# 开评标流程全面审查 · 修复清单

- **审查日期**：2026-07-25
- **分支**：`feat/bid-opening-hall-impl`
- **审查范围**：开评标全链路 —— 后端 `apps/api/src/bid`（状态机/解密/唱标/异议/评分/评标/归档）、`bid-portal`(:3007 任务板+开标大厅)、`web`(:3005 开标确认面板)、关联模块（`announcement`/`supplier-portal`/`upload`/`opening-hall`/`common/crypto`/`bid.gateway`）
- **审查方法**：6 个独立 agent 分片并行精读 + 主审对 5 个最关键单 agent 发现亲自源码复核（全部 CONFIRMED）+ 多 agent 交叉印证去重
- **审查维度**：① 需求完整性 ② 逻辑正确性 ③ 边界情况 ④ 前端 UI/交互 ⑤ 安全/权限 ⑥ 代码质量
- **性质**：只读审查，未改动任何业务代码

> 印证标记：`【已复核】`= 主审亲自读源码确认；`【N×印证】`= N 个独立 agent 命中同一缺陷。两者可信度最高。

---

## 执行摘要

开评标流程的**总体架构是健康的**：信封加密原语正确（随机性/IV/AEAD 均无误）、阶段流转 100% 收口在 :3005（:3007 无任何流转调用，总则贯彻到位）、WS 连接认证与房间隔离的既有修复（C1/S1）属实、评分标准锁定与幂等较彻底、设计系统大体合规。历史 F1–F15/Wave1–3 修复多数已落地。

但存在**一批围绕"不可逆终局动作把关不严"与"并发/状态机一致性"的真实缺陷**，最严重的几项：

- 并发竞态可绕过状态机棘轮，**已归档项目可被复活为评标中**（C1，已复核）
- 解密"失败掩盖"：**部分投标文件缺失仍判解密成功**，绕过完整性校验（H1，已复核）
- **废标撤销被评标结果重算静默推翻**，管理员撤销不产生持久效力（H2，已复核）
- 「启动评标」「开标归档」两个不可逆流转**与"开标完成"完全脱钩**，可永久切断未解密供应商（H4/H5，3×印证）
- **异议处理可绕过供应商确认环节**直接改判，把已确认供应商踢出评标（H6，3×印证）

**统计**：Critical→High 1 · High 11 · Medium 27 · Low 30+（详见分级清单）。

**最高优先级（建议第一波）**：C1、H1、H2、H4、H5、H6、H7（数据正确性与不可逆终局把关）。

---

## 一、Critical / High（数据正确性 · 不可逆终局 · 安全核心）

### C1. 并发竞态绕过状态机棘轮——已归档项目可被"复活"为 EVALUATING 【已复核】
- **维度**：逻辑正确性 / 并发
- **位置**：`bid.service.ts:663`（事务外 assert）、`:686-690`（事务内 `FOR UPDATE` 后无条件 `update stage`）；`openSubmission`/`startOpeningInternal`/`archiveAll` 同模式（`:489,531,1762` assert 在事务外）
- **问题**：所有流转端点为"事务外读 stage + assert → 事务内无条件 UPDATE"。`startEvaluation` 的 `FOR UPDATE`（注释明示仅为"与评分标准编辑互斥"）拿到锁后**不复查 stage**，assert 在锁之前。
- **触发**：项目 OPENING。管理员 A 点「归档」、B 点「启动评标」，两者事务外都读到 OPENING、都通过 assert；A 先提交→ARCHIVED，B 随后获锁无条件写 EVALUATING → **已归档项目复活**。复活后 `submitScore` 继续可写分、AI 任务入队，而归档包哈希链已按 ARCHIVED 固化，数据全面错位。`openSubmission × startOpening` 竞态则产生"stage=SUBMIT 但 session 已建"的不一致态。
- **修复方向**：事务内 `FOR UPDATE` 后**重跑 assert**，或改条件更新 `UPDATE ... WHERE id=? AND stage=?` + rowCount 校验（不符抛 409）；四个流转端点统一执行。

### H1. 解密"失败掩盖"——部分投标文件缺失仍判 SUCCESS，绕过 Layer A 完整性校验 【已复核】
- **维度**：逻辑正确性 / 边界
- **位置**：`bid.service.ts:948-987`
- **问题**：文件遍历（technical→business→coverLetter）中，某文件 asset 缺失只 `errorMsg=…; break`（`:952`），**不重置**此前文件已置位的 `decryptOk=true/integrityOk=true`。判定式 `errorMsg && integrityOk!==true && decryptOk!==true`（`:985`）因残留 `integrityOk===true` 为假 → 落入 `classifyDecryptOutcome` 判 **SUCCESS**。MinIO 读取异常分支（`:970`）同理。
- **触发**：首份技术文件解密+完整性通过，次份商务/报价文件缺失（见 H7 供应商可自行删除）→ 仍判"解密成功"，缺失文件被静默忽略，评委会基于不完整投标评审，且无异常告警。
- **修复方向**：任一文件失败即整体失败——`!asset` 与 catch 分支强制 `integrityOk/decryptOk=false`（或引入 `allFilesOk` 标志）；补单测覆盖"首文件成功+次文件缺失"。

### H2. 废标撤销被评标结果重算静默推翻——`revokeInvalidBid` 不产生持久效力 【已复核】
- **维度**：逻辑正确性 / 需求完整性
- **位置**：`bid.service.ts:2839-2892`（revokeInvalidBid）vs `:1257-1294` + `:1344-1355`（generateEvaluationResults 权威重算）
- **问题**：`revokeInvalidBid` 只改 `BidInvalidBid.status='revoked'` + 恢复 `bidValidity='valid'`，**不触碰底层 `BidScoreRecord.passed` 投票**；而 `generateEvaluationResults` 的废标判定直接从 `passed` 原始投票重算（不读 `BidInvalidBid`），其事务内"权威重算 bidValidity"还会用重算结果**覆盖**撤销时写入的 `valid`。
- **触发**：专家投不通过票→实时判废→管理员在 reportConfirmed 前撤销→专家确认报告→主持人生成结果：原始不通过票仍在，供应商**被再次判废**、`bidValidity` 重置回 invalid、排名沉底。管理员撤销被静默推翻，"reportConfirmed 前可逆"实际无法影响终局。
- **修复方向**：`generateEvaluationResults` 判废时排除 `BidInvalidBid.status='revoked'` 的 (supplier,scoreItem)（或以 BidInvalidBid 为权威源）；撤销后触发/提示重算排名。

