import 'dotenv/config';

const requiredEnv = (key: string) => {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
};

const positiveInteger = (key: string, fallback: number) => {
  const value = Number(process.env[key] ?? fallback);
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${key} must be a positive integer`);
  return value;
};

const nonNegativeNumber = (key: string, fallback = 0) => {
  const value = Number(process.env[key] ?? fallback);
  if (!Number.isFinite(value) || value < 0) throw new Error(`${key} must be non-negative`);
  return value;
};

export const config = {
  databaseUrl: requiredEnv('DATABASE_URL'),
  port: Number(process.env.PORT ?? 4000),
  otpCode: process.env.AUTH_OTP_CODE ?? '1234',
  otpTtlMinutes: Number(process.env.AUTH_OTP_TTL_MINUTES ?? 10),
  sessionTtlDays: Number(process.env.AUTH_SESSION_TTL_DAYS ?? 30),
  ollamaUrl: process.env.OLLAMA_URL ?? 'http://localhost:11434',
  ollamaModel: process.env.OLLAMA_MODEL ?? '',
  geminiApiKey: process.env.GEMINI_API_KEY ?? '',
  grokApiKey: process.env.GROK_API_KEY ?? '',
  voicePort: positiveInteger('VOICE_PORT', 4001),
  voiceMaxConversations: positiveInteger('VOICE_MAX_CONVERSATIONS', 1),
  voiceMaxSessionMinutes: positiveInteger('VOICE_MAX_SESSION_MINUTES', 30),
  voiceAllowedOrigins: (process.env.VOICE_ALLOWED_ORIGINS ?? '').split(',').map(x => x.trim()).filter(Boolean),
  deepgramApiKey: process.env.DEEPGRAM_API_KEY ?? '',
  sarvamApiKey: process.env.SARVAM_API_KEY ?? '',
  voiceLlmBaseUrl: process.env.VOICE_LLM_BASE_URL ?? '',
  voiceLlmApiKey: process.env.VOICE_LLM_API_KEY ?? '',
  voiceLlmModel: process.env.VOICE_LLM_MODEL ?? '',
  voiceSafetyBaseUrl: process.env.VOICE_SAFETY_BASE_URL ?? process.env.VOICE_LLM_BASE_URL ?? '',
  voiceSafetyApiKey: process.env.VOICE_SAFETY_API_KEY ?? process.env.VOICE_LLM_API_KEY ?? '',
  voiceSafetyModel: process.env.VOICE_SAFETY_MODEL ?? '',
  voiceSafetyTimeoutMs: positiveInteger('VOICE_SAFETY_TIMEOUT_MS', 1800),
  voiceSafetyReasoningEffort: process.env.VOICE_SAFETY_REASONING_EFFORT ?? '',
  summaryConcurrency: positiveInteger('SUMMARY_CONCURRENCY', 1),
  summaryPollMs: positiveInteger('SUMMARY_POLL_MS', 2000),
  summaryLlmBaseUrl: process.env.SUMMARY_LLM_BASE_URL ?? '',
  summaryLlmApiKey: process.env.SUMMARY_LLM_API_KEY ?? '',
  summaryLlmModel: process.env.SUMMARY_LLM_MODEL ?? '',
  costSttUsdPerMinute: nonNegativeNumber('COST_STT_USD_PER_MINUTE'),
  costTtsUsdPer1000Chars: nonNegativeNumber('COST_TTS_USD_PER_1000_CHARS'),
  costLlmInputUsdPerMillionTokens: nonNegativeNumber('COST_LLM_INPUT_USD_PER_MILLION_TOKENS'),
  costLlmOutputUsdPerMillionTokens: nonNegativeNumber('COST_LLM_OUTPUT_USD_PER_MILLION_TOKENS'),
};
