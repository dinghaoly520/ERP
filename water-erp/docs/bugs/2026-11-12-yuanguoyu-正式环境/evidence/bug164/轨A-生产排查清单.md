# bug#164 轨A · 生产排查清单（B 机 10.60.14.14）

> 生成：2026-11-12 ｜ 排查人：在生产机操作的用户 ｜ 目标：拿到 tender 分析失败的真实错误文本，对因处置。
> 背景：task=FAILED 全仓唯一写点=`tender.processor.ts:210` catch（worker 真跑真抛错，非 worker 未运行）；失败原因只进 ai-worker 容器日志，不落库。

## 第 0 步 · 现状确认（1 分钟）

正式环境 :3007 打开 SWHI-TP-2026110902（1109谈判采购002）→ 评标管理 tab，看 AI 辅助评标卡当前文案：

- 仍是「招标文件处理失败」→ 继续（错误还在场）
- 变成「分析完成」→ 期间 recreate 已修复，走复验即可关票
- ⚠️ **注意**：截图评标时限截止 2026/11/12 15:42:58（今天下午，已过）。超时闸只拦结果链（submitScores/confirmReport/generateEvaluationResults → 409 EVALUATION_OVERDUE），**不拦重新分析**；但若后续要生成评标结果，需先 `extend-evaluation`（监督+审计留痕）。

## 第 1 步 · 拿真实错误（最关键）

```bash
docker ps | grep -Ei 'worker|api'          # 找 ai-worker 容器名（compose 前缀）
docker logs <ai-worker容器名> --since 720h 2>&1 | grep -B2 -A8 'Failed tender for task'
```

- 有命中 → 错误文本直接定案，按第 2 步对号入座
- 无命中（日志轮转丢了）→ 让它再失败一次：:3007 点「重新分析」，立即 `docker logs <ai-worker容器名> -f` 盯 `Processing tender for task` 到 `Failed tender`

## 第 2 步 · 按错误文本对因入座

| 错误文本特征 | 根因 | 处置 |
|---|---|---|
| `DeepSeek`/`LLM`/`chat`/`fetch failed`+api.deepseek.com/超时 | **LLM 不可达**（tender-extractor.service.ts:20 chatJson 硬依赖）——B 机麒麟内网出不了外网或 key/模型名失效 | `docker exec <ai-worker容器> printenv \| grep -iE 'deepseek\|llm\|vllm'` 核 env；B 机 `curl -v https://api.deepseek.com` 验连通；不通则改指内网 vLLM 或配代理 |
| `OCR`/`8110`/`8100`/`ECONNREFUSED` | OCR env 指错——OCR 2026-11-04 起自管 PM2 **:8110**，若 env 仍指 :8100 必挂 | `docker exec <容器> printenv \| grep -i ocr`；B 机 `curl -s http://localhost:8110/health`；改 `OCR_SERVICE_URL=http://10.60.14.14:8110` 后 recreate |
| `pdftotext`/`ENOENT`/`spawn` | worker 镜像缺 poppler-utils，扫描件全量降级 OCR（叠加上条即双重死） | 镜像补 `poppler-utils`（参照打包脚本重建）；临时可先修 OCR env |
| `P2xxx`/`Prisma`/`column`/金仓报错 | **金仓枚举比较 bug 生产未修**（AiAnalysisTaskStatus 是枚举——KStudio 枚举修复 dev 已布 **prod 待执行**，在册欠账） | 跑金仓枚举修复 DO 块（kingbase-kstudio-enum-operator-fix 在册配方） |
| `KMS_SECRET`/`FIELD_ENC`/`seal`/解封类 | 密钥失配（参照 11-05 PII 密钥失配排障法） | 核 `FIELD_ENC_SECRET` 指纹（crypto-health-report）；OperationLog error 字段佐证 |
| 其他 | 拿到文本再判 | 带回票修会话分析 |

## 第 3 步 · 部署新鲜度核对（若第 2 步对上已知 bug）

`docker ps --format '{{.Names}}\t{{.CreatedAt}}'` 看 api/ai-worker 容器创建时间。**在册待部署/待执行欠账**（已推未确认生效）：

- 11-09 收口：`7c52438da`（knowledge 浮动 rejection 崩 worker）/`80058638a`（专家退库）等 → 须 recreate api+ai-worker
- 金仓枚举比较修复（prod 待执行）
- 短信对账迁移 `20261110060000`（prod 待跑）
- `c58fa58ef` 专家导入归属 sync（用户暂停中）

## 第 4 步 · 处置后复验（关票证据）

1. recreate 对应容器（操作单：docs 容器时区+NTP 2026-11-10）
2. :3007 → SWHI-TP-2026110902 评标管理 tab → 点「重新分析」（二次确认）
3. 观察卡片：招标文件处理中 → 逐家分析中 → 3s 轮询至完成（0/3 → 3/3 家，或部分失败可单家重试）
4. 截图存 `evidence/bug164/`，报告人（曾大乖）确认 → 禅道关单

> 排查结果（真实错误文本/处置动作）请带回票修会话：决定是否需要轨 B（失败原因落库可见化的代码改进）或就此关单。