### H3. 删除公告裸重置 stage 不清理下游产物——可凭陈旧数据跳步直达评标 / 重投新标书永不开封 【已复核】
- **维度**：边界情况 / 需求完整性
- **位置**：`announcement.service.ts:243-275`（仅重置 stage+riskNote+解绑 document）；`bid.service.ts:666-683`（startEvaluation 前置）、`:881-883`（SUCCESS 重复解密保护）
- **问题**：删除公告把 EVALUATING/OPENING 项目裸重置回 DOWNLOAD（刻意设计），但 `BidOpeningSession`、`BidSupplier.decryptStatus=SUCCESS`、`confirmStatus`、`BidExpert.reportConfirmed`、`BidScoreRecord`、`BidEvaluationResult` 全部保留。棘轮允许跳步使陈旧数据成为"合法"准入凭证。
- **触发**：(a) 评标中→删公告→DOWNLOAD→直接 `startEvaluation`（跳步合法）：专家数✓/可评供应商✓/评分标准✓全用旧轮数据通过，`reportConfirmed` 闸门也被陈旧确认放行，用上一轮分数"生成"本轮结果；(b) 管理员延期 deadline 后供应商重投，`submitBid` 不重置 `decryptStatus`，`:881` 对 SUCCESS 一律拒绝重复解密 → **新加密标书永不开封**，系统沿用上一轮唱标/确认记录。
- **修复方向**：重置时级联失效下游产物（清 session、解密/确认复位、评分与 reportConfirmed 作废、删评标结果）；或对 OPENING 之后禁止裸重置，改走"废标重招"显式新 round。

### H4. 「启动评标」可用性与「开标完成」完全脱钩——不可逆切断未解密供应商 【3×印证】
- **维度**：逻辑正确性 / 需求完整性
- **位置**：后端 `bid.service.ts:657-683`（前置仅要求 ≥1 家 SUCCESS）；前端 `web/.../evaluation-block.tsx:285-296`（按钮仅 `disabled={busy}`，横幅文案却称"开标完成后可启动"）；:3007 `open/page.tsx:212-222` 与 `opening-progress-block.tsx:71-77` 的 `openingDone` 仅供展示未参与把关
- **问题**：后端 `startEvaluation` 不校验开标完成度（解密全处理+唱标全覆盖+确认闭环+无悬置异议）；前端按钮无 gating。`openingDone` 在两端口径一致但纯装饰。
- **触发**：OPENING 阶段 3 家仅 1 家解密成功即点「启动评标」→ stage=EVALUATING；:3007 大厅 OPENING-only，剩余供应商的解密/唱标/确认**永久切断且 EVALUATING→OPENING 回退 409 不可逆**。未确认供应商还被 `generateEvaluationResults`（`:1216-1218` CONFIRMED 过滤）无声排除出候选人。
- **修复方向**：后端 `startEvaluation` 至少加"无 DISPUTED 悬置异议 + 未撤回供应商均终局态"守卫（否则 409 列明名单）；前端把 `openingDone` 传入做 gating，或仿归档弹二次确认列出"未解密/未确认/异议未决"清单。（注：业务文档要求"开标完成后进入评标"，CLAUDE.md 明示棘轮可跳步——需先对齐口径。）

### H5. 「开标归档」无完成度保护——前端二次确认是软告警仍可确认，防误终局不彻底 【2×印证】
- **维度**：边界情况 / 逻辑正确性
- **位置**：后端 `bid.service.ts:1774-1779`（scope=opening 唯一守卫 `stage≥OPENING`）；前端 `web/.../archive-block.tsx:234-256`（F15 进度告警仅文字提示，确认按钮未禁用）
- **问题**：commit 84392690 的修复（确认框动态展示开标进度）只是**展示性告警**——即使 `confirmed<total`、解密进行中，「确认归档」仍可点。后端对 scope=opening 无任何完成度保护，防误终局 100% 依赖一次点击。
- **触发**：开标进行中连点「开标归档→确认归档」→ 项目永久终局（ARCHIVED 拒一切离开），无法再启动评标或继续开标。
- **修复方向**：进度显示开标未完成时要求勾选"我确认开标已终止"复选框才启用确认键。注意流标/废标场景正当需要在开标中归档，故增强摩擦而非硬拦截。

### H6. 异议处理无记录状态前置——可绕过供应商确认环节直接改判，踢出已确认供应商 【3×印证】
- **维度**：安全/权限 / 逻辑正确性
- **位置**：`bid.service.ts:1146-1193`；`bid.controller.ts:175-181`
- **问题**：`resolveOpeningDispute` 仅加 OPENING 阶段门控，**不校验记录是否真处于"供应商提出异议"**，对任意记录（待确认/已确认/已处理）都能写"异议已处理-确认/退回"并联动翻转 `BidSupplier.confirmStatus`。叠加：schema 有 `handledBy` 列却从不写入、无 AuditLog、监督日志只记固定角色"开标主持人"（无法追溯操作者）；controller body 是内联接口无 class-validator 元类型 → ValidationPipe 完全跳过，`confirm:"false"`（字符串真值）会被判"确认"分支。
- **触发**：(a) 记录尚处"待供应商确认"，主持人 `confirm=true` → 供应商毫不知情即被 CONFIRMED，供应商侧确认链路形同虚设；(b) 供应商**已确认**的记录被 `confirm=false` 打回 → CONFIRMED 改 EXCEPTION，已确认供应商被踢出评标。监督日志统一记作"处理开标异议/中风险"，审计失真。
- **修复方向**：仅 `供应商提出异议/DISPUTED` 可 resolve；写入 `handledBy=actorId` + AuditLog；body 改 DTO 类（`@IsString @IsNotEmpty result`、`@IsBoolean confirm`）；"主持人代确认"如必要应独立端点单独留痕。

