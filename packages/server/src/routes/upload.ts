import { Router, Request, Response } from 'express';
import multer from 'multer';
import { uploadFile, getStorageType } from '../lib/storage';

export const uploadRouter = Router();

const storage = getStorageType() === 's3'
  ? multer.memoryStorage()
  : multer.diskStorage({
      destination: (_req, _file, cb) => cb(null, process.env.UPLOAD_DIR || 'uploads'),
      filename: (_req, file, cb) => cb(null, file.originalname),
    });

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (_req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('不支持的文件类型，仅允许 JPG/PNG/GIF/WebP'));
    }
  },
});

uploadRouter.post('/', upload.single('file'), async (req: Request, res: Response) => {
  if (!req.file) {
    res.status(400).json({ success: false, error: 'No file uploaded' });
    return;
  }

  try {
    const result = await uploadFile(req.file);
    res.json({ success: true, data: result });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message || 'Upload failed' });
  }
});

uploadRouter.post('/multiple', upload.array('files', 9), async (req: Request, res: Response) => {
  const files = req.files as Express.Multer.File[];
  if (!files || files.length === 0) {
    res.status(400).json({ success: false, error: 'No files uploaded' });
    return;
  }

  try {
    const results = await Promise.all(files.map(uploadFile));
    res.json({ success: true, data: results });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message || 'Upload failed' });
  }
});
