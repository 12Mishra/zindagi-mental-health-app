# Lisa model setup and preparation

The existing `Modelfile` from `feat/lisa-voice-pipeline` imports `lisa-mistral-7b-q4km.gguf` with temperature 0.7, top-p 0.9, and context 4096. The GGUF is distributed separately and ignored by Git; the file is not present merely because the branch was checked out. Its filename does not by itself verify the training history or clinical validity.

## Use the existing Lisa GGUF locally

1. Download the complete `lisa-mistral-7b-q4km.gguf` into this `training/` directory, beside `Modelfile`.
2. From the repository root, run `ollama create lisa -f training/Modelfile`, then `ollama run lisa` for a basic local check.
3. In `server/.env`, set `VOICE_LLM_BASE_URL=http://127.0.0.1:11434/v1/`, `VOICE_LLM_MODEL=lisa`, and `OLLAMA_MODEL=lisa`. Leave `VOICE_LLM_API_KEY=` empty for the local server. Configure the safety checker and speech providers separately.

The realtime client calls Ollama's OpenAI-compatible streaming endpoint. It does not override the Modelfile's sampling temperature. Run the bilingual and safety evaluations before treating this GGUF as demo-ready. CPU-only response time may be too slow for the proposed realtime latency target.

## Prepare the supplied synthetic dialogue file

From the repository root:

```powershell
python training/prepare_dialogue.py --input "C:\path\to\simulated_conversations.json" --output-dir training/prepared
python -m unittest discover -s training -p 'test_*.py' -v
```

The script accepts both `scenario` and `metadata` envelopes and `transcript`/`messages` turns. It reads only role/content fields, removes stage directions from assistant targets, redacts secret-looking text, and never writes the input's credential fields. It groups splits by scenario family before creating assistant-only prompt/completion targets. An unanswered final student turn is skipped, not fabricated. Review the generated examples and `manifest.json` before training. `training/prepared/` is Git ignored.

The supplied 100-record file produced 231 train, 27 validation, and 42 test targets in the local preparation run on 2026-10-06. Its test split showed English text only, so the separate [evaluation cases](eval_cases.jsonl) provide unreviewed synthetic Hindi/Hinglish prompts. These are engineering checks, not clinical labels. There are no audio or summary targets in the attachment.

## Colab

Open [colab_qlora.ipynb](colab_qlora.ipynb). Upload the prepared train and validation files to a Drive folder you control. Review the model license, package versions, GPU availability, and data permission. Set `RUN_TRAINING=True` only when ready. The notebook checks for a CUDA GPU, uses bounded sequence and batch settings, can resume a checkpoint, and saves the adapter/tokenizer/manifest to Drive. Training has not been run in this repository. The old `finetune_colab.py` and `finetune_1000_conversations.ipynb` are historical experiments and should not be used as evidence of a trained model.

The source attachment contains an `api_key_used` field in every record. If those values are active credentials, rotate them. Do not test, print, or commit them.
