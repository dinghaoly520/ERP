# 水平扩容 Runbook（OCR 微服务 / ai-bid-analysis worker）

面向 2 万人规模上线的扩容操作指南。数据库连接池见 `docker-compose.yml` 的 pgbouncer 服务（API 走 6432，迁移走 5432 直连）。

## 一、ai-bid-analysis worker 扩容

**原理**：worker 进程完全无状态（全部状态在 Prisma / Redis / MinIO），BullMQ 保证同一 job 只被一个 worker 处理；job ID 确定性（`tender-${taskId}` / `bidderResult-${id}`）天然去重。多开进程即扩容，无需任何配置同步。

```bash
# 单进程（默认）
pnpm --filter api start:worker:ai-bid-analysis

# 扩容：多开 N 个进程（N 个终端 / PM2 instances / systemd unit 皆可）
pnpm --filter api start:worker:ai-bid-analysis &
pnpm --filter api start:worker:ai-bid-analysis &
```

- 单进程内并发：`AI_BID_WORKER_CONCURRENCY`（默认 2，bidder 队列 DeepSeek + OCR 并行）。
- tender 队列并发固定 1（文档级任务，串行即可）。
- PM2 示例：

```js
// ecosystem.worker.config.js（可选，仓库未内置）
module.exports = {
  apps: [{
    name: 'ai-bid-worker',
    script: 'apps/api/dist/ai-bid-analysis-worker.js',
    instances: 2,
    env: { AI_BID_WORKER_CONCURRENCY: '2' },
  }],
};
```

**验证扩容生效**：两个 worker 进程在跑时入队一个 job（或触发一次分析），只有一个进程打印处理日志，`AiBidderResult` 只被更新一次（查 `updatedAt`/状态单跳变）。

**注意**：改了 ai-bid-analysis 源码后必须 kill 全部 worker 重跑（`pnpm dev` 的 API --watch 不会重启 worker）。

## 二、OCR 微服务扩容

**原理**：`POST /ocr` 无会话亲和（每请求自带完整文件字节），可任意多副本，API 侧 `OcrService` 对 `OCR_SERVICE_URL` 逗号列表 round-robin 分发。

```bash
# 副本 A（默认）：uvicorn :8100，hybrid 子进程 5002-5003
cd services/ocr && bash start.sh

# 副本 B：uvicorn :8101，hybrid 5004-5005（端口段必须错开！）
cd services/ocr && OCR_PORT=8101 OCR_HYBRID_PORT=5004 bash start.sh
```

API 侧 `apps/api/.env`：

```
OCR_SERVICE_URL=http://localhost:8100,http://localhost:8101
```

**约束**：每个 uvicorn 进程按 `OCR_HYBRID_PORT .. +OCR_HYBRID_WORKERS-1` 绑定固定 hybrid 子进程端口，副本间端口段重叠会启动冲突。单 URL 配置时行为与改造前完全一致。

详见 `services/ocr/README.md`。

## 三、API 进程本体

Next.js/Nest 扩容在反代层做（Nginx 上游多实例），注意：

- `@nestjs/schedule` 的 cron（公告定时发布、OperationLog 分区维护、AuditLog 清理）在每个 API 进程内各跑一次——多实例部署时这些 cron 会重复执行。分区维护/清理是幂等的（DROP IF EXISTS / 批量 DELETE），公告发布 cron 需要在多实例部署前加分布式锁（Redis SETNX）——**当前单实例部署不受影响**。
- Socket.IO（开标大厅）多实例需 Redis adapter（`@socket.io/redis-adapter`）——当前单实例不受影响。
