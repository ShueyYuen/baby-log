# 宝宝日志 - 新生儿照护记录与管理系统

一个集记录、计划、成长管理于一体的新生儿照护系统，帮助家庭系统化管理宝宝的日常与成长过程。

## 功能模块

- **记录模块** - 喂养、护理、活动等高频记录，支持时间线展示
- **计划模块** - 疫苗、就医、体检等未来计划管理
- **成长模块** - 身高体重曲线、里程碑记录
- **数据统计** - 喂养频率、睡眠时长、趋势图表

## 技术栈

- **前端**: React 18 + TypeScript + Vite + TailwindCSS + Recharts
- **后端**: Node.js + Express + TypeScript + Prisma
- **数据库**: SQLite (可升级至 PostgreSQL)
- **架构**: pnpm Monorepo

## 快速开始

### 环境要求

- Node.js >= 18
- pnpm >= 8

### 安装与启动

```bash
# 安装依赖
pnpm install

# 初始化数据库
cd packages/server
npx prisma migrate dev
npx tsx src/seed.ts
cd ../..

# 启动开发服务器（前后端同时启动）
pnpm dev
```

### 访问

- 前端: http://localhost:5173
- 后端 API: http://localhost:3001
- 演示账号: `demo` / `demo123`

## 项目结构

```
baby-log/
├── packages/
│   ├── shared/      # 共享类型定义
│   ├── server/      # 后端 API 服务
│   │   ├── prisma/  # 数据库 Schema & 迁移
│   │   └── src/     # 路由、中间件
│   └── web/         # 前端 React 应用
│       └── src/
│           ├── components/  # 通用组件
│           ├── contexts/    # React Context
│           ├── lib/         # 工具库
│           └── pages/       # 页面组件
├── docs/            # 产品与架构文档
└── package.json     # Monorepo 配置
```

## API 概览

| 路径 | 说明 |
|------|------|
| POST /api/auth/register | 注册 |
| POST /api/auth/login | 登录 |
| GET /api/babies | 获取宝宝列表 |
| GET /api/records | 获取记录(分页/筛选) |
| POST /api/records | 创建记录 |
| GET /api/plans | 获取计划列表 |
| POST /api/plans | 创建计划 |
| GET /api/growth | 获取成长数据 |
| GET /api/milestones | 获取里程碑 |
| GET /api/stats/summary | 状态摘要 |
| GET /api/stats/daily | 日统计 |
| POST /api/upload | 上传图片 |

## Docker 部署

### 使用 Docker Compose（推荐）

```bash
# 构建并启动
docker compose up -d

# 查看日志
docker compose logs -f

# 停止
docker compose down
```

启动后访问 http://your-server-ip:8080

### 宝塔面板部署

1. 在宝塔面板安装 Docker 管理器
2. 将项目代码上传至服务器（如 `/www/baby-log`）
3. 在终端中执行:

```bash
cd /www/baby-log
docker compose up -d
```

4. 在宝塔面板中添加「反向代理」网站:
   - 域名: 你的域名
   - 代理目标: `http://127.0.0.1:8080`
   - 勾选 WebSocket 支持（可选）

5. 可选：在宝塔中申请 SSL 证书并开启 HTTPS

### 自定义端口

修改 `docker-compose.yml` 中的端口映射:

```yaml
ports:
  - "你的端口:80"
```

### 数据持久化

数据库和上传的图片通过 Docker Volume 持久化存储：
- `baby-log-data`: 数据库文件
- `baby-log-uploads`: 上传的图片

备份命令:
```bash
docker cp baby-log:/app/data ./backup-data
docker cp baby-log:/app/packages/server/uploads ./backup-uploads
```

## 开发说明

- 后端热重载: `pnpm --filter server dev`
- 前端热重载: `pnpm --filter web dev`
- 数据库管理: `pnpm --filter server db:studio`
