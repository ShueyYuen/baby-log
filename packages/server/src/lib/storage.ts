import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import fs from 'fs';
import path from 'path';
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

// 规范化 endpoint：AWS SDK 要求带协议前缀的完整 URL，否则会抛 "Invalid URL"
function normalizeEndpoint(endpoint?: string): string | undefined {
  if (!endpoint) return undefined;
  const trimmed = endpoint.trim();
  if (!trimmed) return undefined;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

function getConfig(): StorageConfig {
  const type = (process.env.STORAGE_TYPE || 'local') as StorageType;

  if (type === 's3') {
    return {
      type: 's3',
      s3: {
        bucket: process.env.S3_BUCKET || '',
        region: process.env.S3_REGION || 'us-east-1',
        endpoint: normalizeEndpoint(process.env.S3_ENDPOINT),
        accessKeyId: process.env.S3_ACCESS_KEY_ID || '',
        secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || '',
        publicUrl: normalizeEndpoint(process.env.S3_PUBLIC_URL),
        forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
      },
    };
  }

  return {
    type: 'local',
    local: {
      uploadDir: process.env.UPLOAD_DIR || 'uploads',
      publicPath: '/api/v1/uploads',
    },
  };
}

let s3Client: S3Client | null = null;

function getS3Client(): S3Client {
  if (s3Client) return s3Client;

  const config = getConfig();
  if (!config.s3) throw new Error('S3 config not found');

  if (!config.s3.bucket) console.warn('[Storage] S3_BUCKET is empty!');
  if (!config.s3.accessKeyId) console.warn('[Storage] S3_ACCESS_KEY_ID is empty!');
  if (!config.s3.secretAccessKey) console.warn('[Storage] S3_SECRET_ACCESS_KEY is empty!');

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

// 按存储访问风格拼接公开 URL：
// - 配置了 publicUrl → 直接使用
// - forcePathStyle=true（MinIO 等）→ path-style: {endpoint}/{bucket}/{key}
// - 否则（AWS/OSS/COS 默认）→ virtual-hosted: {scheme}://{bucket}.{host}/{key}
function buildPublicUrl(s3: NonNullable<StorageConfig['s3']>, s3Key: string): string {
  if (s3.publicUrl) return `${s3.publicUrl}/${s3Key}`;

  const endpoint = s3.endpoint || `https://s3.${s3.region}.amazonaws.com`;

  if (s3.forcePathStyle) {
    return `${endpoint}/${s3.bucket}/${s3Key}`;
  }

  try {
    const u = new URL(endpoint);
    return `${u.protocol}//${s3.bucket}.${u.host}/${s3Key}`;
  } catch {
    return `${endpoint}/${s3.bucket}/${s3Key}`;
  }
}

export async function uploadFile(file: Express.Multer.File): Promise<UploadResult> {
  const config = getConfig();
  const ext = path.extname(file.originalname);
  const key = `${uuidv4()}${ext}`;

  if (config.type === 's3' && config.s3) {
    const client = getS3Client();
    const s3Key = `uploads/${key}`;
    const body = file.buffer || fs.readFileSync(file.path);

    console.log('[Storage] Uploading to S3:', {
      bucket: config.s3.bucket,
      key: s3Key,
      contentType: file.mimetype,
      size: body?.length,
    });

    try {
      await client.send(new PutObjectCommand({
        Bucket: config.s3.bucket,
        Key: s3Key,
        Body: body,
        ContentType: file.mimetype,
      }));
    } catch (err: any) {
      console.error('[Storage] S3 upload failed:', {
        name: err?.name,
        message: err?.message,
        code: err?.Code || err?.code,
        httpStatusCode: err?.$metadata?.httpStatusCode,
        endpoint: config.s3.endpoint,
        bucket: config.s3.bucket,
        region: config.s3.region,
      });
      throw err;
    }

    // Clean up local temp file if exists
    if (file.path) {
      fs.unlink(file.path, () => { });
    }

    // 私有 bucket：返回签名 URL 供前端即时预览；若配置了 publicUrl（公开读/CDN）则用公开地址
    const url = config.s3.publicUrl
      ? buildPublicUrl(config.s3, s3Key)
      : await getSignedDownloadUrl(s3Key);

    console.log('[Storage] S3 upload success:', { key: s3Key });
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

// ---- key ↔ 展示 URL 转换（边界层，用于路由的入参/出参） ----
// DB 里统一存储 key（如 uploads/xxx.png）。本地存储模式下 key 即为可访问路径，原样处理。

// 从存储值或历史完整 URL 中解析出 S3 key
export function toStorageKey(input: string): string {
  const config = getConfig();
  if (config.type !== 's3' || !config.s3) return input;
  if (!input) return input;

  // 已经是 key（非 http 开头），去掉可能的前导斜杠
  if (!/^https?:\/\//i.test(input)) {
    return input.replace(/^\/+/, '');
  }

  try {
    const u = new URL(input);
    let p = decodeURIComponent(u.pathname).replace(/^\/+/, '');
    // path-style 或 publicUrl 带 bucket 前缀时去掉 bucket 段
    const bucketPrefix = `${config.s3.bucket}/`;
    if (config.s3.bucket && p.startsWith(bucketPrefix)) {
      p = p.slice(bucketPrefix.length);
    }
    return p;
  } catch {
    return input;
  }
}

export function toStorageKeys(arr: string[] | undefined | null): string[] {
  if (!arr) return [];
  return arr.map(toStorageKey);
}

// 把存储的 key 转成前端可展示的 URL（S3 私有 bucket 为签名 URL）
export async function toDisplayUrl(stored: string, expiresIn = 86400): Promise<string> {
  const config = getConfig();
  if (config.type !== 's3' || !config.s3) return stored;
  if (!stored) return stored;

  const key = toStorageKey(stored);
  if (config.s3.publicUrl) return buildPublicUrl(config.s3, key);
  return getSignedDownloadUrl(key, expiresIn);
}

export async function toDisplayUrls(arr: string[] | undefined | null, expiresIn = 86400): Promise<string[]> {
  if (!arr || arr.length === 0) return [];
  return Promise.all(arr.map((s) => toDisplayUrl(s, expiresIn)));
}

// 计算“被移除”的文件：在 oldValues 中但不在 newValues 中的 key（用于编辑时清理旧图）
export function diffRemovedKeys(
  oldValues: string[] | undefined | null,
  newValues: string[] | undefined | null
): string[] {
  const oldKeys = toStorageKeys(oldValues);
  const keep = new Set(toStorageKeys(newValues));
  return oldKeys.filter((k) => !keep.has(k));
}

// 尽力删除一组图片（存储值或历史完整 URL 均可），单个失败不影响其它，也不抛错
export async function deleteFilesBestEffort(values: string[] | undefined | null): Promise<void> {
  if (!values || values.length === 0) return;
  const keys = toStorageKeys(values);
  await Promise.allSettled(
    keys.map(async (key) => {
      try {
        await deleteFile(key);
      } catch (err: any) {
        console.error('[Storage] Failed to delete file:', key, err?.message);
      }
    })
  );
}
