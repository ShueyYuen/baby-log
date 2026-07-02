import { Router, Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { z } from 'zod';

export const growthRouter = Router();

const createGrowthSchema = z.object({
  babyId: z.string().uuid(),
  date: z.string(),
  height: z.number().positive().optional(),
  weight: z.number().positive().optional(),
  headCircumference: z.number().positive().optional(),
  note: z.string().optional(),
});

growthRouter.get('/', async (req: Request, res: Response) => {
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

    const records = await prisma.growthRecord.findMany({
      where: { babyId },
      orderBy: { date: 'desc' },
    });

    res.json({ success: true, data: records });
  } catch {
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

growthRouter.post('/', async (req: Request, res: Response) => {
  try {
    const body = createGrowthSchema.parse(req.body);

    const member = await prisma.babyMember.findFirst({
      where: { babyId: body.babyId, userId: req.userId!, role: { in: ['admin', 'editor'] } },
    });
    if (!member) {
      res.status(403).json({ success: false, error: 'Permission denied' });
      return;
    }

    const record = await prisma.growthRecord.create({
      data: {
        babyId: body.babyId,
        date: new Date(body.date),
        height: body.height,
        weight: body.weight,
        headCircumference: body.headCircumference,
        note: body.note,
      },
    });

    res.json({ success: true, data: record });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

growthRouter.put('/:id', async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const existing = await prisma.growthRecord.findUnique({ where: { id } });
    if (!existing) {
      res.status(404).json({ success: false, error: 'Not found' });
      return;
    }

    const member = await prisma.babyMember.findFirst({
      where: { babyId: existing.babyId, userId: req.userId!, role: { in: ['admin', 'editor'] } },
    });
    if (!member) {
      res.status(403).json({ success: false, error: 'Permission denied' });
      return;
    }

    const record = await prisma.growthRecord.update({
      where: { id },
      data: {
        ...(req.body.date && { date: new Date(req.body.date) }),
        ...(req.body.height !== undefined && { height: req.body.height }),
        ...(req.body.weight !== undefined && { weight: req.body.weight }),
        ...(req.body.headCircumference !== undefined && { headCircumference: req.body.headCircumference }),
        ...(req.body.note !== undefined && { note: req.body.note }),
      },
    });

    res.json({ success: true, data: record });
  } catch {
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

growthRouter.delete('/:id', async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const existing = await prisma.growthRecord.findUnique({ where: { id } });
    if (!existing) {
      res.status(404).json({ success: false, error: 'Not found' });
      return;
    }

    const member = await prisma.babyMember.findFirst({
      where: { babyId: existing.babyId, userId: req.userId!, role: { in: ['admin', 'editor'] } },
    });
    if (!member) {
      res.status(403).json({ success: false, error: 'Permission denied' });
      return;
    }

    await prisma.growthRecord.delete({ where: { id } });
    res.json({ success: true });
  } catch {
    res.status(500).json({ success: false, error: 'Server error' });
  }
});
