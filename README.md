# 宝宝日志 - 新生儿照护记录与管理系统

一个集记录、计划、成长管理于一体的新生儿照护系统，帮助家庭系统化管理宝宝的日常与成长过程。

## 功能模块

- **记录模块** - 喂养、护理、活动等高频记录，支持时间线展示
- **计划模块** - 疫苗、就医、体检等未来计划管理
- **成长模块** - 身高体重曲线、里程碑记录
- **数据统计** - 喂养频率、睡眠时长、趋势图表

## 技术栈

- **前端**: React 18 + TypeScript + Vite + TailwindCSS + Recharts
- **后端**: Go + chi + modernc.org/sqlite（纯 Go，无需 CGO）
- **数据库**: SQLite（表结构与原 Prisma 迁移完全一致，启动时自动建表）
- **架构**: 前后端独立目录（无 monorepo/workspace）

## 快速开始

### 环境要求

- Go >= 1.21
- Node.js >= 18 与 pnpm >= 8（仅前端开发需要）

### 启动后端

```bash
cd backend
# 首次运行会在 backend/dev.db 自动建表
DATABASE_URL="file:./dev.db" \
ADMIN_USERNAME=admin ADMIN_PASSWORD=YourStr0ngP@ss \
PORT=3001 go run .
```

### 启动前端

```bash
cd web
pnpm install
pnpm dev
```

### 访问

- 前端: http://localhost:5173（开发时通过 Vite 代理到后端 3001）
- 后端 API: http://localhost:3001/api/v1

## 项目结构

```
baby-log/
├── backend/         # Go 后端 API 服务（自动建表，兼容原接口与数据库）
│   ├── main.go      # 路由、CORS、静态资源、引导
│   ├── db.go        # SQLite 连接与 Schema
│   └── *.go         # auth / records / plans / growth / ...
├── web/             # 前端 React 应用（独立 pnpm 项目）
│   └── src/
│       ├── components/  # 通用组件
│       ├── contexts/    # React Context
│       ├── lib/         # 工具库
│       └── pages/       # 页面组件
├── deploy/          # 部署脚本（entrypoint.sh）
├── docs/            # 产品与架构文档
└── Dockerfile       # 多阶段构建：Node 打包前端 + Go 编译后端
```

## API 概览

| 路径 | 说明 |
|------|------|
| POST /api/v1/auth/login | 登录 |
| GET /api/v1/babies | 获取宝宝列表 |
| GET /api/v1/records | 获取记录(分页/筛选) |
| POST /api/v1/records | 创建记录 |
| GET /api/v1/plans | 获取计划列表 |
| POST /api/v1/plans | 创建计划 |
| GET /api/v1/growth | 获取成长数据 |
| GET /api/v1/milestones | 获取里程碑 |
| GET /api/v1/stats/summary | 状态摘要 |
| GET /api/v1/stats/daily | 日统计 |
| POST /api/v1/upload | 上传图片 |

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
  - "你的端口:3000"
```

### 数据持久化

数据库和上传的图片通过 Docker Volume 持久化存储：
- `baby-log-data`: 数据库文件
- `baby-log-uploads`: 上传的图片

备份命令:
```bash
docker cp baby-log:/app/data ./backup-data
docker cp baby-log:/app/uploads ./backup-uploads
```

## 开发说明

- 后端: `cd backend && go run .`（修改后重启；也可用 `air` 等工具热重载）
- 前端热重载: `cd web && pnpm dev`
