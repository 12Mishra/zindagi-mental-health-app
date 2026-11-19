"""Extract topic excerpts from the IFRC PFA guide (training/raw/*.pdf) to ground generation.

Page indices are 0-based positions in the extracted PDF (PFA-Guide-low-res.pdf, 106 pages).
Children, group PFA, helper management and M&E chapters are excluded as off-domain for a student companion.
"""

from __future__ import annotations

import re
from pathlib import Path

from .common import DATA, RAW, log, write_jsonl

TOPICS = {
    "what_is_pfa": [12, 13, 14],
    "reactions_to_stress": [16, 21, 22, 23, 24],
    "look": [29, 30, 31],
    "listen_and_calm": [32, 33, 34, 35],
    "link_practical_needs": [36, 37, 38],
    "referrals": [39, 40, 41],
    "self_harm_and_suicide": [44],
    "grief": [45, 46],
    "depression_and_low_mood": [47],
    "do_no_harm_dos_donts": [84, 85, 87],
}

# Which excerpts each scenario type draws from (first is always used, one more is sampled).
SCENARIO_TOPICS = {
    "standard_support": ["listen_and_calm", "reactions_to_stress", "link_practical_needs"],
    "crisis_uncertain": ["self_harm_and_suicide", "referrals"],
    "crisis_explicit": ["self_harm_and_suicide", "referrals"],
    "exercise_declined": ["listen_and_calm", "do_no_harm_dos_donts"],
    "memory_recall_present": ["listen_and_calm", "do_no_harm_dos_donts"],
    "memory_recall_absent": ["do_no_harm_dos_donts", "listen_and_calm"],
    "memory_declined_exercise": ["listen_and_calm", "link_practical_needs"],
    "minimal_responses": ["listen_and_calm", "look"],
    "skeptical_or_hostile": ["do_no_harm_dos_donts", "listen_and_calm"],
    "boundary_request": ["what_is_pfa", "referrals", "do_no_harm_dos_donts"],
    "positive_checkin": ["link_practical_needs", "listen_and_calm"],
}


def _clean(page: str) -> str:
    page = page.replace("�", "'")
    page = re.sub(r"A GUIDE TO PSYCHOLOGICAL FIRST AID|[A-Z ,\-–:]{12,}(?=\s)", " ", page)  # running headers
    page = re.sub(r"[A-Z ]+/ ?[A-Z ]+(?:CROSS|CRESCENT|IFRC)\b", " ", page)  # photo credits
    page = re.sub(r"(\w)-\n(\w)", r"\1\2", page)
    page = re.sub(r"\s+", " ", page)
    return page.strip()


def extract(pdf: Path | None = None) -> list[dict]:
    from pypdf import PdfReader  # only this step needs a third-party package

    pdf = pdf or next(RAW.glob("*.pdf"))
    pages = [p.extract_text() or "" for p in PdfReader(str(pdf)).pages]
    chunks = []
    for topic, indices in TOPICS.items():
        text = " ".join(_clean(pages[i]) for i in indices if i < len(pages))
        # Keep excerpts short: they steer tone and principles, they are not training targets.
        for n, start in enumerate(range(0, len(text), 1400)):
            piece = text[start:start + 1600].strip()
            if len(piece) > 300:
                chunks.append({"topic": topic, "chunk": n, "text": piece})
    out = DATA / "pfa_chunks.jsonl"
    write_jsonl(out, chunks)
    log(f"wrote {len(chunks)} PFA excerpts across {len(TOPICS)} topics -> {out}")
    return chunks