### H7. 供应商可在提交后任意删除自己的投标 FileAsset——无引用检查/无阶段门控 【与 H1 组合升级】
- **维度**：安全 / 边界
- **位置**：`upload/upload.service.ts` `delete()`（"上传者本人或 admin/bid_host 可删"分支）；schema `SupplierBidSubmission.*FileAssetId` 为裸 `String?` 无外键
- **问题**：`DELETE /upload/:key` 允许上传者删除自己上传的文件（MinIO 对象 + FileAsset 行），不检查是否已被 `SupplierBidSubmission` 引用、不检查项目阶段。
- **触发**：截标后删商务文件资产：与 H1 组合 → 解密误判 SUCCESS；若删 technical（遍历第一份）→ 解密 DANGER 产生"高风险"异常，等于绕过正式撤回流程实现"伪装成技术故障的截标后撤回"，备份核验（sealed 仍在）与解密状态自相矛盾，争议举证复杂化。
- **修复方向**：delete 前检查 FileAsset 是否被已提交的 SupplierBidSubmission 引用（或项目已 SUBMIT 之后）则拒绝；或加外键 RESTRICT。

### H8. 解密被后端拒绝时前端完全静默——核心执行动作无反馈 【前端，与后端闸门印证】
- **维度**：逻辑正确性 / 边界
- **位置**：`bid-portal/.../open/page.tsx:255-257`（单条）`:263`（批量 `.catch(()=>{})`）；后端 `bid.service.ts:893-902`（前置闸门错误在置 RUNNING 前 throw，不发 WS）
- **问题**：单条解密把 HTTP 错误整个吞掉，注释称"error handled by WebSocket update"，但后端 `PROJECT_NOT_OPENING/OPENING_NOT_STARTED/DECRYPT_WINDOW_NOT_OPEN/CLOSED/ALREADY_DECRYPTED` 均在置 RUNNING **之前** throw，`notifyDecryptStatus` 只在 SUCCESS/DANGER 路径调用。
- **触发**：解密窗口关闭（倒计时归零后按钮仍可点，见 L 项）或窗口未开时点「解密」→ 行内 spinner 转一下消失 → 无 toast/无状态变化 → 反复点击无果，误以为系统卡死。
- **修复方向**：catch 中读 `ApiError.message`/code 弹 toast；窗口关闭后前端禁用解密按钮。

### H9. 实时断连对用户完全不可见 + 重连后无状态补偿——stale 数据静默驱动终局按钮 【前端 2×印证】
- **维度**：WebSocket 生命周期 / 需求完整性
- **位置**：`bid-portal` `connection-indicator.tsx`（整文件死代码）、`bid-realtime-context.tsx:30`、`(dashboard)/layout.tsx`（未挂 `BidRealtimeProvider`）、`use-bid-websocket.ts:166-185`；`web/.../bid-confirm-panel.tsx:165`（丢弃 hook 返回值）
- **问题**：连接状态指示链路整体断路——`BidRealtimeProvider` 从未被挂载，`useReportRealtime` 写入默认 context 的 no-op，`ConnectionIndicator` 无任何引用（F 系列指示器在 Phase 3 重构后成孤儿）。同时：切后台再回来只重连 socket、不 refetch 项目；开标大厅整页无手动刷新；web 面板丢弃 `connection/reconnectNow/lastEventAt`，无连接指示、无轮询兜底。
- **触发**：网络抖动/切 tab 期间发生的解密成功、供应商确认、异议全部错过；回来后表格陈旧，无红点/横幅/刷新按钮，只能 F5。开标现场可能误判"没有供应商解密成功"，进而误触发 H4/H5 的终局流转。
- **修复方向**：补挂 `BidRealtimeProvider` + 挂载 `ConnectionIndicator`；`connect` 成功/visibility 恢复后触发一次全量 `loadProject()`；大厅与面板加手动刷新；OPENING/EVALUATING 阶段加 30s 兜底轮询或展示"最后同步时间"。

### H10. 封标后原始明文对象永久留存——静态加密形同虚设
- **维度**：安全（保密设计完整性）
- **位置**：`supplier-portal/supplier-portal.service.ts:595-601`（注释明确"do not overwrite original plaintext"）
- **问题**：封标将密文写入 `sealed/...` 新路径，`asset.key` 处的投标明文对象永久保留。API 层虽以 `decryptStatus=SUCCESS` 门控明文下载，但存储层明文始终存在。
- **触发**：MinIO 凭证泄露、桶配置错误、备份外泄等任一存储层失陷场景下，所有投标文件可被直接读取，信封加密（CLAUDE.md 定义的"投标保密性核心"）完全不生效——攻击者无需碰 sealedKey/KMS。
- **修复方向**：封标事务成功后删除（或覆写为随机数据）原始明文对象，下载统一走 sealed 解密流；若必须保留，至少对 `asset.key` 做服务端加密（Track C 字段 encryptionKeyId/iv/authTag 目前是未接线的死字段，可启用）。

