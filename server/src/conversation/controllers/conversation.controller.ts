import type { NextFunction, Request, Response } from 'express';
import type { AuthedRequest } from '../../auth/middlewares/auth.middleware';
import * as conversationService from '../services/conversation.service';
import { issueVoiceTicket } from '../../voice/tickets';

export const startConversationController = async (req: AuthedRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.auth!.userId;
    const { moodBefore = [], moodNote, transcriptConsent = false } = req.body ?? {};
    if (!Array.isArray(moodBefore) || moodBefore.some(value => typeof value !== 'string') ||
        (moodNote !== undefined && typeof moodNote !== 'string') || typeof transcriptConsent !== 'boolean') {
      res.status(400).json({ error: 'Invalid conversation options.' }); return;
    }
    const conversation = await conversationService.startConversation(userId, moodBefore, moodNote, transcriptConsent);
    res.status(201).json(conversation);
  } catch (error) {
    next(error);
  }
};

export const sendMessageController = async (req: AuthedRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.auth!.userId;
    const conversationId = String(req.params.id);
    const content = req.body?.content || req.body?.text;
    
    if (typeof content !== 'string' || content.length > 2000) {
      res.status(400).json({ error: 'Message content must be text up to 2000 characters.' });
      return;
    }
    const clientTurnId = req.body?.clientTurnId;
    if (clientTurnId !== undefined && (typeof clientTurnId !== 'string' || clientTurnId.length > 100)) {
      res.status(400).json({ error: 'Invalid clientTurnId.' }); return;
    }
    
    const result = await conversationService.processMessage(conversationId, userId, content, clientTurnId);
    res.json(result);
  } catch (error) {
    next(error);
  }
};

export const endConversationController = async (req: AuthedRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.auth!.userId;
    const conversationId = String(req.params.id);
    const result = await conversationService.endConversation(conversationId, userId);
    res.json(result);
  } catch (error) {
    next(error);
  }
};

export const getConversationController = async (req: AuthedRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.auth!.userId;
    const conversationId = String(req.params.id);
    const conversation = await conversationService.getConversation(conversationId, userId);
    res.json(conversation);
  } catch (error) {
    next(error);
  }
};

export const getUserProfileController = async (req: AuthedRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.auth!.userId;
    const profile = await conversationService.getUserProfile(userId);
    res.json(profile || { message: 'Profile not found' });
  } catch (error) {
    next(error);
  }
};

export const getUserSummariesController = async (req: AuthedRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.auth!.userId;
    const limit = parseInt(req.query.limit as string) || 10;
    const summaries = await conversationService.getUserSummaries(userId, limit);
    res.json(summaries);
  } catch (error) {
    next(error);
  }
};

export const getSavedConversationsController = async (req: AuthedRequest, res: Response, next: NextFunction) => {
  try {
    const limit = Number(req.query.limit ?? 20);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 30) {
      res.status(400).json({ error: 'limit must be between 1 and 30.' }); return;
    }
    res.json(await conversationService.getSavedConversations(req.auth!.userId, limit));
  } catch (error) { next(error); }
};

export const issueVoiceTicketController = async (req: AuthedRequest, res: Response, next: NextFunction) => {
  try {
    const result = await issueVoiceTicket(req.auth!.userId, req.auth!.sessionId, String(req.params.id));
    if (!result) { res.status(404).json({ error: 'Active conversation not found.' }); return; }
    res.json(result);
  } catch (error) { next(error); }
};

export const deleteConversationController = async (req: AuthedRequest, res: Response, next: NextFunction) => {
  try {
    await conversationService.deleteConversation(String(req.params.id), req.auth!.userId);
    res.status(204).send();
  } catch (error) { next(error); }
};
