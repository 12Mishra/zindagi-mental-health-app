# Lisa v2 data and training pipeline

Builds a fine-tuning set for Lisa that matches what the app actually sends the model, then measures any model on the same cases.

Why v2: the v1 data (`dataset_final.jsonl`) had 100 English-only conversations covering 2 of 5 koshas, replies averaging 75 words (the app asks for under 45), no crisis, Hindi or memory examples, every conversation ending on a student turn, and loss computed on student text too.

## What it produces

| Coverage (default 2,000 conversations) | |
|---|---|
| Koshas | all 5, Manomaya weighted highest |
| Languages | English 35%, Hinglish 27%, Hindi (Devanagari) 25%, mid-conversation switch 13% |
| Scenarios | standard support, uncertain and explicit crisis, declined exercise, memory recall (present / absent / declined exercise), one-word replies, hostile, boundary requests (diagnosis, meds, "are you human", homework), good news |
| Prompt format | exact runtime `SYSTEM_PROMPT`, read from `server/src/conversation/services/context.service.ts`, plus `<checkin>` and `<memory_card>` rendered like `prompt-builder.ts` |
| Targets | Lisa replies only (assistant-only loss), one example per Lisa turn with up to 12 prior messages |

Resources Lisa may name are set in `config/policy.json`: **Tele-MANAS (14416)** and a generic **campus counsellor**. Any other number or helpline name fails the filter. `allow_emergency_112` is `false`.

## Run order (from the repository root)

```bash
python -m venv training/.venv && training/.venv/Scripts/pip install pypdf   # only the pfa step needs it
training/.venv/Scripts/python -X utf8 training/v2/pipeline.py pfa           # PDF in training/raw/
python -X utf8 training/v2/pipeline.py plan --total 2000
python -X utf8 training/v2/pipeline.py generate          # resumable; re-run to continue
python -X utf8 training/v2/pipeline.py filter
python -X utf8 training/v2/pipeline.py judge             # resumable
python -X utf8 training/v2/pipeline.py review-export     # -> data/review.csv for the counsellor
python -X utf8 training/v2/pipeline.py review-import
python -X utf8 training/v2/pipeline.py build             # -> data/final/
python -X utf8 -m unittest discover -s training/v2 -p "test_*.py"
```

`data/seeds.jsonl` (the 100 original scenarios, recovered from `dataset_final.jsonl`) must exist before `plan`.

**Crisis examples are excluded from `build` until a human approves them** in `review.csv`. `--allow-unreviewed-crisis` exists for experiments only.

## Models and keys

| Role | Default | Override |
|---|---|---|
| Teacher (writes conversations) | `openai/gpt-oss-120b` on Groq | `TEACHER_BASE_URL`, `TEACHER_MODEL`, `TEACHER_API_KEY_ENV`, `TEACHER_TPM` |
| Judge | `qwen/qwen3.8-27b` on Groq (a different family from the teacher) | `JUDGE_*` |

Keys are read by **variable name** from the environment, `training/.env` or `server/.env`. The default is `CONTEXT_SAVING_LLM_GROQ`. Never paste keys into chat or commit them.

**Rate limits:** on Groq's free tier (8k tokens/min, 1,000 requests/day per model), each conversation costs about 3k tokens and about 1.5 requests. That's about 2 conversations a minute and roughly 650 a day, so 2,000 takes about 3 days and shares the quota with the app's own summaries. A paid tier or another OpenAI-compatible provider removes this bottleneck.

## Evaluate and compare

```bash
python -X utf8 training/v2/pipeline.py eval --name lisa-v1 --base-url http://127.0.0.1:11434/v1 --model lisa --judge
python -X utf8 training/v2/pipeline.py eval --name groq-prompted --base-url https://api.groq.com/openai/v1 --model openai/gpt-oss-120b --api-key-env CONTEXT_SAVING_LLM_GROQ --judge
python -X utf8 training/v2/pipeline.py compare lisa-v1 groq-prompted
```

Cases: 30 handwritten checks (`config/eval_handwritten.jsonl`: crisis in 3 languages, memory, declined exercises, boundaries, injection, language switches) plus held-out test conversations. Ship a fine-tune only if it beats the prompted baseline on crisis routing, language match and judge scores.

## Train

`python training/v2/build_notebook.py` writes `train_lisa_v2.ipynb`, which runs QLoRA on Qwen3-8B with assistant-only loss, all linear layers, r=16, early stopping, merge, then GGUF Q4_K_M. Use an L4 or A100. A free T4 works but takes many hours on the full set. Serve it with `training/Modelfile.v2`, which sets no system prompt because the app sends its own.

## Known limits

- All data is synthetic and was written by an LLM. The judge is an LLM too. Only human review establishes quality, and clinical validity needs a counsellor.
- `session_notes`, `recalled_memories` and `turn_brief` (produced live by the context agent) are not simulated.
- Lisa is written with feminine first-person forms in Hindi and Hinglish. Change `generate.py` and `policy.json` (`lisa_masculine_form`) if the product decides otherwise.
