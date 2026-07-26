# 开标流转重设计：:3007 执行端「接活 → 执行 → 交回」机制

- 日期：2026-07-26
- 状态：已批准，待实施
- 涉及端：`apps/api`、`apps/bid-portal`（:3007）、`apps/web`（:3005）、`packages/shared`

## 1. 背景

2026-07 Phase 3 重构后，:3007 成为纯开标执行终端，全部阶段流转（确定开标/启动评标/归档/流标）收归 :3005「开标确认」面板。检查发现两个体验问题：

1. :3007「开标完成」横幅文案为"请返回采购管理工作台启动评标，或执行开标归档（流标/废标场景）"——归档入口实际不在 :3007，文案与职责边界不符。
2. 开标执行端与采购工作台之间缺少明确的"交回"动作与移交产物：开标数据虽经共享库实时可见，但没有成包的开标资料移交，主持人也没有"开标结束"的宣告点。

## 2. 设计总则（已确认的决策）

- **:3005 的流转决策权一个不动**：按时开标（确定开标）、延时开标、流标、启动评标、归档（opening + full 两个 scope）全部保留在 :3005，行为与入口均不变。
- **:3007 只做三件事**：接收 3005 流转过来的可开标项目 → 执行开标（现状不变）→ 开标结束后把开标文件包交回 3005。
- **:3007 不恢复归档入口，不增加流标入口**。`archiveAll` 语义零改动（scope=opening 仍为终局、归 :3005）。
- **交回不是硬闸门**：:3005 的启动评标仍只依赖后端 H4 完成度口径，不要求先交回——防止主持人离场锁死流程。交回的意义是"开标完成宣告 + 开标资料成包移交"。
- 后端语义不做破坏性变更：本次为**纯增量**（1 个新端点 + 1 个 WS 事件 + 2 列 schema + 1 条通知）。

## 3. 流程

```
:3005 采购管理工作台                        :3007 开评标管理端
──────────────────                        ──────────────────
① 按时开标（不变）──stage=OPENING──→   任务板出现「开标中」项目
   └ 新增：sendToRole(bid_host)          + bid_host 站内信（新增）
     站内信「已确定开标，请组建会话」      主持人组建会话（不变）
                                          解密 / 唱标 / 确认 / 异议（不变）
                                          （执行数据经共享库实时回流 3005，不变）
                                                │
                                                ▼ openingDone
③ 启动评标 / 流标 / 归档（均不变）        ② 【完成开标 · 移交】（新增）
   ←── opening:completed + 站内信 ────      POST /complete-opening
   「开标进度」区块显示                      生成开标文件包 → MinIO
   「开标资料已接收 · 下载」                 大厅横幅：已移交，跳转 3005
```

## 4. API 设计

### 4.1 新增端点 `POST /api/bid/projects/:id/complete-opening`

- 权限：沿用 `BidController` 类级 `@Roles('admin','bid_host','leader','staff')`（:3007 登录角色为 admin/bid_host）。
- 请求体：无。
- 前置校验（顺序）：
  1. 项目存在，否则 400 `NOT_FOUND`。
  2. `stage === 'OPENING'`，否则 409 `OPENING_STAGE_REQUIRED`（已进评标/已归档/已流标均拒绝）。
  3. 开标会话存在，否则 409 `SESSION_NOT_FOUND`（:3005 裸推阶段后会话尚未组建的窗口期）。
  4. **幂等**：`session.status === '开标完成'` → 直接 200 返回既有 `{ status, handoverAt, handoverAssetId }`，不重新生成文件包。
  5. `assertOpeningDone(projectId)`（见 4.2），不满足 → 409 `OPENING_NOT_DONE`，error 文案列出未到终局态的供应商名单。
