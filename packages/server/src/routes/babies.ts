import { Router, Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { z } from 'zod';

export const babyRouter = Router();

const createBabySchema = z.object({
  name: z.string().min(1).max(50),
  gender: z.enum(['male', 'female']),
  birthDate: z.string(),
  avatar: z.string().optional(),
});

babyRouter.get('/', async (req: Request, res: Response) => {
  try {
    const babies = await prisma.baby.findMany({
      where: {
        members: { some: { userId: req.userId! } },
      },
      include: {
        members: { include: { user: { select: { id: true, displayName: true } } } },
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json({ success: true, data: babies });
  } catch {
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

babyRouter.post('/', async (req: Request, res: Response) => {
  try {
    const body = createBabySchema.parse(req.body);

    const baby = await prisma.baby.create({
      data: {
        name: body.name,
        gender: body.gender,
        birthDate: new Date(body.birthDate),
        avatar: body.avatar,
        members: {
          create: { userId: req.userId!, role: 'admin' },
        },
      },
    });

    res.json({ success: true, data: baby });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

babyRouter.get('/:id', async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const baby = await prisma.baby.findFirst({
      where: {
        id,
        members: { some: { userId: req.userId! } },
      },
      include: {
        members: { include: { user: { select: { id: true, displayName: true } } } },
      },
    });

    if (!baby) {
      res.status(404).json({ success: false, error: 'Not found' });
      return;
    }

    res.json({ success: true, data: baby });
  } catch {
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

babyRouter.put('/:id', async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const member = await prisma.babyMember.findFirst({
      where: { babyId: id, userId: req.userId!, role: { in: ['admin', 'editor'] } },
    });
    if (!member) {
      res.status(403).json({ success: false, error: 'Permission denied' });
      return;
    }

    const baby = await prisma.baby.update({
      where: { id },
      data: {
        ...(req.body.name && { name: req.body.name }),
        ...(req.body.gender && { gender: req.body.gender }),
        ...(req.body.birthDate && { birthDate: new Date(req.body.birthDate) }),
        ...(req.body.avatar !== undefined && { avatar: req.body.avatar }),
      },
    });

    res.json({ success: true, data: baby });
  } catch {
    res.status(500).json({ success: false, error: 'Server error' });
  }
});
