import { Router, Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { z } from 'zod';

export const authRouter = Router();

const registerSchema = z.object({
  username: z.string().min(2).max(50),
  password: z.string().min(4).max(100),
  displayName: z.string().min(1).max(50),
});

const loginSchema = z.object({
  username: z.string(),
  password: z.string(),
});

authRouter.post('/register', async (req: Request, res: Response) => {
  try {
    const body = registerSchema.parse(req.body);

    const existing = await prisma.user.findUnique({
      where: { username: body.username },
    });
    if (existing) {
      res.status(400).json({ success: false, error: '用户名已存在' });
      return;
    }

    const user = await prisma.user.create({
      data: {
        username: body.username,
        password: body.password, // MVP: plain text, use bcrypt in production
        displayName: body.displayName,
      },
    });

    res.json({
      success: true,
      data: {
        token: user.id,
        user: { id: user.id, username: user.username, displayName: user.displayName },
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

authRouter.post('/login', async (req: Request, res: Response) => {
  try {
    const body = loginSchema.parse(req.body);

    const user = await prisma.user.findUnique({
      where: { username: body.username },
    });

    if (!user || user.password !== body.password) {
      res.status(401).json({ success: false, error: '用户名或密码错误' });
      return;
    }

    res.json({
      success: true,
      data: {
        token: user.id,
        user: { id: user.id, username: user.username, displayName: user.displayName },
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

authRouter.get('/me', async (req: Request, res: Response) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ success: false, error: 'Unauthorized' });
    return;
  }

  const token = authHeader.slice(7);
  const user = await prisma.user.findUnique({ where: { id: token } });

  if (!user) {
    res.status(401).json({ success: false, error: 'Invalid token' });
    return;
  }

  res.json({
    success: true,
    data: { id: user.id, username: user.username, displayName: user.displayName },
  });
});