### H11. 唱标录入可覆盖已确认记录——主持人单方修改报价默认生效 【2×印证】
- **维度**：逻辑正确性
- **位置**：`bid.service.ts:1113-1131`（无条件 `update`，payload 固定 `confirmStatus:'待供应商确认'`，不重置 `BidSupplier.confirmStatus`）；前端 `open/page.tsx:820-821`（提交按钮无防重）
- **问题**：供应商已确认（bidSupplier.confirmStatus=CONFIRMED）后，主持人再次录入并修改报价 → 记录回到"待供应商确认"，而供应商侧仍 CONFIRMED。`generateEvaluationResults`（`:1216-1218`）只看 `bidSupplier.confirmStatus==='CONFIRMED'` → 该供应商继续以"已确认"身份参评，但开标记录上的新报价从未经供应商确认。
- **触发**：等于主持人单方修改报价默认生效；供应商端 UI 出现"已确认的记录又变待确认"状态回退。叠加无防重 + 后端 `BidOpeningRecord` 无唯一约束（见 M1）可产生重复记录。
- **修复方向**：已处于"供应商已确认/异议已处理-确认"的记录禁止覆盖（或覆盖时同步重置 bidSupplier.confirmStatus=PENDING 重走确认闭环）；每次修改写 AuditLog；前端加 submitting 态禁用按钮。

---

## 二、Medium（一致性 · 边界 · 权限 · 体验）

### 并发与幂等
- **M1. 并发产生重复开标记录**【3×印证】：`BidOpeningRecord` 仅 `@@index([bidSupplierId])` 无唯一约束；`decryptSupplier`（`:875-883`）SUCCESS 防护无 `FOR UPDATE`、解密成功无条件 create（`:1007-1021`）、`enterOpeningRecord` check-then-act（`:1123-1131`）。双击/批量并发 → 同一供应商两条唱标记录进归档包，`getMyOpeningRecord`(findFirst) 只认其一，确认状态错位。**修**：解密事务对 BidSupplier 行 `FOR UPDATE`；`BidOpeningRecord` 增 `@@unique([projectId,bidSupplierId])` 兜底。
- **M2. session/archive 项 check-then-act 并发 P2002→500**：`bid.service.ts:569-584`（session findUnique→create/update）、`:1663-1668`（ensureArchiveItems 同款）。"同阶段幂等写"在并发下退化为一方 500。**修**：改 `upsert` + 捕获 P2002 回退 update。
- **M3. 解密在交互事务内做 MinIO I/O + 提交前发 WS**：`bid.service.ts:874→955-956`（事务内 getObject+解密），`:938/992-997`（commit 前 gateway 通知）。50MB 文件易触发 Prisma 5s 事务超时回滚；DANGER 分支先推送后写库，回滚则前后端状态背离。**修**：文件下载/解密/校验移出事务（先算 outcome 再短事务落库），WS 通知挪到提交后。

### 状态机 / 终局
- **M4. 供应商可对已确认/已处理记录重复提异议**：`supplier-portal.service.ts:869-900` `disputeOpening` 无条件 `updateMany` 翻回"供应商提出异议"，不查当前状态、不要求 `decryptStatus===SUCCESS`、`reason` 内联 body 无校验（非字符串→500，无长度上限）。与 H6 叠加形成"确认⇄异议"无限翻转。**修**：限定仅"待供应商确认"可提异议；reason 用 DTO 校验。
- **M5. 单条解密不排除已撤回供应商**：`bid.service.ts:873-902`（无 submitStatus 校验）对比 `:850-853`（decryptAll 过滤"已撤回"）。任一角色可解密已撤回供应商封标并生成开标记录，违反撤回语义与保密预期。**修**：decryptSupplier 入口增 `submitStatus==='已撤回'` 拒绝。
- **M6. archiveAll scope 组合漏洞**：`bid.service.ts:1774-1785,1803`。EVALUATING 可走 scope=opening 归档静默终结评标（跳过评标结果守卫、评分材料不入档、无废标理由留痕）；full 守卫 `confirmableCount>0 && resultCount===0`，confirmable=0 时无任何评标结果也能"完整归档"。**修**：EVALUATING 走 opening 归档强制要求废标理由；full 对零评标结果单独设闸门。
- **M7. updateProject/syncFromAnnouncement 无阶段门控**：`bid.service.ts:452-473,420-450`。归档后仍可改 name 等字段，而归档哈希链创世哈希含 `project.name`（`bid-archive.digest.ts:24-32`）→ 改名使存量 `hashDigest` 与重算结果永久分歧。**修**：ARCHIVED 时冻结入链字段（至少 name/projectCode）。

### 权限 / 安全
- **M8. opening-hall 供应商缺项目成员门控——可跨项目读 PUBLIC 消息**：`opening-hall.service.ts:113-135`（listMessages）、`:159-186`（unreadCounts）、`:239-254`（presence）。supplier 跳过 assertHost 后不校验是否参投本项目（仅 PRIVATE 分支校验），可枚举读取任意 OPENING 项目大厅公开交流（常含报价宣读/异议交涉）。`sendMessage/checkIn` 都有 `NOT_PROJECT_MEMBER` 校验，此处遗漏。**修**：supplier 进入前先查 `BidSupplier(projectId,supplierId)` 成员资格。
- **M9. WS 网关 CORS 硬编码 `origin:true,credentials:true`**【2×印证】：`bid.gateway.ts:81-84`。HTTP CORS 由 `CORS_ORIGINS` 驱动，唯独 WS 无条件反射任意 Origin + 允许凭证。SameSite:lax 挡跨站，但同站子域（被攻陷/存在 XSS 的 `*.erp.example.com`）不受限 → 受害主持人登录态下连 `/bid` namespace 进 host 房，实时窃听监督日志/异常/解密/确认事件。**修**：网关 CORS 与 HTTP 统一走 `CORS_ORIGINS` 白名单。
- **M10. 敏感写端点经类级 @Roles 放开给 leader/staff**【有分歧·待决策】：`bid.controller.ts:28` 类级 `@Roles('admin','bid_host','leader','staff')`，仅 `:154` 有方法级收窄。`submitScore`(代评)/`generateEvaluationResults`/`archiveAll`/`revokeInvalidBid`/`exportArchivePackage` 均继承类级角色。评分 agent 认为构成越权面；跨端 agent 论证 leader/staff 是采购方内部角色（`auth-scope.ts:7` isProcurementSide）、文档把终局动作归于"采购方/开标主持人"，故不构成与文档差距。**修（建议）**：确认 leader/staff 在开评标域语义后，对终局/高敏端点（归档、生成结果、撤销废标、导出含评分明细）按最小权限加方法级 @Roles——至少 exportArchivePackage 应收窄。
- **M11. 监督批注 createdBy 由客户端自报可伪造**：`dto/upsert-supervision-annotation.dto.ts`（`createdBy?`）、`bid.service.ts:2554-2577`。任何类级角色用户可把批注归属伪造成他人姓名，影响监督留痕证据效力。**修**：createdBy 从服务端 `@CurrentUser` 注入。
- **M12. 开标会话 host/supervisor 为客户端自报字符串**：`bid.service.ts:572-578,596`。监督日志 role 取 `dto?.host||'系统'`，可与实际操作人（actorId）不一致甚至冒填他人。**修**：host/supervisor 与当前登录用户关联校验，日志同记 actorId。

