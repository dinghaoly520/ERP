# OCR 服务全流程文档

> 最后更新：2026-06-15  
> 适用版本：`services/ocr/` v1.1.0  
> 当前默认引擎：`OCR_ENGINE=rapid`

---

## 1. 架构总览

```
┌─────────────────────────────────────────────────────────────────────┐
│                        OCR Service (:8100)                          │
│                      FastAPI + uvicorn                              │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  POST /ocr                          GET /health                     │
│    │                                    │                           │
│    ├── PDF? ─── engine=rapid ─── _ocr_pdf()                         │
│    │              │                   │                             │
│    │              └── RapidOcrEngine  │  ocr_images() 并行          │
│    │                                  │                             │
│    ├── PDF? ─── engine=easy ─── _ocr_pdf()                          │
│    │              │                   │                             │
│    │              └── EasyOcrEngine   │  ocr_images() 并行          │
│    │                                  │                             │
│    ├── PDF? ─── engine=glm ─── _ocr_pdf()                           │
│    │              │                   │                             │
│    │              └── GlmOcrEngine ───│─ vLLM HTTP API (:8101)      │
│    │                 (httpx, 16线程)  │                             │
│    │                                  │                             │
│    ├── PDF? ─── engine=opendataloader ─── _parse_pdf_opendataloader│
│    │              │                                                │
│    │              ├─ 文字型PDF → 直接提取文字层                     │
│    │              │                                                │
│    │              └─ 扫描件 ──┬── GLM-OCR vLLM 在线 → GPU推理       │
│    │                          └── GLM-OCR 离线 → Hybrid RapidOCR    │
│    │                                                                │
│    └── 图片 ─── _ocr_image() → ocr_image() → engine.recognize()    │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘

外部依赖（独立进程）：
┌──────────────────────┐  ┌──────────────────────────────┐
│  GLM-OCR vLLM :8101  │  │  Hybrid Servers :5002-500m   │
│  0.9B 视觉语言模型    │  │  opendataloader-pdf-hybrid    │
│  GPU 显存 ~2.2GB      │  │  RapidOCR 后端 (PP-OCRv4)    │
└──────────────────────┘  └──────────────────────────────┘
```

---

## 2. 四大引擎对比

| | **RapidOCR** | **EasyOCR** | **GLM-OCR** | **OpenDataLoader** |
|---|---|---|---|---|
| **env 值** | `rapid` | `easy` | `glm` | `opendataloader` |
| **原理** | PP-OCRv4 检测+识别 | CRNN 检测+识别 | 端到端 VLM | docling 文档解析 |
| **运行位置** | CPU (ONNX) | CPU/GPU (PyTorch) | GPU (vLLM) | CPU + Hybrid 服务器 |
| **中文优化** | ✅ 专门优化 | ⚠️ 通用多语言 | ✅ 视觉理解 | 取决于后端 |
| **表格/公式** | ❌ 不支持 | ❌ 不支持 | ✅ 原生支持 | ✅ 保留排版 |
| **手写体** | ❌ | ❌ | ✅ | ❌ |
| **文字型PDF** | 渲染→OCR | 渲染→OCR | 渲染→OCR | 直接提取文字 |
| **扫描件PDF** | 渲染→OCR | 渲染→OCR | 渲染→OCR | 自动检测→GLM/hybrid |
| **并行线程** | 2 | 2 | 16 | 2 (hybrid) |
| **速度（文字PDF）** | 快 | 中等 | 中等 | 最快（不OCR） |
| **速度（扫描件）** | ~0.3s/页 | ~1s/页 | ~0.3s/页 | 取决于后端 |
| **依赖** | rapidocr_onnxruntime | easyocr, torch | vLLM 服务器 | opendataloader-pdf |

---

## 3. 请求处理流程

### 3.1 入口路由 (`main.py:53-76`)

```
POST /ocr  {file, dpi=150, max_pages=200, page_range=None}
    │
    ├── 文件是 PDF？
    │   ├── 是 + ENGINE_NAME == "opendataloader"
    │   │       → _parse_pdf_opendataloader(content, max_pages, page_range)
    │   │
    │   └── 是 + 其他引擎
    │           → _ocr_pdf(content, dpi, max_pages, page_range)
    │
    └── 否（图片）
            → _ocr_image(content)
```

