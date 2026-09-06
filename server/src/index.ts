import dotenv from "dotenv";
dotenv.config();

import express, { type ErrorRequestHandler } from 'express';

import { authRouter } from './auth/routes/auth.routes';
import { config } from './config';

const app = express();

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.status(204).send();
    return;
  }

  next();
});

app.use(express.json());

app.use((req, res, next) => {
  console.log(`[REQ] ${req.method} ${req.url}`);
  next();
});

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

app.use('/auth', authRouter);

import { conversationRouter } from './conversation/routes/conversation.routes';
app.use('/api', conversationRouter);

const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  const message = error instanceof Error ? error.message : 'Unexpected server error.';
  const normalized = message.toLowerCase();
  const status =
    normalized.includes('not registered')
      ? 404
      : normalized.includes('required') ||
        normalized.includes('valid') ||
        normalized.includes('expired')
      ? 400
      : 500;

  res.status(status).json({ error: message });
};

app.use(errorHandler);

app.listen(config.port,"0.0.0.0", () => {
  console.log(`Server listening on http://localhost:${config.port}`);
});
