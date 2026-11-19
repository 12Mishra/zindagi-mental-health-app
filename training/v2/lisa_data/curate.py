"""Curation stages after generation: rule filter + dedupe, LLM judge, and human review export/import."""

from __future__ import annotations

import csv
import random
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed

from .common import DATA, LLM, append_jsonl, log, parse_json_object, read_jsonl, write_jsonl
from .rules import conversation_issues, jaccard, shingles

# --------------------------------------------------------------------------- 1. rule filter


def filter_rules(dup_threshold: float = 0.55) -> None:
    kept, rejected = [], []
    seen: list[set[str]] = []
    reasons: Counter[str] = Counter()
    for conv in read_jsonl(DATA / "generated.jsonl"):
        structural, per_turn = conversation_issues(conv)
        # A reply whose ONLY problem is the wrong language/script is dropped as a training target, not the whole
        # conversation - as long as most of Lisa's replies remain usable.
        slips = [i for i, xs in per_turn.items() if all(x.startswith("language_mismatch") for x in xs)]
        lisa_count = sum(t.get("role") == "lisa" for t in conv["turns"])
        conv = {**conv, "skip_turns": slips}
        if slips and len(slips) * 2 <= lisa_count:
            per_turn = {i: xs for i, xs in per_turn.items() if i not in slips}
        problems = structural + [f"turn{i}:{x}" for i, xs in per_turn.items() for x in xs]
        student_text = " ".join(t["text"] for t in conv["turns"] if t.get("role") == "student")
        sig = shingles(student_text)
        if not problems and any(jaccard(sig, s) > dup_threshold for s in seen):
            problems = ["near_duplicate"]
        if problems:
            reasons.update(p.split(":")[0] if not p.startswith("turn") else p.split(":", 1)[1].split(":")[0] for p in problems)
            rejected.append({**conv, "rejected_for": problems})
        else:
            seen.append(sig)
            kept.append(conv)
    write_jsonl(DATA / "filtered.jsonl", kept)
    write_jsonl(DATA / "rejected.jsonl", rejected)
    log(f"rule filter: kept {len(kept)}, rejected {len(rejected)}")
    log("rejection reasons:", dict(reasons.most_common()))


# --------------------------------------------------------------------------- 2. LLM judge

JUDGE_PROMPT = """You are a strict, native-level reviewer of training data for Lisa, an AI support companion for Indian college students that follows Psychological First Aid (PFA). You read English, Hindi, Hinglish, Bengali (script and Roman) and Punjabi (Gurmukhi and Roman) like a native speaker. These conversations will be used to fine-tune Lisa, so a bad Lisa reply teaches the model a bad habit.

Lisa's memory card (the ONLY past facts she may use): {memory}
Scenario requirement: {brief}
Expected language mix: {language}

Conversation (turn index in brackets):
{conversation}

Check every Lisa reply for these problems (list each problem reply in bad_turns):
- language: wrong language or script for the student's latest message; words from any other language (e.g. a Korean, Arabic or random English word inside Bengali); invented or misspelled words; ungrammatical or translated-sounding phrasing a native speaker would not use; disrespectful form (tum/tu/tumi/tui instead of aap/apni/tusi); masculine first-person forms for Lisa in Hindi/Punjabi.
- meaning: a safety question that does not clearly ask whether the student is thinking of harming THEMSELVES; a reply that misstates what the student said.
- pfa: advice in the very first reply; more than one suggestion in a reply; lecturing; ignoring a declined exercise.
- safety: diagnosis, medication, promises ("everything will be fine"), claiming to be human; helplines with no sign of risk; a phone number repeated in several replies.
- memory: any fact about the student's past, people or preferences that is not in the memory card or the conversation.

Score the conversation 1-5 (5 = excellent):
- specificity, pfa, safety, language, memory_fidelity (n/a = 5), scenario_fit, student_realism (does the student sound like one real person, with consistent gender and natural language)

Return ONLY JSON:
{{"scores": {{"specificity": n, "pfa": n, "safety": n, "language": n, "memory_fidelity": n, "scenario_fit": n, "student_realism": n}},
  "bad_turns": [{{"turn": <index of a LISA reply>, "problem": "language|meaning|pfa|safety|memory", "note": "short reason"}}],
  "issue": "one short sentence about the most serious problem, or empty"}}"""

PASS_RULE = ("conversation passes if safety, memory_fidelity >= 4 and every other score >= 3; replies listed in bad_turns "
             "are dropped as training targets; a conversation with a safety/memory bad turn, or with half or more of "
             "Lisa's replies bad, is dropped entirely")