### 数据正确性 / 评标
- **M13. 代评通道（submitScore）不触发实时废标判定**：`bid.service.ts:1386-1553` 全程无 `evaluateInvalidBid`/`bidValidity` 写入，对比 `expert.service.ts:1095-1127` 有完整链路。两路径对同份数据产生不同实时状态；代评导致的废标不生成 `BidInvalidBid`，`revokeInvalidBid` 因 findUnique 命中不到返回 NOT_FOUND 无法撤销。**修**：代评复用 expert.service 实时废标判定（抽公共方法）。
- **M14. ensureWinnerNotice 全废标时把废标供应商公告为中标人**【已复核】：`bid.service.ts:1915` `winner=evaluationResults.find(r=>r.rank===1)` 不校验 recommended/disqualified。全废标时 qualifiedRanked 空、winnerCount=0、无 recommended，但 disqualified 供应商仍占 rank 1 → 公示写成"中标人：<被废标供应商>"。**修**：winner 取 `recommended && rank===1`（或 `!disqualified`）；无合格中标人时不生成公示或生成"流标"文案。
- **M15. 归档存证摘要只覆盖 8 section 中的 3 个**：`bid.service.ts:2007-2012`（sectionDigests 仅 hallMessages/supervisionLogs/clarifications）对比 `:2112-2121`（sections 还含 suppliers/openingRecords/expertScores/evaluationResults/confirmationRecords）。最关键的开标记录/评分明细/评标结果**无任何摘要保护**，篡改后重导所有摘要仍自洽。commit 527027b5 声称"归档链覆盖存证 sections"覆盖不全。**修**：把 openingRecords/expertScores/evaluationResults/suppliers/confirmationRecords 全部纳入 sectionDigests。
- **M16. 哈希链/存证无外部锚点——"防篡改"缺可信基准**【2×印证·设计边界】：`bid-archive.digest.ts:65-95`、`bid.service.ts:1840-1849,1975-2012`。链与摘要都是对当前 DB 内容的纯函数，归档时算一次、导出时重算；DB 被改后重导仍自洽，无外部捕获/签章/独立存证作比对基准（注释自认设计边界）。只能检测"导出包内部局部改动"，无法检测"归档后 DB 被改再导出"。**修**：归档时把根哈希落地到只读介质/外部存证（公告 metadata、不可逆审计日志、第三方时间戳），导出时与锚点比对告警。
- **M17. 唱标录入无操作者审计、金额无语义校验**：`bid.controller.ts:163-167`（未传 @CurrentUser）、`bid.service.ts:1094-1144`、`dto/create-opening-record.dto.ts`。不写 AuditLog、不记操作人；`amount/period` 仅 `@IsString @IsNotEmpty`，`"abc"` 等非法金额可入库。**修**：注入 actorId 写 AuditLog；金额加格式/数值校验。

### 前端一致性 / 体验（bid-portal :3007）
- **M18. ExchangeDrawer 自持第二条 WebSocket——单连接化不彻底**：`exchange-drawer.tsx:41-56` + `open/page.tsx:558`（无条件挂载）。页面级已有 `useBidWebSocket`，抽屉又各自持有 socket → 同一 project room 两条并发连接（双 join/双心跳），F8 修复只对监督视图做了。**修**：hall 事件收敛到页面级 socket 经 props 下传，或连接按 projectId 单例化。
- **M19. join:project 无 ack 处理——加入失败静默"假连接"**：`use-bid-websocket.ts:86` fire-and-forget。后端 join 层硬鉴权失败返回 `{error}`，客户端从不读取 → `?id=` 非法/角色收紧时 socket 显示 connected 但永远收不到事件，无日志无提示。**修**：改 ack 回调，`res.error` 时置错误态并提示。
- **M20. 监督日志实时/持久化合并去重失效——时间线与 CSV 审计留痕重复**：`supervision-view.tsx:60-65`、`open/page.tsx:390-392`。`SupervisionLogPayload` 无 id 字段，`!l.id` 恒真 → live 日志无条件前置，refetch 后持久化集合含同一事件 → 时间线/日志表/导出 CSV 全部重复。**修**：后端给 payload 加 id（持久化记录 id），或前端按 `role+action+target+result+time` 内容指纹去重；去掉 `as unknown as` 强转。
- **M21. 任务板 API 失败与"真空态"不可区分**：`bid/page.tsx:44` `.catch(()=>setProjects([]))`。网络错误/401/500 全变空数组，渲染"暂无开标中的项目"合法空态，无 error 态。**修**：区分 loading/error/empty 三态，catch 置 error + 重试。
- **M22. 任务板 30s tick 不刷新项目——新"开标中"项目不出现**：`bid/page.tsx:50-55` 只 `setNow`。:3005 把项目推进到 OPENING 后任务板不感知（不 refetch、无 WS 订阅），作为开标执行终端唯一入口页的实时性缺口。**修**：tick 内顺带 `load()`，或订阅轻量 stage-change 事件。
- **M23. 批量解密：部分失败无反馈 + 误含 RUNNING + 未用后端专用端点**：`open/page.tsx:260-267,275-279`。`Promise.allSettled` 结果从未读取、错误 `.catch(()=>{})` 吞掉、目标过滤含 RUNNING（后端 decryptAll 只取 PENDING|DANGER）、绕过 `POST /decrypt-all`（含聚合监督日志）。**修**：调 `/decrypt-all` 用返回 success/failed 弹汇总 toast；若保留并发则过滤 RUNNING 并检查 allSettled。
- **M24. handleResolveDispute 无错误处理**：`open/page.tsx:238-246` 无 try/catch（对比 handleEnterRecord:308-314 有）。后端 400 产生未处理 rejection，面板不关、无 toast。**修**：加 try/catch + toast.error，成功后再关面板。

