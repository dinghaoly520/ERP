# OCR 服务架构文档

> 最后更新：2026-11-03
> 适用版本：`services/ocr/` v1.2.0（`main.py:27`）
> 当前引擎：`OCR_ENGINE=rapid`（RapidOCR PP-OCRv4，**CPU 模式**，GPU 自动检测未触发）
> 变更摘要（相对 v1.1）：GLM-OCR 引擎已整体移除；新增 watchdog 挂死自愈、PDF 分块渲染、事件循环解锁 + 请求串行化、ONNX CUDA GPU 误判防护。

---

## 1. 架构总览

```
┌────────────────────────────────────────────────────────────────────────┐
│                         OCR Service (:8100)                            │
│                    FastAPI + uvicorn (单 worker)                       │
├────────────────────────────────────────────────────────────────────────┤
│                                                                        │
│  POST /ocr                                 GET /health                 │
│    {file, dpi=150, max_pages=200,           {status, engine, hybrid,   │
│     page_range=None}                         workers, busy,            │
│    │                                         busy_seconds, detail}     │
│    │                                                                   │
│    ├── PDF? ── engine=rapid ──── _ocr_pdf()                            │
│    │            │                                                      │
│    │            └─ 分块渲染(16页/块) → ocr_images() 2线程              │
│    │               → RapidOcrEngine (PP-OCRv4 ONNX, CPU/GPU自动)       │
│    │                                                                   │
│    ├── PDF? ── engine=easy ───── _ocr_pdf()（⚠ easyocr 未安装）        │
│    │            └─ EasyOcrEngine (PyTorch)                             │
│    │                                                                   │
│    ├── PDF? ── engine=opendataloader ── _parse_pdf_opendataloader()    │
│    │            ├─ 文字型PDF → docling 直接提取文字层（毫秒级）        │
│    │            └─ 扫描件   → Hybrid Pool (5002-5003) 并行 OCR         │
│    │                          └─ opendataloader-pdf-hybrid 子进程      │
│    │                             后端 RapidOCR（需 venv 补丁）         │
│    │                                                                   │
│    └── 图片 ──── _ocr_image() → ocr_image() → engine.recognize()      │
│                                                                        │
│  稳定性层（v1.2.0）：                                                   │
│    · asyncio.Lock 串行化批次 + executor 跑 OCR → 事件循环永不阻塞      │
│    · watchdog 守护线程：单页超 180s → os._exit(1) → PM2 ~5s 拉起        │
└────────────────────────────────────────────────────────────────────────┘

调用方：apps/api NestJS `local-ai/ocr.service.ts`
  · 大 PDF 分批提交（page_range，每批 40 页，dpi=300）
  · 失败由 BullMQ 队列重试 → 与 watchdog 自愈配合

GPU 上其余常驻：bge-m3 embedding vLLM (:8003, PM2 procurement-embedding)
```

---

## 2. 引擎对比与当前可用性

| | **RapidOCR**（默认） | **EasyOCR** | **OpenDataLoader** |
|---|---|---|---|
| **env 值** | `rapid` | `easy` | `opendataloader` |
| **原理** | PP-OCRv4 检测+方向+识别（ONNX） | CRNN 检测+识别（PyTorch） | docling 文档解析 + hybrid OCR |
| **运行位置** | CPU（满足条件自动切 CUDA） | CPU/GPU | 本地 docling + hybrid 子进程 |
| **当前可用性** | ✅ 生产在用 | ⚠️ **easyocr 未安装**，选了会 ImportError→PM2 重启循环 | ✅ 已安装且已打补丁，默认未启用 |
| **中文优化** | ✅ 专门优化 | ⚠️ 通用多语言 | 取决于后端（rapidocr 后端=同 RapidOCR） |
| **表格/公式/排版** | ❌ | ❌ | ✅ docling 保留 Markdown 排版 |
| **文字型 PDF** | 渲染→OCR | 渲染→OCR | 直接提取文字层（不 OCR） |
| **扫描件 PDF** | 渲染→OCR | 渲染→OCR | 自动检测 → hybrid 并行 OCR |
| **并行度** | 2 线程（`NUM_WORKERS`） | 2 线程 | 2 个 hybrid 子进程 |
| **依赖** | `rapidocr_onnxruntime`（+`onnxruntime-gpu` 已装） | `easyocr`、`torch`（**未装**） | `opendataloader-pdf[hybrid]` + venv 补丁 |