### 3.2 `_ocr_pdf()` — 通用 PDF 路径 (`main.py:248-288`)

```
PDF 字节流
    │
    ① _prepare_pdf()              ← 处理 max_pages=0、page_range 截取
    │
    ② PyMuPDF (fitz) 逐页渲染     ← 每页 → RGB PIL Image
    │  dpi=150, 最大 MAX_SIDE 缩放
    │
    ③ ocr_images(images[])        ← 线程池并行
    │   │
    │   └── ThreadPoolExecutor(NUM_WORKERS)
    │         ├── rapid: 2 线程   → RapidOcrEngine.recognize()
    │         ├── easy:  2 线程   → EasyOcrEngine.recognize()
    │         └── glm:  16 线程   → GlmOcrEngine.recognize() → vLLM HTTP
    │
    ④ 组装 JSON 响应
       {text, page_count, processed_pages, pages: [{page, text}]}
```

### 3.3 `_parse_pdf_opendataloader()` — OpenDataLoader 路径 (`main.py:169-235`)

```
PDF 字节流
    │
    ① parser.parse_pdf_local()     ← docling 直接提取文字层
    │  返回: (全文, [{page, text}])
    │
    ② _is_scanned(pages)           ← 启发式判断
    │  判断依据：>50% 的页 text 以 "![image" 开头且长度 <200
    │
    ├── 不是扫描件（文字型PDF）
    │   └── 直接返回 ① 的结果 ✅
    │
    └── 是扫描件
        │
        ③ glm_ocr_available()？
        │
        ├── ✅ GLM-OCR vLLM 在线
        │   └── ocr_pdf_with_glm(content, dpi=150)
        │       │
        │       ├─ PyMuPDF 渲染 → numpy arrays
        │       └─ ThreadPoolExecutor(8) → GlmOcrEngine.recognize()
        │          └─ POST http://127.0.0.1:8101/v1/chat/completions
        │             └─ base64 PNG + 识别prompt → 返回文字
        │
        └── ❌ GLM-OCR 离线
            │
            ├── Hybrid Pool 在线？
            │   └── parser.parse_pdf_hybrid_parallel()
            │       └─ 多进程逐页 OCR → RapidOCR (PP-OCRv4)
            │
            └── Hybrid Pool 也不在线
                └── ⚠️ 返回扫描件原文（含大量 ![image] 占位符）
```

---

## 4. 各引擎实现细节

### 4.1 RapidOCR (`ocr_engine.py:56-74`)

```python
class RapidOcrEngine:
    def __init__(self):
        # 优先 PP-OCRv5（需手动下载模型到 ~/.rapidocr/models/v5/）
        # 否则 PP-OCRv4（rapidocr_onnxruntime 内置）
        self._engine = RapidOCR(det_model, rec_model, rec_keys)

    def recognize(self, arr: np.ndarray) -> str:
        # arr: RGB uint8 numpy array
        # 返回: 每行检测文字用 \n 连接
        result, _ = self._engine(arr)
        return "\n".join(r[1] for r in result)
```

- **不支持** V5 模型（`V5_MODELS_AVAILABLE = False`），当前使用内置 PP-OCRv4
- ONNX Runtime CPU 推理，无需 GPU
- 图片自动缩放到 `MAX_SIDE=3000px`

### 4.2 EasyOCR (`ocr_engine.py:79-90`)

```python
class EasyOcrEngine:
    def __init__(self):
        self._engine = Reader(["ch_sim", "en"], gpu=torch.cuda.is_available())

    def recognize(self, arr: np.ndarray) -> str:
        return "\n".join(self._engine.readtext(arr, detail=0, paragraph=True))
```

- 可选择 GPU 加速（检测 CUDA 可用性）
- 中文识别弱于 RapidOCR

### 4.3 GLM-OCR (`ocr_engine.py:96-206`)

