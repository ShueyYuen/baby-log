import { Router, Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { z } from 'zod';

export const planRouter = Router();

const createPlanSchema = z.object({
  babyId: z.string().uuid(),
  title: z.string().min(1),
  type: z.enum(['vaccine', 'doctor', 'checkup', 'medicine', 'custom']),
  scheduledAt: z.string(),
  description: z.string().optional(),
  reminder: z.string().optional(),
  repeat: z.enum(['none', 'daily', 'weekly', 'monthly']).default('none'),
});

planRouter.get('/', async (req: Request, res: Response) => {
  try {
    const babyId = req.query.babyId as string;
    const status = req.query.status as string | undefined;

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

    const where: any = { babyId };
    if (status) where.status = status;

    const plans = await prisma.plan.findMany({
      where,
      orderBy: { scheduledAt: 'asc' },
    });

    res.json({ success: true, data: plans });
  } catch {
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

planRouter.post('/', async (req: Request, res: Response) => {
  try {
    const body = createPlanSchema.parse(req.body);

    const member = await prisma.babyMember.findFirst({
      where: { babyId: body.babyId, userId: req.userId!, role: { in: ['admin', 'editor'] } },
    });
    if (!member) {
      res.status(403).json({ success: false, error: 'Permission denied' });
      return;
    }

    const plan = await prisma.plan.create({
      data: {
        babyId: body.babyId,
        title: body.title,
        type: body.type,
        scheduledAt: new Date(body.scheduledAt),
        description: body.description,
        reminder: body.reminder,
        repeat: body.repeat,
        createdBy: req.userId!,
      },
    });

    res.json({ success: true, data: plan });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

planRouter.put('/:id', async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const existing = await prisma.plan.findUnique({ where: { id } });
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

    const plan = await prisma.plan.update({
      where: { id },
      data: {
        ...(req.body.title && { title: req.body.title }),
        ...(req.body.type && { type: req.body.type }),
        ...(req.body.scheduledAt && { scheduledAt: new Date(req.body.scheduledAt) }),
        ...(req.body.description !== undefined && { description: req.body.description }),
        ...(req.body.reminder !== undefined && { reminder: req.body.reminder }),
        ...(req.body.repeat && { repeat: req.body.repeat }),
        ...(req.body.status && { status: req.body.status }),
      },
    });

    res.json({ success: true, data: plan });
  } catch {
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

planRouter.delete('/:id', async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const existing = await prisma.plan.findUnique({ where: { id } });
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

    await prisma.plan.delete({ where: { id } });
    res.json({ success: true });
  } catch {
    res.status(500).json({ success: false, error: 'Server error' });
  }
});
