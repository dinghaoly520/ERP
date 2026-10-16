# 全项目文案整改（开发黑话 / AI 痕迹清除）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 清除 2026-10-16 全项目文案排查发现的用户可见开发黑话、内部代号、端口号、emoji 与 AI 供给链痕迹，共 6 个必做任务 + 1 个可选 CI 闸。

**Architecture:** 纯文案替换（前端 JSX 字符串 / 后端 error 文案 / 种子 JSON），不动任何逻辑、枚举与 `code` 错误码字段。按门户分组为 6 个独立可验证任务，每个任务一个 commit。

**Tech Stack:** Next.js 16 前端（5 门户）、NestJS 11 API、seed-data JSON。

**Spec:** 2026-10-16 全项目排查报告（本对话产出；全量发现已收录为本计划附录 A，计划自含）。

## Global Constraints

- **绝不改动 `code` 错误码字段与枚举值**（`NOT_DUAL_TRACK`/`EVALUATION_RESULTS_REQUIRED` 等是前后端分流契约；本对话已核实全部 e2e/spec 只断言 code 不断言文案）。
- 替换文案不引入新的英文术语；括号一律全角「（）」。
- **并行会话避让**：开工前 `git status`；当前工作区有 SCCA 会话未提交文件（`CLAUDE.md`、`apps/public-portal/src/components/unified-header.tsx`、`apps/supplier-portal-next/src/components/ca-opening-decrypt-card.tsx`、`apps/supplier-portal-next/src/utils/dual-v3-client*.ts`）——本计划与其**零交集**，commit 时只 `git add` 本任务清单内文件，禁止 `git add -A`。
- 每任务完成即 commit，message 前缀 `fix(copy):`；**不主动 push**（用户会另行指示）。
- **行号仅参考**：并行 SCCA 会话正在改部分文件（侦察时点已见行号漂移 ±4），实施时一律以「原文片段」rg 定位替换，勿盲行号跳转。
- 前端验证命令在 `water-erp/` 根运行：`pnpm --filter <app> lint`（app 名 = package.json name：`public-portal`/`bid-portal`/`web`/`supplier-portal-next`）。

## Review Focus

1. **误改错误码字段** → 每处替换只动引号内文案；Task 5 跑断言 code 的 spec 钉住。
2. **JSX 模板字符串改坏（引号/插值/标签闭合）** → Task 1-4 末尾 lint。
3. **删除登录页账号块伤及表单结构** → Task 1 lint + 可选浏览器冒烟 `http://localhost:3002/login`。
4. **seed JSON 手改破坏结构** → Task 6 用 `python3 -I -c "import json; json.load(...)"` 校验。
5. **漏网（同类词在计划外文件）** → 每任务 sweep rg + 附录 B 全局复验；长期回归 → 可选 Task 7 CI 闸（默认不做）。

---

### Task 1: 公共门户登录页删除「测试账号」块（P0-1）

**Files:**
- Modify: `apps/public-portal/src/app/login/page.tsx:58-61`

**Interfaces:** 无（纯删除）。

背景：该块明文展示 4 组测试口令，且 `caigou`/`supplier1`/`wangjg`/`mall` 在 `seed-data/User.json` 中**均已不存在**（双重问题：演示残留 + 失效信息误导）。

- [ ] **Step 1: 删除测试账号 div 块**

删除整个 `<div className="mt-4 p-3 bg-[oklch(0.992_0.003_264)] rounded-lg border border-[oklch(0.91_0.006_264)] text-[10px] ...">…测试账号…</div>`（含内部 `<strong>` 与账号文本，4 行）。

- [ ] **Step 2: 验证**

```bash
rg -n '测试账号' apps/public-portal/src && echo FOUND || echo CLEAN   # 期望 CLEAN
pnpm --filter public-portal lint                                        # 期望通过
```

- [ ] **Step 3: Commit**

```bash
git add apps/public-portal/src/app/login/page.tsx
git commit -m "fix(copy): 删除公共门户登录页失效测试账号块（演示残留+账号已不存在）"
```

---

