import json
import random
import fitz  # PyMuPDF
import os

print("Starting dataset preparation...")

# Paths
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
INPUT_JSON = r"c:\projects\conversations\simulated_conversations.json"
INPUT_PDF = r"c:\projects\conversations\PFA-Guide-low-res (2).pdf"
OUTPUT_JSONL = os.path.join(BASE_DIR, "dataset_final.jsonl")
TRAIN_JSONL = os.path.join(BASE_DIR, "train.jsonl")
VAL_JSONL = os.path.join(BASE_DIR, "val.jsonl")

def process_conversations(input_file):
    print(f"Loading conversations from {input_file}...")
    try:
        with open(input_file, 'r', encoding='utf-8') as f:
            data = json.load(f)
    except Exception as e:
        print(f"Error loading {input_file}: {e}")
        return []

    formatted_conversations = []
    
    for item in data:
        scenario = item.get("scenario", {})
        transcript = item.get("transcript", [])
        
        # Build the system prompt using scenario context
        kosha_layer = scenario.get("kosha_layer", "Unknown Kosha")
        sub_category = scenario.get("sub_category", "Unknown Sub-category")
        scenario_desc = scenario.get("scenario", "Unknown Scenario")
        
        system_content = f"You are Lisa, a compassionate mental health companion for college students. You are trained in Psychological First Aid (PFA) guidelines and the Panchkosh Adhyanam (five-sheath) framework covering Annamaya (Physical), Pranamaya (Vital Energy), Manomaya (Mental), Vijnanamaya (Intellectual), and Anandamaya (Bliss) koshas. You listen empathetically, validate feelings, and help identify immediate needs. You never diagnose, prescribe, or provide clinical therapy. If someone is in crisis, direct them to professional help. Current context: {kosha_layer} - {sub_category} - {scenario_desc}."
        
        messages = [{"role": "system", "content": system_content}]
        
        for turn in transcript:
            role = turn.get("role")
            content = turn.get("content", "").strip()
            
            if role == "client":
                messages.append({"role": "user", "content": content})
            elif role == "responder":
                messages.append({"role": "assistant", "content": content})
                
        formatted_conversations.append({"messages": messages})
        
    print(f"Successfully processed {len(formatted_conversations)} conversations.")
    return formatted_conversations

def extract_pdf_text(pdf_path):
    print(f"Extracting text from {pdf_path}...")
    try:
        doc = fitz.open(pdf_path)
        text = ""
        for page in doc:
            text += page.get_text()
        print("Successfully extracted PDF text.")
        return text
    except Exception as e:
        print(f"Error extracting PDF: {e}")
        return ""

def generate_pfa_qa():
    print("Generating synthetic Q&A pairs from PFA principles...")
    
    pfa_qa = [
        ("What are the core action principles of Psychological First Aid?", "The core action principles of Psychological First Aid (PFA) are Look, Listen, and Link. 'Look' involves checking for safety, observing who needs urgent basic needs, and identifying who has serious distress reactions. 'Listen' means approaching people who may need support, asking about their needs and concerns, and listening to them while helping them feel calm. 'Link' is about helping people address basic needs and access services, helping them cope with problems, giving information, and connecting them with loved ones and social support."),
        ("What is Psychological First Aid (PFA)?", "Psychological First Aid (PFA) describes a humane, supportive response to a fellow human being who is suffering and who may need support. It involves providing practical care and support that is non-intrusive, assessing needs and concerns, helping people to address basic needs (for example, food and water, information), listening to people but not pressuring them to talk, comforting people and helping them to feel calm, helping people connect to information, services and social supports, and protecting people from further harm."),
        ("Is PFA the same as professional counselling?", "No, PFA is not professional counselling. It is not a clinical or psychiatric intervention, and it does not involve asking someone to analyze what happened to them or to put time and events in order. PFA is about providing practical care and support, and it can be delivered by trained non-professionals."),
        ("How should I 'Listen' when providing PFA?", "When providing PFA, 'Listening' means approaching people who may need support in a respectful way. Introduce yourself, pay attention and listen actively without interrupting or judging. Validate their feelings. Do not pressure them to talk if they don't want to. Be patient and help them feel calm and safe."),
        ("What are some important 'Do's' when communicating in PFA?", "Do be honest and trustworthy. Do respect people's right to make their own decisions. Do be aware of and set aside your own biases and prejudices. Do make it clear to people that even if they refuse help now, they can still access help in the future. Do respect privacy and keep the person's story confidential, if this is appropriate."),
        ("What are some important 'Don'ts' when communicating in PFA?", "Don't exploit your relationship as a helper. Don't ask people for money or favors for helping them. Don't make false promises or give false information. Don't exaggerate your skills. Don't force help on people, and don't be intrusive or pushy. Don't pressure people to tell you their story. Don't share people's stories with others. Don't judge the person for their actions or feelings.")
    ]
    
    formatted_pfa = []
    system_prompt = "You are Lisa, a compassionate mental health companion trained in Psychological First Aid (PFA)."
    
    for q, a in pfa_qa:
        formatted_pfa.append({
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": q},
                {"role": "assistant", "content": a}
            ]
        })
        
    print(f"Generated {len(formatted_pfa)} synthetic PFA QA pairs.")
    return formatted_pfa

def main():
    conversations = process_conversations(INPUT_JSON)
    pdf_text = extract_pdf_text(INPUT_PDF)  # Extracted for context, QA pairs are hardcoded
    pfa_qa = generate_pfa_qa()
    
    all_data = conversations + pfa_qa
    random.shuffle(all_data)
    
    print(f"Total dataset size: {len(all_data)} items.")
    
    # Train/Val split (90/10)
    split_idx = int(len(all_data) * 0.9)
    train_data = all_data[:split_idx]
    val_data = all_data[split_idx:]
    
    # Save to JSONL
    print(f"Saving combined dataset to {OUTPUT_JSONL}...")
    with open(OUTPUT_JSONL, 'w', encoding='utf-8') as f:
        for item in all_data:
            f.write(json.dumps(item) + "\n")
            
    print(f"Saving train dataset to {TRAIN_JSONL}...")
    with open(TRAIN_JSONL, 'w', encoding='utf-8') as f:
        for item in train_data:
            f.write(json.dumps(item) + "\n")
            
    print(f"Saving val dataset to {VAL_JSONL}...")
    with open(VAL_JSONL, 'w', encoding='utf-8') as f:
        for item in val_data:
            f.write(json.dumps(item) + "\n")
            
    print("\n--- Summary Statistics ---")
    print(f"Total examples: {len(all_data)}")
    print(f"Training examples: {len(train_data)}")
    print(f"Validation examples: {len(val_data)}")
    print("Dataset preparation complete! You can now use dataset_final.jsonl for fine-tuning.")

if __name__ == "__main__":
    main()
