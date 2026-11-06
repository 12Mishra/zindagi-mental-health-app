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

const nonNegativeInteger = (key: string, fallback: number) => {
  const value = Number(process.env[key] || fallback);
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${key} must be a non-negative integer`);
  return value;
};

const oneOf = <T extends string>(key: string, values: readonly T[], fallback: T): T => {
  const value = (process.env[key] || fallback).trim() as T;
  if (!values.includes(value)) throw new Error(`${key} must be one of ${values.join(', ')}`);
  return value;
};

const flag = (key: string, fallback: boolean) => {
  const value = (process.env[key] || String(fallback)).trim().toLowerCase();
  if (value !== 'true' && value !== 'false') throw new Error(`${key} must be true or false`);
  return value === 'true';
};

// Empty means "not set" so the served model keeps its own default.
const optionalNumber = (key: string, min: number, max: number) => {
  const raw = process.env[key]?.trim();
  if (!raw) return null;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < min || value > max) throw new Error(`${key} must be between ${min} and ${max}`);
  return value;
};

const nonNegativeNumber = (key: string, fallback = 0) => {
  const value = Number(process.env[key] ?? fallback);
  if (!Number.isFinite(value) || value < 0) throw new Error(`${key} must be non-negative`);
  return value;
};

const contextBaseUrl = process.env.CONTEXT_LLM_BASE_URL || (process.env.CONTEXT_SAVING_LLM_GROQ ? 'https://api.groq.com/openai/v1' : '');
const contextApiKey = process.env.CONTEXT_LLM_API_KEY || process.env.CONTEXT_SAVING_LLM_GROQ || '';
const contextModel = process.env.CONTEXT_LLM_MODEL || (process.env.CONTEXT_SAVING_LLM_GROQ ? 'qwen/qwen3.8-27b' : '');

export const config = {
  databaseUrl: requiredEnv('DATABASE_URL'),
  port: Number(process.env.PORT ?? 4000),
  otpCode: process.env.AUTH_OTP_CODE ?? '1234',
  otpTtlMinutes: Number(process.env.AUTH_OTP_TTL_MINUTES ?? 10),
  sessionTtlDays: Number(process.env.AUTH_SESSION_TTL_DAYS ?? 30),
  staffSessionTtlHours: positiveInteger('STAFF_SESSION_TTL_HOURS', 12),
  // Origins of the admin and therapist portals (server-side calls send no Origin; this is for browser clients only).
  portalOrigins: (process.env.PORTAL_ORIGINS ?? 'http://localhost:3100,http://localhost:3200').split(',').map(x => x.trim()).filter(Boolean),
  ollamaUrl: process.env.OLLAMA_URL ?? 'http://localhost:11434',
  ollamaModel: process.env.OLLAMA_MODEL ?? '',
  voicePort: positiveInteger('VOICE_PORT', 4001),
  voiceMaxConversations: positiveInteger('VOICE_MAX_CONVERSATIONS', 1),
  voiceMaxSessionMinutes: positiveInteger('VOICE_MAX_SESSION_MINUTES', 30),
  voiceAllowedOrigins: (process.env.VOICE_ALLOWED_ORIGINS ?? '').split(',').map(x => x.trim()).filter(Boolean),
  deepgramApiKey: process.env.DEEPGRAM_API_KEY ?? '',
  sarvamApiKey: process.env.SARVAM_API_KEY ?? '',
  voiceLlmBaseUrl: process.env.VOICE_LLM_BASE_URL ?? '',
  voiceLlmApiKey: process.env.VOICE_LLM_API_KEY ?? '',
  voiceLlmModel: process.env.VOICE_LLM_MODEL ?? '',
  voiceLlmMaxTokens: positiveInteger('VOICE_LLM_MAX_TOKENS', 120),
  voiceLlmTemperature: optionalNumber('VOICE_LLM_TEMPERATURE', 0, 2),
  voiceLlmWarmup: flag('VOICE_LLM_WARMUP', true),
  // The safety checker must be configured explicitly; it never silently reuses the Lisa endpoint.
  voiceSafetyBaseUrl: process.env.VOICE_SAFETY_BASE_URL ?? '',
  voiceSafetyApiKey: process.env.VOICE_SAFETY_API_KEY ?? '',
  voiceSafetyModel: process.env.VOICE_SAFETY_MODEL ?? '',
  voiceSafetyTimeoutMs: positiveInteger('VOICE_SAFETY_TIMEOUT_MS', 1800),
  voiceSafetyReasoningEffort: process.env.VOICE_SAFETY_REASONING_EFFORT ?? '',
  voiceTriageGateMs: nonNegativeInteger('VOICE_TRIAGE_GATE_MS', 350),
  voiceOutputReview: oneOf('VOICE_OUTPUT_REVIEW', ['async', 'off'] as const, 'async'),
  ttsTransport: oneOf('TTS_TRANSPORT', ['ws', 'http'] as const, 'ws'),
  ttsSpeaker: (process.env.TTS_SPEAKER || 'priya').trim(),
  sttEndpointingMs: positiveInteger('STT_ENDPOINTING_MS', 300),
  bargeInMinWords: positiveInteger('BARGE_IN_MIN_WORDS', 2),
  summaryConcurrency: positiveInteger('SUMMARY_CONCURRENCY', 1),
  summaryPollMs: positiveInteger('SUMMARY_POLL_MS', 2000),
  // Durable summaries and the memory-card merge: when SUMMARY_LLM_* is blank they reuse the context LLM (Groq) instead of local Ollama.
  summaryLlmBaseUrl: process.env.SUMMARY_LLM_BASE_URL || contextBaseUrl,
  summaryLlmApiKey: process.env.SUMMARY_LLM_BASE_URL ? process.env.SUMMARY_LLM_API_KEY ?? '' : contextApiKey,
  // Groq rate limits are per model, so durable jobs use their own model and never starve the in-chat agent or the greeting.
  summaryLlmModel: process.env.SUMMARY_LLM_MODEL || (process.env.CONTEXT_SAVING_LLM_GROQ && !process.env.CONTEXT_LLM_BASE_URL ? 'openai/gpt-oss-120b' : contextModel),
  redisUrl: process.env.REDIS_URL ?? '',
  workingTurns: positiveInteger('WORKING_TURNS', 8),
  promptTokenBudget: positiveInteger('PROMPT_TOKEN_BUDGET', 2000),
  sessionMemoryTtlS: positiveInteger('SESSION_MEMORY_TTL_S', 3600),
  // Context agent: empty model/key = disabled. The Groq key may come from CONTEXT_SAVING_LLM_GROQ.
  contextLlmBaseUrl: contextBaseUrl,
  contextLlmApiKey: contextApiKey,
  contextLlmModel: contextModel,
  contextLlmTimeoutMs: positiveInteger('CONTEXT_LLM_TIMEOUT_MS', 3000),
  contextRecallMinScore: nonNegativeNumber('CONTEXT_RECALL_MIN_SCORE', 0.75),
  embeddingBaseUrl: process.env.EMBEDDING_BASE_URL ?? '',
  embeddingApiKey: process.env.EMBEDDING_API_KEY ?? '',
  embeddingModel: process.env.EMBEDDING_MODEL ?? '',
  embeddingDim: positiveInteger('EMBEDDING_DIM', 768),
  memorySearchMaxRows: positiveInteger('MEMORY_SEARCH_MAX_ROWS', 300),
  memoryRetentionDays: positiveInteger('MEMORY_RETENTION_DAYS', 365),
  riskHistoryRequiresConsent: flag('RISK_HISTORY_REQUIRES_CONSENT', true),
  costSttUsdPerMinute: nonNegativeNumber('COST_STT_USD_PER_MINUTE'),
  costTtsUsdPer1000Chars: nonNegativeNumber('COST_TTS_USD_PER_1000_CHARS'),
  costLlmInputUsdPerMillionTokens: nonNegativeNumber('COST_LLM_INPUT_USD_PER_MILLION_TOKENS'),
  costLlmOutputUsdPerMillionTokens: nonNegativeNumber('COST_LLM_OUTPUT_USD_PER_MILLION_TOKENS'),
};