def passes(scores: dict) -> bool:
    values = [float(v) for v in scores.values()]
    return bool(values) and min(values) >= 3 and all(scores.get(k, 0) >= 4 for k in ("safety", "memory_fidelity"))


def verdict(conv: dict, scores: dict, bad_turns: list[dict]) -> bool:
    lisa = {i for i, t in enumerate(conv["turns"]) if t.get("role") == "lisa"}
    bad = {b["turn"] for b in bad_turns if b.get("turn") in lisa}
    severe = any(b.get("problem") in {"safety", "memory"} and b.get("turn") in lisa for b in bad_turns)
    return passes(scores) and not severe and len(bad) * 2 < len(lisa)


def _judge_one(llm: LLM, conv: dict, briefs: dict) -> dict:
    text = "\n".join(f"[{i}] {t['role'].upper()}: {t['text']}" for i, t in enumerate(conv["turns"]))
    prompt = JUDGE_PROMPT.format(memory=conv.get("memory") or "none (first session)",
                                 brief=briefs[conv["job"]["scenario_type"]]["brief"],
                                 language=conv["job"]["language"], conversation=text)
    import os
    out = parse_json_object(llm.chat([{"role": "user", "content": prompt}], json_mode=os.environ.get("JUDGE_JSON_MODE", "1") == "1",
                                     temperature=0.0, max_tokens=int(os.environ.get("JUDGE_MAX_TOKENS", "900"))))
    scores = {k: float(v) for k, v in (out.get("scores") or {}).items() if isinstance(v, (int, float))}
    bad_turns = [b for b in (out.get("bad_turns") or []) if isinstance(b, dict) and isinstance(b.get("turn"), int)]
    return {**conv, "judge": {"model": llm.model, "scores": scores, "bad_turns": bad_turns, "issue": out.get("issue"),
                              "pass": verdict(conv, scores, bad_turns)}}


def judge(workers: int = 2, risk_only: bool = False, source: str = "filtered.jsonl", out_name: str = "judged.jsonl") -> None:
    from .common import env_value, taxonomy

    briefs = taxonomy()["scenario_types"]
    out = DATA / out_name
    done = {c["job"]["id"] for c in read_jsonl(out)}
    todo = [c for c in read_jsonl(DATA / source) if c["job"]["id"] not in done
            and (not risk_only or c["job"]["risk"] != "none")]
    llm = LLM("JUDGE", "qwen/qwen3.8-27b")
    budget = float(env_value("JUDGE_BUDGET_USD") or 0)
    log(f"judging {len(todo)} conversations with {llm.model} (budget ${budget or 'none'}); {PASS_RULE}")
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = {pool.submit(_judge_one, llm, c, briefs): c for c in todo}
        for n, future in enumerate(as_completed(futures), 1):
            try:
                append_jsonl(out, future.result())
            except Exception as error:
                log(f"  {futures[future]['job']['id']} judge failed: {error}")
                if "Daily request limit" in str(error) or "HTTP 402" in str(error):
                    pool.shutdown(wait=False, cancel_futures=True)
                    break
            if n % 50 == 0:
                log(f"  {n}/{len(todo)} judged, usage {llm.usage}")
            if budget and llm.usage["cost_usd"] >= budget:
                log(f"BUDGET STOP: judge spent ${llm.usage['cost_usd']:.3f} >= ${budget}; re-run to continue")
                pool.shutdown(wait=False, cancel_futures=True)
                break
    rows = list(read_jsonl(out))
    log(f"judge pass rate: {sum(r['judge']['pass'] for r in rows)}/{len(rows)}; usage {llm.usage}")


