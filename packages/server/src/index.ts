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

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
