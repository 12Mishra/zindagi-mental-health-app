# Lisa v2: train and serve on a rented GPU

Contents: `data/` (training data), `train.py`, `run.sh`, two requirements files, `qwen_nothink.jinja`.

## 1. Rent the GPU (RunPod, Vast or Lambda)

| Choice | GPU | Why |
|---|---|---|
| **Recommended** | **A100 80GB** or H100 80GB | Gemma 4 fits easily for training, merging and serving; fastest run |
| Cheaper | L40S / A6000 48GB | 4-bit training works; serving the merged 16-bit Gemma 4 (~52 GB) does **not** fit. Use `--model qwen3-14b` here. |

- Image: any CUDA 12.x PyTorch template (Python 3.11).
- **Disk: 200 GB** (base model ~52 GB + merged model ~52 GB + environments ~25 GB).
- Expose **HTTP port 8000**.
- Gemma 4 needs Ampere or newer (A100/L40S/H100). Do **not** use a T4 or V100.

## 2. Upload and unpack

Upload `lisa_v2_gpu.zip` with the pod's Jupyter file browser, then in a terminal:

```bash
cd /workspace && unzip -q lisa_v2_gpu.zip && cd lisa_v2_gpu
```

Run everything inside `tmux` so a dropped browser tab doesn't kill training: `tmux new -s lisa` (reattach with `tmux attach -t lisa`).

## 3. Run

```bash
bash run.sh setup                 # ~10 min: installs uv, the training env and the vLLM env
bash run.sh smoke                 # ~10 min: loads Gemma 4, trains 10 steps, prints sample replies and a time estimate
bash run.sh train                 # the full run; the smoke step prints how long (expect ~2-4 h on an A100)
bash run.sh export                # ~15 min: merges the adapter -> out/gemma4/merged
bash run.sh serve                 # vLLM on port 8000, model name "lisa-v2", API key printed and saved to lisa_api_key.txt
```

**If `smoke` fails for Gemma 4**, add `--model qwen3-14b` to every step from `smoke` onward. Same commands, same data. Other useful flags:
- `--bf16`: skip 4-bit if quantising the MoE errors (A100 80GB only)
- `--resume out/gemma4/checkpoints/checkpoint-N`: continue after an interruption

**Before you start the full run, check the smoke output:**
1. The rendered prompt ends with the model's "assistant turn" marker, and the completion is a short Lisa reply ending in an end-of-turn token.
2. The loss values printed during the 10 steps go down, or at least don't explode or show NaN.
3. The 2 sample replies are coherent.

## 4. Point the app at it (`server/.env`)

```
VOICE_LLM_BASE_URL=https://<pod-id>-8000.proxy.runpod.net/v1/
VOICE_LLM_MODEL=lisa-v2
VOICE_LLM_API_KEY=<contents of lisa_api_key.txt>
VOICE_LLM_TEMPERATURE=0.5
CHAT_LLM_PROVIDER=voice
```

`VOICE_LLM_TEMPERATURE=0.5` matters: without it vLLM uses Gemma's default of 1.0, which is too random for Lisa.

`CHAT_LLM_PROVIDER=voice` makes the text chat use the same endpoint as voice. vLLM requires the API key on every request, so the public proxy URL is not open to anyone.

## 5. Evaluate from your laptop

```bash
set LISA_GPU_KEY=<key>      (PowerShell: $env:LISA_GPU_KEY="<key>")
python -X utf8 training/v2/pipeline.py eval --name lisa-v2-ft --base-url https://<pod-id>-8000.proxy.runpod.net/v1 --model lisa-v2 --api-key-env LISA_GPU_KEY --max-generated 150
python -X utf8 training/v2/pipeline.py compare base-gemma4-26b-a4b lisa-v2-ft
```

Compare against the prompted baseline (`base-gemma4-26b-a4b`, already run). If the fine-tune is worse on crisis or language match, fall back to a prompted model by switching the env vars.

## Costs and safety
- **Stop the pod when you're not using it.** The merged model in `out/` survives only while the pod's volume exists; download `out/gemma4/adapter` (~a few hundred MB) to keep a copy.
- This is a **demo-grade** model: crisis examples were not counsellor-reviewed. The app's independent safety classifier and fixed crisis messages remain the real safeguard.
