# ===== STEP 1: Install Dependencies =====
# Run this in a Colab cell
!pip install -q -U "unsloth[colab-new] @ git+https://github.com/unslothai/unsloth.git"
!pip install -q -U trl peft accelerate transformers

import torch
from unsloth import FastLanguageModel
from trl import SFTTrainer
from transformers import TrainingArguments
from datasets import load_dataset
import os

print("Dependencies installed and imported successfully!")

# ===== STEP 2: Load Model and Tokenizer =====
max_seq_length = 2048 # Choose any! We auto support RoPE Scaling internally!
dtype = None # None for auto detection. Float16 for Tesla T4, V100, Bfloat16 for Ampere+
load_in_4bit = True # Use 4bit quantization to reduce memory usage. Can be False.

print("Loading Mistral-7B-Instruct-v0.3...")
model, tokenizer = FastLanguageModel.from_pretrained(
    model_name = "unsloth/mistral-7b-instruct-v0.3-bnb-4bit",
    max_seq_length = max_seq_length,
    dtype = dtype,
    load_in_4bit = load_in_4bit,
)
print("Model loaded successfully!")

# ===== STEP 3: Apply LoRA Adapters =====
print("Applying LoRA adapters...")
model = FastLanguageModel.get_peft_model(
    model,
    r = 16, # Choose any number > 0 ! Suggested 8, 16, 32, 64, 128
    target_modules = ["q_proj", "k_proj", "v_proj", "o_proj",
                      "gate_proj", "up_proj", "down_proj",],
    lora_alpha = 32,
    lora_dropout = 0, # Supports any, but = 0 is optimized
    bias = "none",    # Supports any, but = "none" is optimized
    use_gradient_checkpointing = "unsloth", # True or "unsloth" for very long context
    random_state = 3407,
    use_rslora = False,  # We support rank stabilized LoRA
    loftq_config = None, # And LoftQ
)
print("LoRA adapters applied successfully!")

# ===== STEP 4: Load Dataset =====
# Upload your dataset_final.jsonl to Colab before running this cell
dataset_file = "dataset_final.jsonl"
if not os.path.exists(dataset_file):
    print(f"ERROR: {dataset_file} not found. Please upload it to the Colab environment.")
else:
    print(f"Loading dataset from {dataset_file}...")
    dataset = load_dataset("json", data_files=dataset_file, split="train")
    
    # We need to format the conversations for Mistral Instruct
    def format_chat_template(row):
        # Apply the tokenizer's chat template
        row["text"] = tokenizer.apply_chat_template(row["messages"], tokenize=False, add_generation_prompt=False)
        return row
        
    dataset = dataset.map(format_chat_template)
    print(f"Dataset loaded with {len(dataset)} examples!")

# ===== STEP 5: Fine-tune the Model =====
print("Setting up Trainer...")
trainer = SFTTrainer(
    model = model,
    tokenizer = tokenizer,
    train_dataset = dataset,
    dataset_text_field = "text",
    max_seq_length = max_seq_length,
    dataset_num_proc = 2,
    packing = False, # Can make training 5x faster for short sequences.
    args = TrainingArguments(
        per_device_train_batch_size = 2,
        gradient_accumulation_steps = 4,
        warmup_steps = 10,
        num_train_epochs = 3, # Use num_train_epochs instead of max_steps
        learning_rate = 2e-4,
        fp16 = not torch.cuda.is_bf16_supported(),
        bf16 = torch.cuda.is_bf16_supported(),
        logging_steps = 10,
        optim = "adamw_8bit",
        weight_decay = 0.01,
        lr_scheduler_type = "linear",
        seed = 3407,
        output_dir = "outputs",
    ),
)

print("Starting training! This may take a while depending on the GPU...")
trainer_stats = trainer.train()
print("Training complete!")

# ===== STEP 6: Save Model and Export to GGUF =====
# We export to GGUF Q4_K_M for Ollama compatibility
print("Exporting model to GGUF Q4_K_M...")
model.save_pretrained_gguf("lisa-mistral-7b", tokenizer, quantization_method = "q4_k_m")
print("Model saved to 'lisa-mistral-7b-q4_k_m.gguf'")

# ===== STEP 7: Save to Google Drive =====
from google.colab import drive
drive.mount('/content/drive')
print("Google Drive mounted!")

print("Copying GGUF model to Google Drive...")
!cp lisa-mistral-7b-q4_k_m.gguf /content/drive/MyDrive/lisa-mistral-7b-q4km.gguf
print("Successfully copied to Google Drive! You can now download it from there.")
