import { Router, Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { z } from 'zod';
import { createAutoFeedingReminder } from '../lib/auto-reminder';

export const recordRouter = Router();

const createRecordSchema = z.object({
  babyId: z.string().uuid(),
  category: z.enum(['feeding', 'nursing', 'activity']),
  type: z.string(),
  data: z.record(z.unknown()),
  occurredAt: z.string(),
  note: z.string().optional(),
  images: z.array(z.string()).optional(),
});

const querySchema = z.object({
  babyId: z.string(),
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(100).default(20),
  category: z.string().optional(),
  type: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  hasImages: z.string().optional(),
  keyword: z.string().optional(),
});

recordRouter.get('/', async (req: Request, res: Response) => {
  try {
    const query = querySchema.parse(req.query);

    const member = await prisma.babyMember.findFirst({
      where: { babyId: query.babyId, userId: req.userId! },
    });
    if (!member) {
      res.status(403).json({ success: false, error: 'Permission denied' });
      return;
    }

    const where: any = { babyId: query.babyId };
    if (query.category) where.category = query.category;
    if (query.type) where.type = query.type;
    if (query.startDate || query.endDate) {
      where.occurredAt = {};
      if (query.startDate) where.occurredAt.gte = new Date(query.startDate);
      if (query.endDate) where.occurredAt.lte = new Date(query.endDate);
    }
    if (query.hasImages === 'true') {
      where.images = { not: null };
    }
    if (query.keyword) {
      where.note = { contains: query.keyword };
    }

    const [items, total] = await Promise.all([
      prisma.record.findMany({
        where,
        orderBy: { occurredAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: { user: { select: { id: true, displayName: true } } },
      }),
      prisma.record.count({ where }),
    ]);

    const parsed = items.map((item) => ({
      ...item,
      data: JSON.parse(item.data),
      images: item.images ? JSON.parse(item.images) : [],
    }));

    res.json({
      success: true,
      data: {
        items: parsed,
        total,
        page: query.page,
        pageSize: query.pageSize,
        hasMore: query.page * query.pageSize < total,
      },
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

recordRouter.post('/', async (req: Request, res: Response) => {
  try {
    const body = createRecordSchema.parse(req.body);

    const member = await prisma.babyMember.findFirst({
      where: { babyId: body.babyId, userId: req.userId!, role: { in: ['admin', 'editor'] } },
    });
    if (!member) {
      res.status(403).json({ success: false, error: 'Permission denied' });
      return;
    }

    const record = await prisma.record.create({
      data: {
        babyId: body.babyId,
        category: body.category,
        type: body.type,
        data: JSON.stringify(body.data),
        occurredAt: new Date(body.occurredAt),
        note: body.note,
        images: body.images ? JSON.stringify(body.images) : null,
        createdBy: req.userId!,
      },
    });

    res.json({
      success: true,
      data: { ...record, data: JSON.parse(record.data), images: record.images ? JSON.parse(record.images) : [] },
    });

    if (body.category === 'feeding') {
      createAutoFeedingReminder(body.babyId).catch(() => {});
    }
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

recordRouter.put('/:id', async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const existing = await prisma.record.findUnique({ where: { id } });
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

    const record = await prisma.record.update({
      where: { id },
      data: {
        ...(req.body.category && { category: req.body.category }),
        ...(req.body.type && { type: req.body.type }),
        ...(req.body.data && { data: JSON.stringify(req.body.data) }),
        ...(req.body.occurredAt && { occurredAt: new Date(req.body.occurredAt) }),
        ...(req.body.note !== undefined && { note: req.body.note }),
        ...(req.body.images && { images: JSON.stringify(req.body.images) }),
      },
    });

    res.json({
      success: true,
      data: { ...record, data: JSON.parse(record.data), images: record.images ? JSON.parse(record.images) : [] },
    });
  } catch {
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

recordRouter.delete('/:id', async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const existing = await prisma.record.findUnique({ where: { id } });
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

    await prisma.record.delete({ where: { id } });
    res.json({ success: true });
  } catch {
    res.status(500).json({ success: false, error: 'Server error' });
  }
});
