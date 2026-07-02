import { Router, Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { z } from 'zod';
import crypto from 'crypto';
import { authMiddleware } from '../middleware/auth';

export const authRouter = Router();

const loginSchema = z.object({
  username: z.string(),
  password: z.string(),
});

const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const LOWER = 'abcdefghjkmnpqrstuvwxyz';
const DIGITS = '23456789';
const SYMBOLS = '!@#$%&*';
const ALL_CHARS = UPPER + LOWER + DIGITS + SYMBOLS;

function generatePassword(length = 16): string {
  let password: string;
  do {
    const bytes = crypto.randomBytes(length);
    password = '';
    for (let i = 0; i < length; i++) {
      password += ALL_CHARS[bytes[i] % ALL_CHARS.length];
    }
  } while (!validatePasswordStrength(password));
  return password;
}

function validatePasswordStrength(password: string): boolean {
  if (password.length < 8) return false;
  if (!/[A-Z]/.test(password)) return false;
  if (!/[a-z]/.test(password)) return false;
  if (!/[0-9]/.test(password)) return false;
  if (!/[!@#$%&*]/.test(password)) return false;
  return true;
}

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
        user: { id: user.id, username: user.username, displayName: user.displayName, role: user.role },
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
    data: { id: user.id, username: user.username, displayName: user.displayName, role: user.role },
  });
});

// Admin: create user
authRouter.post('/users', authMiddleware, async (req: Request, res: Response) => {
  try {
    const admin = await prisma.user.findUnique({ where: { id: req.userId! } });
    if (!admin || admin.role !== 'admin') {
      res.status(403).json({ success: false, error: '仅管理员可操作' });
      return;
    }

    const schema = z.object({
      username: z.string().min(2).max(50),
      displayName: z.string().min(1).max(50),
    });
    const body = schema.parse(req.body);

    const existing = await prisma.user.findUnique({ where: { username: body.username } });
    if (existing) {
      res.status(400).json({ success: false, error: '用户名已存在' });
      return;
    }

    const password = generatePassword();
    const user = await prisma.user.create({
      data: {
        username: body.username,
        password,
        displayName: body.displayName,
        role: 'user',
      },
    });

    res.json({
      success: true,
      data: {
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        role: user.role,
        generatedPassword: password,
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

// Admin: list users
authRouter.get('/users', authMiddleware, async (req: Request, res: Response) => {
  try {
    const admin = await prisma.user.findUnique({ where: { id: req.userId! } });
    if (!admin || admin.role !== 'admin') {
      res.status(403).json({ success: false, error: '仅管理员可操作' });
      return;
    }

    const users = await prisma.user.findMany({
      select: { id: true, username: true, displayName: true, role: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    });

    res.json({ success: true, data: users });
  } catch {
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// Admin: delete user
authRouter.delete('/users/:id', authMiddleware, async (req: Request, res: Response) => {
  try {
    const admin = await prisma.user.findUnique({ where: { id: req.userId! } });
    if (!admin || admin.role !== 'admin') {
      res.status(403).json({ success: false, error: '仅管理员可操作' });
      return;
    }

    const targetId = req.params.id as string;
    if (targetId === req.userId) {
      res.status(400).json({ success: false, error: '不能删除自己' });
      return;
    }

    await prisma.user.delete({ where: { id: targetId } });
    res.json({ success: true });
  } catch {
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// Admin: reset user password
authRouter.post('/users/:id/reset-password', authMiddleware, async (req: Request, res: Response) => {
  try {
    const admin = await prisma.user.findUnique({ where: { id: req.userId! } });
    if (!admin || admin.role !== 'admin') {
      res.status(403).json({ success: false, error: '仅管理员可操作' });
      return;
    }

    const targetId = req.params.id as string;
    const password = generatePassword();

    await prisma.user.update({
      where: { id: targetId },
      data: { password },
    });

    res.json({ success: true, data: { generatedPassword: password } });
  } catch {
    res.status(500).json({ success: false, error: 'Server error' });
  }
});