> GLM-OCR（vLLM :8101）已在 v1.2 前移除：代码、`start_glm_ocr.sh`、`dev:glm-ocr` 脚本均已删除，本文档不再涉及。

---

## 3. 请求处理流程

### 3.1 入口路由（`main.py:79-102`）

```
POST /ocr  {file, dpi=150, max_pages=200, page_range=None}
    │
    ├── 文件是 PDF？
    │   ├── 是 + ENGINE_NAME == "opendataloader"
    │   │       → _parse_pdf_opendataloader(content, max_pages, page_range)
    │   └── 是 + 其他引擎（rapid / easy）
    │           → _ocr_pdf(content, dpi, max_pages, page_range)
    └── 否（图片）→ _ocr_image(content)
```

### 3.2 `_ocr_pdf()` — rapid/easy 通用路径（`main.py:248-298`）

```
PDF 字节流
    │
    ① _prepare_pdf()（main.py:169）
    │     · max_pages=0 且无 page_range → 只返回页数，不解析
    │     · page_range="3-10" → fitz 截取子文档
    │
    ② 分块渲染循环（main.py:275，块大小 OCR_CHUNK_PAGES=16）
    │     for 每块 16 页：
    │        渲染 dpi=150 → PIL Image 列表
    │        _run_ocr_batch(images)  ← asyncio.Lock 串行 + executor
    │        del images  ← 立即释放像素，峰值内存 ≈ 单块
    │
    ③ ocr_images()（ocr_engine.py:634）
    │     · _to_array()：长边 > MAX_SIDE=3000 则 LANCZOS 缩放
    │     · ThreadPoolExecutor(NUM_WORKERS=2) 逐页 recognize()
    │     · 每页 recognize 由 watchdog 计时（见 §4.3）
    │
    ④ JSON 响应 {text, page_count, processed_pages, pages:[{page,text}]}
```

### 3.3 `_parse_pdf_opendataloader()` 路径（`main.py:186-235`）

```
PDF 字节流
    │
    ① parser.parse_pdf_local()   ← docling 提取文字层 → Markdown
    ② _is_scanned(pages)         ← 启发式判断（见 §9）
    │
    ├── 不是扫描件 → 直接返回 ① 结果 ✅（毫秒级）
    │
    └── 是扫描件且 hybrid pool 在线
        └── parser.parse_pdf_hybrid_parallel()
            └── 按页数均分 → 各 hybrid 子进程并行 OCR → 合并
```

---

## 4. v1.2.0 稳定性设计（核心变更）

### 4.1 事件循环解锁 + 批次串行化（`main.py:32-55`）

- OCR 是 CPU 密集同步操作，全部丢进 `run_in_executor` → **`/health` 永远可响应**，可区分"在处理"（`busy=true` + `busy_seconds`）与"挂死"。
- `asyncio.Lock` 保证同一时刻至多一个 OCR 批次：避免跨请求 OMP/GIL 争用与内存叠加（也是 OMP 死锁的诱因治理）。
- `/health`（`main.py:58-76`）返回：`status, engine, hybrid, workers, busy, busy_seconds, busy_detail`（如 `xxx.pdf p17-32/191`）。

### 4.2 分块渲染（`main.py:34-35, 272-286`）

`OCR_CHUNK_PAGES=16`（env 可调）：渲染→OCR→释放 循环。此前整本 PDF 像素图常驻内存（191 页需数 GB），现峰值 ≈ 单块大小。配合 PM2 `max_memory_restart=4G`。

### 4.3 Watchdog 挂死自愈（`ocr_engine.py:573-610`）

```
_ocr_single()/ocr_image() 每次调用：
    _wd_begin(label) → engine.recognize() → _wd_end()

watchdog 守护线程（每 5s 巡检，OCR_WATCHDOG=1 默认开）：
    in_flight 且 elapsed > OCR_PAGE_TIMEOUT（默认 180s）
        → logger.critical("OCR watchdog: ... 卡死")
        → os._exit(1)          ← 线程无法取消 onnxruntime 死锁，只能杀进程
        → PM2 restart_delay=5s 拉起
        → 上游 BullMQ 任务重试
```

