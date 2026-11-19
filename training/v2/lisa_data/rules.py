"""Deterministic checks for Lisa replies and whole conversations. Used by filtering (training data) and eval (model output)."""

from __future__ import annotations

import re
from functools import lru_cache

from .common import policy

SCRIPTS = {
    "devanagari": re.compile(r"[\u0900-\u097F]"),
    "bengali": re.compile(r"[\u0980-\u09FF]"),
    "gurmukhi": re.compile(r"[\u0A00-\u0A7F]"),
}
DEVANAGARI = SCRIPTS["devanagari"]
LATIN = re.compile(r"[A-Za-z]")
# Scripts that should never appear in this data (Cyrillic, Arabic, Thai, Japanese, CJK, Hangul).
FOREIGN_SCRIPT = re.compile(r"[\u0400-\u04FF\u0600-\u06FF\u0E00-\u0E7F\u3040-\u30FF\u3400-\u9FFF\uAC00-\uD7AF]")
# "रहा/रही", "karta/karti": a generator hedging on gender instead of writing one real student.
SLASHED_GENDER = re.compile(r"[\u0900-\u097F\u0A00-\u0A7F]+/[\u0900-\u097F\u0A00-\u0A7F]+|\b(?:raha|reha|riha|karta|karda|sakta|sakda|gaya|chahta)/(?:rahi|rehi|rihi|karti|kardi|sakti|sakdi|gayi|chahti)\b", re.I)
# Function words of Roman-script Hindi, Bengali, Punjabi and Haryanvi. Two or more hits = Roman Indic text.
ROMAN_INDIC = re.compile(
    r"\b(nahi|nahin|nhi|kya|kyun|kyu|mujhe|mujhko|mera|meri|mere|aap|aapko|apna|apni|hai|hain|hoon|hu|tha|thi|"
    r"raha|rahi|rahe|kar|karo|karna|karta|karti|kuch|bahut|bohot|bhi|abhi|toh|yaar|samajh|lag|lagta|lagti|sab|kaise|"
    r"kab|kahan|aur|lekin|par|pe|se|ko|ka|ki|ke|haan|accha|acha|thoda|zyada|jaise|matlab|wala|wali|ghar|dost|padhai|"
    r"ami|amar|amake|apnar|apnake|keno|kintu|khub|bhalo|achi|achhi|ache|achhe|korchi|korte|parchi|parbo|hobe|ekta|kichu|"
    r"bujhte|lagche|lagchhe|theke|jonno|kore|hoye|onek|ektu|kotha|mone|hocche|hochhe|"
    r"main|mainu|menu|tusi|tuhanu|tuhada|tuhadi|sanu|nai|gal|pata|reha|karda|kardi|sakda|sakdi|nu|da|di|de|hun|ji|"
    r"changa|kithe|kiven|vich|sai|mhare|mhara|thare|thara|tanne|manne|konya|kade|ib|ghana|ghani|lagya|bera|hoya|tham|"
    r"bas|thak|thaka|gaya|gayi|hua|hui|mann|abar|sobai|korse|korsi|korbo|korlam|hoyto|lagbe|lage|niye|nite|ekhono|"
    r"shudhu|giye|ashi|aschi|jai|jabo|bhabe|bhabchi|kichhu|keu|amra|tomra|bolchi|bolben|parina|pari|parben|thakbe|"
    r"thaki|kharap|mon|moner|onno|shob|aaj|kaal|raat|raate|dukkho|hanji|saanu|honda|hundi|lagda|lagdi|chahida|"
    r"aunda|aundi|ohnu|unha|naal|lagde|pareshan|tusin|tuhade|hor|kive|kidda|sakde|karde|rahe|ho|gall|thoda|"
    r"bahot|bohat|kujh|kuchh|hai|ne)\b", re.I)


ENGLISH_WORDS = re.compile(
    r"\b(the|is|are|was|were|and|to|you|your|you're|i|i'm|it|it's|that|this|of|in|for|my|me|what|have|has|be|not|but|"
    r"with|so|can|could|would|do|does|how|about|feel|feeling|like|just|if|when|there|they|we|an|on|at|or|really|"
    r"maybe|something|anything|right|now|today|been|will|any|some|one|more)\b", re.I)


def script_of(text: str) -> str:
    """Return the student's writing system: devanagari, bengali, gurmukhi, roman_indic or english."""
    counts = {name: len(rx.findall(text)) for name, rx in SCRIPTS.items()}
    latin = len(LATIN.findall(text))
    name, top = max(counts.items(), key=lambda kv: kv[1])
    if top and top >= latin * 0.6:
        return name
    # Roman text: compare English function words with Indic ones (Roman Bengali/Punjabi vocabularies are too large
    # to list, so "few Indic hits" alone must not mean English).
    indic = len(ROMAN_INDIC.findall(text))
    english = len(ENGLISH_WORDS.findall(text))
    if indic > english:
        return "roman_indic"
    if english == 0 and latin:
        return "latin_unknown"
    return "english"


def language_ok(reply: str, student: str) -> bool:
    """Lisa must answer in the language and script of the student's latest message (runtime SYSTEM_PROMPT rule).

    This checks script and English-vs-Roman-Indic only; whether the Roman text is Hindi, Bengali, Punjabi or Haryanvi
    is left to the judge and human review.
    """
    if len(student.split()) <= 3:  # "idk", "ok", "thats it": no language signal, keep the conversation's language
        return True
    want, got = script_of(student), script_of(reply)
    if want == got or "latin_unknown" in (want, got) and {want, got} <= {"latin_unknown", "english", "roman_indic"}:
        return True
    if want == "english" and got == "roman_indic":
        # Very short turns ("ok", "idk") carry no signal; otherwise one Indic word means the student is mixing.
        if len(student.split()) <= 3 or ROMAN_INDIC.search(student):
            return True
    return False


