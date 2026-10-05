"""Build the checked-in Colab notebook from readable source cells."""

import json
from pathlib import Path


def markdown(source: str) -> dict:
    return {"cell_type": "markdown", "metadata": {}, "source": source.splitlines(True)}


def code(source: str) -> dict:
    return {"cell_type": "code", "metadata": {}, "source": source.splitlines(True), "execution_count": None, "outputs": []}


cells = [
    markdown("""# Lisa QLoRA preparation (Colab)

This notebook trains an **experimental** adapter on sanitized, assistant-target dialogue examples. It does not train speech or acoustic models, establish clinical validity, or serve the live demo. Run `prepare_dialogue.py` locally, review the manifest and examples, then upload only `train.jsonl` and `validation.jsonl` to your own Drive folder. The held-out `test.jsonl` stays separate.

Training is off by default. Colab GPU access and runtime duration vary. Confirm model license, account access, dataset permission, and GPU availability before running. Save adapters and tokenizer to Drive; the notebook does not claim a GGUF export.
"""),
    code("""%pip install -q 'transformers>=4.55,<5' 'trl>=0.21,<0.30' 'peft>=0.17,<1' 'accelerate>=1.10,<2' 'bitsandbytes>=0.47,<1' 'datasets>=3,<5'
"""),
    code("""import importlib.metadata as metadata
import json
from pathlib import Path
import torch

RUN_TRAINING = False  # Set True after reviewing the data and GPU.
MODEL_ID = 'Qwen/Qwen2.5-1.5B-Instruct'
MAX_LENGTH = 1024
BATCH_SIZE = 1
GRADIENT_ACCUMULATION = 4
EPOCHS = 1
TRAIN_FILE = Path('/content/drive/MyDrive/zindagi_dataset/train.jsonl')
VALIDATION_FILE = Path('/content/drive/MyDrive/zindagi_dataset/validation.jsonl')
OUTPUT_DIR = Path('/content/drive/MyDrive/zindagi_lisa_adapter')
RESUME_FROM_CHECKPOINT = None  # Set to an existing checkpoint directory to resume.

print({name: metadata.version(name) for name in ('transformers', 'trl', 'peft', 'accelerate', 'bitsandbytes', 'datasets')})
if not torch.cuda.is_available():
    print('No CUDA GPU available. Keep RUN_TRAINING=False.')
else:
    print('GPU:', torch.cuda.get_device_name(0), 'memory GiB:', round(torch.cuda.get_device_properties(0).total_memory / 2**30, 1))
"""),
    code("""if RUN_TRAINING:
    assert torch.cuda.is_available(), 'A CUDA GPU is required for this QLoRA configuration.'
    assert torch.cuda.get_device_properties(0).total_memory >= 8 * 2**30, 'Use a smaller model or a larger GPU.'
    from google.colab import drive
    drive.mount('/content/drive')
    assert TRAIN_FILE.exists() and VALIDATION_FILE.exists(), 'Upload the prepared split files to Drive first.'
    from datasets import load_dataset
    dataset = load_dataset('json', data_files={'train': str(TRAIN_FILE), 'validation': str(VALIDATION_FILE)})
    assert len(dataset['train']) and len(dataset['validation'])
    assert set(dataset['train'].column_names) == {'prompt', 'completion'}
    print('Train / validation examples:', len(dataset['train']), len(dataset['validation']))
"""),
    code("""if RUN_TRAINING:
    from transformers import AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig
    from peft import LoraConfig, prepare_model_for_kbit_training
    from trl import SFTConfig, SFTTrainer
    import inspect
    assert 'completion_only_loss' in inspect.signature(SFTConfig).parameters, 'Installed TRL API differs from this notebook.'
    dtype = torch.bfloat16 if torch.cuda.is_bf16_supported() else torch.float16
    quantization = BitsAndBytesConfig(load_in_4bit=True, bnb_4bit_quant_type='nf4', bnb_4bit_use_double_quant=True, bnb_4bit_compute_dtype=dtype)
    tokenizer = AutoTokenizer.from_pretrained(MODEL_ID, use_fast=True)
    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.eos_token
    model = AutoModelForCausalLM.from_pretrained(MODEL_ID, quantization_config=quantization, device_map='auto')
    model = prepare_model_for_kbit_training(model)
    lora = LoraConfig(r=8, lora_alpha=16, lora_dropout=0.05, bias='none', task_type='CAUSAL_LM', target_modules=['q_proj', 'k_proj', 'v_proj', 'o_proj'])
    args = SFTConfig(output_dir=str(OUTPUT_DIR / 'checkpoints'), max_length=MAX_LENGTH,
        per_device_train_batch_size=BATCH_SIZE, gradient_accumulation_steps=GRADIENT_ACCUMULATION,
        num_train_epochs=EPOCHS, learning_rate=1e-4, logging_steps=10, save_steps=50,
        save_strategy='steps', eval_strategy='steps', eval_steps=50, completion_only_loss=True,
        fp16=dtype == torch.float16, bf16=dtype == torch.bfloat16, report_to='none')
    trainer = SFTTrainer(model=model, args=args, train_dataset=dataset['train'],
        eval_dataset=dataset['validation'], peft_config=lora, processing_class=tokenizer)
"""),
    code("""if RUN_TRAINING:
    trainer.train(resume_from_checkpoint=RESUME_FROM_CHECKPOINT)
    evaluation = trainer.evaluate()
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    trainer.model.save_pretrained(str(OUTPUT_DIR / 'adapter'))
    tokenizer.save_pretrained(str(OUTPUT_DIR / 'adapter'))
    manifest = {
        'base_model': MODEL_ID, 'max_length': MAX_LENGTH, 'batch_size': BATCH_SIZE,
        'gradient_accumulation': GRADIENT_ACCUMULATION, 'epochs': EPOCHS,
        'versions': {name: metadata.version(name) for name in ('transformers', 'trl', 'peft', 'accelerate', 'bitsandbytes', 'datasets')},
        'validation_metrics': {key: float(value) for key, value in evaluation.items() if isinstance(value, (int, float))},
        'note': 'Synthetic-dialogue validation only; no clinical validity or live-service capacity claim.',
    }
    (OUTPUT_DIR / 'manifest.json').write_text(json.dumps(manifest, indent=2), encoding='utf-8')
    print('Saved adapter, tokenizer, and manifest to', OUTPUT_DIR)
"""),
    markdown("""## After training

Keep `test.jsonl` held out. Evaluate English, Hindi, Hinglish, risk routing, optional interventions, memory fidelity, and summary factuality with independently reviewed cases before considering deployment. This source dataset alone has no summary labels or audio. Serving a trained adapter requires a separate inference endpoint that satisfies the voice service's OpenAI-compatible streaming interface and passes the same safety gates.
"""),
]

notebook = {"cells": cells, "metadata": {"kernelspec": {"display_name": "Python 3", "language": "python", "name": "python3"}, "language_info": {"name": "python"}}, "nbformat": 4, "nbformat_minor": 5}
Path(__file__).with_name('colab_qlora.ipynb').write_text(json.dumps(notebook, ensure_ascii=False, indent=2) + "\n", encoding='utf-8')
