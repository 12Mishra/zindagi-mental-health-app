"""Lisa v2 data pipeline. Run from the repository root, e.g.  python -X utf8 training/v2/pipeline.py plan --total 2000

Steps (in order):
  pfa              extract PFA guide excerpts from training/raw/*.pdf   (needs: pip install pypdf)
  plan             build data/jobs.jsonl from config/taxonomy.json
  generate         teacher model writes conversations (resumable)     -> data/generated.jsonl
  filter           hard rules + near-duplicate removal                -> data/filtered.jsonl, data/rejected.jsonl
  judge            LLM judge scores; pass/fail (resumable)            -> data/judged.jsonl
  review-export    crisis + 10% sample for a human reviewer           -> data/review.csv
  review-import    read reviewer decisions                            -> data/review_decisions.jsonl
  build            assistant-only train/validation + eval set         -> data/final/
  eval             score any OpenAI-compatible model                  -> data/eval_runs/<name>.json
  compare          side-by-side table of eval runs                    -> data/eval_runs/comparison.md
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.stdout.reconfigure(encoding="utf-8")
sys.stderr.reconfigure(encoding="utf-8")

from lisa_data import build, curate, evaluate, generate, package, pfa, plan  # noqa: E402


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="step", required=True)
    sub.add_parser("pfa")
    p = sub.add_parser("plan"); p.add_argument("--total", type=int, default=2000); p.add_argument("--seed", type=int, default=7)
    g = sub.add_parser("generate"); g.add_argument("--limit", type=int); g.add_argument("--workers", type=int, default=2)
    g.add_argument("--split", choices=["train", "validation", "test"])
    g.add_argument("--ids", help="comma-separated job ids to generate (e.g. for a pilot)")
    sub.add_parser("filter")
    j = sub.add_parser("judge"); j.add_argument("--workers", type=int, default=2)
    j.add_argument("--risk-only", action="store_true", help="judge only crisis conversations (saves quota)")
    jc = sub.add_parser("judge-calibrate", help="score candidate judge models on data/judge_calibration.jsonl")
    jc.add_argument("models", nargs="+")
    r = sub.add_parser("review-export"); r.add_argument("--sample-rate", type=float, default=0.10)
    sub.add_parser("review-import")
    b = sub.add_parser("build"); b.add_argument("--allow-unreviewed-crisis", action="store_true",
                                                help="experiments only: include crisis examples no human has approved")
    e = sub.add_parser("eval")
    e.add_argument("--name", required=True, help="label for this run, e.g. groq-gpt-oss-120b or lisa-v1-gguf")
    e.add_argument("--base-url", required=True, help="OpenAI-compatible base, e.g. http://127.0.0.1:11434/v1")
    e.add_argument("--model", required=True)
    e.add_argument("--api-key-env", default="", help="NAME of the env var holding the key (never the key itself)")
    e.add_argument("--max-generated", type=int, default=150, help="held-out cases to include (0 = handwritten only)")
    e.add_argument("--judge", action="store_true", help="also score each reply with the judge model")
    e.add_argument("--workers", type=int, default=2)
    c = sub.add_parser("compare"); c.add_argument("names", nargs="+")
    sub.add_parser("package", help="zip gpu/ kit + data/final into lisa_v2_gpu.zip")
    args = parser.parse_args()

    if args.step == "pfa":
        pfa.extract()
    elif args.step == "plan":
        plan.build(args.total, args.seed)
    elif args.step == "generate":
        generate.run(args.limit, args.workers, args.split, args.ids.split(",") if args.ids else None)
    elif args.step == "filter":
        curate.filter_rules()
    elif args.step == "judge":
        curate.judge(args.workers, args.risk_only)
    elif args.step == "judge-calibrate":
        curate.calibrate(args.models)
    elif args.step == "review-export":
        curate.review_export(args.sample_rate)
    elif args.step == "review-import":
        curate.review_import()
    elif args.step == "build":
        build.build(args.allow_unreviewed_crisis)
    elif args.step == "eval":
        evaluate.run(args.name, args.base_url, args.model, args.api_key_env,
                     args.max_generated, args.judge, args.workers)
    elif args.step == "package":
        package.build()
    elif args.step == "compare":
        print(evaluate.compare(args.names))


if __name__ == "__main__":
    main()
