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

statsRouter.get('/predict', async (req: Request, res: Response) => {
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

    const recentFeedings = await prisma.record.findMany({
      where: { babyId, category: 'feeding' },
      orderBy: { occurredAt: 'desc' },
      take: 30,
    });

    if (recentFeedings.length < 2) {
      res.json({ success: true, data: { nextFeeding: null, avgIntervalMinutes: null, method: null } });
      return;
    }

    const parsed = recentFeedings.map((r) => ({
      ...r,
      parsedData: JSON.parse(r.data) as Record<string, any>,
    }));

    // Calculate per-ml duration for bottles and per-minute duration for breastfeeding
    const bottleRates: number[] = []; // minutes per ml
    const breastRates: number[] = []; // minutes per nursing-minute

    for (let i = 0; i < parsed.length - 1; i++) {
      const current = parsed[i + 1]; // earlier feeding (the one we measure "how long it lasted")
      const next = parsed[i]; // the next feeding after it
      const intervalMin = (next.occurredAt.getTime() - current.occurredAt.getTime()) / 60000;

      if (intervalMin <= 0 || intervalMin > 480) continue; // skip anomalies (>8h or negative)

      if (current.type === 'bottle') {
        const ml = current.parsedData.amountMl;
        if (ml && ml > 0) {
          bottleRates.push(intervalMin / ml);
        }
      } else if (current.type === 'breastfeed') {
        const totalMin = (current.parsedData.leftMinutes || 0) + (current.parsedData.rightMinutes || 0);
        if (totalMin > 0) {
          breastRates.push(intervalMin / totalMin);
        }
      }
    }

    const lastFeeding = parsed[0];
    const lastFeedingTime = lastFeeding.occurredAt.getTime();
    let predictedInterval: number | null = null;
    let method: string | null = null;

    if (lastFeeding.type === 'bottle' && bottleRates.length >= 2) {
      const avgRate = bottleRates.reduce((a, b) => a + b, 0) / bottleRates.length;
      const ml = lastFeeding.parsedData.amountMl || 0;
      predictedInterval = Math.round(avgRate * ml);
      method = 'bottle';
    } else if (lastFeeding.type === 'breastfeed' && breastRates.length >= 2) {
      const avgRate = breastRates.reduce((a, b) => a + b, 0) / breastRates.length;
      const totalMin = (lastFeeding.parsedData.leftMinutes || 0) + (lastFeeding.parsedData.rightMinutes || 0);
      predictedInterval = Math.round(avgRate * totalMin);
      method = 'breastfeed';
    }

    // Fallback: use simple average interval if specific method doesn't have enough data
    if (predictedInterval === null) {
      const intervals: number[] = [];
      for (let i = 0; i < parsed.length - 1; i++) {
        const diff = parsed[i].occurredAt.getTime() - parsed[i + 1].occurredAt.getTime();
        const min = diff / 60000;
        if (min > 0 && min <= 480) intervals.push(min);
      }
      if (intervals.length >= 2) {
        predictedInterval = Math.round(intervals.reduce((a, b) => a + b, 0) / intervals.length);
        method = 'average';
      }
    }

    if (predictedInterval === null) {
      res.json({ success: true, data: { minutesUntilNext: null, avgIntervalMinutes: null, method: null } });
      return;
    }

    const now = new Date();
    const nextFeedingTime = new Date(lastFeedingTime + predictedInterval * 60000);
    const minutesUntilNext = Math.round((nextFeedingTime.getTime() - now.getTime()) / 60000);

    res.json({
      success: true,
      data: {
        minutesUntilNext,
        avgIntervalMinutes: predictedInterval,
        method,
      },
    });
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
