# 麒麟内网服务器本地 AI 底座部署设计（bge-m3 + Qwen3-4B · llama-server × 2 · 同镜像双容器）

- **日期**：2026-10-30
- **状态**：草案（待用户批准）
- **需求来源**：用户口头需求 + 代码勘察（2026-10-30 会话，经四轮选型迭代收敛）
- **决策输入**（用户已拍板）：无 GPU 纯 CPU；服务器只跑后端/模型服务；**完全内网隔离**（DeepSeek 云不可达，所有 AI 流量走本地）；本地 LLM 需支撑全部四类 AI 功能（招标文件 AI 审查/RAG、AI 投标分析长文档、公告/驾驶舱摘要、水叮当助手对话）；**主力 LLM = qwen3:4b-instruct-2507**；**推理栈 = llama-server × 2（同镜像两容器）**——Ollama / infinity / Xinference 均经用户裁定出局（理由留档 §4.1）

---

## 一、背景与意图

公司分配后端服务器：**麒麟 V10 SP3 · x86_64 · 8 核 CPU · 32G 内存 · 无 GPU · 完全内网隔离**。ERP 生产部署后，其两条 AI 依赖链必须由内网自建服务承载：

| 链路 | 性质 | 内网化后果 |
|------|------|-----------|
| **Embedding（bge-m3）** | **硬依赖**：pgvector 列锁 `vector(1024)`（bge-m3 维度），tender-review RAG「缺一即无法使用」；`VllmMonitorService` 探针 3 连败即判 offline → `embed()` 503 | 必须有常驻、稳定、**维度恒 1024** 的 OpenAI 兼容 embedding 服务 |
| **LLM（本地小模型）** | **软依赖（无阻塞项）**：助手/摘要/AI 投标分析/AI 审查全部经 `LlmService`，失败即降级，不阻主流程 | 用一个 CPU 可跑的小型 Instruct 模型承接全部 LLM 流量，接受质量/速度降级 |

> 「bge3」按 **bge-m3** 理解并锁定——换任何非 1024 维模型需 pgvector 迁移 + 全量向量重建，反目标。Qwen 家族 embedding 型号（如 Qwen3-Embedding-0.6B 恰为 1024 维）也不换：同维 ≠ 同向量空间，存量数据作废且与开发机不同源。

## 二、目标 / 非目标 / 反目标

**目标**
1. 麒麟服务器上以 **llama-server 两个容器（同一镜像、不同模型/端口）** 分别承载 bge-m3（embedding，:8003）与 qwen3-4b（chat，:8080），各自暴露 OpenAI 兼容端点（`/v1/embeddings` 或 `/v1/chat/completions` + `/v1/models`）。
2. ERP 侧以**纯 env 切换**接入（`DEEPSEEK_BASE_URL` / `EMBEDDING_BASE_URL` 指向内网地址），代码改动收敛为 `llm.service.ts` 一处 URL 处理修复。
3. 全流程**离线交付**：镜像 tar + 两个 GGUF + runbook，从能出网的机器一次性搬运。
4. 32G 内存下与（现在或将来）同机 ERP 后端共存：每容器独立内存硬上限。

**非目标**
- OCR 微服务（`services/ocr`，RapidOCR CPU）同机容器化——另一任务，可复用本配方；
- ERP 本体（API/DB/门户）部署编排（`deploy/` 目录另行）；
- LlmService 多 provider 抽象重构——只做最小修复；
- DeepSeek 云主备切换——内网隔离，不存在主备。

**反目标**
- 不引入带调度层/模型管理层的推理平台（Ollama/Xinference 类）——固定两模型，平台税负资产；
- 不上 vLLM-CPU——其优势（PagedAttention、连续批处理）是 GPU 现象，8 核低并发下兑现不了且运维面大；
- 不做容器内双进程（supervisor）——变更域/故障域/OOM 隔离全部耦合；
- 不追求与云端 DeepSeek 的质量对齐；不动 pgvector 1024 维契约。

## 三、约束盘点（代码勘察结论）

### 3.1 代码契约（已核实）