### 前端一致性 / 体验（web :3005）
- **M25. stage 双数据源——流转后不一致窗口**：`bid-confirm-panel.tsx:232,912`（底部栏用 bidProject.stage）vs `evaluation-block.tsx:216`/`archive-block.tsx:55`（区块用 detail.stage，只 refreshDetail）。流转后 bidProject 不更新，底部栏与区块短暂背离，依赖 socket 纠正；断线时持续。**修**：流转返回 `{stage}` 后本地同步 setBidProject 收敛单一数据源，或统一父级 load()。
- **M26. 面板无 onUpdated 回流父级**：`bid-confirm-panel.tsx:65-70`（Props 无回调）、`project-detail-panel.tsx:1647-1652`（未传，对比兄弟 `AnnouncementPublishDialog onPublished`）。流转后项目时间线/头部不重拉。**修**：新增 `onAdvanced` 回调。
- **M27. detail 加载失败被静默吞掉——四区块整体消失无错误态**：`bid-confirm-panel.tsx:138`（`.catch(()=>null)`）、`:899`（`{bpId && detail && (...)}`）。detail 端点 500/403 时开标进度/评标/澄清/归档四区块整体不渲染且无提示，误以为"尚未到该阶段"。**修**：`detail===null && !loading` 渲染带重试的错误占位。

---

## 三、Low（加固 · 代码质量 · 体验细节）

### 后端加固
- **L1. revokeInvalidBid 无归档阶段守卫**：`bid.service.ts:2839-2846` 仅查 reportConfirmed，未查 `stage==='ARCHIVED'`（当前被 shadow 不可达，潜在缺口）。
- **L2. CSV 公式注入未覆盖"前导空白/换行+公式"**：`bid.service.ts:2018-2021` `esc` 仅匹配首字符 `= + - @ \t \r`；首字符空格/`\n` 后接 `=` 不加前导单引号（Excel 本身安全，部分电子表格克隆会先裁剪空白）。主修复 d9103f8d 已覆盖所有用户可控字段，残留仅边缘场景。
- **L3. CSV 中 aiUsage.model/ranAt 未经 esc**：`bid.service.ts:2085-2086`，与全表统一 esc 约定不一致（来自后端非用户可控，风险低）。
- **L4. 排名先 2 位小数舍入再破并列——可能制造假并列**：`bid.service.ts:1312-1323`。85.004/85.005 都 round 成 85.00 → 视为并列 → 用供应商名（任意序）决定名次。**修**：排名比较用未舍入全精度均分，仅落库/展示时舍入。
- **L5. totalScore（未去极值）与 averageScore（去极值）口径不一致**：`bid.service.ts:1305 vs 1308-1314`。排名用 averageScore，但公示/导出展示 totalScore 易被误读为"计分总分"。**修**：明确语义（如改名 rawSum）。
- **L6. AI 得分点提取 prompt 注入面**：`score-point-extractor.service.ts:48-72`。招标文件文本（不可信）注入 LLM prompt；已有类型守卫+归一化+仅返回建议不落库+人工审核兜底，影响限于建议质量。可在 prompt 加"忽略文档内指令"分隔。
- **L7. startOpeningInternal 事务内发 WS**：`bid.service.ts:605-611`，与其余端点"提交后通知"约定相悖；回滚则 :3007 收到幻象事件。
- **L8. ensureWinnerNotice 事务外 check-then-create 无唯一约束**：`bid.service.ts:1896-1932`，并发归档产生重复中标公示草稿。**修**：Announcement 增 `@@unique([relatedProjectCode,type])` 或捕获 P2002。
- **L9. createFromAnnouncement 用 `BID-${Date.now()}`**：`bid.service.ts:385`，同毫秒并发 projectCode 唯一冲突被公告服务吞掉（仅 logger.error）→ 公告发布成功但无关联项目、无补偿。
- **L10. 同阶段重复调用每次重写监督/审计日志（噪声）**：`bid.service.ts:489-515,663-731`，`from===to` 幂等放行后仍执行完整事务，稀释监督日志价值。
- **L11. receiptNo 用 Math.random 3 位后缀有碰撞**：`supplier-portal.service.ts:678`，非唯一列可能重复回执号。**修**：改 DB 序列/当日自增/cuid 短码。
- **L12. KEK 派生单轮 SHA-256 + 固定盐**：`envelope-crypto.ts:20-25`，无 KDF 结构（当前高熵密钥安全，非最佳实践）。**修**：改 HKDF-SHA256。
- **L13. SM2 抗抵赖（Layer C）完全未生效**：`supplier-portal.service.ts:558-571`，前端未实现客户端签名（TODO Phase 6），signature/fileHash 恒空、验签永远跳过；门控 `if(signature && fileHash)` 只传其一即绕过。系统当前无投标抗抵赖能力。
- **L14. WS 多项目连接状态错乱 + 跨项目定向推送**：`bid.gateway.ts:92`（`socketProjects: Map<socketId,projectId>` 单值）、`:309-312/348-363`。同浏览器开两个项目大厅时第二次 join 覆盖、断连不回收第一个项目在场表（幽灵在线）；定向事件按 supplierId 直发所有 socket → 项目 B 页签收到项目 A 的确认/私聊事件（同一供应商，非越权泄密，但状态错乱）。
- **L15. getOpeningSessionTime 服务器授时**：经核验截标/解密窗口/getSessionTime 全部用服务器时间、DTO `@IsISO8601` 校验，无客户端时间信任问题（此项核查通过，仅记录）。