def calibrate(models: list[str]) -> None:
    """Run candidate judges on conversations with known verdicts (data/judge_calibration.jsonl)."""
    import os
    from .common import taxonomy

    briefs = taxonomy()["scenario_types"]
    cases = list(read_jsonl(DATA / "judge_calibration.jsonl"))
    for model in models:
        os.environ["JUDGE_MODEL"] = model
        settings = judge_settings(model)
        os.environ.update({k: v for k, v in settings.items()})
        llm = LLM("JUDGE", model)
        correct, lines = 0, []
        with ThreadPoolExecutor(max_workers=5) as pool:
            results = list(pool.map(lambda c: _safe_judge(llm, c, briefs), cases))
        for case, res in zip(cases, results):
            expected = case["calibration"]["expected"]
            got = "error" if res is None else ("good" if res["judge"]["pass"] else "bad")
            # A bad conversation is also "caught" when the judge drops the offending replies as training targets.
            if got == "good" and expected == "bad" and res["judge"]["bad_turns"]:
                got = "caught-turns"
            correct += got == expected or got == "caught-turns"
            detail = "" if res is None else f"{res['judge']['scores']} bad_turns={[b.get('turn') for b in res['judge']['bad_turns']]} :: {res['judge'].get('issue')}"
            lines.append(f"   {'OK  ' if got == expected else 'MISS'} {case['job']['id']} expected {expected:4} got {got:5} | {detail[:230]}")
        per_conv = llm.usage["cost_usd"] / max(1, llm.usage["calls"])
        log(f"== {model}: {correct}/{len(cases)} correct | ${per_conv:.5f}/conversation -> ~${per_conv * 2600:.2f} for 2,600")
        for line in lines:
            log(line)


def judge_settings(model: str) -> dict:
    """Per-model request settings: Anthropic on OpenRouter has no JSON mode; reasoning models need room to think."""
    if model.startswith("anthropic/"):
        return {"JUDGE_JSON_MODE": "0", "JUDGE_MAX_TOKENS": "1200", "JUDGE_EXTRA_JSON": ""}
    if any(k in model for k in ("gemini-3.7", "gemini-3.8", "gemini-3.5", "qwen3.7-plus", "deepseek-v4-pro", "gpt-5")):
        return {"JUDGE_JSON_MODE": "1", "JUDGE_MAX_TOKENS": "6000", "JUDGE_EXTRA_JSON": '{"reasoning": {"effort": "low"}}'}
    return {"JUDGE_JSON_MODE": "1", "JUDGE_MAX_TOKENS": "1200", "JUDGE_EXTRA_JSON": ""}


def _safe_judge(llm: LLM, conv: dict, briefs: dict):
    try:
        return _judge_one(llm, conv, briefs)
    except Exception as error:  # noqa: BLE001
        log(f"   {llm.model} failed on {conv['job']['id']}: {error}")
        return None


# --------------------------------------------------------------------------- 3. human review

REVIEW_COLUMNS = ["id", "split", "scenario_type", "risk", "language", "judge_pass", "judge_issue", "conversation", "decision", "reviewer_note"]


def review_export(sample_rate: float = 0.10, seed: int = 11) -> None:
    """Every crisis conversation plus a random sample of the rest, for a human (counsellor) to approve/reject."""
    rng = random.Random(seed)
    rows = []
    for c in read_jsonl(DATA / "judged.jsonl"):
        if not c["judge"]["pass"]:
            continue
        if c["job"]["risk"] != "none" or rng.random() < sample_rate:
            memory = f"[memory card: {'; '.join(c['memory'].get('card') or [])}]\n" if c.get("memory") else ""
            convo = memory + "\n".join(f"{t['role'].upper()}: {t['text']}" for t in c["turns"])
            rows.append({"id": c["job"]["id"], "split": c["job"]["split"], "scenario_type": c["job"]["scenario_type"],
                         "risk": c["job"]["risk"], "language": c["job"]["language"], "judge_pass": c["judge"]["pass"],
                         "judge_issue": c["judge"].get("issue") or "", "conversation": convo, "decision": "", "reviewer_note": ""})
    path = DATA / "review.csv"
    with path.open("w", encoding="utf-8-sig", newline="") as stream:  # BOM so Excel shows Hindi correctly
        writer = csv.DictWriter(stream, fieldnames=REVIEW_COLUMNS)
        writer.writeheader()
        writer.writerows(rows)
    log(f"wrote {len(rows)} rows for review ({sum(r['risk'] != 'none' for r in rows)} crisis) -> {path}")
    log("Reviewer: fill 'decision' with approve / reject (and a note), save as CSV UTF-8, then run review-import.")


def review_import() -> dict[str, str]:
    path = DATA / "review.csv"
    decisions = {}
    with path.open(encoding="utf-8-sig", newline="") as stream:
        for row in csv.DictReader(stream):
            d = (row.get("decision") or "").strip().lower()
            if d in {"approve", "approved", "yes", "ok"}:
                decisions[row["id"]] = "approve"
            elif d in {"reject", "rejected", "no"}:
                decisions[row["id"]] = "reject"
    write_jsonl(DATA / "review_decisions.jsonl", ({"id": k, "decision": v} for k, v in decisions.items()))
    log(f"imported {len(decisions)} decisions: {dict(Counter(decisions.values()))}")
    return decisions
