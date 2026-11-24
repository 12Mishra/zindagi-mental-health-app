import dotenv from "dotenv";
dotenv.config();

import express, { type ErrorRequestHandler } from 'express';

import { authRouter } from './auth/routes/auth.routes';
import { requireAuth } from './auth/middlewares/auth.middleware';
import { config } from './config';

const app = express();

app.use((req, res, next) => {
  const origin = req.header('origin');
  if (origin && (config.voiceAllowedOrigins.includes(origin) || config.portalOrigins.includes(origin))) res.header('Access-Control-Allow-Origin', origin);
  res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.status(204).send();
    return;
  }

  next();
});

app.use(express.json({ limit: '16kb' }));

app.use((req, res, next) => {
  console.log(`[REQ] ${req.method} ${req.path}`);
  next();
});

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

app.use('/auth', authRouter);

import { conversationRouter } from './conversation/routes/conversation.routes';
app.use('/api', conversationRouter);

import { staffRouter } from './staff/staff.routes';
app.use('/staff', staffRouter);

import { adminRouter } from './admin/admin.routes';
app.use('/admin', adminRouter);

// Chat is mounted before /therapist so it has its own auth instead of falling through the therapist router.
import { studentChatRouter, therapistChatRouter } from './chat/chat.routes';
app.use('/therapist/chat', therapistChatRouter);
app.use('/api/chat', requireAuth as any, studentChatRouter as any);

import { therapistRouter } from './booking/therapist.routes';
app.use('/therapist', therapistRouter);

import { studentBookingRouter } from './booking/student.routes';
app.use('/api/booking', requireAuth as any, studentBookingRouter as any);

import { checkinRouter } from './checkins/checkin.routes';
app.use('/api/checkins', requireAuth as any, checkinRouter as any);

import { contactsRouter } from './contacts/contacts.routes';
app.use('/api', contactsRouter);

const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  const message = error instanceof Error ? error.message : 'Unexpected server error.';
  const normalized = message.toLowerCase();
  const status =
    normalized.includes('not registered') || normalized.includes('not found')
      ? 404
      : normalized.includes('required') ||
        normalized.includes('valid') ||
        normalized.includes('expired')
      ? 400
      : 500;

  res.status(status).json({ error: status === 500 ? 'Internal server error.' : message });
};

app.use(errorHandler);

import { attachChatSocket, CHAT_WS_PATH } from './chat/chat.hub';
const server = app.listen(config.port,"0.0.0.0", () => {
  console.log(`Server listening on http://localhost:${config.port} (chat socket on ${CHAT_WS_PATH})`);
});
attachChatSocket(server);
