# OCR 服务接管与细粒度配置升级设计

> 日期：2026-11-04
> 范围：`water-erp/services/ocr/`（Python 服务）+ `apps/api/src/local-ai/ocr.service.ts`（消费端）+ 本机接管操作
> 不在范围：容器/Docker 改造、引擎更换、模型升级、GPU 路径变更

## 背景与动机

`water-erp/services/ocr/` 目前是 procurement 项目 OCR 的休眠镜像（逐字节一致，venv 包版本相同），生产 :8100 由 PM2 `procurement-ocr`（procurement 项目目录的 venv）服务，ERP API 的 `OCR_SERVICE_URL` 指向它。存在三个问题：

1. **本目录改代码无法验证**——`start.sh` 端口写死 8100，与在跑实例冲突（CLAUDE.md 已记载 `OCR_PORT`/`OCR_HOST` 参数化能力，但代码里没有，文档超前于代码）。
2. **配置面太粗**——`NUM_WORKERS=2` 写死；CPU 模式 onnxruntime 会话线程完全未配（包默认 -1 无限，2 worker 各自吃满所有核）。生产机是**麒麟、8 核、6 核预算给 OCR、无 GPU**，必须能细粒度限线程。
3. **消费端整链不可调**——NestJS 侧 `BATCH_PAGES=40`、调用点 dpi 写死，低配机无法整形批次。

## 用户裁定记录

1. 全面接管：ERP 跑自己的 OCR 实例，不再复用 procurement :8100。
2. 生产机：麒麟 8 核、6 核给 OCR、无 GPU；OCR 生产上以 Docker 运行，本机调好部署替换（容器事务不在本次范围）。
3. 只改代码，不做容器相关东西。
4. 本机也要把 ERP 切到自己的实例（不只生产）。
5. 接管方式选 **①独立端口**：ERP 实例 :8110 + `apps/api/.env` 改指；procurement 的 :8100 完全不动，两项目各自拥有实例（与生产 ERP 独立 Docker 拓扑一致，避免两仓库 PM2 抢端口竞态）。
6. 配置面不止 worker 数：批处理页数、渲染页数、dpi 等全部开关化，用于低配置生产机器。

## 设计

### A. `services/ocr` 配置面（全部 env，`.env.example` 为提交契约）

| 变量 | 默认 | 说明 |
|---|---|---|
| `OCR_NUM_WORKERS` | 2 | 页级并行 worker 数（原 `NUM_WORKERS=2` 写死于 `ocr_engine.py:28`） |
| `OCR_INTRA_THREADS` | 0=不限 | onnxruntime 会话内线程；**Global 级 kwargs 自动下推 Det/Cls/Rec 三会话**（已在 venv 验证 `UpdateParameters.update_global_to_module` 机制，`rapidocr_onnxruntime` 1.4.4） |
| `OCR_INTER_THREADS` | 0=不限 | 会话间线程 |
| `OCR_DEFAULT_DPI` | 150 | 服务端 `dpi` Form 默认（原写死 `main.py:82`） |
| `OCR_MAX_PAGES_DEFAULT` | 200 | 服务端 `max_pages` Form 默认（原写死） |
| `OCR_CHUNK_PAGES` | 16 | 渲染→OCR→释放分块页数（已有 env，从注释埋没升为一等公民） |

**线程铁律**（写进代码注释与文档）：`OCR_NUM_WORKERS × OCR_INTRA_THREADS ≤ 分给 OCR 的核数`。8 核机 6 核预算预设：`2×3`、`OCR_CHUNK_PAGES=8`、`OCR_DEFAULT_DPI=150`。

非法值（非整数/负数）回落默认并 warn，不崩启动。GPU 判定逻辑与 GPU 路径（`config_gpu.yaml`）不动。

### B. `start.sh`

- `OCR_PORT`/`OCR_HOST` env 参数化（默认 8100/127.0.0.1），补齐 CLAUDE.md 已记载能力。
- venv 失效重建：`requirements.txt` 比 `.venv/.ready` 新则重建（防配置漂移）。

### C. `apps/api` 消费端（低配机整链生效）

- `BATCH_PAGES` 写死 40 → `OCR_BATCH_PAGES` env（默认 40）。
- 批量 dpi 默认 env 化：`OCR_DPI`（默认 150）；`ocrPdf` 第三参改可选，`file-processor.ts` 显式 150 改为省略走 env。

