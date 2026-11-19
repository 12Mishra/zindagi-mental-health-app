"""Build assistant-only prompt/completion splits that match the runtime prompt exactly.

Writes data/final/{train,validation}.jsonl (columns: prompt, completion), data/final/eval.jsonl (held-out test
prompts with metadata and the teacher's reference reply), and data/final/manifest.json.
"""

from __future__ import annotations

import json
from collections import Counter

from .common import DATA, log, read_jsonl, render_system, runtime_system_prompt, write_jsonl
from .rules import word_count

HISTORY_MESSAGES = 12


def examples(conv: dict, base_prompt: str) -> list[dict]:
    system = render_system(base_prompt, conv.get("memory"), conv.get("checkin"))
    rows, history = [], []
    for i, turn in enumerate(conv["turns"]):
        role = "user" if turn["role"] == "student" else "assistant"
        if role == "assistant" and history and history[-1]["role"] == "user" and i not in conv.get("skip_turns", []):
            rows.append({
                "prompt": [{"role": "system", "content": system}, *history[-HISTORY_MESSAGES:]],
                "completion": [{"role": "assistant", "content": turn["text"]}],
                "meta": {"conv": conv["job"]["id"], "turn": i, "scenario_type": conv["job"]["scenario_type"],
                         "risk": conv["job"]["risk"], "language": conv["job"]["language"], "kosha": conv["job"]["kosha"],
                         "has_memory": bool(conv.get("memory")), "memory": conv.get("memory")},
            })
        history.append({"role": role, "content": turn["text"]})
    return rows


def build(allow_unreviewed_crisis: bool = False) -> dict:
    decisions = {r["id"]: r["decision"] for r in read_jsonl(DATA / "review_decisions.jsonl")}
    base = runtime_system_prompt()
    splits: dict[str, list[dict]] = {"train": [], "validation": [], "test": []}
    excluded: Counter[str] = Counter()
    convs: Counter[str] = Counter()
    judged = {c["job"]["id"]: c["judge"] for c in read_jsonl(DATA / "judged.jsonl")}
    verdicts = {k: v["pass"] for k, v in judged.items()}
    unjudged = 0
    for conv in read_jsonl(DATA / "filtered.jsonl"):
        cid, split = conv["job"]["id"], conv["job"]["split"]
        if verdicts.get(cid) is False:
            excluded["judge_fail"] += 1
            continue
        unjudged += cid not in verdicts
        bad = [x["turn"] for x in judged.get(cid, {}).get("bad_turns", []) if isinstance(x.get("turn"), int)]
        if bad:
            conv = {**conv, "skip_turns": sorted(set(conv.get("skip_turns", [])) | set(bad))}
            excluded["judge_bad_replies_dropped"] += len(bad)
        if decisions.get(cid) == "reject":
            excluded["human_reject"] += 1
            continue
        if split != "test" and conv["job"]["risk"] != "none" and decisions.get(cid) != "approve" and not allow_unreviewed_crisis:
            excluded["crisis_not_yet_approved"] += 1
            continue
        convs[split] += 1
        splits[split].extend(examples(conv, base))
    out = DATA / "final"
    for name in ("train", "validation"):
        write_jsonl(out / f"{name}.jsonl", ({"prompt": r["prompt"], "completion": r["completion"]} for r in splits[name]))
    write_jsonl(out / "eval.jsonl", splits["test"])
    train = splits["train"]
    lengths = sorted(word_count(r["completion"][0]["content"]) for r in train) or [0]
    openers = Counter(" ".join(r["completion"][0]["content"].split()[:2]) for r in train)
    manifest = {
        "runtime_prompt_sha_hint": base[:60],
        "conversations": dict(convs), "examples": {k: len(v) for k, v in splits.items()},
        "excluded_conversations": dict(excluded),
        "allow_unreviewed_crisis": allow_unreviewed_crisis,
        "conversations_without_llm_judge": unjudged,
        "train_coverage": {dim: dict(Counter(r["meta"][dim] for r in train).most_common())
                           for dim in ("scenario_type", "language", "kosha", "risk")},
        "train_with_memory_pct": round(100 * sum(r["meta"]["has_memory"] for r in train) / max(1, len(train)), 1),
        "reply_words": {"median": lengths[len(lengths) // 2], "p90": lengths[int(len(lengths) * 0.9)], "max": lengths[-1]},
        "reply_question_pct": round(100 * sum("?" in r["completion"][0]["content"] for r in train) / max(1, len(train)), 1),
        "top_openers": openers.most_common(10),
    }
    (out / "manifest.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8")
    log(json.dumps(manifest, indent=2, ensure_ascii=False))
    if excluded["crisis_not_yet_approved"]:
        log(f"NOTE: {excluded['crisis_not_yet_approved']} crisis conversations are waiting for human approval (review-export).")
    return manifest