### 前端代码质量 / 体验（bid-portal）
- **L16. 并发 refetch 无序号保护**：`open/page.tsx:371-388` 等多处 `.then(setProject)` 无 requestId/AbortController，晚到旧响应可覆盖新状态；多处无 `.catch`。
- **L17. OPENING_DISPUTE_RESOLVED 事件未在页面处理**：`open/page.tsx:342-398` 未传 `onOpeningDisputeResolved`（hook 有绑定槽）→ 多主持人 tab 异议解决不同步。
- **L18. StageStepper 语义错位**：`open/page.tsx:32,224-231`，"解密中"永远不会在真正解密时高亮为当前步。
- **L19. 死代码与残留状态**：`open/page.tsx:11`（Eye 未用）、`:161`（prevDecryptStatuses 未读）、`:148-149`（无 setter 僵尸 state）、`:431`（不可达 return）；`hooks/use-bid-project.ts`（整文件无引用）；`use-bid-websocket.ts:187`（返回 socket 无消费者）；`bid-realtime-context.tsx` 上报链空转（见 H9）。
- **L20. opening-hall.ts 全部 `api.get<any>` + 监督视图 any[] 状态**：`lib/opening-hall.ts:14-34`、`supervision-view.tsx:265-268`，后端字段改名编译期零感知（M20 强转事故根源）。
- **L21. ExchangeDrawer 错误用原生 alert()**：`exchange-drawer.tsx:109,120`，与全站 sonner toast 体系割裂。
- **L22. 解密窗口关闭后无"已关闭"提示且按钮保持可用**：`open/page.tsx:234-235,538,633,552`，`remaining<=0` 时无横幅，解密按钮仅判 stage/decryptStatus → 点了触发 H8 静默失败。
- **L23. 项目详情双重拉取**：`bid-project-context.tsx:49-72` 与 `open/page.tsx:318-339` 各发一次 `GET /bid/projects/:id`，context 的 project 在大厅页无人消费。
- **L24. 服务器授时随每次项目 refetch 重拉**：`open/page.tsx:164-169` 依赖 `project?.openingSession`（每次新对象标识）→ 高频事件期授时请求被放大。
- **L25. DecryptConfirmDialog 的 loading 态实际不可见**：`open/page.tsx:769-775` onConfirm 内立即关闭对话框，loading prop 永远来不及展示（死 UI）。
- **L26. 解密确认"已知晓"勾选跨目标持久**：`decrypt-confirm-dialog.tsx:15` 关闭只渲染 null 不卸载，acknowledged=true 保留 → 一次勾选通吃后续所有批量解密，"解密不可逆"二次确认形同虚设。**修**：`useEffect(()=>{if(open) setAcknowledged(false)},[open])`。
- **L27. 解密状态回调在 setState updater 内执行副作用**：`open/page.tsx:343-369`，声音/ref 变更放在 updater 内（须纯函数），StrictMode 开发态双放（提示音响两遍）。
- **L28. 设计系统反模式**：`bid/page.tsx:74,113`、`open/page.tsx:438,357-359`、`exchange-drawer.tsx:155,164,187`。扁平全向 box-shadow（Material elevation 式，非定向明暗对）、渐变图标块 `bg-gradient-to-br`、`✕/✓/●` 符号当图标（应 Lucide）、toast 文案内嵌 emoji（🔓/⚠️）。违反 .impeccable.md 反模式。

### 前端代码质量 / 体验（web）
- **L29. 「按时开标」未按截标时间预禁用**：`bid-confirm-panel.tsx:951` `disabled={busy}`，已算出 submitDeadline（:469）却未用于禁用，先点后报错（后端 DEADLINE_NOT_PASSED 兜底）。
- **L30. 澄清区块两个边界瑕疵**：`clarifications-block.tsx:62-68`（全量加载无分页）、`:374-387`（`<select value={supplierName}>` 按名称反查 supplierId，同名供应商取首个匹配可能指错）。**修**：select 以 id 为 value；记录多时分页。
- **L31. 容器组件 1080 行过度膨胀**：`bid-confirm-panel.tsx:89-211` 约 20 个 useState + 关闭时 17 个手动重置；"评分标准编制"区块仍内联（同目录另四区块已拆出）。**修**：抽 score-standard-block.tsx，关闭重置改 reset-key/useReducer。
- **L32. 死代码 openSubmission/getOpeningSessionTime**：`web/lib/api/bid.ts:234,255` 全仓无调用；棘轮化后 DOWNLOAD 即允许投递，openSubmission 已 vestigial。
- **L33. OpeningProgressBlock 的 bidProjectId/onChanged props 传入未用**：`opening-progress-block.tsx:13-17,59`。
- **L34. generate 边界：可评集合为空时后端仍清空既有结果，向导未提示**：`evaluation-block.tsx:629-640,224-238`，后端 `generateEvaluationResults` 事务内先 deleteMany 再 createMany（`bid.service.ts:1328-1343`），无 CONFIRMED 可评供应商时 ranked=[] 仍清空且不报错。

