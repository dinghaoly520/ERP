# 在线开标大厅（迭代一）手工验收清单

代码层已全部闭合（最终评审合并就绪），本清单验收浏览器视觉效果与真实交互。

## 0. 准备

```bash
cd water-erp
# 确保 :4001 跑的是 feat/bid-opening-hall-impl 的代码（若是旧会话实例需重启）
pnpm dev:api & pnpm dev:supplier & pnpm dev:bid
```

**账号**：
- 供应商 A：`四川水发建设有限公司` / `supplier@2026`（:3004）
- 供应商 B：`中科院成都信息技术股份有限公司` / `supplier@2026`（:3004 另一浏览器/隐身窗）
- 主持人：`陈源远` / `陈源远@2026`（:3007，bid_host）

**造数**（英雄项目置为开标中 + 两家待确认；验收后执行还原 SQL）：

```sql
UPDATE "BidProject" SET stage='OPENING' WHERE id='cmqhero-bid-proj01';
UPDATE "BidSupplier" SET "confirmStatus"='PENDING', "checkInAt"=NULL
  WHERE "projectId"='cmqhero-bid-proj01' AND "supplierName" IN ('四川水发建设有限公司','中科院成都信息技术股份有限公司');
UPDATE "BidOpeningRecord" SET "confirmStatus"='待供应商确认', "confirmedAt"=NULL,
  "objectionReason"=NULL, "handledAt"=NULL, "handleResult"=NULL
  WHERE "projectId"='cmqhero-bid-proj01' AND "supplierName" IN ('四川水发建设有限公司','中科院成都信息技术股份有限公司');
-- 还原：
UPDATE "BidProject" SET stage='EVALUATING' WHERE id='cmqhero-bid-proj01';
UPDATE "BidSupplier" SET "confirmStatus"='CONFIRMED' WHERE "projectId"='cmqhero-bid-proj01' AND "supplierName" IN ('四川水发建设有限公司','中科院成都信息技术股份有限公司');
UPDATE "BidOpeningRecord" SET "confirmStatus"='供应商已确认' WHERE "projectId"='cmqhero-bid-proj01' AND "supplierName" IN ('四川水发建设有限公司','中科院成都信息技术股份有限公司');
```

---

## A. 核心闭环（供应商 A + 主持人双端同开）

| # | 步骤 | 通过标准 |
|---|------|---------|
| A1 | 供应商 A 登录 :3004 → 投标进展 → 英雄项目 | 「进入开标大厅」按钮可见（仅 OPENING 显示） |
| A2 | 进入大厅 | 状态卡（解密成功/唱标金额/工期/待供应商确认）+ 种子公聊历史 2 条 + 私聊种子 1 条（私聊 tab） |
| A3 | 供应商 A 点「签到」 | 供应商侧显示已签到时刻；**主持端会场交流抽屉花名册实时出现「四川水发 ✓签到」** |
| A4 | 供应商 A 公聊发一条 → 主持端公聊出现；主持端公聊回一条 → 供应商侧实时出现 | 双向实时，无刷新 |
| A5 | 主持端切「私聊」tab → 点水发 chip → 发私聊 | 供应商侧「与主持人私聊」tab 角标 +1，点入见消息 |
| A6 | 主持端交流控制切「禁言」 | 供应商侧输入框禁用 + 「主持人已开启全员禁言」；切「关闭」→「主持人已关闭互动」；切「开放」恢复 |
| A7 | 供应商 A 点「确认开标记录」→ 确定 | **主持端 toast + 解密表/开标记录表确认列即时变化**（不止 toast） |
| A8 | （造数重置水发为待确认后）供应商 A「提出异议」填原因 → 主持端 toast（含原因）→ 主持端处理（维持/退回） | 供应商侧实时出现处理结果提示；记录状态更新 |

## B. Wave 3 细节

| # | 步骤 | 通过标准 |
|---|------|---------|
| B1 | 主持端页面**下滚**后打开会场交流抽屉 | 抽屉相对视口固定（不随卡片滚走），**头部「开放/禁言/关闭/✕」完整可点**（C2） |
| B2 | 打开唱标录入模态（z-50）同时抽屉开着 | 模态盖在抽屉之上（层级正确） |
| B3 | **中文输入法**打字，Enter 确认候选词（双端各测） | 候选确认**不发送**；非组合态 Enter 正常发送（U1，Chromium 重点） |
| B4 | 供应商停留「私聊」tab，主持端连发 3 条公聊 | 公聊角标 = 3（**不是 6**）（C3） |
| B5 | 主持端快速连点 3 家供应商私聊 chip（可 DevTools 节流 Slow 3G 加大窗口） | 最终会话只显示**最后一家**的消息，无串话（R2/N3） |
| B6 | 停 API（或 DevTools 断网）→ 刷新供应商大厅 | 全宽错误态 + 重试按钮；恢复后重试加载成功（U7）；单独令 profile 失败 → 仅右栏会话错误卡、左栏正常 |

