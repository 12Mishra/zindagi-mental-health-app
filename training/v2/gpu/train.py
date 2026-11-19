"""Lisa v2 fine-tune: LoRA on Lisa's replies only, then merge to a 16-bit model that vLLM can serve.

    python train.py smoke  --model gemma4      # 10-minute check: load, render, 10 steps, sample replies, time estimate
    python train.py train  --model gemma4      # full run -> out/<model>/adapter
    python train.py export --model gemma4      # merge adapter -> out/<model>/merged (served by vLLM)

--model is a preset (gemma4, qwen3-14b) or any Hugging Face id. Data: ./data/{train,validation,eval}.jsonl.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import random
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
DATA = HERE / "data"
OUT = HERE / "out"

PRESETS = {
    # Best Bengali/Punjabi in the prompted bake-off; MoE with 4B active params (fast to serve).
    "gemma4": {"id": "google/gemma-4-26B-A4B-it", "lr": 1e-4, "epochs": 2},
    # Fallback: dense, mature tooling. Thinking is disabled by a fixed chat template (train == serve).
    # Its tokenizer spends ~3-4x more tokens on Bengali/Punjabi than Gemma 4, hence the longer max length.
    "qwen3-14b": {"id": "Qwen/Qwen3-14B", "lr": 1e-4, "epochs": 2, "template": "qwen_nothink.jinja", "max_len": 3072},
}


def log(*parts):
    print("[lisa]", *parts, flush=True)


def load_rows(name: str) -> list[dict]:
    path = DATA / f"{name}.jsonl"
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def text_tokenizer(processor_or_tokenizer):
    return getattr(processor_or_tokenizer, "tokenizer", processor_or_tokenizer)


def set_template(tok, preset: dict) -> None:
    if preset.get("template"):
        tok.chat_template = (HERE / preset["template"]).read_text(encoding="utf-8")


def renderer(tok):
    """Render prompt/completion strings with the model's own chat template, exactly as vLLM will at serve time."""
    adds_bos = bool(tok.bos_token) and tok("x").input_ids[:1] == [tok.bos_token_id]

    def strip_bos(text: str) -> str:
        # The template writes <bos> as text and the tokenizer would add another one; keep exactly one.
        return text[len(tok.bos_token):] if adds_bos and text.startswith(tok.bos_token) else text

    # The end-of-turn marker exactly as this template writes it after an assistant message
    # (Gemma 4: "<turn|>", Qwen/ChatML: "<|im_end|>"), read from the template instead of guessed.
    probe = tok.apply_chat_template([{"role": "user", "content": "hi"}, {"role": "assistant", "content": "ZQXJ"}],
                                    tokenize=False)
    turn_end = probe.split("ZQXJ", 1)[1].rstrip("\n") or tok.eos_token

    def render(prompt_msgs: list[dict], reply: str) -> dict:
        # The generation prompt is what vLLM sends at serve time. Templates that add an empty thinking block to it
        # (Gemma 4, our Qwen template) don't write that block for past turns, so the reply is appended explicitly.
        prompt = tok.apply_chat_template(prompt_msgs, tokenize=False, add_generation_prompt=True)
        return {"prompt": strip_bos(prompt), "completion": reply + turn_end}

    render.turn_end = turn_end

    return render


def build_datasets(tok, smoke: bool):
    from datasets import Dataset

    render = renderer(tok)
    out = {}
    for split in ("train", "validation"):
        rows = load_rows(split)
        if smoke:
            rows = random.Random(0).sample(rows, min(len(rows), 64 if split == "train" else 16))
        out[split] = Dataset.from_list([render(r["prompt"], r["completion"][0]["content"]) for r in rows])
    sample = out["train"][0]
    log("---- rendered prompt tail ----\n" + sample["prompt"][-300:])
    log("---- rendered completion ----\n" + repr(sample["completion"]))
    lengths = [len(tok(p + c).input_ids) for p, c in zip(out["train"]["prompt"][:400], out["train"]["completion"][:400])]
    lengths.sort()
    log(f"tokens per example p50={lengths[len(lengths)//2]} p95={lengths[int(len(lengths)*.95)]} max={lengths[-1]}")
    return out, lengths


