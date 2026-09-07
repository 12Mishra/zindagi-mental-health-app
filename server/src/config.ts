import 'dotenv/config';

const requiredEnv = (key: string) => {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
};

export const config = {
  databaseUrl: requiredEnv('DATABASE_URL'),
  port: Number(process.env.PORT ?? 4000),
  otpCode: process.env.AUTH_OTP_CODE ?? '1234',
  otpTtlMinutes: Number(process.env.AUTH_OTP_TTL_MINUTES ?? 10),
  sessionTtlDays: Number(process.env.AUTH_SESSION_TTL_DAYS ?? 30),
  ollamaUrl: process.env.OLLAMA_URL ?? 'http://localhost:11434',
  ollamaModel: process.env.OLLAMA_MODEL ?? 'lisa',
  geminiApiKey: process.env.GEMINI_API_KEY ?? '',
  grokApiKey: process.env.GROK_API_KEY ?? '',
};
