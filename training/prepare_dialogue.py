"""Prepare assistant-target dialogue data without copying source metadata or secrets.

Usage: python training/prepare_dialogue.py --input PATH --output-dir PATH
Outputs are local artifacts and should not be committed.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
from collections import Counter
from pathlib import Path

SYSTEM = (
    "You are Lisa, an AI support companion. Respond briefly in the student's language "
    "using Psychological First Aid principles. Do not diagnose, prescribe, promise an outcome, "
    "or claim to be a human therapist. Exercises are optional."
)
STAGE_DIRECTION = re.compile(r"(?<!\w)(?:\[[^\]]{1,70}\]|\([^)]{1,70}\)|\*[^*]{1,70}\*)(?!\w)")
SECRET_KEYS = re.compile(r"(?:api[_-]?key|token|secret|password|credential)", re.I)
SECRET_VALUE = re.compile(r"(?:sk-[A-Za-z0-9_-]{12,}|AIza[A-Za-z0-9_-]{20,})")
ROMAN_HINDI = re.compile(r"\b(?:nahi|nahin|kya|mujhe|mera|meri|hai|hoon|yaar|samajh)\b", re.I)
RISK = re.compile(r"\b(?:suicide|kill myself|self harm|khudkushi|marna)\b|(?:आत्महत्या|खुदकुशी)", re.I)


def load_records(path: Path) -> list[dict]:
    raw = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(raw, list):
        raise ValueError("Expected a JSON array of conversations")
    return raw


def family(record: dict, index: int) -> str:
    metadata = record.get("scenario") or record.get("metadata") or {}
    if not isinstance(metadata, dict):
        metadata = {}
    value = metadata.get("scenario_family") or metadata.get("family") or metadata.get("id")
    return str(value) if value else f"record-{index}"


def split_for_family(value: str, seed: str) -> str:
    bucket = int(hashlib.sha256(f"{seed}:{value}".encode()).hexdigest()[:8], 16) % 100
    return "train" if bucket < 80 else "validation" if bucket < 90 else "test"


def normalize(record: dict) -> list[dict[str, str]]:
    transcript = record.get("transcript") or record.get("messages") or []
    if not isinstance(transcript, list):
        raise ValueError("Transcript must be a list")
    turns = []
    for item in transcript:
        if not isinstance(item, dict):
            continue
        role = item.get("role") or item.get("from")
        role = "user" if role in {"client", "student", "human", "user"} else (
            "assistant" if role in {"responder", "assistant", "gpt"} else None
        )
        content = item.get("content") or item.get("value")
        if role is None or not isinstance(content, str):
            continue
        text = STAGE_DIRECTION.sub("", content).strip() if role == "assistant" else content.strip()
        text = SECRET_VALUE.sub("[REDACTED]", text)
        if text:
            turns.append({"role": role, "content": text[:2000]})
    return turns


def labels(turns: list[dict[str, str]]) -> list[str]:
    text = " ".join(turn["content"] for turn in turns if turn["role"] == "user")
    labels = []
    if re.search(r"[\u0900-\u097f]", text):
        labels.append("hindi")
    if ROMAN_HINDI.search(text):
        labels.append("hinglish")
    if re.search(r"[A-Za-z]", text):
        labels.append("english")
    if RISK.search(text):
        labels.append("risk_routing")
    return labels


def prepare(records: list[dict], seed: str) -> tuple[dict[str, list[dict]], dict]:
    outputs: dict[str, list[dict]] = {"train": [], "validation": [], "test": []}
    secret_records = 0
    unanswered = 0
    families: dict[str, str] = {}
    coverage: Counter[str] = Counter()
    for index, record in enumerate(records):
        if not isinstance(record, dict):
            raise ValueError(f"Record {index} must be an object")
        if any(SECRET_KEYS.search(str(key)) for key in record):
            secret_records += 1
        group = family(record, index)
        split = split_for_family(group, seed)
        if group in families and families[group] != split:
            raise AssertionError("Family leaked across splits")
        families[group] = split
        turns = normalize(record)
        if turns and turns[-1]["role"] == "user":
            unanswered += 1
        tags = labels(turns)
        if split == "test":
            coverage.update(tags)
        history: list[dict[str, str]] = []
        for turn in turns:
            if turn["role"] == "assistant" and history and history[-1]["role"] == "user":
                # Prompt-completion form trains on the assistant target only.
                outputs[split].append({
                    "prompt": [{"role": "system", "content": SYSTEM}, *history[-12:]],
                    "completion": [{"role": "assistant", "content": turn["content"]}],
                })
            history.append(turn)
    stats = {
        "source_records": len(records), "secret_bearing_records_omitted_from_output": secret_records,
        "unanswered_final_turns_skipped": unanswered,
        "families": len(families), "examples": {name: len(rows) for name, rows in outputs.items()},
        "test_coverage_counts": dict(coverage),
        "missing_evaluation_targets": ["summary_factuality", "acoustic_emotion", "clinical_validation"],
    }
    return outputs, stats


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--seed", default="zindagi-v1")
    args = parser.parse_args()
    records = load_records(args.input)
    outputs, stats = prepare(records, args.seed)
    args.output_dir.mkdir(parents=True, exist_ok=True)
    for name, rows in outputs.items():
        with (args.output_dir / f"{name}.jsonl").open("w", encoding="utf-8") as stream:
            for row in rows:
                stream.write(json.dumps(row, ensure_ascii=False) + "\n")
    (args.output_dir / "manifest.json").write_text(json.dumps(stats, indent=2), encoding="utf-8")
    print(json.dumps(stats, indent=2))


if __name__ == "__main__":
    main()