## C. Wave 4b 细节

| # | 步骤 | 通过标准 |
|---|------|---------|
| C1 | 观察聊天面板连接徽标 | 绿「实时已连」；断网后橙「重连中…」（自动重连，红态窗口很短或不可见属设计）（R10） |
| C2 | 供应商大厅切后台 tab 30s（期间主持端发 2 条公聊）→ 切回 | 自动重连 + **补齐这 2 条**，无丢失无重复（R3） |
| C3 | 供应商 A、B 同时在公聊发言（对方视角） | 对方消息**不是**蓝色"我发的"气泡（U3 按 senderId 判定） |
| C4 | 把英雄项目置 EVALUATING 后看供应商「投标进展」 | 按钮消失，逾期未确认行显示分态文案（PENDING→逾期未确认 / DISPUTED→异议待处理 / EXCEPTION→异议已处理）（U4/M3） |
| C5 | 断网状态点供应商端发送/签到/提交来函 | 弹「网络异常或请求超时，请检查网络」（U5 收口，不再静默）；附件上传失败不双弹窗（M2） |
| C6 | 书面交流附件：拖入第 2 个文件 / 上传中点提交 | 超限提示「仅支持 1 个附件」；上传中提交按钮禁用（U6） |
| C7 | 主持端 CLOSED 态 | 抽屉输入框禁用 + 提示（U11） |
| C8 | 主持端双击异议「处理」按钮 | 仅一次生效（submitting 锁）；对已处理记录再点 → toast「该异议已被处理」（M9） |
| C9 | 非 OPENING 项目打开抽屉（造数或找评标中项目） | 输入框**初始即禁用**（阶段初值同步，不等首次 403）（M5/Wave5-6） |
| C10 | 主持端切项目（抽屉开着切 ?id=） | 抽屉状态全量重置，无上一项目消息/花名册残留（U8）；弱网下切项目公聊区不混入上一项目消息（I2） |

## D. Wave 5 专项（需造数）

| # | 步骤 | 通过标准 |
|---|------|---------|
| D1 | 造 >100 条公聊（脚本批量 POST /opening-hall/.../messages）→ 重开抽屉/大厅 | 显示最新 100 条升序，**尾部无乱序**（窗口外旧消息不追加尾部）（N4） |
| D2 | 供应商 API 直调：把记录置「异议已处理-退回」+ bidSupplier EXCEPTION 后 POST opening-confirm | 400 RECORD_NOT_CONFIRMABLE（API 防线，UI 已门控）（Wave5-1） |

```bash
# D1 造数示例（host cookie）
for i in $(seq 1 105); do curl -s -X POST http://localhost:4001/api/opening-hall/cmqhero-bid-proj01/messages \
  -H "Cookie: $HOST_COOKIE" -H 'X-Portal: web' -H 'Content-Type: application/json' \
  -d "{\"roomType\":\"PUBLIC\",\"content\":\"批量消息 $i\"}" -o /dev/null; done
```

## E. 存证抽查

| # | 步骤 | 通过标准 |
|---|------|---------|
| E1 | 主持端导出归档包 JSON（或 `GET /api/bid/projects/cmqhero-bid-proj01/archive-package/export?format=json`） | `sections.hallMessages` 含公聊+私聊；`hashChain.sectionDigests.hallMessages` = `sha256(JSON.stringify(sections.hallMessages))`（node crypto 复算）；改一条 content 复算失配（S2） |
| E2 | 导 CSV（format=csv） | 含「=== 开标大厅消息 ===」段；发一条 `=1+1 探针` 再导 → CSV 内为 `"'=1+1 探针"`（前置单引号中和，Excel 不求值）（S3/CSV 注入） |
| E3 | 监督端（监督视图）「大厅交流」区 | 公聊 + 按供应商私聊留痕只读可见；监督日志含签到/交流控制/异议前后态迁移记录 |

## F. 安全抽查（可选，命令行）

```bash
# 匿名连接被拒（C1）：预期 ack {"error":"UNAUTHORIZED"} 且收不到任何广播
node -e "const {io}=require('socket.io-client');const s=io('http://localhost:4001/bid');
s.on('connect',()=>s.emit('join:project','cmqhero-bid-proj01',a=>console.log('ack:',JSON.stringify(a))));
s.on('hall:message:new',d=>console.log('泄露!',d.content));setTimeout(()=>process.exit(0),3000)"
# 专家跨项目被拒（S1）：用未指派专家的 token_expert cookie 同上 → NOT_ASSIGNED_EXPERT
```

---

**全部通过** → 迭代一验收完成，PR #44 可合并。**任一不通过** → 记录项编号反馈，定向修复。