- 执行（MinIO 上传在数据库事务之前，失败不产生半落库状态，可安全重试）：
  1. 组装开标文件包 JSON（内容见 §6），计算 `sha256`。
  2. `StorageService.upload('bid-opening-handover/<projectId>.json', buffer, 'application/json')`。
  3. Prisma 事务内：
     - `lockAndReassertStage(tx, id, 'OPENING')` 行锁后复查（复用现有 C1 机制；此处 target 为 OPENING，同阶段幂等复查防并发归档/流标偷跑）；
     - 创建 `FileAsset`（`key` 唯一、`sha256`、`category='bid_opening_handover'`、`uploaderId=actorId`）；
     - 更新 `BidOpeningSession`：`status='开标完成'`、`handoverAt=now`、`handoverAssetId=asset.id`；
     - 写 `BidSupervisionLog`（role=主持人、action='完成开标·资料移交'、result='开标文件包已生成'）；
     - 写 `AuditLog`（`BID_STAGE_CHANGE` 不适用，action 用 `BID_OPENING_HANDOVER`，details 含 assetId/sha256）。
  4. 事务后（try/catch，失败不阻塞主流程，与 abort 通知同模式）：
     - `gateway.notifyOpeningCompleted(id, { handoverAt, handoverAssetId })`；
     - `notificationService.sendToRole('leader', …)` 与 `sendToRole('staff', …)`：标题「项目〈name〉开标完成，资料已移交」，`link: /projects`（:3005 项目页）。
- 响应 200：`{ status: '开标完成', handoverAt, handoverAssetId, downloadUrl: '/api/upload/files/<assetId>' }`。

### 4.2 H4 完成度校验抽共享方法

`bid.service.ts` 现有 `startEvaluation` 内联的 H4 校验（bid.service.ts:750-764）抽为私有方法：

```ts
private async assertOpeningDone(id: string): Promise<void>
// 口径不变：未撤回供应商全部到终局态（SUCCESS+CONFIRMED/EXCEPTION 或 DANGER），
// 无 DISPUTED 悬置。不满足 → ConflictException code=OPENING_NOT_DONE（附名单）。
```

`startEvaluation` 与新端点 `completeOpening` 共用，保证两处永远同口径。（注意：现有 `startEvaluation` 的 H4 未显式校验 DISPUTED——`confirmStatus !== 'CONFIRMED' && !== 'EXCEPTION'` 已隐含拦截 DISPUTED/PENDING，抽方法时保持该行为，不扩口径。）

### 4.3 确定开标时通知 bid_host（流入侧增强）

`startOpeningInternal` 中 `isTransitioning === true`（:3005 按时开标裸推阶段）分支，事务返回后新增：

```ts
this.notificationService.sendToRole('bid_host', {
  type: 'BID_OPENING_CONFIRMED',
  title: `项目${project.name}已确定开标`,
  content: '请前往开标大厅组建会话（填写主持人、监督人与解密窗口）',
  link: `/bid/open?id=${id}`,
});
```

try/catch 非阻塞。仅 `isTransitioning` 时发（:3007 组建会话的同阶段调用不重复发）。

### 4.4 WebSocket 事件

- `packages/shared/src/bid-events.ts`：`BID_EVENT` 增加 `OPENING_COMPLETED: 'opening:completed'`。
- `bid.gateway.ts` 增加：

```ts
notifyOpeningCompleted(projectId: string, data: { handoverAt: string; handoverAssetId: string }) {
  this.server.to(`project:${projectId}`).emit(BID_EVENT.OPENING_COMPLETED, { projectId, ...data, timestamp: Date.now() });
}
```

（发 `project:` 房间——两端都订阅该房间，与 STAGE_CHANGE 一致。）

## 5. 数据模型变更

`BidOpeningSession` 增加两列（schema.prisma:371）：

```prisma
model BidOpeningSession {
  // …现有字段…
  handoverAssetId String?   // 开标文件包 FileAsset 引用（完成开标·移交后写入）
  handoverAt      DateTime? // 移交时间
}
```

**迁移执行路径**（遵守 CLAUDE.md「Prisma Migration Notes」与库内存量 drift 现状）：