### Task 2: bid-portal 文案整改（P0-2/P0-3/P1-6/P1-8/P1-9/emoji，5 文件 13 处）

**Files:**
- Modify: `apps/bid-portal/src/components/workspace/project-tabs.tsx:31`
- Modify: `apps/bid-portal/src/app/(dashboard)/bid/page.tsx:179`
- Modify: `apps/bid-portal/src/components/opening-hall.tsx:682,1099,1100`
- Modify: `apps/bid-portal/src/components/workspace/evaluation-view.tsx:571,1484,1505,1506,1556,2042`
- Modify: `apps/bid-portal/src/app/(dashboard)/bid/project/[id]/page.tsx:155,157`

**Interfaces:** 无。

- [ ] **Step 1: 逐处替换（原文 → 新文）**

| 行 | 原 | 新 |
|---|---|---|
| project-tabs:31 | 请在本工作区「评标管理」tab 启动评标（BID-P3-02，分工 v3：启动评标在本端）。 | 请在本工作区「评标管理」标签页启动评标（启动评标在本端办理）。 |
| bid/page:179 | 在本工作区「评标管理」tab 完成启动评标后，…（分工 v3：启动评标在本端）。 | 在本工作区「评标管理」标签页完成启动评标后，…（启动评标在本端办理）。 |
| opening-hall:682 | 请在本工作区对应 tab 操作 | 请在本工作区对应标签页操作 |
| opening-hall:718 | 启动评标请在本工作区「评标管理」tab 操作 | 启动评标请在本工作区「评标管理」标签页操作 |
| evaluation-view:571 | 可在「开标大厅」tab 回看 | 可在「开标大厅」标签页回看 |
| evaluation-view:1484 | （与后端闸门同口径，全部满足方可继续） | （以下条件须全部满足） |
| evaluation-view:1505 | （「报价轮次」tab） | （「报价轮次」标签页） |
| evaluation-view:1506 | 在「报价轮次」tab 关闭 | 在「报价轮次」标签页关闭 |
| evaluation-view:1556 | 与 :3005 评分标准/评标办法配置一致 | 与采购管理工作台的评分标准/评标办法配置一致 |
| evaluation-view:2042 | 将被后端拒绝（REOPEN_SIGN_PACKET_CLOSED）——先重开签字包 | 将被系统拒绝——请先重开签字包 |
| opening-hall:1099 | 记为异常（EXCEPTION），将计入开标记录 | 将记为「解密异常」，计入开标记录 |
| opening-hall:1100 | 已定性为解密异常（EXCEPTION） | 已定性为解密异常 |
| project/[id]:155 | `🔓 ${supplier.supplierName} 解密成功` | `${supplier.supplierName} 解密成功` |
| project/[id]:157 | `⚠️ ${supplier.supplierName} 解密失败` | `${supplier.supplierName} 解密失败` |

- [ ] **Step 2: 验证**

```bash
rg -n '分工 v[0-9]|BID-P[0-9]|（:300|:300[57][^0-9]|」tab|[一-龥] tab [一-龥]|（EXCEPTION）|🔓|⚠️' apps/bid-portal/src -g '*.tsx' \
  | rg -v ':\d+:\s*(//|\*|/\*|\{/\*)' && echo FOUND || echo CLEAN   # 期望 CLEAN（注释允许残留；tab 正则已避开 tab 变量名）
pnpm --filter bid-portal lint
```

- [ ] **Step 3: Commit**（只 add 上述 5 文件）`fix(copy): bid-portal 清除端口/工单代号/tab/错误码/emoji 外显`

---

### Task 3: web 工作台文案整改（P0-2/P0-3/P1-5/P1-6/P1-9/emoji/括号，7 文件 22 处）