把"永久挂死需人工 kill"收敛为"≤ 阈值+5s 自愈"。设 `OCR_WATCHDOG=0` 可禁用。

### 4.4 GPU 误判防护（`ocr_engine.py:57-75`）

`onnxruntime-gpu` 即使机器没有可用 CUDA 也会把 `CUDAExecutionProvider` 列进 `get_available_providers()`，运行时才在加载 `libonnxruntime_providers_cuda.so` 时报错回退（每次调用刷屏 + 变慢）。因此 GPU 判定需**同时满足三个条件**：

1. `CUDAExecutionProvider` 在 providers 列表中
2. `config_gpu.yaml` 存在（本目录）
3. `ctypes.util.find_library("cudart")` 非 None（真实 CUDA runtime 判据）

**当前机器**：条件 1、2 满足，条件 3 不满足（系统库路径无 libcudart，ldconfig 0 条）→ 启动日志 `No GPU, using CPU OCR`，**以 CPU 模式稳定运行**。

若未来要启用 GPU OCR：将 venv 内 `nvidia-cuda-runtime` 的 lib 目录（或系统 CUDA）加入 `LD_LIBRARY_PATH`（PM2 env 块），重启即自动切换为 `config_gpu.yaml`（det/cls/rec 均为 PP-OCRv4 ONNX CUDA）。

### 4.5 OMP 线程限制（PM2 env）

`OMP_NUM_THREADS=8`（ecosystem.config.js）：onnxruntime 默认 `-1`（无上限），2 会话并发时 48 线程互掐是 OMP 死锁挂死的诱因之一；8×2=16 ≤ 24 核。

---

## 5. 引擎实现细节

### 5.1 RapidOcrEngine（`ocr_engine.py:65-99`）

```python
use_gpu = CUDAExecutionProvider 可用 且 config_gpu.yaml 存在 且 cudart 可找到

if ~/.rapidocr/models/v5/{det_v5,rec_v5.onnx,ppocrv5_dict.txt} 齐全:
    PP-OCRv5 server 模型（本机未安装，自动回落）
else:
    PP-OCRv4 内置模型（当前实际使用）
    use_gpu 时额外传 config_path=config_gpu.yaml

recognize(arr) → result 每行 r[1] 用 \n 连接
```

- 模型：det `ch_PP-OCRv4_det_infer` / cls `ch_ppocr_mobile_v2.0` / rec `ch_PP-OCRv4_rec_infer`（rapidocr 包内置；`config_gpu.yaml` 中为相对路径）
- 输入图片先缩放到 `MAX_SIDE=3000`

### 5.2 EasyOcrEngine（`ocr_engine.py:104-115`）

代码保留但 **easyocr 未安装**（venv 无此包）。`.env` 设 `easy` 会在 warmup 抛 ImportError → PM2 重启循环。需要时先 `.venv/bin/pip install easyocr`。

### 5.3 OpenDataLoader / hybrid（`ocr_engine.py:120-445`）

```
HybridServerPool（ocr_engine.py:226）
  └── N 个 HybridServer 子进程（默认 HYBRID_WORKERS=2，端口 5002、5003）
        命令：opendataloader-pdf-hybrid --port 5002 --force-ocr
              --ocr-lang ch_sim,en --ocr-backend rapidocr
        就绪探测：轮询 /health（120s 超时）
        socks:// 代理自动改写为 socks5://（子进程 httpx 兼容）

OpendataloaderPdfParser（ocr_engine.py:270）
  ├── parse_pdf_local()           ← docling 本地，无 OCR
  ├── parse_pdf_hybrid()          ← 单服务器
  └── parse_pdf_hybrid_parallel() ← 页数均分 → ThreadPool 提交各服务器
                                    → PAGE_BREAK 分隔 → 按页号归并
```

**venv 补丁（必须）**：`opendataloader-pdf 1.11.2` 的 `hybrid_server.py` 原生只支持 EasyOCR 后端。`patches/hybrid_server_rapidocr.patch` 为其添加 `--ocr-backend {easyocr|rapidocr}`（rapidocr 走 docling `RapidOcrOptions`，ONNX 后端）。**当前 venv 已应用**；`pip install --upgrade opendataloader-pdf` 后补丁会丢失，需重放：

