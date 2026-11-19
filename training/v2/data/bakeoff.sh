#!/usr/bin/env bash
# Prompted base-model bake-off on the 39 handwritten cases (no fine-tuning).
cd "$(dirname "$0")/../../.."
run() { python -X utf8 training/v2/pipeline.py eval --name "$1" --base-url https://openrouter.ai/api/v1 --model "$2" \
          --api-key-env OPENROUTER_DATA_GENERATION_KEY --max-generated 0 --judge --workers 3 > "training/v2/data/eval_runs/$1.log" 2>&1; }
mkdir -p training/v2/data/eval_runs
run base-gemma3-12b google/gemma-3-12b-it &
run base-llama31-8b meta-llama/llama-3.1-8b-instruct &
EVAL_EXTRA_JSON='{"reasoning": {"enabled": false}}' run base-qwen3-14b qwen/qwen3-14b &
run base-gemma4-26b-a4b google/gemma-4-26b-a4b-it &
wait
python -X utf8 training/v2/pipeline.py compare base-gemma3-12b base-llama31-8b base-qwen3-14b base-gemma4-26b-a4b
