import express from 'express';
import cors from 'cors';
import { recordRouter } from './routes/records';
import { planRouter } from './routes/plans';
import { growthRouter } from './routes/growth';
import { milestoneRouter } from './routes/milestones';
import { babyRouter } from './routes/babies';
import { authRouter } from './routes/auth';
import { statsRouter } from './routes/stats';
import { authMiddleware } from './middleware/auth';
import { uploadRouter } from './routes/upload';
import { pushRouter } from './routes/push';
import { startReminderScheduler } from './scheduler';
import { prisma } from './lib/prisma';

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());
app.use('/uploads', express.static('uploads'));

app.use('/api/auth', authRouter);

app.use('/api/babies', authMiddleware, babyRouter);
app.use('/api/records', authMiddleware, recordRouter);
app.use('/api/plans', authMiddleware, planRouter);
app.use('/api/growth', authMiddleware, growthRouter);
app.use('/api/milestones', authMiddleware, milestoneRouter);
app.use('/api/stats', authMiddleware, statsRouter);
app.use('/api/upload', authMiddleware, uploadRouter);
app.use('/api/push', authMiddleware, pushRouter);

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

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
