import { Router } from 'express';

import {
  startConversationController,
  sendMessageController,
  endConversationController,
  getConversationController,
  getUserProfileController,
  getUserSummariesController,
  issueVoiceTicketController,
  deleteConversationController,
  getSavedConversationsController,
} from '../controllers/conversation.controller';
import { requireAuth } from '../../auth/middlewares/auth.middleware';

export const conversationRouter = Router();

conversationRouter.post('/conversations', requireAuth as any, startConversationController as any);
conversationRouter.post('/conversations/:id/message', requireAuth as any, sendMessageController as any);
conversationRouter.post('/conversations/:id/end', requireAuth as any, endConversationController as any);
conversationRouter.post('/conversations/:id/voice-ticket', requireAuth as any, issueVoiceTicketController as any);
conversationRouter.get('/conversations/:id', requireAuth as any, getConversationController as any);
conversationRouter.delete('/conversations/:id', requireAuth as any, deleteConversationController as any);

conversationRouter.get('/users/me/profile', requireAuth as any, getUserProfileController as any);
conversationRouter.get('/users/me/summaries', requireAuth as any, getUserSummariesController as any);
conversationRouter.get('/users/me/conversations', requireAuth as any, getSavedConversationsController as any);

conversationRouter.post('/audio/transcribe', requireAuth as any, (_req, res) => {
  res.status(410).json({ error: 'Recorded-file transcription is disabled. Use the realtime voice session.' });
});
