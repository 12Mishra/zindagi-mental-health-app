"""Turn taxonomy.json quotas into a deterministic list of generation jobs (data/jobs.jsonl)."""

from __future__ import annotations

import random
from collections import Counter

from .common import DATA, log, read_jsonl, taxonomy, weighted_choice, write_jsonl
from .pfa import SCENARIO_TOPICS

MEMORY_SCENARIOS = {"memory_recall_present", "memory_recall_absent", "memory_declined_exercise"}


def build(total: int, seed: int = 7) -> list[dict]:
    tax = taxonomy()
    rng = random.Random(seed)
    seeds = list(read_jsonl(DATA / "seeds.jsonl"))
    seeds_by_kosha: dict[str, list[dict]] = {}
    for s in seeds:
        seeds_by_kosha.setdefault(s["kosha"], []).append(s)
    pfa = list(read_jsonl(DATA / "pfa_chunks.jsonl"))
    pfa_by_topic: dict[str, list[dict]] = {}
    for c in pfa:
        pfa_by_topic.setdefault(c["topic"], []).append(c)

    jobs = []
    for n in range(total):
        scenario = weighted_choice(rng, tax["scenario_types"])
        spec = tax["scenario_types"][scenario]
        kosha = weighted_choice(rng, tax["koshas"])
        language = weighted_choice(rng, tax["languages"])
        seed_ref = None
        # Reuse an original scenario for the two koshas the old data covered, a third of the time.
        if kosha in seeds_by_kosha and rng.random() < 0.33:
            seed_ref = rng.choice(seeds_by_kosha[kosha])
            subcategory = seed_ref["subcategory"]
        else:
            subcategory = rng.choice(tax["koshas"][kosha]["subcategories"])
        topics = SCENARIO_TOPICS[scenario]
        picked = [topics[0]] + ([rng.choice(topics[1:])] if len(topics) > 1 else [])
        excerpt_ids = []
        for topic in picked:
            if pfa_by_topic.get(topic):
                c = rng.choice(pfa_by_topic[topic])
                excerpt_ids.append(f"{c['topic']}:{c['chunk']}")
        style = rng.sample(seeds, k=min(2, len(seeds)))
        # Jobs reusing the same original scenario share a split so it can't leak from train into test.
        r = random.Random(seed_ref["seed_id"]).random() if seed_ref else rng.random()
        split = "test" if r < tax["split"]["test"] else "validation" if r < tax["split"]["test"] + tax["split"]["validation"] else "train"
        jobs.append({
            "id": f"v2-{n:05d}",
            "split": split,
            "scenario_type": scenario,
            "risk": spec["risk"],
            "kosha": kosha,
            "subcategory": subcategory,
            "seed_scenario": seed_ref["scenario"] if seed_ref else None,
            "language": language,
            "persona": {k: rng.choice(v) for k, v in tax["personas"].items()},
            "lisa_turns": rng.randint(tax["lisa_turns"]["min"], tax["lisa_turns"]["max"]),
            "with_memory": scenario in MEMORY_SCENARIOS or rng.random() < (tax.get("crisis_memory_probability", 0.6)
                                                                              if spec["risk"] != "none" else tax["memory_probability_for_other_scenarios"]),
            "with_checkin": rng.random() < tax["checkin_probability"],
            "pfa_excerpts": excerpt_ids,
            "style_samples": [s["student_samples"][0] for s in style if s["student_samples"]],
        })
    write_jsonl(DATA / "jobs.jsonl", jobs)
    for dim in ("scenario_type", "kosha", "language", "split"):
        log(dim, dict(Counter(j[dim] for j in jobs).most_common()))
    log(f"wrote {len(jobs)} jobs -> {DATA / 'jobs.jsonl'}")
    return jobs
