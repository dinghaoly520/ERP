# 供应商投标意向确认与履约管理 设计文档

- 日期：2026-11-12
- 状态：已评审（用户逐项裁定，见「已定口径」）
- 涉及门户：供应商门户 :3004（项目机会）、采购管理工作台 :3005（公告投标情况 / 项目管理供应商参与 / 开标确认面板 / 供应商管理参与情况）、API :4001

## 1. 背景与定位

采购公告「报名方式」文案已向供应商承诺流程为「注册、查询项目、**确认投标意向**和文件投递」（`apps/web/src/components/announcement-dialog.tsx:285` 保底常量、`apps/web/src/lib/announcement-templates.ts:125` AI prompt），但后端零实现。本功能落地该承诺，并延伸为供应商履约管理闭环：

```
公开项目：确认参与意向（拟参与按钮）──┐
                                      ├─→ 投递标书 ─→ 开标后未投递计事故 ─→ 满 3 次自动拉黑+通知
邀请项目：回执确认参加（既有 RSVP）──┘（邀请项目不加按钮，回执即承诺）
```

意向确认是**公开项目投递标书的必经前置步骤**（后端硬闸），同时作为新维度并入 :3005 三处既有视图，并在供应商管理中心沉淀供应商参与情况全史。

## 2. 已定口径（用户裁定，勿翻案）

| # | 口径 | 裁定 |
|---|------|------|
| 1 | 数据模型 | 独立意向表 `SupplierBidIntent`（不污染 BidSupplier 名册语义——`submitBid` 会给公开投递人也建名册行，名册不能作邀请制判定） |
| 2 | 供应商端家数 | 不展示。供应商只见自己的确认状态；参与家数仅 :3005 可见 |
| 3 | 意向撤回 | 不允许（单向确认，与黑名单警示配套；误点联系采购中心人工处理） |
| 4 | 投递前置 | 只有确认了意向才能投递标书（公开项目后端硬闸；邀请制项目豁免——回执即承诺） |
| 5 | 邀请制项目 | 不采用拟参与按钮（其「确认参加」= 既有邀请回执机制） |
| 6 | 拉黑计数 | 两轨合并：公开「确认意向未投递」+ 邀请「回执确认参加未投递」 |
| 7 | 拉黑阈值 | 累计满 3 次触发（第 3 次即拉黑） |
| 8 | 存量追溯 | 历史确认未投递只入表展示、不触发拉黑；仅部署后新发生的第 3 次拉黑 |

## 3. 适用范围判定（intentApplicable）

**项目级**判定，单一事实源在后端，随各读端返回，前端不自行推断：

- 适用（公开项目）：该项目关联 `BidDocument.accessScope === 'OPEN'`；
- 不适用（邀请制）：`accessScope ∈ {INVITED, DESIGNATED}`，或项目无 BidDocument（谈判项目恒无——采购文件走 Redis negotiation-config 交付）；直接采购无供应商面，天然不涉及。

实现约束：判定查询必须与 `listBidProjects` 的 BidDocument 富化（`supplier-portal.service.ts:1516/:1591/:1665-1690` scopeMap）**同源同口径**，防止同一项目两处判定漂移。

## 4. 数据模型（新增两表）

```prisma
model SupplierBidIntent {
  id          String   @id @default(cuid())
  projectId   String
  supplierId  String
  confirmedAt DateTime @default(now())
  createdAt   DateTime @default(now())
  project     BidProject @relation(fields: [projectId], references: [id], onDelete: Cascade)
  supplier    Supplier   @relation(fields: [supplierId], references: [id], onDelete: Cascade)
  @@unique([projectId, supplierId]) // 幂等锚点（并发双击兜底）
  @@index([projectId])
}

model SupplierBidNoShow {
  id         String   @id @default(cuid())
  projectId  String
  supplierId String
  track      String   // INTENT=公开意向 | RSVP=邀请回执
  detectedAt DateTime @default(now()) // 事故成立（项目开标后）被扫到的时刻
  legacy     Boolean  @default(false) // 存量回填标记：展示计入、不触发拉黑
  project    BidProject @relation(fields: [projectId], references: [id], onDelete: Cascade)
  supplier    Supplier   @relation(fields: [supplierId], references: [id], onDelete: Cascade)
  @@unique([projectId, supplierId]) // 每项目每家最多一条事故
  @@index([supplierId])
}
```

