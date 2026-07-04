#!/bin/sh
set -e

# 准备数据与上传目录（Go 后端会在启动时自动建表，无需迁移工具）
mkdir -p /app/data /app/uploads

# 启动 Go 后端
exec /app/babylog-server
