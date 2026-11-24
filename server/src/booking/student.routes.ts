import { Router, type NextFunction, type Response } from 'express';
import type { AuthedRequest } from '../auth/middlewares/auth.middleware';
import {
  BookingError, bookSlot, cancelAsStudent, isScope, isTopic, listOpenSlots, listOutreach, listStudentAppointments,
  getStudentAppointment, setConsent, updateOutreach, SCOPES,
} from './booking.service';
import { cancelStudentRequest, createRequest, getAvailability, listStudentRequests, respondToProposal } from './requests.service';

/** Student-facing booking, consent and outreach routes. Mounted behind `requireAuth` (student bearer token). */
export const studentBookingRouter = Router();

const handle = (fn: (req: AuthedRequest, res: Response) => Promise<void>) =>
  async (req: AuthedRequest, res: Response, next: NextFunction) => {
    try { await fn(req, res); } catch (error) {
      if (error instanceof BookingError) { res.status(error.status).json({ error: error.message }); return; }
      next(error);
    }
  };

studentBookingRouter.get('/slots', handle(async (req, res) => { res.json(await listOpenSlots(req.auth!.userId)); }));

studentBookingRouter.post('/appointments', handle(async (req, res) => {
  const { slotId, reason, consents, alertId } = req.body ?? {};
  if (typeof slotId !== 'string') throw new BookingError('slotId is required.', 400);
  if (reason != null && !isTopic(reason)) throw new BookingError('Invalid reason.', 400);
  if (consents != null && !(Array.isArray(consents) && consents.every(isScope))) throw new BookingError(`consents must be a list of ${SCOPES.join(', ')}.`, 400);
  if (alertId != null && typeof alertId !== 'string') throw new BookingError('Invalid alertId.', 400);
  res.status(201).json(await bookSlot(req.auth!.userId, { slotId, reason: reason ?? null, consents: consents ?? [], alertId: alertId ?? undefined }));
}));

studentBookingRouter.get('/appointments', handle(async (req, res) => { res.json(await listStudentAppointments(req.auth!.userId)); }));
studentBookingRouter.get('/appointments/:id', handle(async (req, res) => { res.json(await getStudentAppointment(req.auth!.userId, String(req.params.id))); }));
studentBookingRouter.post('/appointments/:id/cancel', handle(async (req, res) => { res.json(await cancelAsStudent(req.auth!.userId, String(req.params.id))); }));

studentBookingRouter.put('/appointments/:id/consent/:scope', handle(async (req, res) => {
  const scope = String(req.params.scope).toUpperCase();
  if (!isScope(scope)) throw new BookingError('Unknown consent scope.', 400);
  if (typeof req.body?.granted !== 'boolean') throw new BookingError('granted (boolean) is required.', 400);
  res.json(await setConsent(req.auth!.userId, String(req.params.id), scope, req.body.granted));
}));

studentBookingRouter.get('/outreach', handle(async (req, res) => { res.json(await listOutreach(req.auth!.userId)); }));
studentBookingRouter.post('/outreach/:id/:action', handle(async (req, res) => {
  const action = String(req.params.action);
  if (action !== 'seen' && action !== 'dismiss') throw new BookingError('Unknown action.', 400);
  await updateOutreach(req.auth!.userId, String(req.params.id), action);
  res.json({ ok: true });
}));

// ── Session requests (the in-app counselling request form) ──
studentBookingRouter.get('/availability', handle(async (req, res) => { res.json(await getAvailability(req.auth!.userId)); }));
studentBookingRouter.get('/requests', handle(async (req, res) => { res.json(await listStudentRequests(req.auth!.userId)); }));
studentBookingRouter.post('/requests', handle(async (req, res) => {
  const { rollNumber, branch, mode, therapistId, windows, slotId } = req.body ?? {};
  res.status(201).json(await createRequest(req.auth!.userId, { rollNumber, branch, mode, therapistId, windows, slotId }));
}));
studentBookingRouter.post('/requests/:id/respond', handle(async (req, res) => {
  const action = req.body?.action;
  if (action !== 'accept' && action !== 'decline') throw new BookingError('action must be accept or decline.', 400);
  res.json(await respondToProposal(req.auth!.userId, String(req.params.id), action === 'accept', req.body?.windows));
}));
studentBookingRouter.post('/requests/:id/cancel', handle(async (req, res) => { res.json(await cancelStudentRequest(req.auth!.userId, String(req.params.id))); }));
