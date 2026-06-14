# 功能落地审计：空壳模块与不完善功能清单

> 审计日期：2026-06-14
> 审计范围：`apps/api/src/` 全部 Service 层逐行审查 + 前端页面代码量验证
> 审计标准：不以后端有 API 端点或前端有页面 = 功能实现；以实际业务逻辑代码为准

---

## 一、标记为"AI"但实际是规则引擎/伪随机的模块

### 1.2 AI 供应商风险评分（`aiService.getSupplierRiskScores`）

- **文件**：`apps/api/src/ai/ai.service.ts` 第 409-430 行
- **问题等级**：🔴 严重 — 全部是伪随机数
- **现状**：
  - "文件完整性"分数 = `s.submitStatus === '已提交' ? 90 + (seed % 10) : 50 + (seed % 20)`
  - "历史履约"分数 = `75 + (seed % 20)` —— 与真实履约数据完全无关
  - 五个风险因子全部基于 `hashString(supplierName)` 生成
  - `confidence` 字段缺失
- **对外暴露的 API**：`GET /api/ai/projects/:projectId/risk-scores`
- **前端调用方**：管理后台风险监控
- **应实现**：对接真实供应商历史数据（中标率、履约评价、投诉记录、变更次数）+ 外部数据源


---

## 二、开标解密 — 不存在真正的加解密操作

### 2.1 标书解密（`bidService.decryptSupplier`）

- **文件**：`apps/api/src/bid/bid.service.ts` 第 311-384 行
- **问题等级**：🔴 严重 — 核心安全功能是空壳
- **现状**：
  - 整个"解密"过程就是三次数据库状态更新：`PENDING → RUNNING → SUCCESS`
  - 不执行任何实际的加密/解密运算
  - DANGER（解密失败）状态需要通过 `simulateDanger=true` 参数手动触发
  - 注释明确写的是 `// Phase 2: 模拟解密结果`
  - 真实系统中，此处应验证供应商上传投标文件的数字签名或解密加密标书
- **对外暴露的 API**：`POST /api/bid/projects/:id/decrypt/:supplierId`
- **前端调用方**：开标大厅"一键解密"按钮
- **影响**：开标过程的文件安全性形同虚设，所有供应商投标文件在上传时就是明文

### 2.2 归档 Hash Digest