1. **LLM 单点收口成立**：全部 LLM HTTP 流量（ai / ai-bid-analysis worker / assistant / announcement-ai / expert-* / supplier-*，25+ 调用点）都注入 `local-ai/LlmService`；散落各文件的 `DEEPSEEK_*` env 直读均只用于**展示/溯源/配置存在性检查**，无旁路 HTTP。改一处，全局生效。
2. **Embedding 契约**（`embedding.service.ts`）：`POST {EMBEDDING_BASE_URL}/embeddings`，OpenAI 格式 `{model, input: string[]}`，批 32；`EMBEDDING_API_KEY` 可选 Bearer。
3. **探针契约**（`vllm-monitor.service.ts`）：每 5 分钟 `GET {base 去 /v1}/v1/models`，模型 id 模糊匹配（`id === expected || id.includes(expected) || expected.includes(id)`），3 连败判 offline。**服务端必须有 `/v1/models`**（llama-server `--alias` 满足；TEI 无此端点，出局）。注意：探针仅 embedding 侧带 Bearer（`EMBEDDING_API_KEY`），LLM 侧探针不带头——故 chat 容器不设 `--api-key`。
4. **LLM 请求特征**：OpenAI chat 格式；`chatJson` 大量使用 `response_format: {type:'json_object'}`（llama-server 映射为 JSON grammar 强制，合法率反而高于自由生成）；默认 `maxTokens 16384`、`timeoutMs 180s`；重试/并发由 `LLM_MAX_RETRIES`（2）/`LLM_MAX_CONCURRENCY`（10）驱动；读 `message.content`（qwen3-2507 Instruct 纯非思考，无 `reasoning_content` 干扰）。

### 3.2 代码级阻塞点（内网接入必改，P0）

`local-ai/llm.service.ts` 的 `deepseekRequest` 为 DeepSeek 云定制：

| 问题 | 现状 | 后果 |
|------|------|------|
| 协议硬编码 | `https.request(...)` | `http://` 内网端点被当 https 握手 → 失败 |
| 端口硬编码 | `port: 443` | `http://ip:8080` 的端口被忽略 → 连到 443 |
| `/v1` 被剥 | 构造器 `.replace(/\/v1$/, '')` | llama-server 的 OpenAI 端点在 `/v1/chat/completions`，剥掉后 404 |

**修复细则**（最小改动）：
- 构造器：`baseUrl` 只去尾斜杠，**保留 `/v1`**（DeepSeek 云两种路径都兼容，回归无虞）；
- `deepseekRequest`：按 `new URL()` 取 `protocol`（http/https 分派 `http`/`https` 模块）与 `port`（`url.port || (https?443:80)`），`family: 4` 保留；
- 把「base URL → 请求 URL/协议/端口」抽成**纯函数导出**，`llm.service.spec.ts` 加本地端点用例（http + 自定义端口 + /v1 保留 + 云端两种写法回归）。

### 3.3 硬件/环境约束

- 纯 CPU 推理：8 核，两服务线程预算 4+6；上下文与并发必须克制（见 §五/§七）。
- 内网隔离：镜像与 GGUF 离线导入；无 DNS/公网依赖。
- 麒麟内核 4.19 + cgroup v1：常规 amd64 容器可跑；llama.cpp 官方镜像为 Ubuntu 基（CPU 构建），不依赖新内核特性。

## 四、方案选型（四轮迭代终态）

### 4.1 推理栈

| 候选 | 结论 | 理由 |
|------|------|------|
| **llama-server × 2（选定）** | ✅ | 同一引擎（llama.cpp = CPU 上最快的 int4 内核）、单二进制零 Python、全参数显式（无隐藏默认值，行为确定）、`--mlock` 钉内存、`--api-key` 可选鉴权、静态交付最轻。embedding（BERT 类 encoder + `--pooling cls`）与 chat 同栈，运维心智单一 |
| Ollama | ❌（用户否决） | 引擎同为 llama.cpp 分支，硬化配置后效率与 llama-server 在噪声级内，但平台层（模型换入换出调度、版本升级改默认值的行为漂移、可观测性弱）是生产形态负资产 |
| infinity（michaelfeil/infinity） | ❌（用户放弃） | embedding 专用高吞吐（ONNX 动态批处理）优于 llama.cpp encoder 路径，但本项目 RAG 索引是突发异步、量级小，用不满；且引入 Python 栈破坏同栈收敛 |
| Xinference | ❌ | 模型生命周期围绕在线拉取设计，离线导入逆纹理；平台层 = 又一笔 Ollama 式平台税；chat 走 llama-cpp-python 反而比原生 llama-server 慢一层 |
| vLLM-CPU | ❌ | 优势全是 GPU 现象；8 核上单流 decode 普遍慢于 llama.cpp；~8G 镜像 + AVX512 赌注 + 内存 +2-3G。开发机 :8003（vLLM on GPU）方案不可搬 |
| TEI | ❌ | 无 `/v1/models`，探针必挂 |

