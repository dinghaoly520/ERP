# OCR 服务接管与细粒度配置升级 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `water-erp/services/ocr` 升级为可独立运行、可细粒度调参、带文字层快速路径的主副本；NestJS 消费端批次/dpi 可调 + 页数探测零 OCR + 结果缓存；本机 ERP 经 PM2 `erp-ocr`（:8110）切到自己实例，procurement :8100 不再复用。

**Architecture:** 全部新配置走 env（Python 侧 `resolve_*` 纯函数解析 + `RapidOCR` 扁平 kwargs 限线程；NestJS 侧 ConfigService 读 `OCR_BATCH_PAGES`/`OCR_DPI` + Redis 结果缓存）。文字层快速路径在 `_ocr_pdf` 分块循环内逐页判定（fitz `get_text` 阈值，不足回退 OCR）。GPU 路径、watchdog、引擎选择逻辑全部不动。

**Tech Stack:** Python 3.10（现有 `.venv`，unittest）/ FastAPI uvicorn / rapidocr_onnxruntime 1.4.4 / NestJS jest + ioredis（`REDIS_CLIENT` token）

**Spec:** `docs/superpowers/specs/2026-11-04-ocr-service-takeover-config-design.md`

## Global Constraints

- 引擎 `rapid` 不变；GPU 判定与 GPU 路径（`config_gpu.yaml`）不动；watchdog 语义不动。
- 生产机 CPU 已确认 **x86_64**（用户裁定 2026-11-04）；P1/P2 优化项（INT8/v5/paddle/流水线重叠/上传一次多批）**不做**。
- 不新增 Python/npm 依赖；`requirements.txt` 不改。
- Python 测试一律 `services/ocr/.venv/bin/python -m unittest`（venv 内无 pytest）。
- `services/ocr/.env` 与 `apps/api/.env` 均 gitignored（机器本地件）；提交的契约是 `.env.example` 与代码。
- CLAUDE.md 修改必须走 Bash（ARS 守卫拦 Edit/Write）。
- 并行会话规则：`git add` 只加明确文件路径，禁 `-A`；commit 前后校验 `git status`。
- commit message 尾行：`Co-Authored-By: Claude Code <noreply@anthropic.com>`。
- 本机 :8100（procurement-ocr PM2）全程不动。

## Review Focus

1. **非法 env 值**（`OCR_INTRA_THREADS=abc`、负数、空串）→ 回落默认 + warn，不崩启动 → Task 1 Step 1 测试钉死。
2. **`/health` 在引擎 warmup 完成前被调** → `num_workers` 等来自模块常量仍可报（不依赖 engine 实例）→ Task 2 Step 1 测试钉死。
3. **显式传参覆盖 env 默认**：`dpi`/`max_pages` Form 有值时 env 默认不生效 → Task 2 常量只进 Form default + Task 5 Step 1 的 dpi 省略契约测试钉死。
4. **文字层脏数据**（短文本/水印页/乱码）→ 字符数不足阈值即整页回退 OCR，不产出半截结果 → Task 3 Step 1 测试钉死。
5. **缓存键串参数**：不同 dpi/pageRange/maxPages 不得命中彼此结果；**缓存故障不得阻断 OCR**（Redis 挂了照常 OCR）→ Task 6 Step 1 测试钉死。
6. **:8110 被占用** → uvicorn 启动即显式失败退出 → Task 7 Step 3 `ss` 预检 + PM2 状态验证。
7. **requirements.txt 后续变更** → `start.sh` 检测比 `.venv/.ready` 新则重建 venv → Task 4 `-nt` 条件 + `bash -n` 钉死（不做真实重建验证）。

---

### Task 1: ocr_engine.py 配置解析 + RapidOCR 线程注入 + .env.example 扩写

**Files:**
- Modify: `services/ocr/ocr_engine.py:28-40`（env 常量区）、`ocr_engine.py:65-99`（RapidOcrEngine）
- Modify: `services/ocr/.env.example`（全量旋钮 + 6 核预设注释）
- Create: `services/ocr/test_config.py`