```python
class GlmOcrEngine:
    # 线程安全：每线程一个 httpx.Client（连接池复用）

    def _get_client(self):
        # trust_env=False → 绕过系统代理（vLLM 在 localhost）
        return httpx.Client(timeout=120s, limits=Limits(max_connections=8))

    def recognize(self, arr: np.ndarray) -> str:
        # array → PNG bytes → base64
        # POST /v1/chat/completions
        #   model: /home/asus/models/GLM-OCR
        #   messages: [{role:"user", content:[
        #     {type:"image_url", image_url:{url:"data:image/png;base64,..."}},
        #     {type:"text", text:"请识别图片中的所有文字内容，保持原有格式和排版。"}
        #   ]}]
        #   max_tokens: 2048, temperature: 0.1
        # 返回: content.strip()
```

**vLLM 服务启动参数** (`start_glm_ocr.sh`):
```
--host 127.0.0.1 --port 8101
--gpu-memory-utilization 0.85
--max-model-len 4096
--max-num-seqs 16
--enforce-eager              ← 避免视觉 token CUDA Graph 兼容问题
--allowed-local-media-path / ← 允许 file:// URL 输入
```

### 4.4 OpenDataLoader / docling (`ocr_engine.py:361-536`)

```
OpendataloaderPdfParser
│
├── parse_pdf_local()         ← docling 本地解析（无OCR）
│   └── opendataloader_pdf.convert(hybrid=None)
│       └── 提取 PDF 文字层 → Markdown
│
├── parse_pdf_hybrid()        ← 单 hybrid 服务器
│   └── opendataloader_pdf.convert(hybrid="docling-fast")
│
└── parse_pdf_hybrid_parallel() ← 多 hybrid 服务器并行
    └── _parallel_ocr()
        ├── _is_scanned() 判断
        └── ThreadPoolExecutor → _process_page_range()
            └── opendataloader_pdf.convert(hybrid_url="http://127.0.0.1:{port}")
```

**Hybrid 服务器** (`HybridServer`):
- 独立子进程：`opendataloader-pdf-hybrid`
- 后端：`--ocr-backend rapidocr`（PP-OCRv4）
- 每服务器一个端口（默认 5002 起）
- 默认启动 2 个实例，并行处理不同页码范围

---

## 5. 配置参考

### 5.1 `.env` 文件

```bash
# services/ocr/.env  （当前默认配置）

# 引擎选择：rapid | easy | glm | opendataloader
OCR_ENGINE=rapid

# 图片最大边长（像素），超过自动缩放
OCR_MAX_SIDE=3000

# 线程池大小（glm 模式下默认 16，其他 2）
# OCR_NUM_WORKERS=8

# ── GLM-OCR (仅 OCR_ENGINE=glm 或 opendataloader 扫描件路径) ──
GLM_VLLM_URL=http://127.0.0.1:8101/v1
GLM_VLLM_MODEL=/home/asus/models/GLM-OCR
GLM_VLLM_TIMEOUT=120
GLM_VLLM_MAX_TOKENS=2048
GLM_VLLM_CONCURRENCY=8

# ── Hybrid 服务器 (仅 OCR_ENGINE=opendataloader) ──
# OCR_HYBRID_PORT=5002
# OCR_HYBRID_LANG=ch_sim,en
# OCR_HYBRID_DEVICE=cuda
# OCR_HYBRID_OCR_ENGINE=rapidocr
# OCR_HYBRID_WORKERS=2
```

### 5.2 运行时自动调整

| 环境变量 | rapid | easy | glm | opendataloader |
|---------|-------|------|-----|----------------|
| `NUM_WORKERS` | 2 | 2 | **16** | 2 |
| Hybrid 服务器 | 不启动 | 不启动 | 不启动 | **启动 2 个** |
| `get_engine()` 返回 | RapidOcrEngine | EasyOcrEngine | GlmOcrEngine | RapidOcrEngine |
| GLM bridge | 不初始化 | 不初始化 | N/A（直接用） | **延迟初始化** |

---

## 6. GPU 资源分配

