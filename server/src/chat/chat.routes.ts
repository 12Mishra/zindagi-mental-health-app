import { Router, type NextFunction, type Request, type Response } from 'express';
import type { AuthedRequest } from '../auth/middlewares/auth.middleware';
import { BookingError } from '../booking/booking.service';
import { requireStaff, staffOf } from '../staff/staff.middleware';
import { issueChatTicket, type ChatPrincipal } from './chat.hub';
import { chatContacts, getMessages, listThreads, markRead, openAsStudent, openAsTherapist, sendMessage, unreadTotal } from './chat.service';

const handle = (fn: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction) => {
    fn(req, res).catch(error => {
      if (error instanceof BookingError) { res.status(error.status).json({ error: error.message }); return; }
      next(error);
    });
  };

/** Routes shared by both sides once the caller is known. */
function threadRoutes(router: Router, who: (req: Request) => ChatPrincipal) {
  router.get('/threads', handle(async (req, res) => { res.json(await listThreads(who(req))); }));
  router.get('/unread', handle(async (req, res) => { res.json({ unread: await unreadTotal(who(req)) }); }));
  router.get('/threads/:id/messages', handle(async (req, res) => {
    res.json(await getMessages(who(req), String(req.params.id), req.query.before));
  }));
  router.post('/threads/:id/messages', handle(async (req, res) => {
    res.status(201).json(await sendMessage(who(req), String(req.params.id), req.body?.body, req.body?.clientId));
  }));
  router.post('/threads/:id/read', handle(async (req, res) => { res.json(await markRead(who(req), String(req.params.id))); }));
  router.post('/ticket', handle(async (req, res) => { res.json(issueChatTicket(who(req))); }));
}

/** Student side, mounted at /api/chat behind requireAuth. */
export const studentChatRouter = Router();
const userId = (req: Request) => (req as AuthedRequest).auth!.userId;
const student = (req: Request): ChatPrincipal => ({ role: 'STUDENT', id: userId(req) });
studentChatRouter.get('/contacts', handle(async (req, res) => { res.json(await chatContacts(userId(req))); }));
studentChatRouter.post('/threads', handle(async (req, res) => {
  if (typeof req.body?.therapistId !== 'string') throw new BookingError('therapistId is required.', 400);
  res.json(await openAsStudent(userId(req), req.body.therapistId));
}));
threadRoutes(studentChatRouter, student);

/** Counsellor side, mounted at /therapist/chat. */
export const therapistChatRouter = Router();
therapistChatRouter.use(requireStaff('THERAPIST'));
const therapist = (req: Request): ChatPrincipal => ({ role: 'THERAPIST', id: staffOf(req).staffId });
therapistChatRouter.post('/threads', handle(async (req, res) => {
  const { staffId, institutionId } = staffOf(req);
  res.json(await openAsTherapist(staffId, institutionId, req.body ?? {}));
}));
threadRoutes(therapistChatRouter, therapist);