- **文件**：`apps/api/src/bid/bid.service.ts` 第 585 行
- **问题等级**：🔴 中等
- **现状**：
  ```typescript
  const hashDigest = `sha256:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  ```
  - 不是真实的 SHA-256 哈希
  - 标注为 `sha256:` 前缀但实际是随机字符串
  - 每次归档生成的 digest 都不同（因为含 `Date.now()` 和 `Math.random()`）
- **应实现**：对归档文件内容计算真实的 SHA-256 哈希，确保防篡改

---

## 三、有 API 但功能不完整的模块

### 3.1 专家回避确认 — 无自动检测

- **文件**：`apps/api/src/expert/expert.service.ts` 第 130-139 行
- **问题等级**：🟡 中等
- **现状**：
  - `confirmAvoidance()` 只是把 `avoidanceConfirmed` 字段设成 `true`
  - 不对专家与供应商/项目之间的利益冲突做任何自动检测
  - 专家可以闭着眼睛点"确认无回避"，系统无条件接受
- **有部分补偿**：专家抽取时的合规过滤（`expert-admin.service.ts` 第 190-199 行）会检查 employer 名称是否与投标供应商名称包含匹配，但这只是简单的字符串比较
- **应实现**：
  - 自动比对：专家工作单位 vs 投标供应商名称/法人/股东
  - 历史合作关系检测
  - 亲属关系备案
  - 自动排除+通知+补抽

### 3.2 供应商资质管理 — 缺少主动到期通知

- **文件**：`apps/api/src/supplier-portal/supplier-portal.controller.ts` 第 76-93 行 + `supplier-portal.service.ts` 第 132-142、903-911 行
- **问题等级**：🟡 中等
- **现状**：
  - 资质模型已包含 `validFrom`/`validTo` 日期字段（`addQualification` 写入）
  - Dashboard Stats 已统计 30 天内即将到期的资质数量（`expiringQualifications`）
  - 但无主动通知/提醒机制：资质快到期时不会向供应商推送站内信、短信或邮件提醒
- **应实现**：到期前 N 天自动触发通知（至少站内信），通知供应商及时更新即将过期的资质证书

### 3.3 供应商绩效评价 — 仅基础打分

- **文件**：`apps/api/src/supplier/supplier.controller.ts` 第 195-207 行
- **问题等级**：🟡 中等
- **现状**：五维度评分 + A/B/C/D 等级，但：
  - 无自动聚合历史评价生成供应商画像
  - 无绩效趋势分析
  - 无自动淘汰/降级机制
  - 不与投标资格联动

### 3.4 专家绩效考核 — 仅基础统计

- **文件**：`apps/api/src/expert/expert-admin.service.ts` 第 320-349 行
- **问题等级**：🟡 中等
- **现状**：
  - 三维度评分（出勤/质量/纪律）+ A/B/C/D 等级
  - 有 `getEvaluationStats()` 统计各等级分布和均分
  - 但无自动退库机制、无评分偏离度与履职评价的关联分析

### 3.5 多渠道通知 — 仅有站内信

- **文件**：`apps/api/src/notification/notification.service.ts`
- **问题等级**：🟡 中等
- **现状**：完整的站内信系统（广播/个人/分页/已读），但无短信/邮件/企业微信等外部渠道
- **影响**：开标提醒、澄清通知、审批通知只能通过站内信触达，用户不登录就收不到

### 3.6 WebSocket 推送 — 仅在开标解密场景使用

- **文件**：`apps/api/src/bid/bid.gateway.ts`
- **问题等级**：🟡 低
- **现状**：BidGateway 在解密和阶段变更时推送，但评标进度、评分更新、澄清通知等场景无实时推送


### 需要补齐不完整功能的（P1）

| # | 模块 | 缺失部分 |
|---|------|---------|
| 5 | 专家回避 | 自动利益冲突检测 |
| 6 | 资质管理 | 到期预警 |
| 7 | 绩效评价 | 自动聚合+淘汰机制 |
| 8 | 通知系统 | 短信/邮件渠道 |
| 9 | WebSocket | 扩展覆盖场景 |

---

## 修复状态汇总（2026-06-14，分支 `fix/audit-gap-remediation`）

全部 9 项已修复，158 个单测通过、API 构建通过。逐项映射：

| 审计项 | 修复 | commit |
|--------|------|--------|
| 1.2 AI 风险评分伪随机 | ✅ 改为真实数据（履约均分/资质有效性/报价偏离预算/解密状态/文件完整度）+ `confidence` | `b7a761a` |
| 2.1 标书解密空壳 | ✅ `decryptSupplier` 接入真实完整性校验（读 MinIO 重算 SHA-256 比对 `FileAsset.sha256`，DANGER 由真实失败触发）；AES sealedKey 解密分支预留 | `6db4291` `739b12a` |
| 2.2 归档假 Hash | ✅ `computeArchiveDigest` 真实 SHA-256（归档项+项目元数据规范化） | `2f8f35f` |
| 3.1 专家回避无检测 | ✅ `ExpertConflictService` 单位名归一化匹配，`confirmAvoidance` 命中冲突即拦截 | `ab16939` |
| 3.2 资质到期无通知 | ✅ `SchedulerModule` 每日扫描 + 站内信（多渠道分发） | `9251083` |
| 3.3 供应商绩效不完整 | ✅ `aggregatePerformance` 画像 + 连续低分自动停用 + 通知 | `ea385d9` |
| 3.4 专家绩效不完整 | ✅ `computeExpertMeanDeviations` 偏离度 + 偏离度×履职等级关联 + 连续 D 级自动停用 | `e82bf98` |
| 3.5 仅站内信 | ✅ `NotificationChannel` 抽象 + Email(nodemailer/SMTP-gated) + SMS(桩) | `6d7bc54` |
| 3.6 WebSocket 覆盖不足 | ✅ 新增评分/澄清/评标进度推送，接入 submitScore/createClarification | `b557523` |

**遗留（可选后续）**：
- 2.1 Layer B 端到端：`submitBid` 写入 AES 封存密钥到 MinIO 封存对象（当前 Layer A 完整性校验已落地，sealedKey 解密分支已预留，见计划 Task 2-Extension）。
- 3.5 SMS 真实网关：当前为桩，`User` 表加 `phone` 字段后 `shouldDispatch('sms')` 自动生效。
- 3.6 `notifyEvaluationProgress` 已暴露为 gateway API，尚未接计算触发点（评标进度百分比变更时推送）。