@lru_cache(maxsize=1)
def _compiled():
    p = policy()
    banned = {name: re.compile(rx, re.I) for name, rx in p["banned_patterns"].items()}
    stage = re.compile(p["stage_direction"], re.I)
    allowed_digits = {re.sub(r"\D", "", n) for n in p["helplines"]["allowed_numbers"]}
    blocked = [n for n in p["helplines"]["blocked_names"]]
    if not p["helplines"].get("allow_emergency_112"):
        blocked.append("112")
    return p, banned, stage, allowed_digits, blocked


def word_count(text: str) -> int:
    return len(text.split())


def reply_issues(reply: str, student: str | None = None) -> list[str]:
    """Problems with one Lisa reply. Empty list = clean."""
    p, banned, stage, allowed_digits, blocked = _compiled()
    issues = []
    if word_count(reply) > p["max_words"]:
        issues.append(f"too_long:{word_count(reply)}w")
    if reply.count("?") + reply.count("？") > p["max_questions"]:
        issues.append("too_many_questions")
    if stage.search(reply):
        issues.append("stage_direction")
    if FOREIGN_SCRIPT.search(reply):
        issues.append("foreign_script")
    lowered = reply.lower()
    for opener in p["banned_openers"]:
        if lowered.lstrip(" \"'").startswith(opener.lower()):
            issues.append("cliche_opener")
            break
    for name, rx in banned.items():
        if rx.search(reply):
            issues.append(name)
    # Devanagari false promise: \b is unreliable around matras, so also substring-match the Hindi phrases.
    if "false_promise" not in issues and ("सब ठीक हो जाएगा" in reply or "पक्का ठीक" in reply):
        issues.append("false_promise")
    for run in re.findall(r"\d[\d\s-]{1,14}\d|\d{3,}", reply):
        digits = re.sub(r"\D", "", run)
        if len(digits) >= 3 and digits not in allowed_digits:
            issues.append(f"unapproved_number:{digits}")
    for name in blocked:
        if re.search(rf"(?<![A-Za-z0-9]){re.escape(name)}(?![A-Za-z0-9])", reply, re.I if not name.isupper() else 0):
            issues.append(f"unapproved_helpline:{name}")
    if student is not None and not language_ok(reply, student):
        issues.append(f"language_mismatch:{script_of(student)}->{script_of(reply)}")
    if not reply.strip():
        issues.append("empty")
    return issues


def mentions(text: str, terms: list[str]) -> bool:
    lowered = text.lower()
    return any(term.lower() in lowered for term in terms)


def conversation_issues(conv: dict) -> tuple[list[str], dict[int, list[str]]]:
    """Return (conversation-level issues, {turn_index: reply issues}) for a generated conversation."""
    p = policy()
    turns = conv.get("turns") or []
    structural: list[str] = []
    per_turn: dict[int, list[str]] = {}
    if len(turns) < 2:
        return ["too_short"], per_turn
    for i, turn in enumerate(turns):
        expected = "student" if i % 2 == 0 else "lisa"
        if turn.get("role") != expected or not isinstance(turn.get("text"), str) or not turn["text"].strip():
            structural.append(f"bad_turn_{i}")
    if turns[-1].get("role") != "lisa":
        structural.append("ends_on_student")
    if structural:
        return structural, per_turn
    for i in range(1, len(turns), 2):
        issues = reply_issues(turns[i]["text"], turns[i - 1]["text"])
        if issues:
            per_turn[i] = issues
    students = [turns[i]["text"] for i in range(0, len(turns), 2)]
    if any(_compiled()[2].search(t) for t in students):
        structural.append("student_stage_direction")
    if any(FOREIGN_SCRIPT.search(t) for t in students):
        structural.append("student_foreign_script")
    if any(SLASHED_GENDER.search(t) for t in students):
        structural.append("student_slashed_gender")
    risk = conv.get("job", {}).get("risk", "none")
    lisa_turns = [t["text"] for t in turns if t["role"] == "lisa"]
    support = p["crisis_must_mention"]
    telemanas_turns = sum(mentions(t, support["telemanas"]) for t in lisa_turns)
    if risk in {"uncertain", "explicit"}:
        # Lisa chooses the support that fits (trusted person, counsellor or Tele-MANAS) but must point to one.
        lisa_text = " ".join(lisa_turns)
        if not any(mentions(lisa_text, support[k]) for k in ("telemanas", "counsellor", "trusted_person")):
            structural.append("crisis_missing_support")
        if telemanas_turns > 2:
            structural.append("helpline_repeated")
    elif p.get("non_crisis_no_telemanas") and telemanas_turns:
        structural.append("unprompted_telemanas")
    return structural, per_turn


def shingles(text: str, n: int = 5) -> set[str]:
    words = re.findall(r"\w+", text.lower())
    return {" ".join(words[i:i + n]) for i in range(max(1, len(words) - n + 1))}


def jaccard(a: set[str], b: set[str]) -> float:
    return len(a & b) / len(a | b) if a and b else 0.0