**同镜像两容器 vs 单容器双进程（用户裁定前者）**：

| 维度 | 同镜像两容器（选定） | 单容器双进程 |
|------|--------------------|-------------|
| 变更域 | chat 换档/调参独立重启，embed（1024 维锁死永不变）零感知 | 任一变动 = 双断 |
| 故障域/OOM | 各自 `--memory`；chat 异常膨胀不伤 embed | 同 cgroup，OOM killer 可能杀掉无辜 embed |
| 进程管理 | docker `--restart` 白捡 | 容器内自建 supervisor = 换个地方再交平台税 |
| 日志/健康 | 单源干净；HEALTHCHECK 一容器一探针 | 混流加前缀；探针只能探一个 |
| 成本 | 仅多一行 `docker run`/一行 `docker ps` | — |

> 裸机等价形态（静态二进制 + systemd × 2）可完全不依赖 docker；本设计按用户原始诉求走 docker 形态。

### 4.2 模型选型

- **Embedding**：`bge-m3` F16 GGUF（~2.3G，1024 维，与开发机 vLLM fp16 数值同源——cosine ≈1，存量 pgvector 向量可混用）。`--pooling cls`，`--ctx-size 8192`（对齐开发机 `--max-model-len 8192`）。
- **LLM 主力**：`qwen3:4b-instruct-2507`（Q4_K_M ~2.5G，用户 2026-10-30 裁定，替代初稿 qwen2.5:7b）。2507 Instruct 为**纯非思考版**（无思维链，`message.content` 直出，无思维链耗尽 max_tokens 的截断风险）；JSON/中文能力与 Qwen2.5-7B 同档；8 核上 decode ~15-25 tok/s（约 7B 的 1.5-2 倍）；权重省 ~2.2G。`--ctx-size 32768`（原生 32K 稳态/256K YaRN）。
- **KV 缓存量化是内存节省的落袋前提（必配）**：Qwen3-4B 架构 36 层 × 8 KV 头，**每 token KV（fp16 ~148KB）反而高于 Qwen2.5-7B（~57KB）**——32K ctx 的 fp16 KV ≈ 4.6G，会把权重省下的内存吃回去。必配 `--cache-type-k q8_0 --cache-type-v q8_0 --flash-attn on`（KV 减半至 ~2.3G，2026-10-30 本机实测可用），模型常驻即 ~4.8G（实测精确吻合）。若目标机构建上 FA 不可用，回退 = `--ctx-size 16384`。
- GGUF 来源：**bge-m3 开发机已有**——`/home/asus/models/bge-m3`（HF 格式，`pytorch_model.bin` 2.2G，与 :8003 vLLM 同一份权重，2026-10-30 核实），用 llama.cpp `convert_hf_to_gguf.py` 就地转 F16 GGUF（只取 dense 主干，colbert/sparse 头不带——与 vLLM 服务口径一致；同源权重，§5.4 cosine 比对天然成立）；qwen3-4b Q4_K_M 下载源已定（2026-10-30 实测核实）：**unsloth 镜像 · ModelScope 国内直连**（`unsloth/Qwen3-4B-Instruct-2507-GGUF`，单文件 Q4_K_M ~2.33G——Qwen 官方 GGUF 仓库在 HF 为 gated、ModelScope 无同名仓库）。

## 五、服务器侧部署设计

### 5.1 交付物（全部离线制作，scp 进内网）

| 件 | 制作方法 | 目标 |
|----|---------|------|
| `llamacpp-server-image.tar`（数百 MB） | 能出网机器：`docker pull ghcr.io/ggml-org/llama.cpp:server`（2026-10-30 实测核实：**官方不发布 avx2/avx512 变体 tag**，CPU 镜像即 `server`，内含多内核运行时分发）→ 验证通过后以 **digest 锁定**（`docker inspect` 取 RepoDigests）→ `docker save` | `docker load -i` |
| `bge-m3-f16.gguf`（~1.1G，实测 2026-10-30） | **开发机本地转换**：`/home/asus/models/bge-m3`（已有，HF 格式）→ `convert_hf_to_gguf.py` 转 F16 | 放 `/data/models/`（只读挂载） |
| `qwen3-4b-instruct-2507-Q4_K_M.gguf`（~2.33G） | ModelScope unsloth 镜像直连下载 | 同上 |
| runbook + 两条启动脚本 | **入库** `water-erp/deploy/ai-kylin/`（版本管理） | — |