**Interfaces:**
- Produces: `resolve_thread_config(env: Mapping[str, str]) -> dict`（键 `intra_op_num_threads`/`inter_op_num_threads`，仅含 >0 项）；`resolve_num_workers(env: Mapping[str, str]) -> int`（默认 2，非法/≤0 回落 2）
- Produces: 模块常量 `NUM_WORKERS: int`、`OCR_INTRA_THREADS: int`、`OCR_INTER_THREADS: int`（Task 2 /health 消费）
- Produces: `RapidOcrEngine` CPU 分支注入线程 kwargs（v5 与 v4 两条 CPU 路径都注入；GPU 分支不动）

- [ ] **Step 1: 写失败测试 `test_config.py`**

```python
import unittest
from ocr_engine import resolve_thread_config, resolve_num_workers

class ResolveThreadConfigTest(unittest.TestCase):
    def test_empty_env_returns_empty(self):
        self.assertEqual(resolve_thread_config({}), {})

    def test_values_mapped(self):
        self.assertEqual(
            resolve_thread_config({"OCR_INTRA_THREADS": "3", "OCR_INTER_THREADS": "1"}),
            {"intra_op_num_threads": 3, "inter_op_num_threads": 1},
        )

    def test_zero_means_unset(self):
        self.assertEqual(resolve_thread_config({"OCR_INTRA_THREADS": "0"}), {})

    def test_invalid_falls_back_to_default(self):
        self.assertEqual(resolve_thread_config({"OCR_INTRA_THREADS": "abc"}), {})
        self.assertEqual(resolve_thread_config({"OCR_INTRA_THREADS": "-2"}), {})

class ResolveNumWorkersTest(unittest.TestCase):
    def test_default_2(self):
        self.assertEqual(resolve_num_workers({}), 2)
    def test_override(self):
        self.assertEqual(resolve_num_workers({"OCR_NUM_WORKERS": "4"}), 4)
    def test_invalid_falls_back(self):
        self.assertEqual(resolve_num_workers({"OCR_NUM_WORKERS": "x"}), 2)
        self.assertEqual(resolve_num_workers({"OCR_NUM_WORKERS": "0"}), 2)
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd water-erp/services/ocr && .venv/bin/python -m unittest test_config -v`
Expected: FAIL（ImportError: cannot import name 'resolve_thread_config'）

- [ ] **Step 3: 实现**

`ocr_engine.py` env 常量区加两个纯函数（`try: int(...) except (ValueError, TypeError): logger.warning + 回落`；`<=0` 视为未设），模块常量改为由函数从 `os.environ` 求值。`RapidOcrEngine.__init__`：`thread_kwargs = resolve_thread_config(os.environ)`，v4 CPU 路径 `RapidOCR(**thread_kwargs)`、v5 CPU 路径 `kwargs.update(thread_kwargs)`，GPU 路径（`config_path`）原样不动。函数 docstring 写线程铁律：`OCR_NUM_WORKERS × OCR_INTRA_THREADS ≤ 核预算`。

`.env.example` 重写：引擎/边长两行保留 + 「并行与线程」（NUM_WORKERS/INTRA/INTER + 铁律注释 + 8 核 6 核预算预设 `2×3`）+「渲染与批次」（CHUNK_PAGES/DEFAULT_DPI/MAX_PAGES_DEFAULT）+「稳定性」（TIMEOUT/WATCHDOG）+「Hybrid」（含 ERP 实例与 :8100 并存须错开 `OCR_HYBRID_PORT` 段的注释）。

- [ ] **Step 4: 跑测试确认通过**

Run: `cd water-erp/services/ocr && .venv/bin/python -m unittest test_config -v`
Expected: PASS（7 tests）

- [ ] **Step 5: Commit**

```bash
git add water-erp/services/ocr/ocr_engine.py water-erp/services/ocr/.env.example water-erp/services/ocr/test_config.py
git commit -m "feat(ocr): 细粒度线程/worker 配置面——resolve_* 纯函数 + RapidOCR CPU 路径注入"
```

---

### Task 2: main.py Form 默认 env 化 + /health 上报生效配置

**Files:**
- Modify: `services/ocr/main.py:27`（version→1.3.0）、`main.py:35` 附近（常量）、`main.py:58-76`（health）、`main.py:79-102`（Form 默认）
- Test: `services/ocr/test_main.py`（追加）