**Files:**
- Modify: `apps/web/src/components/projects/bid-confirm-panel.tsx:1029`
- Modify: `apps/web/src/components/projects/bid-confirm/opening-progress-block.tsx:169`
- Modify: `apps/web/src/components/projects/bid-confirm/archive-block.tsx:198,215,217`
- Modify: `apps/web/src/components/projects/bid-confirm/supervision-push-block.tsx:239`
- Modify: `apps/web/src/components/expert/expert-evaluation-dialog.tsx:130,225,282,440,453`
- Modify: `apps/web/src/app/(main)/expert/[id]/page.tsx:642,908,939`
- Modify: `apps/web/src/components/tender-review/report-view-combined.tsx:435,454`
- Modify: `apps/web/src/components/tender-review/suggestion-editor.tsx:125,130,159,183`
- Modify: `apps/web/src/app/(main)/supplier/dashboard/page.tsx:552`
- Modify: `apps/web/src/components/projects/sunshine-platform-dialog.tsx:331,342,367,399-401,566`

**Interfaces:** 无（`engine === 'ai'` 判断分支保留原样，只改分支内文案）。

- [ ] **Step 1: 逐处替换**

| 位置 | 原 | 新 |
|---|---|---|
| bid-confirm-panel:1029 | 已在 :3007 开评标管理端现场办理 | 已在开评标管理端现场办理 |
| opening-progress:169 | 由开评标管理端（:3007）执行 | 由开评标管理端执行 |
| archive-block:198 | ——请在 :3007 评标签字 tab 完成后重试（完整归档闸门：…） | ——请在开评标管理端「评标签字」标签页完成后重试（完整归档条件：…） |
| archive-block:215 | 当前置闸门（评标签字闭环 + 评标回流包） | 当前置条件（评标签字闭环 + 评标回流包） |
| archive-block:217 | 归档会被拦截（EVALUATION_RESULTS_REQUIRED） | 归档将被拦截，请先生成评标结果 |
| supervision-push:239 | 推送结果不影响归档闸门——外部平台未接入时不阻塞完整归档 | 推送结果不作为归档前置条件——外部平台未接入时不影响完整归档 |
| expert-dialog:130 | 规则兜底已写入评价说明（AI 暂不可用） | 规则分析已写入评价说明（AI 暂不可用） |
| expert-dialog:225a | 徽标「规则兜底」 | 「规则分析」 |
| expert-dialog:225b | LLM 综合历史评价、偏离度… | AI 综合历史评价、偏离度… |
| expert-dialog:282 | （placeholder）规则兜底已填入参考说明 | 规则分析已填入参考说明 |
| expert-dialog:440 | '规则兜底'}完成 | '规则分析'}完成 |
| expert-dialog:453 | 'LLM' : '规则兜底' | 'AI' : '规则分析' |
| expert/[id]:642 | 规则兜底：{risk.ruleBrief} | 规则分析：{risk.ruleBrief} |
| expert/[id]（title 属性） | 专家库档案等级（A-129，区别于…） | 专家库档案等级（区别于…）（rg 定位：`（A-129，`） |
| expert/[id]:939 | 档案维度（A-129） | 档案维度 |
| report-view:435 | ✅ 未发现问题 | 未发现问题 |
| report-view:454 | ⬜ 不适用 / ✅ 通过 | 不适用 / 通过 |
| suggestion-editor:125,159,183 | ✏️ 修改意见 | 修改意见 |
| suggestion-editor:130 | ✅ 已修改 | 已修改 |
| supplier/dashboard:552 | 点击 ⭐ 即可关注 | 点击星标即可关注 |
| sunshine:331,342,367 | (公示内容，随公告正文) 等 | 全角（…） |
| sunshine:399-401,566 | (万元) ×4（含「招标金额/招标采购限额/公开采购限额」与 placeholder「投标金额(万元)」） | （万元） |

- [ ] **Step 2: 验证**

```bash
rg -n '（:300|:3007|A-1[0-9][0-9][，）]|规则兜底|LLM 综合|（EVALUATION_RESULTS_REQUIRED|✅|⬜|✏️|⭐|\(万元\)' apps/web/src -g '*.tsx' \
  | rg -v ':\d+:\s*(//|\*|/\*|\{/\*)' | rg -v '\*/}' && echo FOUND || echo CLEAN   # 期望 CLEAN（JSX 多行注释尾行以 */} 结尾已排除）
pnpm --filter web lint
```

