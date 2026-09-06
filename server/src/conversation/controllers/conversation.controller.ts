import type { NextFunction, Request, Response } from 'express';
import type { AuthedRequest } from '../../auth/middlewares/auth.middleware';
import * as conversationService from '../services/conversation.service';
import { transcribeAudio } from '../services/stt.service';

export const startConversationController = async (req: AuthedRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.auth!.userId;
    const { moodBefore = [], moodNote } = req.body;
    const conversation = await conversationService.startConversation(userId, moodBefore, moodNote);
    res.status(201).json(conversation);
  } catch (error) {
    next(error);
  }
};

export const sendMessageController = async (req: AuthedRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.auth!.userId;
    const conversationId = String(req.params.id);
    const content = req.body.content || req.body.text;
    
    if (!content) {
      res.status(400).json({ error: 'Message content is required' });
      return;
    }
    
    const result = await conversationService.processMessage(conversationId, userId, content);
    res.json(result);
  } catch (error) {
    next(error);
  }
};

export const endConversationController = async (req: AuthedRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.auth!.userId;
    const conversationId = String(req.params.id);
    const summary = await conversationService.endConversation(conversationId, userId);
    res.json(summary);
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

export const transcribeAudioController = async (req: AuthedRequest, res: Response, next: NextFunction) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: 'No audio file uploaded' });
      return;
    }
    
    const transcribedText = await transcribeAudio(req.file.path);
    res.json({ text: transcribedText });
  } catch (error) {
    next(error);
  }
};