**Interfaces:**
- Consumes: Task 1 的 `NUM_WORKERS`/`OCR_INTRA_THREADS`/`OCR_INTER_THREADS`（from ocr_engine import）
- Produces: 模块常量 `DEFAULT_DPI: int`、`DEFAULT_MAX_PAGES: int`（非法回落默认并 warn，同 Task 1 语义）；health payload 新键 `num_workers`/`intra_threads`/`inter_threads`/`chunk_pages`（0=包默认）

- [ ] **Step 1: 追加失败测试到 `test_main.py`**

```python
class HealthConfigReportTest(unittest.TestCase):
    def test_health_reports_effective_config_before_warmup(self):
        payload = asyncio.run(main.health())
        for key in ("num_workers", "intra_threads", "inter_threads", "chunk_pages"):
            self.assertIn(key, payload)
            self.assertIsInstance(payload[key], int)
        self.assertEqual(payload["num_workers"], main.NUM_WORKERS)

class FormDefaultsTest(unittest.TestCase):
    def test_env_backed_defaults_are_ints(self):
        self.assertIsInstance(main.DEFAULT_DPI, int)
        self.assertGreater(main.DEFAULT_MAX_PAGES, 0)
```

（`main.health()` 不触引擎——这正是「warmup 前可查」要钉死的点。）

- [ ] **Step 2: 跑测试确认失败**

Run: `cd water-erp/services/ocr && .venv/bin/python -m unittest test_main -v`
Expected: FAIL（KeyError: 'num_workers' / AttributeError: DEFAULT_DPI）

- [ ] **Step 3: 实现**

`main.py`：import 处从 `ocr_engine` 增补 `NUM_WORKERS, OCR_INTRA_THREADS, OCR_INTER_THREADS`；模块级 `DEFAULT_DPI`（env `OCR_DEFAULT_DPI`，默认 150）、`DEFAULT_MAX_PAGES`（env `OCR_MAX_PAGES_DEFAULT`，默认 200）；`/ocr` Form 默认改用两常量；`/health` payload 增四键；`version="1.3.0"`。

- [ ] **Step 4: 跑测试确认通过（全量回归）**

Run: `cd water-erp/services/ocr && .venv/bin/python -m unittest discover -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add water-erp/services/ocr/main.py water-erp/services/ocr/test_main.py
git commit -m "feat(ocr): dpi/max_pages 服务端默认 env 化 + /health 上报生效配置"
```

---

### Task 3: 文字层快速路径（P0 性能项①）

**Files:**
- Modify: `services/ocr/main.py`（`_ocr_pdf` 分块循环 + 新 helper）
- Modify: `services/ocr/.env.example`（追加 `OCR_TEXT_LAYER_MIN_CHARS` 段）
- Test: `services/ocr/test_main.py`（追加）

**Interfaces:**
- Produces: `_should_use_text_layer(text: str, min_chars: int) -> bool`（纯函数：`min_chars > 0 and len(text.strip()) >= min_chars`——0=禁用快速路径恒走 OCR）
- Produces: 模块常量 `TEXT_LAYER_MIN_CHARS: int`（env `OCR_TEXT_LAYER_MIN_CHARS`，默认 100）
- Produces: 响应契约扩展——`pages[i]` 增可选字段 `"source": "text-layer" | "ocr"`（NestJS 只读 `page`/`text`，向后兼容）
- Consumes: Task 2 的 `DEFAULT_DPI` 无关；`_ocr_pdf` 内部分块循环结构

- [ ] **Step 1: 追加失败测试**

```python
class TextLayerFastPathTest(unittest.TestCase):
    def test_should_use_text_layer_boundaries(self):
        self.assertFalse(_should_use_text_layer("", 100))          # 空页
        self.assertFalse(_should_use_text_layer("水印", 100))       # 短文本(水印/页眉)
        self.assertTrue(_should_use_text_layer("字" * 100, 100))    # 达阈值
        self.assertFalse(_should_use_text_layer("字" * 999, 0))     # 0=禁用

    def test_ocr_pdf_mixed_pages_split(self):
        # fitz 造 3 页：p1 长 text_layer、p2 仅 3 字、p3 无文字
        # patch.object(main, "_run_ocr_batch", AsyncMock 返回 ["P2-OCR", "P3-OCR"])
        # asyncio.run(main._ocr_pdf(pdf_bytes, 150, 10))
        # 断言：pages[0].source=="text-layer" 且 text 含 p1 内容
        #      pages[1]/[2].source=="ocr"；_run_ocr_batch 仅被调 1 次、images 长 2
```