- 迁移：`prisma migrate dev --create-only` → `prisma db execute` → `prisma migrate resolve --applied`（本机 drift 铁律；CI 全新库重放自动覆盖）。
- 种子：`seed-data/SupplierBidIntent.json`（英雄项目已投递供应商补意向，三视图演示有数据）；给一家种子供应商 2 条 `legacy=true` 事故（参与情况全史演示、不触发拉黑）；`seed.ts` TRUNCATE 清单纳入两新表。

## 5. 后端 · 确认端点（公开项目）

`POST /supplier-portal/bid-projects/:id/confirm-intent`（类级 `@Roles('supplier')` 已覆盖；**幂等**——已有记录直接 200 返回，不报错）。

闸门顺序（`supplier-portal.service.ts` 新增 `confirmBidIntent`）：

| 序 | 闸门 | 失败码 |
|---|------|--------|
| 0 | 项目 intentApplicable | 400 `INTENT_NOT_APPLICABLE`（邀请制走回执） |
| 1 | `assertProjectVisibleToSupplier`（归属∪受邀∪本人投递，复用既有读闸 :1972-1984） | 403 `COMPANY_SCOPE_FORBIDDEN` |
| 2 | 供应商非黑名单（同 submitBid :2276 口径） | 403 `SUPPLIER_BLACKLISTED` |
| 3 | 阶段 ∈ {DOWNLOAD, SUBMIT} | 409 `INTENT_STAGE_CLOSED` |
| 4 | 截标未过（deadline 空则只看阶段） | 409 `INTENT_DEADLINE_PASSED` |
| 5 | upsert 落库 | — |

临时供应商（isTemporary）不加过期闸：临时过期供应商确认意向后未转正 → 事故照计（对应真实信用代码实体，威慑成立）。

## 6. 后端 · 投递前置闸

`saveBidDraft` 与 `submitBid` 前置校验：**项目 intentApplicable 且该供应商无 SupplierBidIntent** → 400 `INTENT_REQUIRED`「请先确认参与意向，再投递标书」。

- 邀请制项目（定向/谈判）豁免——回执即承诺；
- 意向窗口（截标前+DOWNLOAD/SUBMIT）与投递窗口重合，能投递的时刻必能先补确认，**无死锁**；
- 谈判多轮报价 `submitQuote` 不加闸（开标后动作，必有初始投递在前）；
- 存量已投递记录不受影响（闸只挡写）；
- 撤回（withdrawn）后重投：意向记录仍在，闸自然放行。

## 7. 后端 · 读端合并

| 读端 | 改动 |
|------|------|
| `listBidProjects` | 每项增 `intentApplicable`、`myIntent: boolean`、`intentConfirmable: boolean`（按 §5 闸门同口径派生）；当页项目一次 `findMany` 转 map，防 N+1；**不返家数** |
| `getBidProject` | 增 `intentApplicable`、`myIntentConfirmedAt: string \| null`、`intentConfirmable` |
| `getParticipants`（`announcement.service.ts:1683`，公告「投标情况」） | 合并集 = 下载者(BidDocumentAccess) ∪ 名册(BidSupplier) ∪ 投递 ∪ **意向集**，每家带 `intentConfirmedAt`；意向-only 行 join Supplier 取名；轮界收口逻辑不动 |
| `getProjectParticipants`（:1847，项目「供应商参与」） | 同上合并——公开招标/询比/竞价/谈判项目的「供应商参与」自动含意向供应商（前端拉取范围本就覆盖公开招标，零改动） |
| `GET /bid/projects/:id/workspace`（开标确认面板） | 名册行附 `intentConfirmedAt`；意向-only 供应商（确认但不在名册/未下载）补行（业务标签「自主确认」，downloadStatus/submitStatus 填默认「待下载/待提交」）；头部统计加「已确认意向 N」 |
| **新** `GET /supplier/:id/participation`（供应商管理，§9） | 履约聚合 |

**顺手补缺**：`downloadNegotiationFile`（`supplier-portal.service.ts:1884-1947`）现零留痕——补写 `BidSupplier.downloadStatus='已下载'` + `lastDownloadAt=now`（该端点本就名册命中才放行，直接更新），谈判项目下载情况在投标情况/开标面板不再失真。

## 8. 履约机制 · 三次不投递自动拉黑

### 8.1 事故判定（供应商 s × 项目 p，唯一键去重）

成立条件（全部满足）：

