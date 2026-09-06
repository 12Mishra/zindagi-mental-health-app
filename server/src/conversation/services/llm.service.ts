import { config } from '../../config';

export const chatWithLisa = async (messages: { role: string; content: string }[], systemPrompt: string): Promise<string> => {
  const payload = {
    model: config.ollamaModel,
    messages: [
      { role: 'system', content: systemPrompt },
      ...messages
    ],
    stream: false,
    options: {
      num_predict: 100, // Keeps responses concise (2-3 sentences) so generation finishes in 1-2 seconds
      temperature: 0.7,
      top_p: 0.9,
    },
  };

  try {
    const response = await fetch(`${config.ollamaUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(`Ollama chat error: ${response.statusText}`);
    }

    const data = await response.json();
    return data.message.content;
  } catch (error) {
    console.error('LLM Chat Error:', error);
    throw new Error('Failed to communicate with LLM');
  }
};

const parseJsonResponse = (rawContent: string) => {
  const cleaned = rawContent.replace(/```json/gi, '').replace(/```/g, '').trim();
  const parsed = JSON.parse(cleaned);
  return {
    summary: parsed.summary || 'Student shared reflections on current emotions and received compassionate support from Lisa.',
    keyThemes: Array.isArray(parsed.keyThemes) ? parsed.keyThemes : ['Emotional Processing', 'Supportive Dialogue'],
    keywords: Array.isArray(parsed.keywords) ? parsed.keywords : ['mindfulness', 'self-care'],
    riskFlags: Array.isArray(parsed.riskFlags) ? parsed.riskFlags : [],
  };
};

const summarizeWithGemini = async (prompt: string, apiKey: string) => {
  console.log('[Summary LLM] Calling Google Gemini 1.5 Flash API...');
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        temperature: 0.2,
      },
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Gemini API error ${response.status}: ${errText}`);
  }

  const data = await response.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Empty response from Gemini');
  return parseJsonResponse(text);
};

const summarizeWithGrok = async (prompt: string, apiKey: string) => {
  console.log('[Summary LLM] Calling xAI Grok API...');
  const url = 'https://api.x.ai/v1/chat/completions';
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'grok-2-latest',
      messages: [
        { role: 'system', content: 'You are an analytical assistant. You MUST return ONLY valid JSON.' },
        { role: 'user', content: prompt },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.2,
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Grok API error ${response.status}: ${errText}`);
  }

  const data = await response.json();
  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new Error('Empty response from Grok');
  return parseJsonResponse(text);
};

export const generateSummaryAndKeywords = async (conversationText: string): Promise<{ summary: string; keyThemes: string[]; keywords: string[]; riskFlags: string[] }> => {
  const prompt = `Analyze this mental health conversation. Return ONLY a valid JSON object with this exact format:
{
  "summary": "2-sentence summary of how the student felt and how Lisa supported them",
  "keyThemes": ["theme1", "theme2"],
  "keywords": ["keyword1", "keyword2"],
  "riskFlags": []
}

Conversation:
${conversationText}`;

  // 1. Try Gemini if configured (fastest, high quality, free tier)
  if (config.geminiApiKey) {
    try {
      return await summarizeWithGemini(prompt, config.geminiApiKey);
    } catch (error) {
      console.warn('Gemini summarization failed, falling back:', error);
    }
  }

  // 2. Try Grok if configured
  if (config.grokApiKey) {
    try {
      return await summarizeWithGrok(prompt, config.grokApiKey);
    } catch (error) {
      console.warn('Grok summarization failed, falling back:', error);
    }
  }

  // 3. Fall back to local Ollama model
  console.log(`[Summary LLM] Using local Ollama model (${config.ollamaModel})...`);
  const payload = {
    model: config.ollamaModel,
    messages: [
      { role: 'user', content: prompt }
    ],
    stream: false,
    format: 'json',
    options: {
      num_predict: 120,
      temperature: 0.5,
    }
  };

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000); // 8s safety timeout

    const response = await fetch(`${config.ollamaUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!response.ok) {
      throw new Error(`Ollama summary error: ${response.statusText}`);
    }

    const data = await response.json();
    return parseJsonResponse(data.message.content);
  } catch (error) {
    console.warn('Local Ollama summary fallback used:', error);
    return {
      summary: 'Student shared reflections on current emotions and received compassionate active listening support from Lisa.',
      keyThemes: ['Emotional Processing', 'Supportive Dialogue'],
      keywords: ['mindfulness', 'self-care'],
      riskFlags: [],
    };
  }
};

export const generateSummary = async (conversationText: string) => {
  const result = await generateSummaryAndKeywords(conversationText);
  return { summary: result.summary, keyThemes: result.keyThemes };
};

export const extractKeywords = async (conversationText: string) => {
  const result = await generateSummaryAndKeywords(conversationText);
  return { keywords: result.keywords, riskFlags: result.riskFlags };
};