```
RTX 5090 D (24GB VRAM)
│
├── bge-m3 embedding (:8003)    ~2.3 GB   ← PM2: procurement-embedding
├── GLM-OCR vLLM (:8101)        ~2.2 GB   ← PM2: procurement-glm-ocr
│   └── KV Cache + 激活值       ~2-6 GB   （取决于并发）
│
└── 剩余                        13-17 GB
    可用于更大 batch size 或未来扩展
```

**GLM-OCR vLLM 关键参数**：
- `gpu-memory-utilization=0.85` → 预占约 20.4GB
- `max-model-len=4096` → OCR 输出通常 <500 tokens，留足余量
- `max-num-seqs=16` → 最多 16 个并发推理请求
- `enforce-eager` → 跳过 CUDA Graph 编译（兼容性，首 token 延迟不受影响）

---

## 7. 环境适配补丁

由于本机 GPU 较新（RTX 5090 D, SM 120）且 CUDA toolkit 通过 pip 安装（非系统 apt），需要以下运行时补丁：

### 7.1 vLLM glm_ocr.py — 禁用视频模态

**文件**: `/home/asus/vllm_venv/.../vllm/model_executor/models/glm_ocr.py`

**问题**: GLM-OCR 继承自 GLM-4V 的 `Glm4vProcessingInfo`，后者声明支持视频输入。encoder cache 启动剖析时会创建虚拟视频输入，导致 GLM-OCR 视觉编码器崩溃。

**修复**:
```python
class GlmOcrProcessingInfo(Glm4vProcessingInfo):
    def get_supported_mm_limits(self) -> Mapping[str, int | None]:
        return {"image": None}  # 仅图片，无视频

# 注册时使用 GlmOcrProcessingInfo 替代 Glm4vProcessingInfo
# _mark_tower_model(vllm_config, {"image"})  替代 {"image", "video"}
```

### 7.2 Triton build.py — Python 头文件路径

**文件**: `/home/asus/vllm_venv/.../triton/runtime/build.py`

**问题**: 系统未安装 `python3.10-dev`，`/usr/include/python3.10/` 不存在。Triton JIT 编译 CUDA 辅助代码时需要 `Python.h`。

**修复**: 优先使用 `posix_user` scheme（`~/.local/include/python3.10`），头文件从下载的 `libpython3.10-dev` deb 包提取。

### 7.3 FlashInfer CCCL 兼容性

**环境变量**: `FLASHINFER_EXTRA_CUDAFLAGS="-DCCCL_DISABLE_CTK_COMPATIBILITY_CHECK"`

**问题**: FlashInfer 0.6.12 内置的 CCCL 头文件（CUB/libcudacxx/Thrust）与 CUDA 13.x nvcc 编译器不兼容。

**修复**: 跳过 CUDA toolkit 版本兼容性检查。

### 7.4 CUDA 库符号链接

**路径**: `/home/asus/vllm_venv/.../nvidia/cu13/lib/`

**问题**: pip 安装的 nvidia-cuda-runtime 只提供版本化 `.so` 文件（如 `libcudart.so.13`），编译器链接需要无版本号 `.so`。

**修复**: 手动创建 `libcudart.so → libcudart.so.13` 等符号链接。

---

## 8. PM2 生产部署

### 8.1 服务列表 (`ecosystem.config.js`)

| PM2 名称 | 端口 | 用途 | 重启策略 |
|----------|------|------|---------|
| `procurement-api` | 4000 | NestJS 后端 | max 10 次 |
| `procurement-web` | 3001 | Next.js 前端 | max 10 次 |
| `procurement-embedding` | 8003 | bge-m3 向量化 | 无限制 |
| `procurement-glm-ocr` | 8101 | GLM-OCR vLLM | max 5 次 |
| `procurement-ocr` | 8100 | OCR FastAPI | max 10 次 |
| `procurement-worker` | — | AI 投标分析队列 | max 10 次 |

### 8.2 启动顺序

```bash
# 1. 基础设施
pnpm infra:up          # PostgreSQL, Redis, MinIO

# 2. GPU 模型服务（先于 OCR 服务）
pm2 start procurement-embedding    # bge-m3 on :8003
pm2 start procurement-glm-ocr      # GLM-OCR on :8101  ← 可选

# 3. 应用服务
pm2 start procurement-ocr          # OCR on :8100
pm2 start procurement-api          # API on :4000
pm2 start procurement-web          # Web on :3001
pm2 start procurement-worker       # Queue worker
```

