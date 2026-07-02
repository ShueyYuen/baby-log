import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';

export type StorageType = 'local' | 's3';

interface StorageConfig {
  type: StorageType;
  s3?: {
    bucket: string;
    region: string;
    endpoint?: string;
    accessKeyId: string;
    secretAccessKey: string;
    publicUrl?: string;
    forcePathStyle?: boolean;
  };
  local?: {
    uploadDir: string;
    publicPath: string;
  };
}

function getConfig(): StorageConfig {
  const type = (process.env.STORAGE_TYPE || 'local') as StorageType;

  if (type === 's3') {
    return {
      type: 's3',
      s3: {
        bucket: process.env.S3_BUCKET || '',
        region: process.env.S3_REGION || 'us-east-1',
        endpoint: process.env.S3_ENDPOINT || undefined,
        accessKeyId: process.env.S3_ACCESS_KEY_ID || '',
        secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || '',
        publicUrl: process.env.S3_PUBLIC_URL || undefined,
        forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
      },
    };
  }

  return {
    type: 'local',
    local: {
      uploadDir: process.env.UPLOAD_DIR || 'uploads',
      publicPath: '/uploads',
    },
  };
}

let s3Client: S3Client | null = null;

function getS3Client(): S3Client {
  if (s3Client) return s3Client;

  const config = getConfig();
  if (!config.s3) throw new Error('S3 config not found');

  s3Client = new S3Client({
    region: config.s3.region,
    endpoint: config.s3.endpoint,
    forcePathStyle: config.s3.forcePathStyle,
    credentials: {
      accessKeyId: config.s3.accessKeyId,
      secretAccessKey: config.s3.secretAccessKey,
    },
  });

  return s3Client;
}

export interface UploadResult {
  url: string;
  key: string;
}

export async function uploadFile(file: Express.Multer.File): Promise<UploadResult> {
  const config = getConfig();
  const ext = path.extname(file.originalname);
  const key = `${uuidv4()}${ext}`;

  if (config.type === 's3' && config.s3) {
    const client = getS3Client();
    const s3Key = `uploads/${key}`;

    await client.send(new PutObjectCommand({
      Bucket: config.s3.bucket,
      Key: s3Key,
      Body: file.buffer || fs.readFileSync(file.path),
      ContentType: file.mimetype,
    }));

    // Clean up local temp file if exists
    if (file.path) {
      fs.unlink(file.path, () => {});
    }

    const url = config.s3.publicUrl
      ? `${config.s3.publicUrl}/${s3Key}`
      : `${config.s3.endpoint || `https://s3.${config.s3.region}.amazonaws.com`}/${config.s3.bucket}/${s3Key}`;

    return { url, key: s3Key };
  }

  // Local storage
  const uploadDir = config.local!.uploadDir;
  if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
  }

  if (file.path) {
    const dest = path.join(uploadDir, key);
    fs.renameSync(file.path, dest);
  } else if (file.buffer) {
    fs.writeFileSync(path.join(uploadDir, key), file.buffer);
  }

  return {
    url: `${config.local!.publicPath}/${key}`,
    key,
  };
}

export async function deleteFile(key: string): Promise<void> {
  const config = getConfig();

  if (config.type === 's3' && config.s3) {
    const client = getS3Client();
    await client.send(new DeleteObjectCommand({
      Bucket: config.s3.bucket,
      Key: key,
    }));
    return;
  }

  // Local storage
  const filePath = path.join(config.local!.uploadDir, path.basename(key));
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
}

export async function getSignedDownloadUrl(key: string, expiresIn = 3600): Promise<string> {
  const config = getConfig();

  if (config.type === 's3' && config.s3) {
    const client = getS3Client();
    const command = new GetObjectCommand({
      Bucket: config.s3.bucket,
      Key: key,
    });
    return getSignedUrl(client, command, { expiresIn });
  }

  return `${config.local!.publicPath}/${path.basename(key)}`;
}

export function getStorageType(): StorageType {
  return getConfig().type;
}