### 5.2 两容器运行

> 双轨交付（2026-10-30 补）：`emd_llm/docker-compose.yml` 为等价编排（`docker compose config` 校验，command token 与 run 脚本逐一对齐；`pull_policy: never` 只认离线 load 进来的镜像）。目标机有 compose 插件走 compose，没有则 run 脚本兜底——**不把 compose 当硬依赖**（麒麟 docker-engine 发行包不一定带 v2 插件，内网机装插件麻烦）。

```bash
# ① 向量服务 bge-m3（:8003，呼应开发机端口习惯）——flags 已本机实测（见 §5.5）
docker run -d --name erp-embed --restart always \
  -p 8003:8003 -v /data/models:/models:ro \
  --memory=5g --cpus 4 --ulimit memlock=-1 \
  ghcr.io/ggml-org/llama.cpp:server \
  -m /models/bge-m3-f16.gguf --embedding --pooling cls \
  --alias bge-m3-erp --ctx-size 8192 --threads 4 --load-mode mlock \
  --host 0.0.0.0 --port 8003 --api-key <EMBED_KEY>

# ② 生成服务 qwen3-4b（:8080）——注意：不设 --api-key（VllmMonitor LLM 探针不带 Bearer，见 §3.1-3）
docker run -d --name erp-llm --restart always \
  -p 8080:8080 -v /data/models:/models:ro \
  --memory=10g --cpus 6 --ulimit memlock=-1 \
  ghcr.io/ggml-org/llama.cpp:server \
  -m /models/qwen3-4b-instruct-2507-Q4_K_M.gguf \
  --alias qwen3-4b-erp --ctx-size 32768 \
  --cache-type-k q8_0 --cache-type-v q8_0 --flash-attn on \
  --parallel 1 --threads 6 --load-mode mlock \
  --host 0.0.0.0 --port 8080
```

参数理由：`--mlock` 钉内存防换页；`--parallel 1` 单槽（KV 最省，并发排队交给 `LLM_MAX_CONCURRENCY`）；线程 4+6 合计 ≤8 核；独立 `--memory` 上限互为故障隔离；embed 侧 `--api-key` 与 `EMBEDDING_API_KEY` 同值形成最小鉴权（探针侧支持 Bearer）。ERP 后端若同机，可改 `-p 127.0.0.1:8003:8003` + docker 网络直连。

### 5.3 防火墙（两端口）

```bash
firewall-cmd --permanent --add-rich-rule='rule family=ipv4 source address=<ERP后端IP>/32 port port=8003 protocol=tcp accept'
firewall-cmd --permanent --add-rich-rule='rule family=ipv4 source address=<ERP后端IP>/32 port port=8080 protocol=tcp accept'
firewall-cmd --reload
```

### 5.4 服务器侧验收（首验闸——不过不进下一步）

```bash
curl -H "Authorization: Bearer <EMBED_KEY>" http://127.0.0.1:8003/v1/models            # 列出 bge-m3-erp
curl -H "Authorization: Bearer <EMBED_KEY>" http://127.0.0.1:8003/v1/embeddings -d '{"model":"bge-m3-erp","input":["测试"]}' | jq '.data[0].embedding | length'   # =1024
curl http://127.0.0.1:8080/v1/models                                                    # 列出 qwen3-4b-erp
curl http://127.0.0.1:8080/v1/chat/completions -d '{"model":"qwen3-4b-erp","messages":[{"role":"user","content":"回复OK"}],"max_tokens":8}'
docker stats --no-stream                                                               # 实测基线：embed ~1.2G / llm ~4.8G（本机，§5.5）；llm 显著超出=KV 量化未生效
```
另抽样比对（换任何 embed 服务端都躲不掉的校验点）：同一段文本在开发机 vLLM bge-m3 与麒麟 llama-server 的向量 **cosine > 0.999 且模长口径一致**（归一化语义影响 pgvector 内 cosine/dot 查询）。

