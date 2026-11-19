#!/usr/bin/env bash
# Lisa v2 on a rented GPU.  Usage:  bash run.sh <setup|smoke|train|export|serve|all> [--model gemma4|qwen3-14b]
# Needs: NVIDIA GPU (A100 80GB recommended), ~200 GB disk. Optional: HF_TOKEN, LISA_API_KEY (else one is generated).
set -euo pipefail
cd "$(dirname "$0")"
STEP="${1:-help}"; shift || true
MODEL="gemma4"
if [[ "${1:-}" == "--model" ]]; then MODEL="$2"; shift 2; fi
export HF_HOME="${HF_HOME:-$PWD/hf_cache}"
export PATH="$HOME/.local/bin:$PATH"

setup() {
  command -v uv >/dev/null || curl -LsSf https://astral.sh/uv/install.sh | sh
  # Two environments: training (Unsloth/TRL) and serving (vLLM) pin different torch builds.
  [[ -d .venv-train ]] || uv venv .venv-train --python 3.11
  uv pip install --python .venv-train/bin/python -r requirements-train.txt
  [[ -d .venv-serve ]] || uv venv .venv-serve --python 3.11
  uv pip install --python .venv-serve/bin/python -r requirements-serve.txt
  echo "setup done"
}

train_py() { .venv-train/bin/python train.py "$@" 2>&1 | tee -a "logs/$1-$MODEL.log"; }

serve() {
  local dir="out/$MODEL/merged"
  [[ -d "$dir" ]] || { echo "No merged model at $dir - run export first"; exit 1; }
  if [[ -z "${LISA_API_KEY:-}" ]]; then
    LISA_API_KEY="lisa-$(head -c 18 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 24)"
    echo "$LISA_API_KEY" > lisa_api_key.txt
    echo "Generated API key saved to $(pwd)/lisa_api_key.txt - put it in server/.env as VOICE_LLM_API_KEY"
  fi
  echo "Serving $dir as 'lisa-v2' on port 8000 (OpenAI-compatible, key required)"
  exec .venv-serve/bin/vllm serve "$dir" --served-model-name lisa-v2 --host 0.0.0.0 --port 8000 \
    --api-key "$LISA_API_KEY" --max-model-len 4096 --gpu-memory-utilization 0.90 --generation-config auto
}

mkdir -p logs
case "$STEP" in
  setup)  setup ;;
  smoke)  train_py smoke  --model "$MODEL" "$@" ;;
  train)  train_py train  --model "$MODEL" "$@" ;;
  export) train_py export --model "$MODEL" "$@" ;;
  serve)  serve ;;
  all)    setup; train_py smoke --model "$MODEL" "$@"; train_py train --model "$MODEL" "$@"
          train_py export --model "$MODEL" "$@"; serve ;;
  *) sed -n '2,4p' "$0"; exit 1 ;;
esac