1. `prisma migrate dev --create-only --name bid_opening_session_handover`（只生成 SQL，不应用）；
2. `prisma db execute --file <生成的 .sql>` 直接对库执行（两条 `ALTER TABLE ... ADD COLUMN`，零数据风险）；
3. `prisma migrate resolve --applied <migration_name>` 登记已应用；
4. `pnpm db:generate`。

**禁止**交互式 `migrate dev`（会触发 reset 丢数据）。新增列均可空，旧会话行不受影响。

## 6. 开标文件包（移交产物）

单个 JSON 文档，键名 `bid-opening-handover/<projectId>.json`，内容：

```jsonc
{
  "packageType": "BID_OPENING_HANDOVER",
  "packageVersion": 1,
  "generatedAt": "ISO8601",
  "project": { "id", "projectCode", "name", "procurementMethod", "openTime", "deadline", "stage" },
  "session": { "host", "supervisor", "decryptWindowStart", "decryptWindowEnd", "status", "handoverAt" },
  "suppliers": [{ "supplierName", "receiptNo", "encryptStatus", "decryptStatus", "confirmStatus", "submitStatus", "submittedAt" }],
  "openingRecords": [{ "supplierName", "amount", "period", "qualityTarget", "bondStatus", "confirmStatus", "objectionReason", "handleResult" }],
  "supervisionLogs": [{ "time", "role", "action", "target", "result", "riskFlag" }],
  "summary": { "supplierTotal", "decrypted", "decryptFailed", "recorded", "confirmed", "disputed", "withdrawn" },
  "fingerprint": "sha256(上述字段规范化 JSON)"   // 最后计算并回填，验签口径与 exportArchivePackage 一致（JSON.stringify 键序固定）
}
```

- `FileAsset.sha256` 存整包字节哈希；`fingerprint` 字段为内容级指纹（不含自身），供人工比对。
- 下载走现有受保护下载端点 `GET /api/upload/files/:assetId`（FileAsset 已含元数据；前端 `<a target="_blank" rel="noopener">`——**不要加 noreferrer**，会丢 Referer 导致 portal 识别失败 401，见库内既有教训）。
- 幂等：已移交则返回既有 asset，不重新生成、不覆盖 MinIO 对象。

## 7. 前端改动

### 7.1 :3007（bid-portal）

**`app/(dashboard)/bid/open/page.tsx`**

- 替换现有「开标完成」横幅（现 518-531 行）为三态：
  1. `openingDone && !session.handoverAt && stage==='OPENING'`：横幅「开标完成」+ 主按钮【完成开标 · 移交采购管理工作台】→ `completeOpening(projectId)` → 成功 toast「开标资料已移交」+ refetch；失败按 error.code 提示（`OPENING_NOT_DONE` 展示名单）。
  2. `session.handoverAt` 存在：绿色横幅「开标资料已于 {handoverAt} 移交采购管理工作台，后续评标 / 归档请前往 :3005」+ 按钮【前往采购管理工作台】（`portalURL('web','/projects')`）。**删除原文案中"或执行开标归档"字样。**
  3. 阶段终局横幅（现 489-501 行覆盖 EVALUATING/ARCHIVED）：增加 `ABORTED` 分支——「本项目已流标，后续处理（流标公告）请在采购管理工作台操作」。
- `openingDone` 派生逻辑不变（已是 H4 同口径）。

**`lib/api/bid.ts`**：新增 `completeOpening(projectId)` → `api.post('/bid/projects/${id}/complete-opening', {})`。

**`hooks/use-bid-websocket.ts`**：新增 `onOpeningCompleted` 回调（页面侧 refetch，与 onStageChange 同处理）。

**类型**：`lib/types.ts` 的 `openingSession` 类型补 `handoverAt?: string | null; handoverAssetId?: string | null`。

**任务板（`bid/page.tsx`）：不改。**

### 7.2 :3005（web）

**`components/projects/bid-confirm/opening-progress-block.tsx`**

- 会话信息条（现 122-137 行）：当 `openingSession.handoverAt` 存在时，追加只读提示块「开标资料已接收（{handoverAt}）· [下载开标文件包]」——下载链 `/api/upload/files/${handoverAssetId}`（`rel="noopener"`）。
- 其余（进度四联、确认开标结果按钮、流标按钮）一律不动。