def load_model(model_id: str, preset: dict, max_len: int, four_bit: bool, engine: str):
    """Unsloth when available (faster, handles MoE/multimodal quirks); plain transformers+peft otherwise."""
    import torch

    if engine in ("auto", "unsloth"):
        try:
            from unsloth import FastModel  # must be imported before trl/transformers
            model, proc = FastModel.from_pretrained(model_name=model_id, max_seq_length=max_len,
                                                    load_in_4bit=four_bit, full_finetuning=False,
                                                    token=os.environ.get("HF_TOKEN"))
            model = FastModel.get_peft_model(model, finetune_vision_layers=False, finetune_language_layers=True,
                                             finetune_attention_modules=True, finetune_mlp_modules=True,
                                             r=16, lora_alpha=32, lora_dropout=0, bias="none", random_state=3407)
            tok = text_tokenizer(proc)
            set_template(tok, preset)
            return model, tok, "unsloth"
        except Exception as error:  # noqa: BLE001
            if engine == "unsloth":
                raise
            log(f"Unsloth path failed ({type(error).__name__}: {error}); falling back to transformers+peft")

    from peft import LoraConfig, get_peft_model, prepare_model_for_kbit_training
    from transformers import AutoConfig, AutoTokenizer, BitsAndBytesConfig

    cfg = AutoConfig.from_pretrained(model_id)
    model_cls = _model_class(cfg)
    quant = BitsAndBytesConfig(load_in_4bit=True, bnb_4bit_quant_type="nf4", bnb_4bit_use_double_quant=True,
                               bnb_4bit_compute_dtype=torch.bfloat16) if four_bit else None
    model = model_cls.from_pretrained(model_id, dtype=torch.bfloat16, device_map="auto", quantization_config=quant)
    if four_bit:
        model = prepare_model_for_kbit_training(model, use_gradient_checkpointing=True)
    else:
        model.gradient_checkpointing_enable()
        model.enable_input_require_grads()
    names = [n for n, _ in model.named_modules()]
    proj = r"(q_proj|k_proj|v_proj|o_proj|gate_proj|up_proj|down_proj)"
    target = rf".*language_model.*\.{proj}" if any("language_model" in n for n in names) else rf".*\.{proj}"
    model = get_peft_model(model, LoraConfig(r=16, lora_alpha=32, lora_dropout=0.0, bias="none",
                                             task_type="CAUSAL_LM", target_modules=target))
    tok = AutoTokenizer.from_pretrained(model_id)
    set_template(tok, preset)
    return model, tok, "transformers"


def _model_class(cfg):
    from transformers import AutoModelForCausalLM
    if getattr(cfg, "vision_config", None) is not None:
        from transformers import AutoModelForImageTextToText
        return AutoModelForImageTextToText
    return AutoModelForCausalLM


def sample_replies(model, tok, n: int = 4) -> None:
    import torch
    rows = random.Random(1).sample(load_rows("eval"), n)
    render = renderer(tok)
    model.eval()
    for row in rows:
        prompt = render(row["prompt"], "x")["prompt"]
        ids = tok(prompt, return_tensors="pt").to(model.device)
        with torch.no_grad():
            out = model.generate(**ids, max_new_tokens=110, do_sample=True, temperature=0.5, top_p=0.9)
        reply = tok.decode(out[0][ids.input_ids.shape[1]:], skip_special_tokens=True).strip()
        log(f"STUDENT: {row['prompt'][-1]['content'][:160]}\n        LISA: {reply}\n     TEACHER: {row['completion'][0]['content']}")


