import { Request, Response, NextFunction } from 'express';
import { prisma } from '../lib/prisma';

declare global {
  namespace Express {
    interface Request {
      userId?: string;
    }
  }
}

/**
 * Simple token-based auth for MVP.
 * Token format: "Bearer <userId>" for simplicity.
 * In production, use JWT or session-based auth.
 */
export async function authMiddleware(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ success: false, error: 'Unauthorized' });
    return;
  }

  const token = authHeader.slice(7);

  try {
    const user = await prisma.user.findUnique({ where: { id: token } });
    if (!user) {
      res.status(401).json({ success: false, error: 'Invalid token' });
      return;
    }
    req.userId = user.id;
    next();
  } catch {
    res.status(500).json({ success: false, error: 'Auth error' });
  }
}