**`hooks/use-bid-websocket.ts`**：新增 `onOpeningCompleted` 回调。

**`bid-confirm-panel.tsx`**：socket 订阅处加 `onOpeningCompleted: () => { if (isOpen) void load(); }`。

**不改清单（明确）**：按时开标 / 延时开标 / 流标 / 评分标准 / 启动评标（评标管理块横幅 + 确认开标结果按钮）/ 归档区块两个 scope 触发器——全部保持现状。（"确认开标结果"与"启动评标"双入口的命名清理列为后续可选优化，不在本次范围。）

### 7.3 shared

`BID_EVENT.OPENING_COMPLETED` 常量；改后 `pnpm --filter @water-erp/shared build`。

## 8. 守卫与边界用例

| 场景 | 行为 |
|---|---|
| 未组建会话即调 complete-opening | 409 `SESSION_NOT_FOUND`（stage 校验先过、session 存在性随后，见 §4.1 校验顺序） |
| 开标未完成（有人未解密/未确认/异议悬置） | 409 `OPENING_NOT_DONE` + 名单 |
| 重复点击 / 两端并发交回 | 幂等：既有 `开标完成` 直接返回；并发下事务内复查 session 状态，后提交方走幂等分支 |
| 交回前 :3005 已启动评标（stage=EVALUATING） | 409 `OPENING_STAGE_REQUIRED`——开标已被评标动作事实上接管，横幅转入"开标已结束"态 |
| 交回前 :3005 已流标（ABORTED） | 同上，409；大厅显示流标终局横幅 |
| MinIO 不可用 | 上传先于事务，直接 5xx，数据库零副作用，可重试 |
| :3007 主持人永不交回 | 无死锁：:3005 启动评标不受交回门控（H4 口径独立满足即可） |
| 交回后又想重生成文件包 | 不支持（幂等返回既有包）。异议须在交回前处理完（openingDone 已要求无 DISPUTED），无重生成需求 |

## 9. 测试计划

**单元（apps/api，jest）**

- `assertOpeningDone` 共享方法：全终局 / 未解密 / DISPUTED 悬置 / 已撤回排除 / 全 DANGER 五组用例。
- `completeOpening`：幂等返回、stage 非 OPENING 拒绝、OPENING_NOT_DONE 拒绝、正常路径写入 session + FileAsset + 监督日志（MinIO 用 mock StorageService）。

**E2E（apps/api/test/bid/）**

- 扩展既有 bid 套件走完闭环：确定开标 → 组建会话 → 解密 → 唱标 → 确认 → `complete-opening` → 校验 session.status / handoverAt / FileAsset 行存在 → `GET /upload/files/:assetId` 可下载且 JSON 字段齐全。
- 回归：不经交回直接 `start-evaluation`（H4 满足）仍成功——验证非门控。

**手工验证**

- :3005 按时开标 → bid_host 站内信到达 → :3007 任务板/大厅组建会话 → 走完开标 → 交回 → :3005 开标进度块出现"资料已接收 · 下载" → 下载包内容正确 → :3005 启动评标不受影响。
- :3005 先流标 → :3007 大厅出现流标终局横幅、交回按钮不可达。

## 10. 文档同步

实施完成后更新 `CLAUDE.md`（经 Bash 编辑）：

- 「开评标管理端」章节：页面描述补充"完成开标·移交"机制与交回横幅；
- 「Bid Stage State Machine」段落：在":3005 驱动流转"之后补一句":3007 在 OPENING 阶段内另持有完成开标·资料移交（不改 stage，产物回传 :3005）"；
- 模块表 `Bid` 行无需改动。

## 11. 非目标（明确不做）

- 不改 `archiveAll` 任何语义；不给 :3007 归档 / 流标入口。
- 不把交回设为启动评标的前置条件。
- 不清理 :3005 现有任何按钮（含"确认开标结果"重复入口）。
- 不动任务板、不动 open-submission、不动延时开标。