### 5.5 本机验证记录（2026-10-30，开发机，交付物即此版本）

开发机按 §5 流程全量验证通过（容器 :18003/:18080，验证后已清理；`emd_llm/` 目录为交付暂存区，ERP 开发调用链零改动）：

| 项 | 结果 |
|----|------|
| 镜像 | `ghcr.io/ggml-org/llama.cpp:server`，digest `sha256:01c2bc28d51291536df2ccebe5c6af1cdec9ea9b2bd98ac59556408caf96d3f8`，save tar **295M**（dist/） |
| 向量一致性 | 4 段文本（中文/混合/领域）cosine **0.999989~0.999993**，双侧模长均 1.0000（归一化口径一致）——存量 pgvector 混用零风险 |
| embed 验收 | `/v1/models` id=bge-m3-erp ✓ · 维度 1024 ✓ · 裸访问 401 ✓ |
| LLM 验收 | 对话正常（法条回答正确，finish=stop）· `response_format json_object` 返回合法 JSON ✓（chatJson 契约成立） |
| 内存实测 | embed **1.21G**/5G · llm **4.80G**/10G（与 §4.2 预算精确吻合 → KV q8_0 生效证据） |
| 吞吐实测 | prefill 52-74 tok/s · decode ~10 tok/s（6 线程；8 线程仅 +8% → 内存带宽瓶颈非核数瓶颈，维持 4+6 分配） |
| flags 修正实录 | ① `--mlock` 已被移除 → `--load-mode mlock`；② `--flash-attn` 需带值 `on`（裸写被拒）；③ 容器须 `--ulimit memlock=-1`（默认 RLIMIT_MEMLOCK 64MB 锁不住权重）；④ llm 侧一个 726MB 匿名缓冲 mlock 失败属内核 overcommit 启发式，非致命（权重本体已锁） |
| GGUF 校验 | bge-m3-f16 1.1G sha256 `48cedb…fc5f` · qwen3 Q4_K_M 2,497,281,120B sha256 与 ModelScope 元数据一致 |

## 六、ERP 侧改动设计

### 6.1 代码（P0，一个小 PR）——✅ 已落地（2026-10-30，本机验证 25/25 + 全量 3509 绿）

1. `local-ai/llm.service.ts`：按 §3.2 修复（协议/端口/`/v1` 保留，抽纯函数）。
2. `local-ai/llm.service.spec.ts`：新增 URL 构造用例（本地 http + 自定义端口 + /v1 保留；云端 `https://api.deepseek.com` 与 `.../v1` 两写法回归）。

**验收**：`pnpm --filter api test -- llm.service` 绿 + CI validate 绿；开发机 .env 不变（云端行为回归）。

### 6.2 生产 .env（麒麟/ERP 后端机）

```ini
DEEPSEEK_BASE_URL=http://<麒麟IP>:8080/v1
DEEPSEEK_MODEL=qwen3-4b-erp
DEEPSEEK_API_KEY=local-llama           # 占位非空（空则 LlmService 视为未配置）；chat 容器未设 --api-key，忽略 Bearer
EMBEDDING_BASE_URL=http://<麒麟IP>:8003/v1
EMBEDDING_MODEL=bge-m3-erp
EMBEDDING_API_KEY=<EMBED_KEY>          # 与 erp-embed 容器 --api-key 同值
LLM_BASE_URL=http://<麒麟IP>:8080/v1   # VllmMonitor 健康页探针（展示）
LLM_MODEL=qwen3-4b-erp
LLM_MAX_CONCURRENCY=2                  # CPU 队列防打爆（默认 10 会积压）
LLM_MAX_RETRIES=2                      # 不变
```
> 改 .env 后**API 与 ai-bid worker 双进程都要重启**（既有口径）。模型名必须与 `/v1/models` 的 `--alias` 完全一致——模型名拼错=全库分析秒败的既有教训。

### 6.3 已知需要放宽的紧超时调用点——✅ 已放宽（2026-10-30 落地，全量 3509 绿）

| 位置 | 现值 | 建议 |
|------|------|------|
| `expert-admin.service.ts:829` | `timeoutMs: 15_000, retries: 1` | 放宽到 90-120s（prefill 计入耗时；或该功能内网环境降级关闭） |
| `expert-extraction-ai.service.ts:181` | `timeoutMs: 90_000, retries: 1` | 放宽到 240s |
| 其余调用点 | 默认 180s | 首轮实测后再定；ai-bid 长文档若频超时，对 processor 调 `LlmCallOptions.timeoutMs` |

