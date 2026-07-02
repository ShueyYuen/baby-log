import { Router, Request, Response } from 'express';
import webpush from 'web-push';
import { prisma } from '../lib/prisma';
import { z } from 'zod';

export const pushRouter = Router();

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || '';
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || '';
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:baby-log@example.com';

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
}

pushRouter.get('/vapid-key', (_req: Request, res: Response) => {
  res.json({ success: true, data: { publicKey: VAPID_PUBLIC_KEY } });
});

const subscribeSchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({
    p256dh: z.string(),
    auth: z.string(),
  }),
});

pushRouter.post('/subscribe', async (req: Request, res: Response) => {
  try {
    const body = subscribeSchema.parse(req.body);

    console.log(`[Push] Subscribe request from user ${req.userId}, endpoint: ${body.endpoint.slice(0, 60)}...`);

    await prisma.pushSubscription.upsert({
      where: { endpoint: body.endpoint },
      update: { p256dh: body.keys.p256dh, auth: body.keys.auth, userId: req.userId! },
      create: {
        userId: req.userId!,
        endpoint: body.endpoint,
        p256dh: body.keys.p256dh,
        auth: body.keys.auth,
      },
    });

    console.log(`[Push] Subscription saved for user ${req.userId}`);
    res.json({ success: true });
  } catch (err) {
    console.error('[Push] Subscribe error:', err);
    res.status(400).json({ success: false, error: 'Invalid subscription data' });
  }
});

pushRouter.delete('/subscribe', async (req: Request, res: Response) => {
  try {
    const { endpoint } = req.body;
    if (!endpoint) {
      res.status(400).json({ success: false, error: 'endpoint required' });
      return;
    }

    await prisma.pushSubscription.deleteMany({
      where: { endpoint, userId: req.userId! },
    });

    res.json({ success: true });
  } catch {
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

const reminderSchema = z.object({
  babyId: z.string().uuid(),
  remindAt: z.string(),
  source: z.enum(['feeding_auto', 'feeding_manual', 'plan']).default('feeding_manual'),
  title: z.string().optional(),
  body: z.string().optional(),
  refId: z.string().optional(),
});

pushRouter.post('/reminder', async (req: Request, res: Response) => {
  try {
    const body = reminderSchema.parse(req.body);

    const member = await prisma.babyMember.findFirst({
      where: { babyId: body.babyId, userId: req.userId! },
    });
    if (!member) {
      res.status(403).json({ success: false, error: 'Permission denied' });
      return;
    }

    const reminder = await prisma.reminder.create({
      data: {
        babyId: body.babyId,
        remindAt: new Date(body.remindAt),
        source: body.source,
        title: body.title || '',
        body: body.body || '',
        refId: body.refId,
      },
    });

    res.json({ success: true, data: reminder });
  } catch {
    res.status(400).json({ success: false, error: 'Invalid data' });
  }
});

pushRouter.get('/reminder', async (req: Request, res: Response) => {
  try {
    const babyId = req.query.babyId as string;
    if (!babyId) {
      res.status(400).json({ success: false, error: 'babyId required' });
      return;
    }

    const member = await prisma.babyMember.findFirst({
      where: { babyId, userId: req.userId! },
    });
    if (!member) {
      res.status(403).json({ success: false, error: 'Permission denied' });
      return;
    }

    const reminders = await prisma.reminder.findMany({
      where: { babyId, sent: false, remindAt: { gte: new Date() } },
      orderBy: { remindAt: 'asc' },
      take: 10,
    });

    res.json({ success: true, data: reminders });
  } catch {
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

pushRouter.get('/due-reminders', async (req: Request, res: Response) => {
  try {
    const now = new Date();

    // Find all babies the user is a member of
    const memberships = await prisma.babyMember.findMany({
      where: { userId: req.userId! },
      select: { babyId: true },
    });

    const babyIds = memberships.map((m) => m.babyId);
    if (babyIds.length === 0) {
      res.json({ success: true, data: [] });
      return;
    }

    const dueReminders = await prisma.reminder.findMany({
      where: { babyId: { in: babyIds }, sent: false, remindAt: { lte: now } },
      include: { baby: { select: { name: true } } },
    });

    if (dueReminders.length === 0) {
      res.json({ success: true, data: [] });
      return;
    }

    const notifications = dueReminders.map((r) => ({
      id: r.id,
      title: r.title || `${r.baby.name} 提醒`,
      body: r.body || '您有一条提醒',
    }));

    // Mark as sent
    await prisma.reminder.updateMany({
      where: { id: { in: dueReminders.map((r) => r.id) } },
      data: { sent: true },
    });

    console.log(`[Push] Served ${notifications.length} due reminder(s) via polling to user ${req.userId}`);
    res.json({ success: true, data: notifications });
  } catch {
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

export async function sendPushToUser(userId: string, payload: { title: string; body: string; data?: Record<string, unknown> }) {
  const subscriptions = await prisma.pushSubscription.findMany({
    where: { userId },
  });

  console.log(`[Push] Sending to user ${userId}, found ${subscriptions.length} subscription(s)`);

  if (subscriptions.length === 0) {
    console.log(`[Push] No subscriptions for user ${userId}, skipping`);
    return [];
  }

  const results = await Promise.allSettled(
    subscriptions.map(async (sub) => {
      try {
        console.log(`[Push] Sending to endpoint: ${sub.endpoint.slice(0, 60)}...`);
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          JSON.stringify(payload)
        );
        console.log(`[Push] Successfully sent to ${sub.endpoint.slice(0, 60)}...`);
      } catch (err: any) {
        console.error(`[Push] Failed to send: status=${err.statusCode}, message=${err.message}`);
        if (err.statusCode === 410 || err.statusCode === 404) {
          await prisma.pushSubscription.delete({ where: { id: sub.id } });
          console.log(`[Push] Removed expired subscription ${sub.id}`);
        }
        throw err;
      }
    })
  );

  return results;
}

export async function sendPushToBabyMembers(babyId: string, payload: { title: string; body: string; data?: Record<string, unknown> }) {
  const members = await prisma.babyMember.findMany({
    where: { babyId },
    select: { userId: true },
  });

  console.log(`[Push] Sending to all members of baby ${babyId}, found ${members.length} member(s)`);

  const results = await Promise.allSettled(
    members.map((m) => sendPushToUser(m.userId, payload))
  );

  return results;
}