- [ ] **Step 3: Commit** `fix(copy): web 清除规则兜底/LLM/闸门/端口/代号/emoji/半角括号外显`

---

### Task 4: supplier-portal 文案整改（P1-7 前端 + 括号 + 上线承诺，3 文件）

**Files:**
- Modify: `apps/supplier-portal-next/src/app/(main)/bids/[id]/round-quote/page.tsx:201,288,349`
- Modify: `apps/supplier-portal-next/src/app/(main)/bids/[id]/submit/page.tsx:272`
- Modify: `apps/supplier-portal-next/src/app/(main)/profile/page.tsx:252`

- [ ] **Step 1: 替换**

| 行 | 原 | 新 |
|---|---|---|
| round-quote:201 | 报价已提交(密封)，不可修改 | 报价已提交（密封），不可修改 |
| round-quote:288,349 | 报价(元) | 报价（元） |
| submit:272 | 平台尚未开放新轨投递通道，请联系管理员 | 新版加密投递通道尚未开放，请联系管理员 |
| profile:252 | 附件上传功能即将上线 | 附件上传功能暂未开放 |

- [ ] **Step 2: 验证**

```bash
rg -n '新轨|即将上线|提交\(密封\)|报价\(元\)' apps/supplier-portal-next/src -g '*.tsx' \
  | rg -v ':\d+:\s*(//|\*|/\*|\{/\*)' && echo FOUND || echo CLEAN
pnpm --filter supplier-portal-next lint
```

- [ ] **Step 3: Commit** `fix(copy): supplier-portal 清除「新轨」黑话/半角括号/上线承诺文案`

---

### Task 5: API 用户消息整改（P0-4 + P1-7 后端，3 文件 8 处）

**Files:**
- Modify: `apps/api/src/assistant/assistant.service.ts:197`
- Modify: `apps/api/src/supplier-portal/supplier-portal.service.ts:2065,2457,2504,2976,3190,3336`
- Modify: `apps/api/src/bid/bid-decrypt.service.ts:145`

**Interfaces:** Produces：error 文案变更、`code` 字段全部原样（`NOT_DUAL_TRACK` 等保持）。

- [ ] **Step 1: 替换**

| 位置 | 原 | 新 |
|---|---|---|
| assistant:197 | `抱歉，AI 服务暂时不可用：${(e as Error).message}。请检查 DeepSeek API Key 配置或稍后重试。` | `抱歉，AI 服务暂时不可用，请稍后重试。`（下一行 `this.logger.error` 已记录完整异常，保留不动） |
| sp:2065 | 旧轨（平台代解密）投递通道已关闭——请绑定 SCCA CA U盾后按双层信封（dual-v3）投递 | 原投递方式（平台代解密）已停用——请绑定 SCCA CA U盾，使用新版双信封加密投递 |
| sp:2457,2504 | 该供应商非 dual-v3 轨，请走对应补传通道 | 该供应商未使用新版双信封加密投递，请走对应补传通道 |
| sp:2976 | 旧轨项目请走主持端补传通道 | 该项目为历史投递方式，请走主持端补传通道 |
| sp:3190 | 该供应商走旧轨（单层）加密，无解密包 | 该供应商采用单层加密（历史投递方式），无解密包 |
| sp:3336 | 该供应商走旧轨（单层）加密，请走主持端解密通道 | 该供应商采用单层加密（历史投递方式），请走主持端解密通道 |
| bid-decrypt:145 | 该供应商走旧轨（单层）加密，无外层可解 | 该供应商采用单层加密（历史投递方式），无外层可解 |

- [ ] **Step 2: sweep 复核（防漏网）**

```bash
rg -n "error: '[^']*轨|DeepSeek API Key" apps/api/src -g '!**/*.spec.ts'   # 期望零命中（注释可留）
rg -c "NOT_DUAL_TRACK" apps/api/src/supplier-portal/supplier-portal.service.ts  # 期望仍为 5（code 未动）
```

- [ ] **Step 3: 跑受影响单测**