```bash
cd .venv/lib/python3.10/site-packages/opendataloader_pdf/
patch hybrid_server.py < ../../../../patches/hybrid_server_rapidocr.patch
```

---

## 6. 配置参考

### 6.1 环境变量（`ocr_engine.py:28-40`、`main.py:35`）

| 变量 | 默认值 | 说明 |
|---|---|---|
| `OCR_ENGINE` | `rapid` | 引擎：`rapid` \| `easy` \| `opendataloader` |
| `OCR_MAX_SIDE` | `3000` | 图片长边超限自动缩放 |
| `OCR_CHUNK_PAGES` | `16` | PDF 分块渲染页数（内存控制） |
| `OCR_PAGE_TIMEOUT` | `180` | watchdog 单页超时秒数 |
| `OCR_WATCHDOG` | `1` | `0` 禁用 watchdog |
| `OCR_HYBRID_PORT` | `5002` | hybrid 起始端口（仅 opendataloader） |
| `OCR_HYBRID_WORKERS` | `2` | hybrid 子进程数（仅 opendataloader） |
| `OCR_HYBRID_LANG` | `ch_sim,en` | hybrid OCR 语言 |
| `OCR_HYBRID_OCR_ENGINE` | `rapidocr` | hybrid 后端（需补丁） |
| `OCR_HYBRID_DEVICE` | `cuda` | hybrid 声明参数 |

当前 `.env` 仅两行：`OCR_ENGINE=rapid`、`OCR_MAX_SIDE=3000`。`start.sh` 首次运行会从 `.env.example` 自动创建 `.env`（模板已对齐 rapid 默认）。

### 6.2 PM2 生产 env（ecosystem.config.js `procurement-ocr`）

| 项 | 值 | 原因 |
|---|---|---|
| `OMP_NUM_THREADS` | `8` | 防 onnxruntime OpenMP 线程互掐死锁 |
| `ALL_PROXY` | `socks5://127.0.0.1:7897/` | docling/huggingface_hub 走 httpx，需 socks5 格式 |
| `max_memory_restart` | `4G` | 191 页批处理正常峰值 <1G，超限回收 |
| `kill_timeout` | `30s` | 留时间清理 hybrid 子进程 |
| `restart_delay` | `5s` | watchdog 自杀后快速拉起 |
| `max_restarts` | `10` | 防崩溃循环 |

---

## 7. GPU 资源现状（RTX 5090 D, 24GB）

```
├── bge-m3 embedding vLLM (:8003)   ~2.3GB   PM2: procurement-embedding
├── OCR 服务                        CPU 模式（显存 0；GPU 判定条件见 §4.4）
└── 剩余显存                        可供未来启用 OCR CUDA / 其他模型
```

GLM-OCR vLLM（原 :8101，~2.2GB）已下线，相关 vLLM 环境适配补丁（glm_ocr.py 视频模态、Triton 头文件、FlashInfer CCCL 等）随引擎一并废弃，本文档不再记录。

---

## 8. 部署与启动

### 8.1 文件清单

| 文件 | 用途 |
|---|---|
| `main.py` | FastAPI 入口（路由、分块渲染、锁与 busy 状态） |
| `ocr_engine.py` | 引擎工厂 + watchdog + hybrid pool + opendataloader 解析 |
| `config_gpu.yaml` | RapidOCR CUDA 配置（GPU 模式自动启用） |
| `start.sh` | 开发启动：建 `.env`/`.venv` → uvicorn :8100（`pnpm dev:ocr`） |
| `requirements.txt` | Python 依赖（PyMuPDF 为 PDF 渲染器；pdf2image 已移除） |
| `patches/hybrid_server_rapidocr.patch` | venv 内 opendataloader 补丁的留档，升级后重放 |
| `test_main.py` | 单元测试（max_pages=0 只返回页数） |
| `test_ocr.py` | opendataloader hybrid 路径手动诊断脚本（`python test_ocr.py <pdf>`） |

### 8.2 启动方式

