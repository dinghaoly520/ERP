# OCR 微服务

FastAPI + uvicorn 的文档 OCR 服务，API 端经 `OCR_SERVICE_URL`（默认 `http://localhost:8100`）调用 `POST /ocr` 与 `GET /health`。

## 启动

```bash
pnpm dev:ocr            # = bash services/ocr/start.sh（首次自动建 .venv）
```

## 多副本（水平扩容）

服务本身无状态（每个请求自带完整文件字节，无会话亲和），可多副本并行，API 侧轮询分发。每副本需要：

1. **不同的 `OCR_PORT`**（uvicorn 监听端口）
2. **不重叠的 hybrid 子进程端口段** —— 每个 uvicorn 进程按 `OCR_HYBRID_PORT .. OCR_HYBRID_PORT + OCR_HYBRID_WORKERS - 1` 绑定固定端口（`ocr_engine.py` 的 HybridPool），重叠会启动冲突

示例（GPU 机，每副本 2 个 hybrid worker）：

```bash
# 副本 A（默认）：uvicorn :8100，hybrid 5002-5003
bash start.sh
# 副本 B：uvicorn :8101，hybrid 5004-5005
OCR_PORT=8101 OCR_HYBRID_PORT=5004 bash start.sh
```

API 侧 `.env`：

```
OCR_SERVICE_URL=http://localhost:8100,http://localhost:8101
```

API 的 `OcrService` 对逗号列表做 round-robin：批处理大文件时各批轮流分发到不同副本；单 URL 时行为与之前完全一致。

## 环境变量

| 变量 | 默认 | 说明 |
|------|------|------|
| `OCR_HOST` | `127.0.0.1` | uvicorn 监听地址 |
| `OCR_PORT` | `8100` | uvicorn 监听端口（多副本需各不相同） |
| `OCR_ENGINE` | `opendataloader` | `opendataloader` / `rapid` / `easy` |
| `OCR_HYBRID_PORT` | `5002` | hybrid 子进程起始端口（多副本需错开整段） |
| `OCR_HYBRID_WORKERS` | `2` | 每副本 hybrid 并行 worker 数 |
| `OCR_HYBRID_DEVICE` | `cuda` | `cuda` / `cpu` |
| `OCR_MAX_SIDE` | `3000` | 图片 OCR 最长边 |