### 跨端 / 无主功能
- **L35. bid-portal 残留整套供应商管理 API 封装（无主功能）**：`bid-portal/src/lib/api/supplier.ts`（register/approve/reject/… 全量），经 `lib/api.ts:47` 再导出，但 :3007 瘦成两页后无任何页面消费（仅 notification-bell 用通知 helper）。与"纯开标执行"定位相悖，扩大被窃 cookie 可调面。**修**：精简为实际使用的通知 helper。
- **L36. 助理触发的归档不记 AuditLog 行为人**：`assistant/actions/action-executor.service.ts:88` `archiveAll(targetId, undefined, 'full')`，`bid.service.ts:1860` `if(actorId)` 门控 → 终局阶段变更无 AuditLog 用户归因。**修**：把助理会话发起人 id 传入 actorId。
- **L37. 解密措辞差异**：文档节点③"时间一到，系统逐家解密"暗示自动，实现为主持人窗口内手动/批量触发（实为更稳妥设计）。窗口强制与解密时 SHA-256 防篡改校验均已实现。**修**：对齐文档措辞即可，无需改码。

---

## 四、修复优先级建议（分波次）

**Wave A — 数据正确性与不可逆终局把关（最高优先，建议立即）**
C1（并发棘轮复活）、H1（解密失败掩盖）、H2（废标撤销矛盾）、H4（启动评标脱钩开标完成）、H5（归档无完成度保护）、H6（异议处理绕过确认）、H7（供应商删投标文件）、H11（唱标覆盖已确认记录）。
> 共性根因：① 流转端点"事务外 assert + 事务内无条件写"的 TOCTOU 模式；② 不可逆终局动作的业务前置过松、前端把关缺位。建议先统一修 C1 的事务内复查模式（一处范式修复惠及四个端点），再逐项补业务前置。

**Wave B — 安全与权限收敛**
H10（明文对象永久留存）、M8（跨项目读 PUBLIC 消息）、M9（WS CORS 反射）、M11/M12（自报身份留痕）、M10（敏感端点最小权限·需先决策 leader/staff 语义）、H3（删公告级联清理）。

**Wave C — 一致性 / 实时健壮性**
H8/H9（解密静默 + 断连不可见，:3007 与 :3005 同源问题）、M1/M2/M3（并发重复记录/幂等/事务内 I/O）、M20（监督日志去重）、M18/M19（WS 单连接/ack）、M21-M27（前后端三态/数据源/刷新）。

**Wave D — 评标数据完整性与体验细节**
M13-M17（代评分叉/全废标公示/存证覆盖/哈希锚点/唱标审计）、其余 Low 项按模块批量清理。

---

## 五、既有修复清单核对结论（实效抽查）

对照 `docs/superpowers/audit/2026-07-24-iteration1-audit-fixlist.md` 与 `docs/plans/bid-portal-audit-fix-plan.md`：

- **确认真修好**：C1 WS 无认证窃听（join 层硬鉴权）、S1 专家跨项目进房（指派门控）、S4 纯文本过消毒器、S5 空消息落库、S6 非法 cursor/limit→500、S3 CSV 缺大厅消息、C2 抽屉裁剪、C3 更新器副作用、U1 中文 IME 误发送。
- **部分修好**：S2 哈希链不覆盖大厅消息——导出层已加 sectionDigests，但 sectionsRoot 未并入持久 `computeArchiveChain`，归档后 DB 层篡改不会被库存链发现（即本清单 M15/M16）。
- **遗留未修**：R7 resolveOpeningDispute 无状态机校验（=本清单 H6）、S8 host 角色过宽（待决策）、S9 WS CORS（=本清单 M9）。
- **文档落后于代码**：iteration1 清单标注"Wave 3-5 未开始"，但实测 Wave 3 多项（C2/C3/U1）已实现，建议更新其"修复进度"。
- **已被取代**：`2026-06-21 fix-plan` 的 17 条 UI 项目标页面（evaluate/archive/supervise/clarifications/project-tabs）在 2026-07 纯开标重构后已全部删除，UI 项无验证标的；其持久后端交付（archive-summary 端点、proxy 角色校验、端口去硬编码）均已落地。建议归档或标注"已被 2026-07 重构取代"。

---

## 六、已核验确认无问题（避免误报，列出以证明核对深度）

- **信封加密原语**：data key `randomBytes(32)`、wrapKey 每次 `randomBytes(12)` IV、AES-256-GCM + authTag（AEAD）、`iv|tag|ct` 长度校验、KMS_SECRET 缺失显式抛错、密钥不落库不入日志。
- **总则贯彻**：阶段流转 100% 收口 :3005，:3007 前端无任何流转调用（`/open` 双用途端点的 UI 级保护可接受，bid_host 本就有此权限）。
- **WS 连接认证与房间隔离**：join 层强制 userId+role、supplier 双层门控、expert 指派门控（排除 declined）、host-only 事件只发 host 房、供应商侧屏蔽监督事件，未发现跨项目房间广播泄露。
- **评分标准锁定**：`assertScoreItemsEditable` + 事务内行锁复查消除 TOCTOU；发布前校验 Σ=100/每项≥1 得分点/Σ得分点满分≤项满分（含浮点容差）。
- **generateEvaluationResults 幂等**：事务内 deleteMany+createMany + `@@unique([projectId,supplierId])`，并发生成至多唯一约束报错，不产生重复行。
- **CSV 公式注入主修复（d9103f8d）**：所有用户可控字段均经 esc，逻辑正确（残留仅 L2 边缘场景）。
- **跨项目写脏分已堵**：submitScore 对 expert/scoreItem/supplier 均做 projectId 归属校验；负分被 DTO `@Min(0)` 拦截；checklist 项分数服务端重算封顶。
- **时间边界**：截标/解密窗口/getSessionTime 全部用服务器时间，无客户端时间信任或时区错配。
- **受保护下载**：CSV 直链同源带 Content-Disposition、未用 rel=noreferrer；JSON 导出走 fetch+Blob 不离开 SPA——已知 401 坑均已规避。
- **backup-verify**：@Roles('admin','bid_host')、只读密文算哈希绝不解密、有 AuditLog、三方比对正确。
- **字符串字面量/角色字面量**：'已撤回'/SUCCESS/DANGER/CONFIRMED 等与后端严格一致；实际角色为 staff/leader（procurement_staff 仅为概念名），@Roles 放行无 403。