1. p.stage ∈ {OPENING, EVALUATING, ARCHIVED}（开过标——以阶段集合为权威，不依赖具体流转路径；即便罕见跳步推进，cron 兜底扫描也会覆盖）；**ABORTED 流标不计数**（非供应商责任）；
2. s 在 p 无 `status='submitted'` 的 SupplierBidSubmission（**withdrawn 撤回视同未投递**；撤回后重投成功则最终 submitted、不计）；
3. 承诺信号成立，track 取值：
   - `INTENT`：存在 SupplierBidIntent（p 为公开项目）——优先；
   - `RSVP`：s 在 p 的全部 `InvitationRsvp`（projectId 非空）中，**按 `respondedAt` 最新一条** status=ACCEPTED（同项目多批次以最后回应为准；尊重代变更——被工作人员改为婉拒则不计；代回应 ACCEPTED 计入，代回应必有理由留痕）。

### 8.2 写入时机（双触发，均幂等）

- **每日 Scheduler 兜底扫描（真正的保证）**：凌晨低峰（参照 scanSupplierCertExpiry 03-08 点档），扫 stage∈{OPENING,EVALUATING,ARCHIVED} 且无事故行的 (p,s) 组合，补写事故行。**首次运行即完成存量回填，全部标 `legacy=true`**（此后新增 legacy=false）。
- **即时钩子（求时效）**：阶段推进到 OPENING+ 的已知写点（按时开标确认为主入口；启动评标/归档推进点）后置 fire-and-forget 扫该项目（失败仅记日志，不影响流转；漏挂由次日 cron 补扫）。实施时 grep bid 模块 stage 写点清单收口。

### 8.3 拉黑动作（仅在**新建**事故行时触发检查；幂等）

该供应商 `legacy=false` 事故数 ≥3 且 `Supplier.status ≠ BLACKLIST` → 事务内：

1. **复用既有 `blacklistSupplier` service 路径**（`supplier.controller.ts:684` 人工拉黑同款）：`Supplier.status=BLACKLIST` + `disableReason`（注明「累计 3 次确认参与采购项目但未投递投标/响应文件」+ 三个项目名与时间）；
2. `SupplierPenalty` 自动留痕（文号 `AUTO-YYYYMMDD-NNN` 随机防撞重试，机关=采购中心，decisionDate=now，penaltyContent=同理由）——cron 路径不经 HTTP 无 OperationLog，**留痕权威=处罚表+disableReason**；
3. 通知该供应商**全部关联账号**（现 Supplier.userId 1:1，按关联账号查询实现、兼容将来多账号）：`sendToUser(uid, ['in_app'], {...})`，类型 `SUPPLIER_AUTO_BLACKLISTED`（注册进 `packages/shared/src/notification-registry.ts` 并重建 shared），标题/内容含理由与项目清单，link 指向供应商门户 `/dashboard`；
4. **不冻结登录**（User.isFrozen 不动）——供应商仍可登录查看通知与申诉；拉黑效果走既有链路（投递/获取文件 403 SUPPLIER_BLACKLISTED、项目机会黑名单横幅）。

人工恢复通道已现成：`POST /supplier/:id/unblacklist`（:692），零新增。

## 9. :3005 供应商管理 · 参与情况

供应商管理中心详情新增**「参与情况」卡片**（新端点 `GET /supplier/:id/participation`，角色随 supplier 模块既有口径）：

- KPI：确认参与（意向）次数 / 回执确认次数 / **实际投递次数** / **确认未投递次数（红色突出，含历史）** / 履约进度「n/3——再次确认未投递将自动列入黑名单」（n=非 legacy 事故数，n≥1 才显示）；
- 明细表：逐条事故——项目名/编号、track 标签（公开意向/邀请回执）、项目当前阶段、承诺确认时间（意向 confirmedAt / 回执 respondedAt）、检出时间、legacy 标记「历史」；
- 拉黑状态条：BLACKLIST 时显示 disableReason + 处罚留痕（SupplierPenalty 列表），旁挂既有解黑操作入口。

## 10. :3004 前端

**确认弹窗**（`SpDialog`+icon 参数，弹窗规范 A 版；`apps/supplier-portal-next/src/components/ui.tsx:102`）：

- 标题「确认参与意向」+ 项目名；
- 正文红色警示（cgzxui 警示色 token，禁裸红）：**「若多次确认投标意向却未参与，则可能会被移入黑名单。」**
- 灰字辅助：「确认后不可撤回；确认参与意向后方可投递标书」；
- 按钮：取消 / 确认参与。