（mock `_run_ocr_batch` 避免加载真引擎——单测不依赖 rapidocr。）

- [ ] **Step 2: 跑测试确认失败**

Run: `cd water-erp/services/ocr && .venv/bin/python -m unittest test_main -v`
Expected: FAIL（NameError: _should_use_text_layer）

- [ ] **Step 3: 实现**

`_ocr_pdf` 分块循环内逐页：`layer = doc[page_idx].get_text("text")` → `_should_use_text_layer(layer, TEXT_LAYER_MIN_CHARS)` 为真记 `{page, text: layer, source: "text-layer"}`，否则该页入渲染列表；块内渲染列表走 `_run_ocr_batch`（detail 注明 `pX-pY` 中 OCR 页号），结果标 `source: "ocr"`；按页号归并输出。`.env.example` 追加：`OCR_TEXT_LAYER_MIN_CHARS=100`（0=禁用；文字层达阈值的页直接取文本不 OCR，数字原生 PDF 提速一个量级）。

- [ ] **Step 4: 跑测试确认通过（全量回归）**

Run: `cd water-erp/services/ocr && .venv/bin/python -m unittest discover -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add water-erp/services/ocr/main.py water-erp/services/ocr/test_main.py water-erp/services/ocr/.env.example
git commit -m "feat(ocr): 文字层快速路径——数字原生 PDF 逐页判定免 OCR，不足阈值回退"
```

---

### Task 4: start.sh 端口参数化 + venv 失效重建

**Files:**
- Modify: `services/ocr/start.sh`

**Interfaces:**
- Produces: `OCR_PORT`（默认 8100）/ `OCR_HOST`（默认 127.0.0.1）env 透传 uvicorn；`requirements.txt` 比 `.venv/.ready` 新时删标记重建 venv

- [ ] **Step 1: 修改 start.sh**

结构：`.env` 自动创建保留 → venv 就绪判断改为 `if [ ! -f ".venv/.ready" ] || [ "requirements.txt" -nt ".venv/.ready" ]; then`（重建前 echo 说明原因）→ `OCR_PORT="${OCR_PORT:-8100}"; OCR_HOST="${OCR_HOST:-127.0.0.1}"` → exec uvicorn 用两变量。

- [ ] **Step 2: 标记 venv 已同步（防无谓重建）**

`requirements.txt`（11-03 改）比 `.venv/.ready`（06-14 建）新，但 venv 实际包版本已逐一核实与 requirements 一致——`touch .venv/.ready` 追平标记，避免新逻辑首跑触发全量 pip 重装（走代理、耗时数分钟、零收益）。
Run: `touch water-erp/services/ocr/.venv/.ready`

- [ ] **Step 3: 语法与轻量行为验证**

Run: `bash -n water-erp/services/ocr/start.sh`（语法零输出=过）；`OCR_PORT=8111 timeout 30 bash water-erp/services/ocr/start.sh & sleep 15 && curl -s localhost:8111/health; kill %1 2>/dev/null`
Expected: `/health` 返回 JSON 且含 `"num_workers"`（warmup 约 5-10s）

- [ ] **Step 4: Commit**

```bash
git add water-erp/services/ocr/start.sh
git commit -m "feat(ocr): start.sh 支持 OCR_PORT/OCR_HOST 参数化 + requirements 变更触发 venv 重建"
```

---

### Task 5: apps/api 消费端 env 化 + 页数探测零 OCR（P0 性能项②）

**Files:**
- Modify: `apps/api/src/local-ai/ocr.service.ts`（constructor、`ocrPdf` 签名、批处理穿参、`getPdfPageCount`）
- Modify: `apps/api/src/ai-bid-analysis/utils/file-processor.ts:72`（去掉显式 `150`）
- Test: `apps/api/src/local-ai/ocr.service.spec.ts`（追加，复用 `makeService` 惯例）

