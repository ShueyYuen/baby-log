import cors from 'cors';
import express from 'express';
import fs from 'fs';
import path from 'path';
import { prisma } from './lib/prisma';
import { authMiddleware } from './middleware/auth';
import { authRouter } from './routes/auth';
import { babyRouter } from './routes/babies';
import { growthRouter } from './routes/growth';
import { milestoneRouter } from './routes/milestones';
import { planRouter } from './routes/plans';
import { pushRouter } from './routes/push';
import { recordRouter } from './routes/records';
import { statsRouter } from './routes/stats';
import { uploadRouter } from './routes/upload';
import { startReminderScheduler } from './scheduler';

const app = express();
const PORT = process.env.PORT || 3001;
const API_PREFIX = '/api/v1';

function resolveWebDistDir(): string | null {
  const candidates = [
    process.env.WEB_DIST_DIR,
    path.resolve(process.cwd(), '../web/dist'),
    path.resolve(process.cwd(), 'packages/web/dist'),
  ].filter(Boolean) as string[];

  for (const dir of candidates) {
    if (fs.existsSync(dir)) {
      return dir;
    }
  }

  return null;
}

app.use(cors());
app.use(express.json());

app.use((req, _res, next) => {
  if (!req.path.startsWith('/api/')) {
    console.log(`[HTTP] ${req.method} ${req.path}`);
  }
  next();
});

app.use(`${API_PREFIX}/uploads`, express.static('uploads'));

app.use(`${API_PREFIX}/auth`, authRouter);

app.use(`${API_PREFIX}/babies`, authMiddleware, babyRouter);
app.use(`${API_PREFIX}/records`, authMiddleware, recordRouter);
app.use(`${API_PREFIX}/plans`, authMiddleware, planRouter);
app.use(`${API_PREFIX}/growth`, authMiddleware, growthRouter);
app.use(`${API_PREFIX}/milestones`, authMiddleware, milestoneRouter);
app.use(`${API_PREFIX}/stats`, authMiddleware, statsRouter);
app.use(`${API_PREFIX}/upload`, authMiddleware, uploadRouter);
app.use(`${API_PREFIX}/push`, authMiddleware, pushRouter);

app.get(`${API_PREFIX}/health`, (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

const webDistDir = resolveWebDistDir();
console.log(`[Static] Web dist dir: ${webDistDir ?? 'NOT FOUND'}`);
if (webDistDir) {
  const indexHtml = path.join(webDistDir, 'index.html');
  console.log(`[Static] index.html exists: ${fs.existsSync(indexHtml)}`);
  app.use(express.static(webDistDir));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) {
      next();
      return;
    }
    console.log(`[SPA] Fallback → index.html for ${req.path}`);
    res.sendFile(indexHtml);
  });
} else {
  console.warn('[Static] No web dist directory found, SPA fallback disabled');
}

async function ensureAdmin() {
  const username = process.env.ADMIN_USERNAME;
  const password = process.env.ADMIN_PASSWORD;
  if (!username || !password) {
    console.log('ADMIN_USERNAME/ADMIN_PASSWORD not set, skipping admin bootstrap');
    return;
  }
  if (password.length < 8) {
    console.error('ADMIN_PASSWORD must be at least 8 characters');
    process.exit(1);
  }

  const existing = await prisma.user.findUnique({ where: { username } });
  if (existing) {
    if (existing.role !== 'admin' || existing.password !== password) {
      await prisma.user.update({
        where: { username },
        data: { role: 'admin', password },
      });
      console.log(`Admin account "${username}" updated`);
    }
  } else {
    await prisma.user.create({
      data: { username, password, displayName: '管理员', role: 'admin' },
    });
    console.log(`Admin account "${username}" created`);
  }
}

ensureAdmin().then(() => {
  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    startReminderScheduler();
  });
}).catch((err) => {
  console.error('Failed to bootstrap admin:', err);
  process.exit(1);
});
