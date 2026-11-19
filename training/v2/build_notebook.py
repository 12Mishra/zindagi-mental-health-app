"""Write train_lisa_v2.ipynb (QLoRA on data/final from the v2 pipeline).  Run: python training/v2/build_notebook.py"""

import json
from pathlib import Path

CELLS = [
("md", """# Lisa v2 - QLoRA fine-tune

Trains a LoRA adapter on `data/final/train.jsonl` + `validation.jsonl` produced by `training/v2/pipeline.py build`.
Loss is computed **only on Lisa's replies**; the prompt is the exact runtime system prompt (with memory card / check-in).

**GPU:** a T4 (free Colab) works for 8B but takes many hours on the full set; use an **L4 or A100** (Colab Pro) and a **High-RAM** runtime for the merge step.
Upload `train.jsonl`, `validation.jsonl` and `eval.jsonl` to `MyDrive/lisa_v2/data/`. Accept the base model's licence on Hugging Face first if it is gated.
Training is off until you set `RUN_TRAINING = True`."""),
("code", """%pip install -q 'transformers>=4.55,<5' 'trl>=0.21,<0.30' 'peft>=0.17,<1' 'accelerate>=1.10,<2' 'bitsandbytes>=0.47,<1' 'datasets>=3,<5'"""),
("code", """import json, importlib.metadata as md
from pathlib import Path
import torch

RUN_TRAINING = False
MODEL_ID = 'Qwen/Qwen3-8B'          # alternatives to compare: 'google/gemma-3-12b-it' (better Hindi, needs more VRAM)
DRIVE = Path('/content/drive/MyDrive/lisa_v2')
DATA, OUT = DRIVE / 'data', DRIVE / 'run_qwen3_8b'
MAX_LENGTH = 2048
EPOCHS = 2
LR = 1e-4
LORA_R, LORA_ALPHA = 16, 32
BATCH, GRAD_ACCUM = 2, 8              # effective batch 16; lower BATCH to 1 on a T4
RESUME = None                         # path to a checkpoint dir to resume

print({p: md.version(p) for p in ('transformers', 'trl', 'peft', 'bitsandbytes')})
print('GPU:', torch.cuda.get_device_name(0) if torch.cuda.is_available() else 'none')"""),
("code", """from google.colab import drive
drive.mount('/content/drive')
from datasets import load_dataset
from transformers import AutoTokenizer

tokenizer = AutoTokenizer.from_pretrained(MODEL_ID)
if tokenizer.pad_token is None:
    tokenizer.pad_token = tokenizer.eos_token

def render(row):
    # Render with the model's own chat template, thinking disabled (Qwen3), so training == inference format.
    kwargs = {'enable_thinking': False}
    try:
        prompt = tokenizer.apply_chat_template(row['prompt'], tokenize=False, add_generation_prompt=True, **kwargs)
        full = tokenizer.apply_chat_template(row['prompt'] + row['completion'], tokenize=False, **kwargs)
    except TypeError:
        prompt = tokenizer.apply_chat_template(row['prompt'], tokenize=False, add_generation_prompt=True)
        full = tokenizer.apply_chat_template(row['prompt'] + row['completion'], tokenize=False)
    reply = row['completion'][0]['content']
    if full.startswith(prompt):
        completion = full[len(prompt):]
    else:  # template rewrites history (e.g. strips think blocks); fall back to reply + end-of-turn token
        end = '<|im_end|>' if '<|im_end|>' in prompt else '<end_of_turn>' if '<end_of_turn>' in prompt else tokenizer.eos_token
        completion = reply + end
    return {'prompt': prompt, 'completion': completion}

raw = load_dataset('json', data_files={'train': str(DATA / 'train.jsonl'), 'validation': str(DATA / 'validation.jsonl')})
data = raw.map(render, remove_columns=raw['train'].column_names)
lengths = [len(tokenizer(p + c).input_ids) for p, c in zip(data['train']['prompt'][:500], data['train']['completion'][:500])]
print(data, '\\ntoken length p50/p95/max:', sorted(lengths)[len(lengths)//2], sorted(lengths)[int(len(lengths)*.95)], max(lengths))
print('---- generation prompt tail (must match the Ollama TEMPLATE) ----')
print(repr(data['train'][0]['prompt'][-120:]))
print('---- completion ----')
print(repr(data['train'][0]['completion']))"""),
("code", """if RUN_TRAINING:
    from transformers import AutoModelForCausalLM, BitsAndBytesConfig, EarlyStoppingCallback
    from peft import LoraConfig, prepare_model_for_kbit_training
    from trl import SFTConfig, SFTTrainer
    bf16 = torch.cuda.is_bf16_supported()
    dtype = torch.bfloat16 if bf16 else torch.float16
    model = AutoModelForCausalLM.from_pretrained(MODEL_ID, device_map='auto', torch_dtype=dtype,
        quantization_config=BitsAndBytesConfig(load_in_4bit=True, bnb_4bit_quant_type='nf4',
                                               bnb_4bit_use_double_quant=True, bnb_4bit_compute_dtype=dtype))
    model = prepare_model_for_kbit_training(model, use_gradient_checkpointing=True)
    lora = LoraConfig(r=LORA_R, lora_alpha=LORA_ALPHA, lora_dropout=0.05, bias='none', task_type='CAUSAL_LM',
                      target_modules=['q_proj', 'k_proj', 'v_proj', 'o_proj', 'gate_proj', 'up_proj', 'down_proj'])
    args = SFTConfig(output_dir=str(OUT / 'checkpoints'), max_length=MAX_LENGTH, completion_only_loss=True,
        per_device_train_batch_size=BATCH, per_device_eval_batch_size=BATCH, gradient_accumulation_steps=GRAD_ACCUM,
        num_train_epochs=EPOCHS, learning_rate=LR, lr_scheduler_type='cosine', warmup_ratio=0.05, weight_decay=0.0,
        optim='paged_adamw_8bit', bf16=bf16, fp16=not bf16, gradient_checkpointing=True,
        logging_steps=10, eval_strategy='steps', eval_steps=50, save_strategy='steps', save_steps=50, save_total_limit=3,
        load_best_model_at_end=True, metric_for_best_model='eval_loss', greater_is_better=False, report_to='none')
    trainer = SFTTrainer(model=model, args=args, train_dataset=data['train'], eval_dataset=data['validation'],
                         peft_config=lora, processing_class=tokenizer,
                         callbacks=[EarlyStoppingCallback(early_stopping_patience=4)])
    trainer.train(resume_from_checkpoint=RESUME)
    metrics = trainer.evaluate()
    trainer.model.save_pretrained(str(OUT / 'adapter')); tokenizer.save_pretrained(str(OUT / 'adapter'))
    (OUT / 'manifest.json').write_text(json.dumps({'base_model': MODEL_ID, 'epochs': EPOCHS, 'lr': LR, 'lora_r': LORA_R,
        'max_length': MAX_LENGTH, 'train_examples': len(data['train']), 'eval': metrics,
        'versions': {p: md.version(p) for p in ('transformers', 'trl', 'peft')}}, indent=2))
    print(metrics)"""),
("md", """## Quick look at replies on held-out prompts
Not a substitute for `pipeline.py eval` - this is a sanity check before exporting."""),
("code", """if RUN_TRAINING:
    import random
    rows = [json.loads(l) for l in open(DATA / 'eval.jsonl', encoding='utf-8')]
    model.eval()
    for row in random.Random(0).sample(rows, 6):
        prompt = render({'prompt': row['prompt'], 'completion': row['completion']})['prompt']
        ids = tokenizer(prompt, return_tensors='pt').to(model.device)
        out = model.generate(**ids, max_new_tokens=120, temperature=0.5, do_sample=True)
        print('STUDENT:', row['prompt'][-1]['content'][:200])
        print('LISA   :', tokenizer.decode(out[0][ids.input_ids.shape[1]:], skip_special_tokens=True).strip())
        print('TEACHER:', row['completion'][0]['content'], '\\n')"""),
("md", """## Merge and export GGUF for Ollama
Reloads the base model in 16-bit (High-RAM runtime), merges the adapter, converts with llama.cpp and quantises to Q4_K_M.
Download `lisa-v2-q4km.gguf` and `Modelfile` from Drive into `training/`, then `ollama create lisa-v2 -f training/Modelfile.v2`."""),
("code", """if RUN_TRAINING:
    import gc, subprocess
    from transformers import AutoModelForCausalLM
    from peft import PeftModel
    del model, trainer; gc.collect(); torch.cuda.empty_cache()
    base = AutoModelForCausalLM.from_pretrained(MODEL_ID, torch_dtype=torch.float16, device_map='cpu', low_cpu_mem_usage=True)
    merged = PeftModel.from_pretrained(base, str(OUT / 'adapter')).merge_and_unload()
    merged.save_pretrained('/content/merged', safe_serialization=True); tokenizer.save_pretrained('/content/merged')
    del base, merged; gc.collect()
    run = lambda cmd: subprocess.run(cmd, shell=True, check=True)
    run('git clone --depth 1 https://github.com/ggml-org/llama.cpp /content/llama.cpp')
    run('pip install -q -r /content/llama.cpp/requirements/requirements-convert_hf_to_gguf.txt')
    run('python /content/llama.cpp/convert_hf_to_gguf.py /content/merged --outtype f16 --outfile /content/lisa-v2-f16.gguf')
    run('cmake -S /content/llama.cpp -B /content/llama.cpp/build -DGGML_CUDA=OFF -DLLAMA_CURL=OFF && cmake --build /content/llama.cpp/build --target llama-quantize -j 8')
    run(f'/content/llama.cpp/build/bin/llama-quantize /content/lisa-v2-f16.gguf {OUT}/lisa-v2-q4km.gguf Q4_K_M')
    print('GGUF written to', OUT / 'lisa-v2-q4km.gguf')"""),
]


def main():
    nb = {"nbformat": 4, "nbformat_minor": 5, "metadata": {"accelerator": "GPU", "colab": {"gpuType": "L4"},
          "kernelspec": {"name": "python3", "display_name": "Python 3"}}, "cells": []}
    for kind, src in CELLS:
        cell = {"cell_type": "markdown" if kind == "md" else "code", "metadata": {}, "source": src.splitlines(keepends=True)}
        if kind == "code":
            cell.update({"execution_count": None, "outputs": []})
        nb["cells"].append(cell)
    out = Path(__file__).with_name("train_lisa_v2.ipynb")
    out.write_text(json.dumps(nb, indent=1), encoding="utf-8")
    print("wrote", out)


if __name__ == "__main__":
    main()
