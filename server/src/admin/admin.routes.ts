import { Router } from 'express';
import { prisma } from '../db';
import { attachAlertStream } from '../insights/alert-stream';
import { notifyAlert, toPublicAlert } from '../insights/alerts';
import { buildOverview, CohortTooSmallError } from '../insights/overview';
import { COHORT_PATTERN } from '../insights/privacy';
import { requireStaff, staffOf } from '../staff/staff.middleware';

export const adminRouter = Router();
adminRouter.use(requireStaff('ADMIN'));

const STATUSES = ['NEW', 'ACK', 'RESOLVED'] as const;
type Status = typeof STATUSES[number];
const isStatus = (value: unknown): value is Status => typeof value === 'string' && (STATUSES as readonly string[]).includes(value);

const DEFAULT_OUTREACH = 'A counsellor is available if you would like to talk. You can book a time in the app whenever you are ready. / जब आप चाहें, एक काउंसलर से बात करने के लिए ऐप में समय बुक कर सकते हैं।';

adminRouter.get('/overview', async (req, res, next) => {
  try {
    const cohort = typeof req.query.cohort === 'string' ? req.query.cohort : 'all';
    if (!COHORT_PATTERN.test(cohort)) { res.status(400).json({ error: 'Invalid cohort.' }); return; }
    res.json(await buildOverview(staffOf(req).institutionId, cohort));
  } catch (error) {
    if (error instanceof CohortTooSmallError) { res.status(422).json({ error: 'cohort_too_small' }); return; }
    next(error);
  }
});

// Declared before the :id routes so "stream" is never read as an id.
adminRouter.get('/alerts/stream', (req, res) => attachAlertStream(staffOf(req).institutionId, res));

adminRouter.get('/alerts', async (req, res, next) => {
  try {
    const { institutionId } = staffOf(req);
    const status = isStatus(req.query.status) ? req.query.status : undefined;
    const before = typeof req.query.before === 'string' && !Number.isNaN(Date.parse(req.query.before)) ? new Date(req.query.before) : undefined;
    const rows = await prisma.alert.findMany({
      where: { institutionId, ...(status ? { status } : {}), ...(before ? { lastSeenAt: { lt: before } } : {}) },
      orderBy: { lastSeenAt: 'desc' }, take: 50,
    });
    res.json({ alerts: rows.map(toPublicAlert), next: rows.length === 50 ? rows[49].lastSeenAt.toISOString() : null });
  } catch (error) { next(error); }
});

adminRouter.patch('/alerts/:id', async (req, res, next) => {
  try {
    const { institutionId } = staffOf(req);
    const { status, assigneeId } = (req.body ?? {}) as { status?: unknown; assigneeId?: unknown };
    const data: { status?: Status; resolvedAt?: Date | null; assigneeId?: string | null } = {};
    if (status !== undefined) {
      if (!isStatus(status)) { res.status(400).json({ error: 'status must be NEW, ACK or RESOLVED.' }); return; }
      data.status = status;
      data.resolvedAt = status === 'RESOLVED' ? new Date() : null;
    }
    if (assigneeId !== undefined) {
      if (assigneeId !== null) {
        const therapist = typeof assigneeId === 'string'
          ? await prisma.staffUser.findFirst({ where: { id: assigneeId, institutionId, role: 'THERAPIST', active: true }, select: { id: true } }) : null;
        if (!therapist) { res.status(400).json({ error: 'assigneeId must be a therapist of this institution.' }); return; }
      }
      data.assigneeId = assigneeId as string | null;
    }
    if (!Object.keys(data).length) { res.status(400).json({ error: 'Nothing to update.' }); return; }
    // Scoped by institution in the write itself, so another institution's alert id simply matches nothing.
    const { count } = await prisma.alert.updateMany({ where: { id: req.params.id, institutionId }, data });
    const alert = count ? await prisma.alert.findFirst({ where: { id: req.params.id, institutionId } }) : null;
    if (!alert) { res.status(404).json({ error: 'Alert not found.' }); return; }
    await notifyAlert('alert.updated', alert);
    res.json(toPublicAlert(alert));
  } catch (error) { next(error); }
});

/** Sends an in-app invitation to the student behind an alert. The admin never learns who that student is. */
adminRouter.post('/alerts/:id/outreach', async (req, res, next) => {
  try {
    const { institutionId } = staffOf(req);
    const alert = await prisma.alert.findFirst({ where: { id: req.params.id, institutionId } });
    if (!alert) { res.status(404).json({ error: 'Alert not found.' }); return; }
    if (!alert.subjectUserId) { res.status(400).json({ error: 'This alert has no individual student.' }); return; }
    const message = typeof req.body?.message === 'string' && req.body.message.trim() ? req.body.message.trim() : DEFAULT_OUTREACH;
    if (message.length > 280) { res.status(400).json({ error: 'message must be at most 280 characters.' }); return; }
    const recent = await prisma.outreach.findFirst({ where: { alertId: alert.id, createdAt: { gte: new Date(Date.now() - 86_400_000) } }, select: { id: true } });
    if (recent) { res.status(429).json({ error: 'Outreach was already sent in the last 24 hours.' }); return; }
    await prisma.outreach.create({ data: { alertId: alert.id, userId: alert.subjectUserId, message } });
    res.status(201).json({ ok: true });
  } catch (error) { next(error); }
});

adminRouter.get('/therapists', async (req, res, next) => {
  try {
    const rows = await prisma.staffUser.findMany({
      where: { institutionId: staffOf(req).institutionId, role: 'THERAPIST', active: true },
      orderBy: { displayName: 'asc' }, select: { id: true, displayName: true },
    });
    res.json(rows);
  } catch (error) { next(error); }
});