**Interfaces:**
- Produces: `OcrService` 构造读 `OCR_BATCH_PAGES`（默认 '40'）/ `OCR_DPI`（默认 '150'）；`ocrPdf(buffer: Buffer, maxPages = 200, dpi?: number)`——省略 dpi 时用 `this.defaultDpi`
- Produces: `getPdfPageCount` 改调 `ocrPdfSingle(buffer, 0, 50, null)`——服务端 `max_pages=0` 且无 `page_range` 时零 OCR 早返回（`main.py:177-178` 已支持）
- NestJS env 语义：缺省/非法（NaN）回落默认并 log 一次

- [ ] **Step 1: 追加失败测试**

`makeService(url, env?)` mock `get` 增 key 分支，新增 describe：

```typescript
describe('OCR_BATCH_PAGES / OCR_DPI env 化 + 页数探测零 OCR', () => {
  it('OCR_BATCH_PAGES=20：100 页文件分 5 批（+1 次页数探测），批界按 20 切', async () => {
    // mock fetch 记录每次 FormData 的 page_range/max_pages/dpi
    // 断言：总调用 6 次；批界含 '1-20'、'81-100'；每批 max_pages 均为 20
  });
  it('页数探测调用零 OCR：max_pages=0 且无 page_range', async () => {
    // 首次（探测）调用断言 form: max_pages=='0' 且 page_range 字段未附带（服务端据此走零 OCR 早返回）
  });
  it('省略 dpi 走 OCR_DPI 默认：表单 dpi 字段=env 值', async () => {
    // 小文件单次路径 OCR_DPI='200' → FormData dpi=='200'
  });
  it('显式 dpi 覆盖 env 默认', async () => { /* ocrPdf(buf, 200, 120) → dpi=='120' */ });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd water-erp/apps/api && ./node_modules/.bin/jest src/local-ai/ocr.service.spec.ts`
Expected: FAIL（env 不被读取，批界仍 40 / 探测仍 max_pages=1 + page_range '1-1'）

- [ ] **Step 3: 实现**

`constructor`：`this.batchPages = this.readIntConfig('OCR_BATCH_PAGES', 40)`、`this.defaultDpi = this.readIntConfig('OCR_DPI', 150)`（私有 `readIntConfig(key, def)`：NaN 回落 + warn 一次）。`ocrPdf(buffer, maxPages = 200, dpi?: number)` 内 `const effectiveDpi = dpi ?? this.defaultDpi` 向下穿参；`BATCH_PAGES` 引用改 `this.batchPages`。`getPdfPageCount`：`ocrPdfSingle(buffer, 0, 50, null)`（读 `result.pageCount` 逻辑不变）。`file-processor.ts:72` 改 `ocrService.ocrPdf(buffer, maxPages)`。

- [ ] **Step 4: 跑测试确认通过 + TS 编译**

Run: `cd water-erp/apps/api && ./node_modules/.bin/jest src/local-ai/ocr.service.spec.ts && npx tsc --noEmit`
Expected: jest 全 PASS（含既有 round-robin 用例）；tsc 零错误

- [ ] **Step 5: Commit**

```bash
git add water-erp/apps/api/src/local-ai/ocr.service.ts water-erp/apps/api/src/local-ai/ocr.service.spec.ts water-erp/apps/api/src/ai-bid-analysis/utils/file-processor.ts
git commit -m "feat(api): OCR 消费端批次/dpi 走 env + 页数探测改 max_pages=0 零 OCR"
```

---

### Task 6: OCR 结果缓存（P0 性能项③）

**Files:**
- Modify: `apps/api/src/local-ai/ocr.service.ts`（缓存层）
- Test: `apps/api/src/local-ai/ocr.service.spec.ts`（`makeService` 增 REDIS_CLIENT mock + 新 describe）

**Interfaces:**
- Consumes: `@Global() RedisModule` 的 `'REDIS_CLIENT'` token（ioredis 客户端；worker 进程可能未导入该模块 → 必须 `@Optional() @Inject('REDIS_CLIENT')`，客户端缺席时缓存静默禁用）
- Produces: `ocrPdf`/`ocrImage` 入口缓存——键 `ocr:v1:{scope}:{sha256}:{dpi}:{maxPages}:{pageRange||'all'}`（scope `pdf`|`img`；sha256 为文件内容哈希）；env `OCR_CACHE_ENABLED`（默认 'true'）/ `OCR_CACHE_TTL_SECONDS`（默认 604800）/ `OCR_CACHE_MAX_ENTRY_KB`（默认 2048，超限跳过存储防 Redis 内存压力）
- 语义：缓存 get/set 任何异常 → warn 后照常走 OCR（**故障不阻断**）；命中返回缓存并 log

