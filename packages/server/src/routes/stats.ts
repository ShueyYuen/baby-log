import { Router, Request, Response } from 'express';
import { prisma } from '../lib/prisma';

export const statsRouter = Router();

statsRouter.get('/summary', async (req: Request, res: Response) => {
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

    const now = new Date();

    const lastFeeding = await prisma.record.findFirst({
      where: { babyId, category: 'feeding' },
      orderBy: { occurredAt: 'desc' },
    });

    const lastDiaper = await prisma.record.findFirst({
      where: { babyId, category: 'nursing', type: 'diaper' },
      orderBy: { occurredAt: 'desc' },
    });

    const lastSleep = await prisma.record.findFirst({
      where: { babyId, category: 'activity', type: 'sleep' },
      orderBy: { occurredAt: 'desc' },
    });

    const summary = {
      lastFeeding: lastFeeding
        ? { time: lastFeeding.occurredAt.toISOString(), minutesAgo: Math.round((now.getTime() - lastFeeding.occurredAt.getTime()) / 60000) }
        : null,
      lastDiaper: lastDiaper
        ? { time: lastDiaper.occurredAt.toISOString(), minutesAgo: Math.round((now.getTime() - lastDiaper.occurredAt.getTime()) / 60000) }
        : null,
      lastSleep: lastSleep
        ? { time: lastSleep.occurredAt.toISOString(), minutesAgo: Math.round((now.getTime() - lastSleep.occurredAt.getTime()) / 60000) }
        : null,
    };

    res.json({ success: true, data: summary });
  } catch {
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

statsRouter.get('/daily', async (req: Request, res: Response) => {
  try {
    const babyId = req.query.babyId as string;
    const date = req.query.date as string || new Date().toISOString().split('T')[0];

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

    const startOfDay = new Date(date + 'T00:00:00.000Z');
    const endOfDay = new Date(date + 'T23:59:59.999Z');

    const records = await prisma.record.findMany({
      where: {
        babyId,
        occurredAt: { gte: startOfDay, lte: endOfDay },
      },
    });

    let feedingCount = 0;
    let diaperCount = 0;
    let sleepMinutes = 0;
    const feedingDetails = { breastfeed: 0, bottle: 0, solid: 0 };

    for (const record of records) {
      if (record.category === 'feeding') {
        feedingCount++;
        if (record.type === 'breastfeed') feedingDetails.breastfeed++;
        else if (record.type === 'bottle') feedingDetails.bottle++;
        else if (record.type === 'solid') feedingDetails.solid++;
      } else if (record.type === 'diaper') {
        diaperCount++;
      } else if (record.type === 'sleep') {
        const data = JSON.parse(record.data);
        sleepMinutes += data.durationMinutes || 0;
      }
    }

    res.json({
      success: true,
      data: { date, feedingCount, diaperCount, sleepMinutes, feedingDetails },
    });
  } catch {
    res.status(500).json({ success: false, error: 'Server error' });
  }
});