### D. 本机接管（独立端口方案）

- PM2 托管 ERP 实例：`services/ocr/ecosystem.config.js` 定义 `erp-ocr`，uvicorn 绑 `127.0.0.1:8110`。**必须 PM2 而非 concurrently**——v1.2.0 watchdog 自杀（`os._exit(1)`）依赖外部拉起者，`pnpm dev` 链的 concurrently 不会重启。
- PM2 参数对齐 procurement-ocr 惯例：`max_memory_restart 4G`、`kill_timeout 30s`、`restart_delay 5s`、`max_restarts 10`。
- `apps/api/.env`：`OCR_SERVICE_URL=http://localhost:8110`（原指向 :8100 的注释同步改写）。
- `services/ocr/.env`（gitignored 机器本地件）：新旋钮写入，值取生产预设（2×3）保持双环境调参一致。
- `pm2 save` 会快照整机应用（含 procurement 两应用）——共享机器状态，操作时向用户提示。

### E. 验证标准

1. 单测：`resolve_*` 配置解析（默认/覆盖/非法回落/0=不限）+ `/health` 上报生效配置（`num_workers`/`intra_threads`/`inter_threads`/`chunk_pages`，0=包默认）。
2. 双实例对比：同一文字 PDF / 扫描件 / 图片分别 POST :8110 与 :8100，文本一致（同代码同模型同参数）。
3. 线程观测：OCR 进行中 `pidstat -t` 确认线程受预算约束。
4. 切换验证：`apps/api` 改指 :8110 重启后，系统健康页 OCR 探活指向 :8110 且 ok。

### F. 文档同步

- `services/ocr/ARCHITECTURE.md` 升 v1.3.0（配置面表格、接管拓扑、线程铁律）。
- `main.py` FastAPI version → 1.3.0。
- `CLAUDE.md` OCR 相关段落更新（**必须经 Bash 修改**，ARS 守卫拦 Edit/Write）。

## 2026-11-04 补充：P0 性能优化并入（用户裁定）

在上述设计基础上增补三项 P0 性能优化（对应瓶颈分析与用户裁定）：

1. **文字层快速路径**（性能项①）：`_ocr_pdf` 分块循环内逐页 `fitz get_text` 预检，字符数达 `OCR_TEXT_LAYER_MIN_CHARS`（默认 100，0=禁用）的页直接取文字层免 OCR，不足阈值整页回退 OCR；响应 `pages[i]` 增可选 `source: "text-layer"|"ocr"` 字段（向后兼容）。数字原生 PDF（标书主流）预期提速一个量级。
2. **页数探测零 OCR**（性能项②）：NestJS `getPdfPageCount` 从「OCR 第 1 页读 page_count」改为 `max_pages=0` 无 `page_range` 调用——服务端既有早返回路径零 OCR。
3. **OCR 结果缓存**（性能项③）：NestJS 层 Redis 缓存（`REDIS_CLIENT` token，`@Optional()` 防 worker 进程缺 provider），键 `ocr:v1:{scope}:{sha256}:{dpi}:{maxPages}:{pageRange||'all'}`，env `OCR_CACHE_ENABLED`/`OCR_CACHE_TTL_SECONDS`（默认 7 天）/`OCR_CACHE_MAX_ENTRY_KB`（默认 2048）；缓存故障 warn 后照常 OCR 不阻断；rerun/重试场景零重复计算。

同轮裁定：**生产机 CPU 确认为 x86_64**（无 ARM 轮子顾虑）；P1/P2 优化项（INT8 量化模型、PP-OCRv5、paddle 后端、渲染↔OCR 流水线重叠、workers×intra 基准矩阵、dpi 精调、上传一次多批处理）**明确不做**，留待接管稳定后按实测数据另行立项。

## 非目标

- 不改引擎（保持 rapid + 内置 PP-OCRv4——生产内网无下载条件）。
- 不动 watchdog 语义、事件循环串行化设计。
- 不做 Docker/镜像相关产出。
- hybrid/opendataloader 引擎不改，仅文档提醒：ERP 实例若切 opendataloader 需 `OCR_HYBRID_PORT` 错开 procurement 的 5002/5003 段。
