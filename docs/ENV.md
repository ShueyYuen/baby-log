# 环境变量配置说明

本文档列出系统所有可配置的环境变量。

---

## 基础配置

| 变量名 | 必填 | 默认值 | 说明 |
|--------|------|--------|------|
| `NODE_ENV` | 否 | `development` | 运行环境，可选 `development` / `production` |
| `PORT` | 否 | `3001` | API 服务器监听端口 |

---

## 数据库配置

| 变量名 | 必填 | 默认值 | 说明 |
|--------|------|--------|------|
| `DATABASE_URL` | 是 | `file:./dev.db` | Prisma 数据库连接字符串 |

### 示例

**SQLite（开发/小规模部署）:**
```env
DATABASE_URL="file:./dev.db"
```

**Docker 部署推荐:**
```env
DATABASE_URL="file:/app/data/baby-log.db"
```

**PostgreSQL（未来扩展）:**
```env
DATABASE_URL="postgresql://user:password@localhost:5432/babylog"
```

> 注意：切换到 PostgreSQL 需修改 `prisma/schema.prisma` 中的 `provider`。

---

## 存储配置

| 变量名 | 必填 | 默认值 | 说明 |
|--------|------|--------|------|
| `STORAGE_TYPE` | 否 | `local` | 存储类型：`local`（本地） 或 `s3`（对象存储） |

---

### 本地存储配置

当 `STORAGE_TYPE=local` 时生效：

| 变量名 | 必填 | 默认值 | 说明 |
|--------|------|--------|------|
| `UPLOAD_DIR` | 否 | `uploads` | 本地上传文件存放目录（相对于 server 工作目录） |

---

### S3/对象存储配置

当 `STORAGE_TYPE=s3` 时生效：

| 变量名 | 必填 | 默认值 | 说明 |
|--------|------|--------|------|
| `S3_BUCKET` | 是 | - | 存储桶名称 |
| `S3_REGION` | 否 | `us-east-1` | 存储区域 |
| `S3_ENDPOINT` | 否 | AWS 默认 | 自定义 S3 端点 URL |
| `S3_ACCESS_KEY_ID` | 是 | - | 访问密钥 ID |
| `S3_SECRET_ACCESS_KEY` | 是 | - | 访问密钥 Secret |
| `S3_PUBLIC_URL` | 否 | 自动生成 | 公开访问 URL 前缀 |
| `S3_FORCE_PATH_STYLE` | 否 | `false` | 是否使用路径风格（MinIO 需设为 `true`） |

### 各云服务商配置示例

#### AWS S3

```env
STORAGE_TYPE=s3
S3_BUCKET=my-baby-log-bucket
S3_REGION=ap-northeast-1
S3_ACCESS_KEY_ID=AKIAXXXXXXXXXXXXXXXX
S3_SECRET_ACCESS_KEY=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
S3_PUBLIC_URL=https://my-baby-log-bucket.s3.ap-northeast-1.amazonaws.com
```

#### 阿里云 OSS

```env
STORAGE_TYPE=s3
S3_BUCKET=my-baby-log-bucket
S3_REGION=oss-cn-hangzhou
S3_ENDPOINT=https://oss-cn-hangzhou.aliyuncs.com
S3_ACCESS_KEY_ID=LTAIXXXXXXXXXXXXXXXX
S3_SECRET_ACCESS_KEY=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
S3_PUBLIC_URL=https://my-baby-log-bucket.oss-cn-hangzhou.aliyuncs.com
S3_FORCE_PATH_STYLE=false
```

#### 腾讯云 COS

```env
STORAGE_TYPE=s3
S3_BUCKET=my-baby-log-1250000000
S3_REGION=ap-guangzhou
S3_ENDPOINT=https://cos.ap-guangzhou.myqcloud.com
S3_ACCESS_KEY_ID=AKIDxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
S3_SECRET_ACCESS_KEY=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
S3_PUBLIC_URL=https://my-baby-log-1250000000.cos.ap-guangzhou.myqcloud.com
S3_FORCE_PATH_STYLE=false
```

#### MinIO（自建）

```env
STORAGE_TYPE=s3
S3_BUCKET=baby-log
S3_REGION=us-east-1
S3_ENDPOINT=http://minio.example.com:9000
S3_ACCESS_KEY_ID=minioadmin
S3_SECRET_ACCESS_KEY=minioadmin
S3_PUBLIC_URL=http://minio.example.com:9000/baby-log
S3_FORCE_PATH_STYLE=true
```

#### Cloudflare R2

```env
STORAGE_TYPE=s3
S3_BUCKET=baby-log
S3_REGION=auto
S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
S3_ACCESS_KEY_ID=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
S3_SECRET_ACCESS_KEY=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
S3_PUBLIC_URL=https://pub-xxxxx.r2.dev
S3_FORCE_PATH_STYLE=false
```

---

## Docker Compose 完整配置示例

### 最小配置（本地存储）

```yaml
services:
  baby-log:
    build: .
    ports:
      - "8080:80"
    volumes:
      - baby-log-data:/app/data
      - baby-log-uploads:/app/packages/server/uploads
    environment:
      - NODE_ENV=production
      - DATABASE_URL=file:/app/data/baby-log.db
      - STORAGE_TYPE=local

volumes:
  baby-log-data:
  baby-log-uploads:
```

### 使用 S3 存储

```yaml
services:
  baby-log:
    build: .
    ports:
      - "8080:80"
    volumes:
      - baby-log-data:/app/data
    environment:
      - NODE_ENV=production
      - DATABASE_URL=file:/app/data/baby-log.db
      - STORAGE_TYPE=s3
      - S3_BUCKET=my-baby-log-bucket
      - S3_REGION=oss-cn-hangzhou
      - S3_ENDPOINT=https://oss-cn-hangzhou.aliyuncs.com
      - S3_ACCESS_KEY_ID=${S3_ACCESS_KEY_ID}
      - S3_SECRET_ACCESS_KEY=${S3_SECRET_ACCESS_KEY}
      - S3_PUBLIC_URL=https://my-baby-log-bucket.oss-cn-hangzhou.aliyuncs.com

volumes:
  baby-log-data:
```

> 提示：使用 S3 时不再需要 `baby-log-uploads` 卷，因为图片直接上传到对象存储。

---

## 宝塔面板部署配置

如果通过宝塔面板部署，可以在项目根目录创建 `.env` 文件：

```env
NODE_ENV=production
PORT=3001
DATABASE_URL=file:/app/data/baby-log.db
STORAGE_TYPE=local
```

或者在 `docker-compose.yml` 中通过 `env_file` 引入：

```yaml
services:
  baby-log:
    env_file: .env.production
```

---

## 变量优先级

1. Docker Compose `environment` 中直接设置的值（最高优先级）
2. `env_file` 引入的文件
3. Dockerfile 中 `ENV` 设置的默认值
4. 代码中的硬编码默认值（最低优先级）