```bash
# 开发（根 package.json）
pnpm dev:ocr        # → bash services/ocr/start.sh
                     #   首次自动建 venv（.venv/.ready 标记）、.env

# 生产（PM2，自动 resurrect）
pm2 start ecosystem.config.js --only procurement-ocr
pm2 logs procurement-ocr

# 健康检查
curl localhost:8100/health
# {"status":"ok","engine":"rapid","hybrid":false,"workers":0,"busy":false}
```

### 8.3 NestJS 调用方（`apps/api/src/local-ai/ocr.service.ts`）

- 上传 PDF > 阈值时**客户端分批**：`page_range` 每批 40 页、`dpi=300`，避免单请求过大；
- 服务端另有 `OCR_CHUNK_PAGES` 分块渲染兜底，两层分批互补；
- 请求失败由 BullMQ 队列重试，与 watchdog 自愈闭环配合。

---

## 9. 扫描件判断逻辑（`main.py:238-245`、`ocr_engine.py:448-456`）

```python
def _is_scanned(pages) -> bool:
    # >50% 的页 text 以 "![image" 开头且长度 <200 → 扫描件
```

docling 解析扫描件时无法提取文字，页面输出为图片占位符 `![image](input_images/page_N.jpg)`，此规则检测该模式。

---

## 10. 性能参考（历史测量值，v1.1 时代本机数据，供量级参考）

| 场景 | 引擎 | 速度 | 准确度 |
|------|------|------|--------|
| 纯文字 PDF（30页） | opendataloader | 毫秒级（不 OCR） | 100%（原文提取） |
| 纯文字 PDF（30页） | rapid | ~30s（2 线程 CPU） | 高 |
| 扫描件（10页） | rapid | ~3s | 中-高（中文优化） |
| 单页图片 | rapid | ~0.3s | 中-高 |

> v1.2.0 的分块渲染/watchdog 不改变单页吞吐，主要收益是内存峰值与可用性。如需当前机器的最新数据可重新测量。

---

## 11. 引擎选择建议

```
Q1: PDF 是纯文字型还是扫描件？
    ├── 纯文字型 → opendataloader（直接提取，毫秒级；需 hybrid 补丁环境）
    └── 扫描件 / 混合 / 不确定
        └── 以中文为主的投标文件 → rapid（当前默认，准确稳定，零外部依赖）

当前默认: rapid ✅  —— 中文投标文件场景，且不依赖 venv 补丁与子进程
easy     仅在需要多语言混排且接受安装 easyocr/torch 时考虑
```

---

## 12. 故障排查

| 症状 | 可能原因 | 排查 |
|------|---------|------|
| `/health` 正常但 `busy=true` 很久 | 大批次在处理（正常） | 看 `busy_seconds`/`busy_detail`（含文件名与页码进度） |
| 进程反复重启，日志含 `OCR watchdog` | 单页 recognize 卡死超 180s | 确认 PM2 env `OMP_NUM_THREADS=8`；偶发属自愈设计；频繁则查 OMP/驱动 |
| 日志 `No GPU, using CPU OCR` 但期望 GPU | libcudart 不在库路径 | 见 §4.4，设 `LD_LIBRARY_PATH` 后重启 |
| OCR 返回空文本 | 空白扫描件 / 置信度过滤 | `curl /health`；人工看渲染图清晰度 |
| 日志 `Using PP-OCRv4 default models` | 正常 | v5 模型未装；要 v5 需放 `~/.rapidocr/models/v5/` |
| 选 `easy` 后 PM2 重启循环 | easyocr 未安装 | `.venv/bin/pip install easyocr` 或改回 `rapid` |
| hybrid 启动失败 / 无 `--ocr-backend` | pip 升级后 venv 补丁丢失 | 重放 `patches/hybrid_server_rapidocr.patch`（§5.3） |
| Hybrid 服务器离线 | 子进程崩溃 | `curl localhost:5002/health`；`pm2 logs procurement-ocr` |
| httpx 代理报错 | `socks://` 不被识别 | 生产 env 已设 `socks5://`；代码侧自动改写子进程代理 |
| GPU OOM / 显存争抢 | 多模型共存 | `nvidia-smi`；OCR 当前 CPU 模式不占显存 |
