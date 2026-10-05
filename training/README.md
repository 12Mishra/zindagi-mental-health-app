# Lisa model preparation

Live Lisa uses the configured base-model endpoint. Fine-tuning is optional and separate from serving. No Lisa weights or clinical validation are included here.

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
