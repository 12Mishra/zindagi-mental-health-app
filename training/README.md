# Fine-Tuning Lisa: The Zindagi Mental Health Companion

This guide walks you through the process of fine-tuning a Mistral 7B model to act as "Lisa," a mental health companion trained on Psychological First Aid (PFA) and the Panchkosh Adhyanam framework.

## 1. Prerequisites
- Python 3.10+
- pip (Python package manager)
- A Google Account (for Google Colab)
- Windows PC (for running the final model with Ollama)

## 2. Install Local Dependencies
Before preparing the dataset, install the required Python libraries on your local machine:
```bash
pip install pymupdf
```

## 3. Prepare the Dataset
We need to combine our simulated conversations and the PFA guidelines into a format suitable for the language model.
1. Open a terminal/command prompt.
2. Navigate to the `training` directory:
   ```bash
   cd c:\projects\conversations\zindagi-mental-health-app\training
   ```
3. Run the dataset preparation script:
   ```bash
   python prepare_dataset.py
   ```
4. This script will read `simulated_conversations.json` and the PDF, generating synthetic Q&A and formatting everything into `dataset_final.jsonl`.
   *Expected Output:* You should see progress prints and finally a summary stating "Dataset preparation complete!"

## 4. Open Google Colab
Since fine-tuning requires a powerful GPU, we will use Google Colab (free tier usually provides a Tesla T4 GPU).
1. Go to [Google Colab](https://colab.research.google.com/).
2. Click **New Notebook**.
3. Go to `Runtime` -> `Change runtime type`.
4. Select `T4 GPU` as the Hardware accelerator and click Save.

## 5. Upload Files to Colab
1. On the left sidebar of the Colab notebook, click the **Folder icon** (Files).
2. Click the **Upload to session storage** icon (a file with an up arrow).
3. Select and upload the `dataset_final.jsonl` file that you generated in Step 3.

## 6. Run the Fine-Tuning Script
1. Open the `finetune_colab.py` file in a text editor on your computer.
2. Copy the code block under `# ===== STEP 1: Install Dependencies =====` and paste it into the first cell of your Colab notebook. Run the cell (Shift+Enter or click the Play button).
3. Add a new code cell (`+ Code`). Copy and paste the rest of the code from `finetune_colab.py` (Steps 2 through 7) into this new cell.
4. Run the cell. The script will:
   - Load the base model.
   - Apply LoRA adapters.
   - Load your uploaded dataset.
   - Train the model (this will take some time, likely 15-30 minutes).
   - Export the model to a GGUF format (`lisa-mistral-7b-q4_k_m.gguf`).
   - Prompt you to mount Google Drive and save the file there.
   
   *Note:* When prompted to mount Google Drive, follow the authorization link and allow access.

## 7. Download the Model
1. Go to your [Google Drive](https://drive.google.com/).
2. Locate the file named `lisa-mistral-7b-q4km.gguf`.
3. Right-click and select **Download**.
4. Once downloaded, move this file to the `c:\projects\conversations\zindagi-mental-health-app\training\` directory on your computer.

## 8. Install Ollama on Windows
Ollama is a tool that lets you run large language models locally on your machine.
1. Open PowerShell or Command Prompt.
2. Run the following command to install Ollama:
   ```powershell
   winget install Ollama.Ollama
   ```
3. Close and reopen your terminal after installation completes.

## 9. Create the Model in Ollama
We use a `Modelfile` to configure how Ollama runs our fine-tuned model.
1. Ensure your terminal is in the `training` directory:
   ```powershell
   cd c:\projects\conversations\zindagi-mental-health-app\training
   ```
2. Verify that `Modelfile` and `lisa-mistral-7b-q4km.gguf` are in this folder.
3. Create the model in Ollama:
   ```powershell
   ollama create lisa -f Modelfile
   ```
   *Expected Output:* Ollama will read the GGUF file and create a local model named "lisa".

## 10. Test Lisa
Now you can chat with your fine-tuned mental health companion locally!
1. Run the model in your terminal:
   ```powershell
   ollama run lisa "I feel anxious about my exams"
   ```
2. Lisa should respond empathetically, adhering to the PFA guidelines and Panchkosh framework without providing clinical advice.

### Troubleshooting
- **Ollama says 'model not found':** Ensure you named the model `lisa` during the `ollama create` step and that the path in the `Modelfile` correctly points to the `.gguf` file.
- **Colab runs out of memory (OOM):** Ensure you are using the T4 GPU. If it still crashes during training, try reducing `per_device_train_batch_size` to 1 in the training script.
- **Dataset preparation script fails on PDF:** Ensure `pymupdf` is installed (`pip install pymupdf`) and the path to the PDF is correct in the script.
