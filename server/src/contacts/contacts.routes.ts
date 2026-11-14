import { Router, type NextFunction, type Response } from 'express';
import type { AuthedRequest } from '../auth/middlewares/auth.middleware';
import { requireAuth } from '../auth/middlewares/auth.middleware';
import { ContactsError, createContact, deleteContact, listContacts, reorderContacts, updateContact } from './contacts.service';
import { getPendingPrompt, listNotifications, previewMessage, respondToPrompt } from './prompts.service';

/** Student-only routes, mounted at /api. Every query is scoped to the caller; another student's ids are a 404, never a 403. */
export const contactsRouter = Router();
contactsRouter.use(['/contacts', '/support-prompts', '/contact-notifications'], requireAuth as any);

const handle = (fn: (req: AuthedRequest, res: Response) => Promise<void>) =>
  async (req: AuthedRequest, res: Response, next: NextFunction) => {
    try { await fn(req, res); } catch (error) {
      if (error instanceof ContactsError) { res.status(error.status).json({ error: error.message }); return; }
      next(error);
    }
  };

const uid = (req: AuthedRequest) => req.auth!.userId;

contactsRouter.get('/contacts', handle(async (req, res) => { res.json(await listContacts(uid(req))); }));
contactsRouter.post('/contacts', handle(async (req, res) => { res.status(201).json(await createContact(uid(req), req.body ?? {})); }));
// Declared before /contacts/:id so "order" and "message-preview" are never read as ids.
contactsRouter.put('/contacts/order', handle(async (req, res) => { res.json(await reorderContacts(uid(req), req.body?.ids)); }));
contactsRouter.get('/contacts/message-preview', handle(async (req, res) => { res.json(await previewMessage(uid(req), req.query.lang)); }));
contactsRouter.patch('/contacts/:id', handle(async (req, res) => { res.json(await updateContact(uid(req), String(req.params.id), req.body ?? {})); }));
contactsRouter.delete('/contacts/:id', handle(async (req, res) => { await deleteContact(uid(req), String(req.params.id)); res.status(204).end(); }));

contactsRouter.get('/support-prompts/pending', handle(async (req, res) => { res.json(await getPendingPrompt(uid(req))); }));
contactsRouter.post('/support-prompts/:id/respond', handle(async (req, res) => {
  res.json(await respondToPrompt(uid(req), String(req.params.id), req.body ?? {}));
}));

contactsRouter.get('/contact-notifications', handle(async (req, res) => { res.json(await listNotifications(uid(req))); }));
