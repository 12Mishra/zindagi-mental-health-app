import fs from 'fs';

export const transcribeAudio = async (audioFilePath: string): Promise<string> => {
  try {
    // We try to import whisper-node dynamically or handle a fallback
    // Since whisper-node requires python/whisper and model downloading,
    // this is a simplified stub that falls back if whisper is not available.
    
    // Simulate async operation
    await new Promise(resolve => setTimeout(resolve, 500));
    
    let whisperNode: any;
    try {
      whisperNode = require('whisper-node');
    } catch (e) {
      console.warn('whisper-node is not installed or available, using fallback transcription');
      return "This is a simulated transcription since whisper-node is not installed.";
    }

    const options = {
      modelName: "base.en",
      whisperOptions: {
        language: "auto",
        gen_file_txt: false,
        gen_file_subtitle: false,
        gen_file_vtt: false,
      }
    };
    
    const transcripts = await whisperNode.whisper(audioFilePath, options);
    const fullText = transcripts.map((t: any) => t.speech).join(" ");
    return fullText;
  } catch (error) {
    console.error('STT Error:', error);
    return "Error transcribing audio.";
  } finally {
    // Optionally clean up the file
    if (fs.existsSync(audioFilePath)) {
      try {
        fs.unlinkSync(audioFilePath);
      } catch (err) {
        console.error('Failed to remove temp file', err);
      }
    }
  }
};