## 七、资源预算（32G）

| 项 | 常驻内存 | 上限 |
|----|---------|------|
| erp-embed（GGUF 1.1G + encoder 计算缓冲） | ~2-2.5G | `--memory=5g` |
| erp-llm（权重 2.5G + 32K KV q8_0 ~2.3G + 缓冲） | ~5-5.5G | `--memory=10g`（给 KV 量化失效留缓冲） |
| **两容器合计** | **~8.5-9G** | 15G 硬顶 |
| 预留：同机 ERP 后端（PG+Redis+MinIO+API+worker） | ~10-12G | — |
| OS/页缓存 | 余量（~10G+） | — |

磁盘：GGUF ~3.5G（bge 1.1G + qwen 2.33G）+ 镜像数百 MB，放 `/data` 分区。CPU：embed 4 线程 + chat 6 线程（突发并发时轻微超订由 OS 调度，可实测后微调）。

## 八、验证清单（分层，实施时逐项打勾）

1. **服务器首验闸**：§5.4 全部 curl + `docker stats` 内存实测 + 向量 cosine/模长比对。
2. **ERP 健康**：系统健康页 VllmMonitor `llm.online=true`、`embedding.online=true`（5 分钟探针周期）。
3. **四功能冒烟**：
   - 水叮当助手对话（:3008 / 移动端第四 Tab，多轮）；
   - 公告 AI 摘要重新生成 + 驾驶舱今日要报；
   - ai-bid 投标分析：对一个已有项目 rerun，worker 日志/DB 状态走完 COMPLETED，`aiProvenance` 快照 model=qwen3-4b-erp；
   - tender-review：一次语义审查问答（embedding+LLM 双链路同时打到）。
4. **降级路径**：`docker stop erp-llm` → LLM 功能报错但不阻断主流程、embedding 不受扰；`docker stop erp-embed` → RAG 报 503、LLM 不受扰；`docker start` → 探针 5 分钟内自愈。

## 九、风险与已知取舍

| 风险 | 评估/缓解 |
|------|----------|
| CPU 吞吐低（并发 1，长任务分钟级） | 所有 LLM 功能本就异步/可降级（无阻塞项定位）；`LLM_MAX_CONCURRENCY=2` 排队 |
| llama.cpp encoder 路径 embedding 吞吐 < 专用 server | 本项目量级（突发异步索引 + 低频查询）无感；契约是 OpenAI `/v1/embeddings`，真遇瓶颈换专用服务也仅是改 env 的事 |
| `-fa`（CPU flash attention）构建可用性 | 首验闸必查；不可用回退 `--ctx-size 16384` |
| 向量口径（归一化/池化）与开发机不一致 | §5.4 cosine + 模长双比对是硬闸 |
| 小模型 JSON 遵从度 | Qwen3-4B-Instruct-2507 JSON 能力与 7B 同档 + llama-server grammar 强制 + `chatJson` 围栏剥离/首尾{}/重试三重兜底 |
| 麒麟 4.19 内核兼容 | 常规 amd64 容器无碍；异常时换 `server`（generic 内核）镜像 tag |
| chat 容器无 `--api-key` | 探针限制所致（§3.1-3）；防火墙白名单兜底，embed 侧有钥 |
| 模型冷启动 | 容器启动即加载（无懒加载语义），`--restart always` 兜底；重启后首请求慢属预期 |

## 十、留给实施者的决定 / 后续路线

- **实施时定**：镜像 tag/digest 与 avx2/avx512 变体（`/proc/cpuinfo` 判定）；qwen3 GGUF 下载源（HF/ModelScope）与 bge-m3 转换环境（开发机现有 python venv 装 llama.cpp 转换脚本依赖即可）；`<麒麟IP>`/`<ERP后端IP>`/`<EMBED_KEY>` 具体值；`-fa` 可用性实测。
- **P2（本轮不做）**：两档模型路由（`LlmCallOptions.model` 管道已具备——4B 主力后优先级降低）；OCR 微服务同机容器化；`deploy/ai-kylin/` 之外的全栈部署编排。
- **明确不做**：见 §二非目标/反目标。