| 位置 | 交互 |
|------|------|
| 列表行（`/bids` `bids/page.tsx`） | `intentApplicable` 才显示「拟参与」按钮；已确认 → 禁用「已确认参与」；不可确认（阶段过/已截标）→ 不显示 |
| 详情页操作条（`bid-act-card`，`bids/[id]/page.tsx`） | 完整文案「拟参与本次采购/招标」——按 procurementMethod 含「招标」自适应（遵 2026-11-03 采购口径裁定：招标不得泛指）；已确认 → 禁用「已确认参与」 |
| 详情页「提交标书」按钮 | 未确认时点击 → 弹同一确认弹窗（附提示行「确认参与意向后方可投递标书」），确认成功直接跳 `/bids/[id]/submit` |
| 投递页（`/bids/[id]/submit`） | 前端按 `myIntentConfirmedAt` 判断入口；后端 `INTENT_REQUIRED` 兜底提示 |

## 11. :3005 前端（四处）

1. **公告列表「投标情况」弹窗**（`notice/page.tsx:579-700`）：KPI 行增「已确认意向」；供应商表增「意向」列（已确认+时间 / 未确认）；
2. **公告详情投标情况卡**（`notice/[id]/page.tsx:428-460`）：逐家加意向标记与确认时间；
3. **项目管理「供应商参与」**（`project-detail-panel.tsx:876`）：后端合并后自动带出，前端零改动；
4. **开标确认面板「供应商投标状态」**（`bid-confirm-panel.tsx:649-720`）：表增「意向」列与确认时间；头部统计加「已确认意向」；意向-only 行标「自主确认」。

另 §9 供应商管理参与情况卡。所有新 UI 遵 cgzxui 体系（无裸色/无平阴影/1px 发丝线）。

## 12. 明确不做（YAGNI 留档）

- 意向撤回端点（口径 #3）；
- 供应商端参与家数展示（口径 #2）；
- 拉黑通知给 :3005 管理员（现仅通知该单位账号；将来可加）；
- DECLINED/未回执计数（仅 ACCEPTED 算承诺）；
- `submitQuote` 意向闸；
- 自动解黑（人工走既有 unblacklist）；
- 催促未投递扩展到意向-only 供应商（nudge 现挂名册；公开项目催促将来可扩）；
- :3004 公告中心详情页加入口（项目机会列表+详情已覆盖主路径）。

## 13. 测试与兼容

- **单测**（co-located，`supplier-portal.service.spec.ts` 新 describe 等）：
  - confirm-intent：闸门五例 + 幂等 + 邀请项目 400；
  - 投递前置闸：OPEN 项目要求意向 / 邀请·谈判豁免 / 意向后放行；
  - 事故判定：INTENT 轨 / RSVP 轨 / 多批次最新回应 / 代变更不计 / 流标排除 / 撤回视同未投递 / 撤回重投不计 / 同项目两轨去重；
  - 拉黑：满 3 触发 / legacy 豁免（2 legacy+1 新不触发、3 新触发）/ 幂等不重复拉黑 / 通知发送 / 复用 blacklistSupplier 路径；
  - participation 聚合口径；listBidProjects 批量 myIntent/intentApplicable。
- **e2e**：既有提交流程套件（`bid` / `bid-v3` / `clarification-reply` / `opening-hall`）中 **OPEN 项目**提交前补 confirm-intent 调用（谈判/受邀套件无需）；新增两条链路：「未确认提交 → 400 INTENT_REQUIRED → 确认 → 投递成功」；「回执确认 ×3 未投递 → 开标 → 自动拉黑+通知+处罚留痕」。CI 无独立 selfcheck 脚本（已随 040df9a8 删除），兼容面即上述套件。
- **构建链**：`notification-registry.ts` 新类型 → `pnpm --filter @water-erp/shared build`；迁移入链后 CI 全新库重放自动覆盖。

## 14. 部署注意

- 上线后首个凌晨 cron 完成存量回填（legacy）；存量供应商不会被追溯拉黑（口径 #8）；
- 供应商门户 https 前提不变（本功能无新增 WebCrypto 依赖，无额外要求）；
- 拉黑威慑文案与实际机制一致：警示语「可能会被移入黑名单」= 满 3 次自动执行，无人工缓冲。
