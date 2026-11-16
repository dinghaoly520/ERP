# 设计：bge-m3 :8003 与 erp-ocr :8110 收编进 pnpm dev 启动链

**日期**：2026-11-16 · **状态**：已获用户确认（会话内裁定）

## 意图与背景

procurement 项目（`~/桌面/procurement`）已停用。其 PM2 托管的 bge-m3 嵌入 vLLM（`:8003`，ERP 的 RAG/tender-review 硬依赖）失去宿主；ERP 自管 PM2 的 `erp-ocr`（`:8110`）同样随 PM2 退役失去宿主（`pm2-asus.service` 已 inactive）。目标：两者收编进 `pnpm dev` 一键启动链，PM2 层从 dev 工作流彻底退役。

venv（`/home/asus/vllm_venv`）与模型（`/home/asus/models/bge-m3`）均为机器级路径，不受 procurement 停用影响。

## 目标 / 非目标

- ✅ `pnpm dev` 同时拉起 OCR `:8110` 与 bge-m3 `:8003`，且**崩溃自动重启**（保住 OCR watchdog 自杀→拉起语义）
- ✅ `pnpm dev:kill` 全链清理覆盖两个新端口与守护器进程
- ✅ PM2 轨退役（删 `services/ocr/ecosystem.config.js`），文档同步
- ❌ 生产拓扑零改动（B 机 OCR=Docker；`apps/api/.env` 两个 URL 不动）
- ❌ 不新增常驻基建（无新 systemd/PM2 单元、无新依赖）

## 关键裁定

1. **推翻 `ecosystem.config.js`「勿并入 pnpm dev」注释的前提**：当时理由是 concurrently 不会重启子进程——加 shell 守护循环（`while` + 崩溃延迟重启 + TERM 整链退出）后语义等价 PM2 autorestart，前提消除。
2. **守护器通用化**：`scripts/dev-supervise.sh <label> <port> <delay_s> <cmd...>`，OCR 与 embedding 共用（对齐 `dev-api-guard.sh` + selftest 先例）；端口已占用则让位 exit 0（幂等，残留实例仍可用）。
3. **`start.sh` 默认端口 8100→8110**（ERP canon；procurement 停用后 8100 是陷阱）。
4. **dev:kill 扩清**：端口 +`8003`+`8110`；cmdline 扫杀 `*dev-supervise.sh*`（先杀守护器再清端口，防 10s 后孤儿复活抢端口）；`--api` 模式**不**杀守护器（保「只清 :4001」语义）。
5. **配套用户操作**：`sudo systemctl disable pm2-asus.service`（system 级 enabled，不 disable 则下次重启复活 procurement 全家桶抢 `:8003`/`:4000`）。

## 否决路线

- ERP 独立 PM2/systemd 单元：违背「并入 pnpm dev」的明确要求。
- Docker 化挂 `infra:up`：dev 改代码须重建镜像、GPU 直通复杂、vLLM 镜像体积大。

## 验收口径

OCR 崩杀→5s 内自动重启；`/health` 200。embedding `/v1/models` 含 bge-m3、embeddings 返回 1024 维（模型加载分钟级，轮询超时 180s）。全链 `pnpm dev` 后 13 端口全监听（3002/3004-3008/3010/3011/4001/8003/8110），`pnpm dev:kill` 清干净。守护循环契约由 `dev-supervise.selftest.sh` 三用例锁定（端口让位 / 崩溃重启 / TERM 不复活）。