- [ ] **Step 1: 追加失败测试**

```typescript
describe('OCR 结果缓存', () => {
  it('相同参数二次调用命中缓存：fetch 仅 1 次，二次结果与一次相同', async () => {});
  it('dpi 不同 → 键不同 → 两次 fetch', async () => {});
  it('Redis get 抛异常 → 不崩、照常 fetch', async () => {});
  it('缓存禁用（OCR_CACHE_ENABLED=false）→ 不读不写', async () => {});
});
```

（`makeService` 增可选 redis mock：`{ get: jest.fn(), set: jest.fn() }`；既有用例全部补传该 mock——**DI 新依赖后旧用例会因缺 provider 报错，属预期首轮失败**。）

- [ ] **Step 2: 跑测试确认失败**

Run: `cd water-erp/apps/api && ./node_modules/.bin/jest src/local-ai/ocr.service.spec.ts`
Expected: FAIL（Nest DI 缺 REDIS_CLIENT provider / 缓存不存在）

- [ ] **Step 3: 实现**

constructor 增 `@Optional() @Inject('REDIS_CLIENT') private readonly redis?: Redis | null`。私有方法：`cacheKey(scope, buffer, dpi, maxPages, pageRange)`（crypto sha256）；`cacheGet(key)`/`cacheSet(key, result)`（try/catch + enabled/size/TTL 检查）。`ocrPdf` 与 `ocrImage` 入口处包裹（batched 路径缓存**最终合并结果**，整文件一键）。缓存值 = `JSON.stringify(OcrResult)`。

- [ ] **Step 4: 跑测试确认通过 + TS 编译**

Run: `cd water-erp/apps/api && ./node_modules/.bin/jest src/local-ai/ocr.service.spec.ts && npx tsc --noEmit`
Expected: 全 PASS；tsc 零错误

- [ ] **Step 5: Commit**

```bash
git add water-erp/apps/api/src/local-ai/ocr.service.ts water-erp/apps/api/src/local-ai/ocr.service.spec.ts
git commit -m "feat(api): OCR 结果 Redis 缓存——内容哈希键，重跑/重试零重复计算，故障不阻断"
```

---

### Task 7: 本机接管——PM2 erp-ocr(:8110) + apps/api 切换

**Files:**
- Create: `services/ocr/ecosystem.config.js`
- Modify（gitignored，机器本地）: `services/ocr/.env`、`apps/api/.env:37-39`

**Interfaces:**
- Consumes: Task 1-4 的配置面与端口参数
- Produces: PM2 应用 `erp-ocr`（:8110）；ERP API 流量切至 `http://localhost:8110`

- [ ] **Step 1: 写 ecosystem.config.js**

单 app `erp-ocr`：`cwd: __dirname`、`script: './.venv/bin/uvicorn'`、`args: 'main:app --host 127.0.0.1 --port 8110 --workers 1 --timeout-keep-alive 300'`、`interpreter: 'none'`、`max_memory_restart: '4G'`、`kill_timeout: 30000`、`restart_delay: 5000`、`max_restarts: 10`（对齐 procurement-ocr 惯例；watchdog 自杀靠 restart_delay 拉起）。

- [ ] **Step 2: 写两个 .env**

`services/ocr/.env` 追加：`OCR_NUM_WORKERS=2`、`OCR_INTRA_THREADS=3`、`OCR_INTER_THREADS=1`（8 核生产预设，双环境一致）、`OCR_CHUNK_PAGES=16`、`OCR_DEFAULT_DPI=150`、`OCR_MAX_PAGES_DEFAULT=200`、`OCR_TEXT_LAYER_MIN_CHARS=100`。
`apps/api/.env`：`OCR_SERVICE_URL=http://localhost:8110`，注释改「ERP 自管实例（services/ocr，PM2 erp-ocr）」。

- [ ] **Step 3: 端口预检 + 起 PM2**

