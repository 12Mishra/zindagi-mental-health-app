import { Router } from 'express';
import multer from 'multer';
import os from 'os';
import path from 'path';

import {
  startConversationController,
  sendMessageController,
  endConversationController,
  getConversationController,
  getUserProfileController,
  getUserSummariesController,
  transcribeAudioController
} from '../controllers/conversation.controller';
import { requireAuth } from '../../auth/middlewares/auth.middleware';

export const conversationRouter = Router();

const upload = multer({ dest: path.join(os.tmpdir(), 'zindagi-audio-uploads') });

conversationRouter.post('/conversations', requireAuth as any, startConversationController as any);
conversationRouter.post('/conversations/:id/message', requireAuth as any, sendMessageController as any);
conversationRouter.post('/conversations/:id/end', requireAuth as any, endConversationController as any);
conversationRouter.get('/conversations/:id', requireAuth as any, getConversationController as any);

conversationRouter.get('/users/me/profile', requireAuth as any, getUserProfileController as any);
conversationRouter.get('/users/me/summaries', requireAuth as any, getUserSummariesController as any);

conversationRouter.post('/audio/transcribe', requireAuth as any, upload.single('audio'), transcribeAudioController as any);
