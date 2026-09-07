# ==============================================================================
# Fine-Tuning Mistral 7B on 1000+ Conversations using Unsloth (Free Google Colab T4)
# ==============================================================================

# ===== STEP 1: Install Dependencies =====
# Run this in the first cell of Google Colab
!pip install -q -U "unsloth[colab-new] @ git+https://github.com/unslothai/unsloth.git"
!pip install -q -U trl peft accelerate transformers datasets bitsandbytes

import os
import torch
from unsloth import FastLanguageModel
from trl import SFTTrainer
from transformers import TrainingArguments
from datasets import load_dataset
from google.colab import drive

# Mount Google Drive early so checkpoints and exported models are safe
drive.mount('/content/drive')
print("Google Drive mounted successfully!")

# ===== STEP 2: Load Model and Tokenizer =====
# We use Mistral 7B Instruct v0.3 with 4-bit quantization (runs in ~6GB VRAM on free T4)
max_seq_length = 2048 # Adjust to 4096 if your conversations are very long
dtype = None # Auto-detects float16 for Tesla T4
load_in_4bit = True

print("Loading Mistral-7B-Instruct-v0.3...")
model, tokenizer = FastLanguageModel.from_pretrained(
    model_name = "unsloth/mistral-7b-instruct-v0.3-bnb-4bit",
    max_seq_length = max_seq_length,
    dtype = dtype,
    load_in_4bit = load_in_4bit,
)
print("Base model loaded!")

# ===== STEP 3: Apply LoRA Adapters (Tuned for 1000+ Conversations) =====
# Using rank r=16 or r=32 allows the model to learn 1000+ rich dialogues without catastrophic forgetting
model = FastLanguageModel.get_peft_model(
    model,
    r = 16, # Rank 16 provides an ideal balance of memory and capacity
    target_modules = ["q_proj", "k_proj", "v_proj", "o_proj",
                      "gate_proj", "up_proj", "down_proj"],
    lora_alpha = 32,
    lora_dropout = 0, # 0 is mathematically optimized in Unsloth
    bias = "none",
    use_gradient_checkpointing = "unsloth", # Crucial for fitting 1000+ dialogues in 15GB VRAM
    random_state = 3407,
    use_rslora = False,
    loftq_config = None,
)
print("LoRA adapters configured successfully!")

# ===== STEP 4: Load & Prepare 1000+ Conversations Dataset =====
# Upload your dataset to Colab root or copy from Google Drive:
# e.g., dataset_file = "/content/drive/MyDrive/conversations_1000.jsonl"
dataset_file = "dataset_final.jsonl" 

if not os.path.exists(dataset_file):
    print(f"Warning: {dataset_file} not found in root. Checking Google Drive...")
    drive_path = os.path.join("/content/drive/MyDrive", dataset_file)
    if os.path.exists(drive_path):
        dataset_file = drive_path
        print(f"Found dataset in Google Drive: {dataset_file}")
    else:
        raise FileNotFoundError(f"Please upload your dataset file to Colab or Google Drive!")

print(f"Loading dataset from: {dataset_file}")

# Handles both JSONL and standard JSON array files
if dataset_file.endswith(".jsonl"):
    raw_dataset = load_dataset("json", data_files=dataset_file, split="train")
else:
    raw_dataset = load_dataset("json", data_files=dataset_file, field=None, split="train")

print(f"Total raw examples: {len(raw_dataset)}")

# Flexible chat formatter supporting standard formats:
# 1. {"messages": [{"role": "user", "content": "..."}, {"role": "assistant", "content": "..."}]}
# 2. {"conversations": [{"from": "human", "value": "..."}, {"from": "gpt", "value": "..."}]}
# 3. {"instruction": "...", "input": "...", "output": "..."}
def format_prompts(batch):
    formatted_texts = []
    
    # Format 1: messages list
    if "messages" in batch:
        for msgs in batch["messages"]:
            text = tokenizer.apply_chat_template(msgs, tokenize=False, add_generation_prompt=False)
            formatted_texts.append(text)
            
    # Format 2: conversations list (ShareGPT format)
    elif "conversations" in batch:
        for conv in batch["conversations"]:
            msgs = []
            for turn in conv:
                role = "user" if turn.get("from") in ["human", "user"] else "assistant"
                msgs.append({"role": role, "content": turn.get("value", "")})
            text = tokenizer.apply_chat_template(msgs, tokenize=False, add_generation_prompt=False)
            formatted_texts.append(text)
            
    # Format 3: instruction / output
    elif "instruction" in batch and "output" in batch:
        for inst, inp, out in zip(batch["instruction"], batch.get("input", [""]*len(batch["instruction"])), batch["output"]):
            content = f"{inst}\n{inp}".strip() if inp else inst
            msgs = [
                {"role": "user", "content": content},
                {"role": "assistant", "content": out}
            ]
            text = tokenizer.apply_chat_template(msgs, tokenize=False, add_generation_prompt=False)
            formatted_texts.append(text)
            
    return {"text": formatted_texts}

dataset = raw_dataset.map(format_prompts, batched=True)
print(f"Successfully processed {len(dataset)} conversations into Mistral Chat Template!")
print("Sample prompt preview:\n", dataset[0]["text"][:300] + "...\n")

# ===== STEP 5: Train Model (Optimized for 1000+ Dialogues) =====
# For 1000+ examples:
# - 1 or 2 epochs is ideal (1000 * 2 / 8 = 250 steps, approx 20-30 mins on T4)
# - Learning rate 1.5e-4 provides stable convergence without overfitting
trainer = SFTTrainer(
    model = model,
    tokenizer = tokenizer,
    train_dataset = dataset,
    dataset_text_field = "text",
    max_seq_length = max_seq_length,
    dataset_num_proc = 2,
    packing = False, # Set True if conversations are short (<500 tokens) for 2-3x speedup
    args = TrainingArguments(
        per_device_train_batch_size = 2,
        gradient_accumulation_steps = 4, # Effective batch size = 8
        warmup_ratio = 0.05,
        num_train_epochs = 2, # 2 epochs gives deep comprehension of the 1000 conversations
        learning_rate = 1.5e-4,
        fp16 = not torch.cuda.is_bf16_supported(),
        bf16 = torch.cuda.is_bf16_supported(),
        logging_steps = 10,
        optim = "adamw_8bit",
        weight_decay = 0.01,
        lr_scheduler_type = "cosine",
        seed = 3407,
        output_dir = "/content/drive/MyDrive/lisa_checkpoints",
        save_strategy = "steps",
        save_steps = 100, # Saves checkpoints every 100 steps to Drive
    ),
)

print("Starting training on 1000+ conversations...")
trainer_stats = trainer.train()
print("Training completed successfully!")

# ===== STEP 6: Export to GGUF Q4_K_M for Ollama =====
output_model_name = "lisa-mistral-7b-v2"
print(f"Exporting model to GGUF Q4_K_M as '{output_model_name}'...")
model.save_pretrained_gguf(output_model_name, tokenizer, quantization_method = "q4_k_m")

# Move GGUF directly to Google Drive so it's safely saved
source_gguf = f"{output_model_name}-q4_k_m.gguf"
dest_gguf = f"/content/drive/MyDrive/{output_model_name}-q4km.gguf"

if os.path.exists(source_gguf):
    print(f"Copying {source_gguf} to Google Drive ({dest_gguf})...")
    !cp {source_gguf} {dest_gguf}
    print("GGUF model saved to Google Drive! You can download it directly to your PC.")
else:
    print(f"GGUF exported as {source_gguf} in current directory.")