Run: `ss -tlnp | grep 8110`（必须空）→ `cd water-erp/services/ocr && pm2 start ecosystem.config.js --only erp-ocr && pm2 save`
验证：`curl -s localhost:8110/health`——`engine=rapid`、`num_workers=2`、`intra_threads=3`、`busy=false`。
**注意**：`pm2 save` 快照含 procurement 两应用（共享机器状态）；若 :8110 被占，uvicorn 显式退出——PM2 显示 errored，不静默换端口。

- [ ] **Step 4: 重启 API 验证切换**

**先与用户确认重启时机**（可能打断其运行中的 pnpm dev）。`pnpm dev:kill && pnpm dev` 起 API 后，以 admin 会话调系统健康页 OCR 探活端点（`probeReplicas` 消费方；执行时查实际路由），或 tail `pm2 logs erp-ocr` 观察 API 发起的 `/health` 探测打到 :8110。
Expected: 探活 ok 且 URL 为 :8110；procurement-ocr（:8100）无 ERP 流量。

- [ ] **Step 5: Commit（仅入库文件）**

```bash
git add water-erp/services/ocr/ecosystem.config.js
git commit -m "feat(ocr): PM2 erp-ocr 托管配置——ERP 独立 OCR 实例(:8110)接管本机流量"
```

---

### Task 8: 双实例输出对比 + 线程观测 + 文档同步

**Files:**
- Modify: `services/ocr/ARCHITECTURE.md`（v1.3.0）
- Modify: `/home/asus/桌面/ERP/CLAUDE.md`（OCR 相关段；**必须 Bash 修改**）

**Interfaces:**
- Consumes: Task 7 起的 :8110 实例与既有 :8100 实例

- [ ] **Step 1: 对比测试三件套（断言按路径分档）**

测试材料自造（`/tmp` 下用本 venv 生成）：文字 PDF = `fitz` 新建 3 页各 `insert_text` 中文英文混排标记串；扫描件 = PIL 画白底黑字图 → `fitz` `insert_image` 嵌 2 页；PNG = PIL 直接存。
分别 POST `:8110/ocr` 与 `:8100/ocr`（同 `dpi=150`）：
- **扫描件 + PNG：`text` 逐字符一致**（两实例同 OCR 路径）。
- **文字 PDF：:8110 走快速路径（`pages[].source=="text-layer"`、毫秒级、文本含全部标记串）；:8100 全量 OCR**——断言 :8110 含每页标记串即可，不强求与 :8100 逐字符一致（提取 vs OCR 天然差异）。
- 时间记录：文字 PDF 两端耗时对比写进验证输出（预期 :8110 快一个量级）。

- [ ] **Step 2: 线程预算观测**

对一个 ≥10 页扫描件发起 OCR，期间 `pidstat -t -p <erp-ocr uvicorn pid> 2 5`。
Expected: 活跃线程峰值 ≈ `workers × intra + 解释器/IO 常量`（远低于全核）。

- [ ] **Step 3: 文档同步**

`ARCHITECTURE.md`：版本 1.3.0、配置面表补七旋钮（含 `OCR_TEXT_LAYER_MIN_CHARS`）、文字层快速路径流程图、部署拓扑加 `erp-ocr :8110`、线程铁律、接管记录。
`CLAUDE.md`（Bash）：OCR 辅助服务段更新——`erp-ocr` PM2 :8110、`OCR_SERVICE_URL` 指向、`OCR_PORT/OCR_HOST` 参数化、低配机配置指针（`services/ocr/.env.example`）、文字层快速路径一句话说明。

- [ ] **Step 4: 终验**

Run: `cd water-erp/services/ocr && .venv/bin/python -m unittest discover` + `pm2 ls | grep erp-ocr` + `curl -s localhost:8110/health`
Expected: 全 PASS / online / 配置生效值正确。

- [ ] **Step 5: Commit**

```bash
git add water-erp/services/ocr/ARCHITECTURE.md
git commit -m "docs(ocr): v1.3.0 架构文档——配置面/快速路径/接管拓扑/线程铁律"
cd /home/asus/桌面/ERP && git add CLAUDE.md && git commit -m "docs: CLAUDE.md OCR 段同步——erp-ocr 独立实例接管(:8110)"
```