### 8.3 开发命令

```bash
pnpm dev:ocr          # OCR 服务（读取 .env 中的 OCR_ENGINE）
pnpm dev:glm-ocr      # GLM-OCR vLLM 服务（独立启动）
pnpm dev:vllm         # bge-m3 embedding 服务
pnpm dev              # 全部启动
```

---

## 9. 扫描件判断逻辑

```python
def _is_scanned(pages: list) -> bool:
    """如果大多数页的 text 以 ![image 开头且长度 <200 字符 → 扫描件"""
    if not pages:
        return False
    img_only = sum(
        1 for p in pages
        if p["text"].strip().startswith("![image")
        and len(p["text"].strip()) < 200
    )
    return img_only > len(pages) * 0.5
```

docling 处理扫描件时，无法提取文字，页面输出为图片占位符 `![image](input_images/page_N.jpg)`。此启发式规则检测这种模式。

---

## 10. 性能基准

| 场景 | 引擎 | 速度 | 准确度 |
|------|------|------|--------|
| 纯文字 PDF（30页） | opendataloader | 毫秒级（不OCR） | 100%（原文提取） |
| 纯文字 PDF（30页） | rapid | ~30s（2线程） | 高 |
| 纯文字 PDF（30页） | glm | ~5s（16线程） | 高 |
| 扫描件（10页） | rapid | ~3s | 中（中文优化） |
| 扫描件（10页） | glm | ~3s | 高（表格/公式/手写） |
| 扫描件（10页） | opendataloader+GLM | ~3s | 高 |
| 单页图片 | rapid | ~0.3s | 中-高 |
| 单页图片 | glm | ~0.3s（预热后） | 高 |

**GLM-OCR 预热吞吐测量**（RTX 5090 D, dpi=150, 1200×400px）:
- 首请求：~48s（含 vLLM profile_run 预热）
- 后续请求：**~0.29s/页**（~3.3 页/秒）

---

## 11. 引擎选择建议

```
┌─────────────────────────────────────────────────────────────────────┐
│                         OCR 引擎选择决策树                           │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  Q1: PDF 是纯文字型还是扫描件？                                     │
│      ├── 纯文字型（电子生成）                                       │
│      │   └── 选 opendataloader → 直接提取，毫秒级                   │
│      │                                                                │
│      └── 扫描件 / 混合 / 不确定                                     │
│          │                                                          │
│          Q2: 是否需要保留表格/公式/排版？                            │
│              ├── 是 → opendataloader（自动检测+GLM回落）            │
│              │                                                     │
│              └── 否（只要文字内容）                                 │
│                  │                                                 │
│                  Q3: 文档以中文为主？                               │
│                      ├── 是 → rapid（中文优化，准确稳定）           │
│                      └── 否/多语言混排 → glm（VLM通用识别）         │
│                                                                     │
│  当前默认: rapid ← 适合中文投标文件场景                            │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 12. 故障排查

| 症状 | 可能原因 | 排查命令 |
|------|---------|---------|
| OCR 返回空文本 | 引擎未加载/图片过大 | `curl localhost:8100/health` |
| GLM-OCR 不可用 | vLLM 未启动 | `curl localhost:8101/health` |
| Hybrid 服务器离线 | 子进程崩溃 | `curl localhost:5002/health` |
| GLM-OCR 返回乱码 | max_tokens 超过上下文窗口 | 检查 `GLM_VLLM_MAX_TOKENS` < `max-model-len - prompt_tokens` |
| vLLM 启动失败 | FlashInfer JIT 编译失败 | 检查 `FLASHINFER_EXTRA_CUDAFLAGS` 是否设置 |
| GPU OOM | 多个模型争抢显存 | `nvidia-smi` 检查显存使用 |
| httpx 代理错误 | SOCKS 代理干扰 localhost | 确认 `trust_env=False` 已设置 |