def train(args, preset: dict, smoke: bool) -> None:
    model_id = preset["id"]
    run_dir = OUT / args.model
    model, tok, engine = load_model(model_id, preset, args.max_len, not args.bf16, args.engine)
    log(f"loaded {model_id} via {engine} ({'bf16' if args.bf16 else '4-bit'})")
    data, lengths = build_datasets(tok, smoke)

    from transformers import EarlyStoppingCallback
    from trl import SFTConfig, SFTTrainer

    epochs = 1 if smoke else args.epochs or preset["epochs"]
    cfg = SFTConfig(
        output_dir=str(run_dir / ("smoke" if smoke else "checkpoints")), max_length=args.max_len,
        completion_only_loss=True, packing=False,
        per_device_train_batch_size=args.batch, per_device_eval_batch_size=args.batch,
        gradient_accumulation_steps=args.grad_accum, num_train_epochs=epochs,
        max_steps=10 if smoke else -1, learning_rate=args.lr or preset["lr"], lr_scheduler_type="cosine",
        warmup_steps=0.03, weight_decay=0.0,  # transformers 5: a float here is a ratio (warmup_ratio was removed)
        optim="adamw_8bit", bf16=True, gradient_checkpointing=True,
        logging_steps=1 if smoke else 10, eval_strategy="no" if smoke else "steps", eval_steps=args.eval_every,
        save_strategy="no" if smoke else "steps", save_steps=args.eval_every, save_total_limit=3,
        load_best_model_at_end=not smoke, metric_for_best_model="eval_loss", greater_is_better=False,
        report_to="none", seed=3407)
    trainer = SFTTrainer(model=model, args=cfg, processing_class=tok, train_dataset=data["train"],
                         eval_dataset=None if smoke else data["validation"],
                         callbacks=[] if smoke else [EarlyStoppingCallback(early_stopping_patience=3)])
    started = time.time()
    trainer.train(resume_from_checkpoint=args.resume or None)
    elapsed = time.time() - started

    if smoke:
        per_step = elapsed / 10
        full_rows = len(load_rows("train"))
        steps = math.ceil(full_rows / (args.batch * args.grad_accum)) * (args.epochs or preset["epochs"])
        log(f"SMOKE OK: {per_step:.1f}s/step -> full run about {steps} steps = {steps * per_step / 3600:.1f} h "
            f"(+ periodic eval). Loss should have moved; check the log above.")
        sample_replies(model, tok, 2)
        return

    metrics = trainer.evaluate()
    adapter = run_dir / "adapter"
    trainer.model.save_pretrained(str(adapter))
    tok.save_pretrained(str(adapter))
    (run_dir / "train_manifest.json").write_text(json.dumps({
        "base_model": model_id, "engine": engine, "four_bit": not args.bf16, "epochs": epochs,
        "lr": args.lr or preset["lr"], "train_examples": len(data["train"]), "hours": round(elapsed / 3600, 2),
        "eval": {k: float(v) for k, v in metrics.items() if isinstance(v, (int, float))}}, indent=2))
    log(f"saved adapter -> {adapter}; eval {metrics}")
    sample_replies(model, tok, 4)


def export(args, preset: dict) -> None:
    """Merge the LoRA adapter into the 16-bit base so vLLM can serve it without LoRA support."""
    import torch
    from peft import PeftModel
    from transformers import AutoConfig, AutoProcessor, AutoTokenizer

    run_dir = OUT / args.model
    adapter, merged_dir = run_dir / "adapter", run_dir / "merged"
    cfg = AutoConfig.from_pretrained(preset["id"])
    base = _model_class(cfg).from_pretrained(preset["id"], dtype=torch.bfloat16, device_map="auto")
    merged = PeftModel.from_pretrained(base, str(adapter)).merge_and_unload()
    merged.save_pretrained(str(merged_dir), safe_serialization=True, max_shard_size="5GB")
    tok = AutoTokenizer.from_pretrained(str(adapter))  # carries the training chat template
    tok.save_pretrained(str(merged_dir))
    try:  # multimodal bases (Gemma 4) need their processor files for vLLM to load the model
        AutoProcessor.from_pretrained(preset["id"]).save_pretrained(str(merged_dir))
        tok.save_pretrained(str(merged_dir))  # re-save so our tokenizer/chat template wins
    except Exception as error:  # noqa: BLE001
        log(f"no processor saved ({error}); fine for text-only bases")
    log(f"merged model -> {merged_dir}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("step", choices=["smoke", "train", "export"])
    parser.add_argument("--model", default="gemma4", help="preset name or Hugging Face id")
    parser.add_argument("--engine", choices=["auto", "unsloth", "transformers"], default="auto")
    parser.add_argument("--bf16", action="store_true", help="no 4-bit quantization (needs ~80GB for gemma4)")
    parser.add_argument("--max-len", type=int, default=0, help="default: 2048 (gemma4) / 3072 (qwen3-14b)")
    parser.add_argument("--batch", type=int, default=4)
    parser.add_argument("--grad-accum", type=int, default=4)
    parser.add_argument("--epochs", type=float, default=0)
    parser.add_argument("--lr", type=float, default=0)
    parser.add_argument("--eval-every", type=int, default=150)
    parser.add_argument("--resume", default="", help="checkpoint dir to resume from")
    args = parser.parse_args()
    preset = PRESETS.get(args.model, {"id": args.model, "lr": 1e-4, "epochs": 2})
    args.max_len = args.max_len or preset.get("max_len", 2048)
    if args.step == "export":
        export(args, preset)
    else:
        train(args, preset, smoke=args.step == "smoke")


if __name__ == "__main__":
    sys.exit(main())
