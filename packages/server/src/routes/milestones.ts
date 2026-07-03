import { Router, Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { z } from 'zod';
import { deleteFilesBestEffort, diffRemovedKeys, toDisplayUrls, toStorageKeys } from '../lib/storage';

export const milestoneRouter = Router();

const createMilestoneSchema = z.object({
  babyId: z.string().uuid(),
  type: z.string(),
  title: z.string().min(1),
  occurredAt: z.string(),
  description: z.string().optional(),
  images: z.array(z.string()).optional(),
});

milestoneRouter.get('/', async (req: Request, res: Response) => {
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

    const milestones = await prisma.milestone.findMany({
      where: { babyId },
      orderBy: { occurredAt: 'desc' },
    });

    const parsed = await Promise.all(milestones.map(async (m) => ({
      ...m,
      images: m.images ? await toDisplayUrls(JSON.parse(m.images)) : [],
    })));

    res.json({ success: true, data: parsed });
  } catch {
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

milestoneRouter.post('/', async (req: Request, res: Response) => {
  try {
    const body = createMilestoneSchema.parse(req.body);

    const member = await prisma.babyMember.findFirst({
      where: { babyId: body.babyId, userId: req.userId!, role: { in: ['admin', 'editor'] } },
    });
    if (!member) {
      res.status(403).json({ success: false, error: 'Permission denied' });
      return;
    }

    const milestone = await prisma.milestone.create({
      data: {
        babyId: body.babyId,
        type: body.type,
        title: body.title,
        occurredAt: new Date(body.occurredAt),
        description: body.description,
        images: body.images ? JSON.stringify(toStorageKeys(body.images)) : null,
      },
    });

    res.json({
      success: true,
      data: { ...milestone, images: milestone.images ? await toDisplayUrls(JSON.parse(milestone.images)) : [] },
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

milestoneRouter.put('/:id', async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const existing = await prisma.milestone.findUnique({ where: { id } });
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

    const milestone = await prisma.milestone.update({
      where: { id },
      data: {
        ...(req.body.type && { type: req.body.type }),
        ...(req.body.title && { title: req.body.title }),
        ...(req.body.occurredAt && { occurredAt: new Date(req.body.occurredAt) }),
        ...(req.body.description !== undefined && { description: req.body.description }),
        ...(req.body.images !== undefined && { images: req.body.images ? JSON.stringify(toStorageKeys(req.body.images)) : null }),
      },
    });

    // 编辑时清理被移除的旧图片文件（尽力而为，不阻断响应）
    if (req.body.images !== undefined && existing.images) {
      const removed = diffRemovedKeys(JSON.parse(existing.images), req.body.images || []);
      if (removed.length > 0) deleteFilesBestEffort(removed).catch(() => {});
    }

    res.json({
      success: true,
      data: { ...milestone, images: milestone.images ? await toDisplayUrls(JSON.parse(milestone.images)) : [] },
    });
  } catch {
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

milestoneRouter.delete('/:id', async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const existing = await prisma.milestone.findUnique({ where: { id } });
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

    await prisma.milestone.delete({ where: { id } });

    // 同步删除该里程碑关联的图片文件（尽力而为，不阻断响应）
    if (existing.images) {
      deleteFilesBestEffort(JSON.parse(existing.images)).catch(() => {});
    }

    res.json({ success: true });
  } catch {
    res.status(500).json({ success: false, error: 'Server error' });
  }
});