```bash
pnpm --filter api test -- assistant.service.spec.ts supplier-portal.service.spec.ts
# 若 apps/api/src/bid/ 下存在 bid-decrypt 相关 spec 一并跑：ls apps/api/src/bid | rg -i decrypt
```

期望：全绿（已核实这些 spec 只断言 code，不断言文案）。

- [ ] **Step 4: Commit** `fix(copy): API 用户消息去除 DeepSeek 运维泄漏与「轨/dual-v3」黑话（code 字段不动）`

---

### Task 6: 种子「某某」公司名（P2-15）

**Files:**
- Modify: `apps/api/prisma/seed-data/Notification.json`（7 处）

- [ ] **Step 1: 替换**

`某某外部建设有限公司` → `外部建设有限公司`（7 处 content；若用户偏好具体虚构名，替换前确认）。

- [ ] **Step 2: JSON 结构校验**

```bash
python3 -I -c "import json; json.load(open('apps/api/prisma/seed-data/Notification.json')); print('OK')"
```

- [ ] **Step 3:（可选，执行前须用户确认）存量 DB 同步**

`db:seed` 是破坏性重建，**不为此重跑**；对当前库执行等值替换：

```bash
docker exec -i $(docker ps -qf name=postgres) psql -U water_erp -d water_erp -c \
  "UPDATE \"Notification\" SET \"content\" = replace(\"content\", '某某外部建设有限公司', '外部建设有限公司') WHERE \"content\" LIKE '%某某%';"
```

- [ ] **Step 4: Commit**（只 add JSON）`fix(copy): 种子通知去除「某某」占位公司名`

---

### Task 7（可选，默认不做）: CI 文案巡检闸

**Files:**
- Create: `water-erp/scripts/copy-lint.sh`
- Modify: `.github/workflows/ci.yml`（validate job 追加一步）

内容：脚本用 `rg` 在五门户 tsx **非注释行**扫描禁词集（`:300[0-9]）|（:300|分工 v[0-9]|BID-P[0-9]|（A-1[0-9][0-9]）|规则兜底|」tab|（EXCEPTION）|🔓|⚠️|✅|⬜|✏️|⭐|即将上线`），命中 exit 1。注意：脚本内 rg 无注释行过滤能力，可用两遍 rg 管道（同本计划各任务验证命令的写法）；交互 shell 的 grep 是 ugrep 函数、方言不同，脚本一律显式 `rg` 或 `/usr/bin/grep`。
**执行前提：用户裁定是否要此闸**（误报风险：合法含 emoji 的场景目前为零，但未来可能引入）。

---

## 裁定不改清单（用户已确认或属诊断场景）

- `ca-selftest-dialog.tsx`（wss://localhost:36171、GM/T 0010）——CA 诊断工具，受众带 IT
- `account-management-panel.tsx:1336`（127.0.0.1 本地回环）——admin 系统管理页
- `platform-push.service.ts:155`（端点路径提示）——admin 监管推送
- `bid-sign-packet-docx.service.ts:351`「降级」——P3 可选：若改，「异常/降级/替换留痕」→「异常/转人工核验/替换留痕」，需用户裁定（签字包为法定纸面证据件）
- `about/page.tsx`「重要抓手」——政公文用语，非开发黑话
- work-arrangements `TODO` 枚举——仅内部键，展示层已映射中文「待办」

## 附录 B: 全局终验命令（Task 1-6 完成后跑一次）

```bash
cd water-erp
rg -n '测试账号|分工 v[0-9]|BID-P[0-9]|（A-1[0-9][0-9]）|（:300|规则兜底|LLM 综合|（EXCEPTION）|🔓|⚠️|✅|⬜|✏️|⭐|即将上线|非 dual-v3 轨' apps -g '*.tsx' \
  | rg -v ':\d+:\s*(//|\*|/\*|\{/\*)' && echo "FOUND-REVIEW" || echo ALL-CLEAN
rg -n "error: '[^']*轨|DeepSeek API Key" apps/api/src -g '!**/*.spec.ts' && echo FOUND || echo API-CLEAN
```

（期望 `ALL-CLEAN` / `API-CLEAN`；`已定性为解密异常`等纯文字处无码即通过。）
