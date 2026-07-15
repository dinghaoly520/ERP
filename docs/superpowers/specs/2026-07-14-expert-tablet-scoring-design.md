# 专家平板打分 + checklist 重构 + 无效投标流程 — 设计文档

- **日期**：2026-07-14
- **状态**：草案，待用户 review
- **作者**：brainstorming 会话产出
- **关联分支**：`fix/api-code-review`（实现时建议另开 `feat/expert-tablet-scoring`）

---

## 1. 背景与目标

### 1.1 现状（已核实）

- 专家在 `expert-portal`（桌面优先网页）打分：**滑块 + 数字输入框 + 文本框**（`apps/expert-portal/src/app/(app)/evaluate/[id]/page.tsx:1267-1304`）。
- 评分标准 `BidScoreItem` 是大类空壳：seed 里 25 项，`scoringCriteria` / `evidenceHint` **全为空**（`apps/api/prisma/seed-data/BidScoreItem.json`）。专家对着"技术评分50"凭感觉拖滑块。
- 每个评分项已有 `reason` 文本框（低于满分必填），存为 `BidScoreRecord.reason`。
- **无任何手写/画布/手写笔/签名基础设施**（全仓零 `canvas`/`pointerdown` 绘图）。
- 硬约束：**分数不进 WebSocket 事件载荷**（`packages/shared/src/bid-events.ts:7`，招标投标法·专家独立评审）；打分走 HTTP REST。
- 登录是**无状态 JWT**（`apps/api/src/auth/auth.service.ts:119`，只 `jwt.sign`，不踢人），同一专家可多设备同时在线。
- **已有废标规则**：通过性审查不通过票严格过半→废标（`apps/api/src/bid/bid.service.ts:1140`，测试覆盖 `bid.service.spec.ts:584-618`），但只在 `generateEvaluationResults` 事后计算；`BidSupplier` 无废标状态字段。
- 管理端 `bid-portal` 已有评分标准 tab：`/bid/project/[id]?tab=standard`（`apps/bid-portal/src/app/(dashboard)/bid/project/[id]/components/project-tabs.tsx:25`，发标/投标期默认），API `/bid/projects/:id/score-items` CRUD 完备，但**只能维护大类，无得分点层级**。

### 1.2 目标

1. **双屏协同**：电脑看招投标文件/对照条款/AI 分析；平板只做打分 + 手写备忘。解决显示器小、看标书与打分来回切换的不便。
2. **打分模型重构**：滑块 → 得分点 checklist（**形态 B2：二元勾选 + 档内微调**）。客观条款由管理员制定为 checklist，专家勾客观达成项，主观部分微调。
3. **手写备忘**：平板手写笔，**OCR 文字 + 墨迹原图**并存。
4. **降级对等**：桌面打分 tab 与平板功能**一模一样**，平板不可用时桌面独立完成全程。
5. **强制核对关口**：平板打的分必须经桌面核对（**审阅 + 可微调 + 确认**）才能进 report 环节。
6. **无效投标流程**：资格性/符合性审查不通过（过半）→ 实时流转到无效投标显式状态，停止后续打分、排除排名。

### 1.3 非目标（YAGNI）

- 不采购专用平板硬件、不写原生 App（用 PWA/触屏路由）。
- 不做 AI 自动从招标文件解析得分点（MVP 管理员手工录入；AI 增强后置）。
- 价格分仍用公式，不进 checklist。

---

## 2. 整体架构

```
┌─────────────────────────┐         ┌──────────────────────────┐
│  电脑（桌面浏览器）      │         │   平板（PWA / 触屏路由）  │
│  expert-portal 桌面版    │         │  expert-portal /tablet    │
│                          │         │                          │
│  · 看招投标文件          │         │  · checklist 勾选打分(B2)│
│  · 对照条款 / AI 分析    │         │  · 手写备忘录(OCR+墨迹)   │
│  · 核对关口(审阅+确认)   │         │  · 评分理由(手写)         │
└────────────┬─────────────┘         └─────────────┬────────────┘
             │   同一专家 JWT（多点登录，已核实可行）   │
             └─────────────────┬────────────────────┘
                               │  评标室封闭 WiFi（隔离内网，非公网）
                               ▼
                    ┌────────────────────────┐
                    │  API :4001             │
                    │  HTTP REST 打分/核对    │
                    │  Socket.IO 仅传活动里程碑│
                    │  （分数永不进 WS）      │
                    └────────────────────────┘

┌─────────────────────────────────────┐
│ bid-portal /bid/project/[id]?tab=standard │  管理员：编制得分点 checklist
└─────────────────────────────────────┘
```

- 平板 = `expert-portal` 的一个**触屏路由**（PWA，跑任意 Android/iPad 浏览器），零新硬件、零原生开发，复用现有登录/API/幂等提交/断线重连/草稿 localStorage。
- 连接：**WiFi 直连**（评标室封闭内网）。隔离在网络层做，不靠线缆。

---

## 3. 数据模型

### 3.1 新增表（5 张）

**① `BidScorePoint`** — 得分点定义（管理端录入）

```prisma
model BidScorePoint {
  id           String   @id @default(cuid())
  scoreItemId  String                          // 归属哪个评分项大类
  name         String                          // 如 "施工组织设计"
  fullScore    Decimal  @db.Decimal(5, 1)      // 该点满分
  seq          Int      @default(0)            // 排序
  evidenceHint String?                         // 评审要点 / 判定依据
  objective    Boolean  @default(true)         // 客观条款(true) vs 主观项(false)
  scoreItem    BidScoreItem @relation(fields: [scoreItemId], references: [id], onDelete: Cascade)
  decisions    BidScorePointDecision[]
  @@index([scoreItemId])
}
```

**② `BidScorePointDecision`** — 专家勾选裁定（B2 核心）

```prisma
model BidScorePointDecision {
  id           String   @id @default(cuid())
  expertId     String
  pointId      String
  supplierId   String
  checked      Boolean                         // 客观项：是否达成
  awardedScore Decimal  @db.Decimal(5, 1)      // 实得分：勾中默认=fullScore 可下调；主观项专家直填
  note         String?                         // 该点备注
  expert       BidExpert     @relation(fields: [expertId], references: [id], onDelete: Cascade)
  point        BidScorePoint @relation(fields: [pointId], references: [id], onDelete: Cascade)
  supplier     BidSupplier   @relation(fields: [supplierId], references: [id], onDelete: Restrict)
  @@unique([expertId, pointId, supplierId])
  @@index([supplierId])
}
```

**③ `BidScoreReview`** — per 专家+供应商 核对状态

```prisma
model BidScoreReview {
  id           String    @id @default(cuid())
  expertId     String
  projectId    String
  supplierId   String
  status       String    @default("draft")     // draft | verified
  sourceDevice String?                          // tablet | desktop（最近一次写入）
  verifiedAt   DateTime?
  expert       BidExpert   @relation(...)
  @@unique([expertId, projectId, supplierId])
}
```

**④ `ExpertMemo`** — 手写备忘

```prisma
model ExpertMemo {
  id           String   @id @default(cuid())
  expertId     String
  projectId    String
  supplierId   String?                          // 可空：项目级 / 供应商级
  scoreItemId  String?                          // 可空：可挂在某评分项下
  contentText  String?                          // OCR 识别文字
  inkFileId    String?                          // 墨迹原图 MinIO FileAsset id
  sourceDevice String?                          // tablet | desktop
  createdAt    DateTime @default(now())
  @@index([expertId, projectId])
}
```

**⑤ `BidInvalidBid`** — 无效投标决议记录

```prisma
model BidInvalidBid {
  id          String   @id @default(cuid())
  projectId   String
  supplierId  String
  scoreItemId String                            // 触发废标的审查项（资格性/符合性）
  failCount   Int                               // 不通过票数
  totalCount  Int                               // 已判定专家数
  status      String   @default("invalid")      // invalid | revoked
  decidedAt   DateTime @default(now())
  revokedAt   DateTime?
  revokedBy   String?                           // 委员会 / 组长
  @@index([projectId, supplierId])
}
```

### 3.2 现有表改动

- **`BidSupplier`** 加冗余废标状态（便于查询/界面快速渲染）：
  ```prisma
  bidValidity  String  @default("valid")   // valid | invalid
  ```
- **`BidScoreRecord`** 语义变更（结构不动）：
  - `score` 从"专家手输"变为**汇总计算列** = 该 scoreItem 下所有勾中 point 的 `awardedScore` 之和。
  - `passed`（资格/符合性）= 该类所有客观 point 全 `checked=true` → 通过；任一不勾 → 不通过。
  - `reason` 保留（整项理由）。
- **`BidScoreItem`** 不动（大类）。细则下沉到 `BidScorePoint.evidenceHint`，大类 `scoringCriteria` 留作概述。
- **`BidExpert`** 补 `@relation` 到 `BidScorePointDecision` / `BidScoreReview` / `ExpertMemo`。

---

## 4. 打分流程与状态机

### 4.1 状态机（per 专家+供应商）

```
[空白] ──(平板/桌面 勾选打分)──▶ draft
draft  ──(桌面 核对:审阅+微调+确认)──▶ verified
全部供应商 verified + 无效投标判定完成 ──▶ reportConfirmed（锁定，不可改）
```

- draft / verified 在 `reportConfirmed` 前都可写、可改。
- **`draft → verified` 只能在桌面**点"核对确认"。
- 降级：全程桌面也走 `draft → verified`（核对关口不省）。

### 4.2 得分计算

- **客观 point**（`objective=true`）：`checked=true` → `awardedScore` 默认 = `fullScore`，可下调（≤ `fullScore`）；`checked=false` → 0。
- **主观 point**（`objective=false`）：专家直接填 `awardedScore`（0 ~ `fullScore`）。
- `BidScoreRecord.score` = Σ `awardedScore`（该 scoreItem 下所有 point）。
- 资格/符合性：该类所有客观 point 全 `checked=true` → `passed=true`；否则 `passed=false`。

### 4.3 双端职责

| 能力 | 桌面 tab（鼠标键盘） | 平板（触屏 PWA） |
|------|------|------|
| 看招投标文件 / 对照条款 / AI 分析 | ✅ 主力 | （可选只读） |
| checklist 勾选打分（B2） | ✅ 完整 | ✅ 完整（**同一组件**，触屏布局） |
| 档内微调 | ✅ | ✅ |
| 手写备忘 | 键盘输入文字 | ✅ 手写笔（OCR + 墨迹） |
| **核对确认 draft→verified** | ✅ **唯一** | ❌ |
| reportConfirm 锁定 | ✅ | ❌（防误触） |

"一模一样"靠**抽共享 checklist 打分组件**，桌面/平板只是外壳布局不同，调同一套 API、写同一份数据。

### 4.4 核对关口（决策：审阅 + 可微调 + 确认）

- 平板/桌面提交 → `draft`。
- 桌面打开核对视图：逐项审阅，**可微调** `awardedScore` / `note`，点"确认核对" → `verified`。
- 所有供应商 `verified` + 进度 100% → 可 `reportConfirm`。

---

## 5. 无效投标流程

### 5.1 触发与判定（实时聚合，过半制 — 决策 A + B）

- 每个专家独立在资格性/符合性 checklist 判定，**提交即计入**（不等核对确认）。
- 系统实时聚合：某审查项（`scoreItem`，资格性/符合性）"不通过"（`passed=false`）票数**严格过半** → 标记该供应商 `bidValidity=invalid`，写 `BidInvalidBid`（`failCount` / `totalCount` / `scoreItemId`）。
- **状态随每票更新（用户决策 B，接受跳变）**：UI 显示**当前票数进度**（如"废标判定中 · 不通过 2/3 票"），区分暂定态；`reportConfirmed` 时凝固最终态。

### 5.2 流转动作（标记 invalid 后）

1. 该供应商在**所有专家**的商务/技术/价格打分界面**置灰排除**，不再打分。
2. 已打的商务/技术/价格分：**记录保留**，靠 `bidValidity=invalid` 在汇总/排名时 **WHERE 过滤排除**（不需额外作废字段）。
3. 排名排除（复用 `generateEvaluationResults` 末位逻辑 `bid.service.ts:1201`）。
4. 决议写**审计 / 监督日志**。
5. **WS 广播活动里程碑**（如 `bid:validity:change`；**载荷只含 supplierId + 票数进度，不含任何分数**，不违反 `bid-events.ts:7` 铁律）→ 各专家端实时收到、界面置灰，实现"实时流转到显式状态"。
6. （可选）通知供应商 — 见 §12 未决。

### 5.3 可逆性（决策 D）

- `reportConfirmed` 前：委员会/组长可**复核撤销**（`BidInvalidBid.status=revoked`，`bidValidity` 回 `valid`）。
- `reportConfirmed` 后：不可逆。

### 5.4 复用现有逻辑

- 过半判定逻辑**从 `bid.service.ts:1140` 抽取为可复用函数** `evaluateInvalidBid(projectId, supplierId, scoreItemId)`，在专家提交审查结果后调用，与 `generateEvaluationResults` 共用。

---

## 6. 手写备忘

### 6.1 平板手写

- 本地 `<canvas>` + pointer events 实时渲染笔迹（低延迟，画在本地）。
- 保存：① 笔迹导出 PNG/PDF → MinIO（`inkFileId`，复用 `StorageService`）② 调 OCR 微服务 `:8100` → `contentText`（复用 `local-ai/OcrService`）③ 写 `ExpertMemo`。
- 挂载层级：项目级 / 供应商级 / 评分项级（`supplierId` / `scoreItemId` 可空）。

### 6.2 桌面

- 键盘输入 `contentText`（无手写）；可查看平板备忘的文字 + 调出墨迹原图。

---

## 7. 管理端：得分点编制

### 7.1 入口

复用 `bid-portal` `/bid/project/[id]?tab=standard`。

### 7.2 扩展

- 现有 `ScoreItem` 大类 CRUD 保留（`/bid/projects/:id/score-items`）。
- **新增得分点 CRUD**：`/bid/projects/:id/score-items/:itemId/points`。
- 模板 `applyScoreItemTemplate` 扩展为**带得分点**。
- UI：每个大类下可增删改得分点行（`name` / `fullScore` / `seq` / `evidenceHint` / `objective`）。
- **客观条款**（含技术评审客观项）由管理员制定；主观项标记 `objective=false`。

### 7.3 锁定

进评标阶段前编制完成并锁定（现有锁定点不变 — 评分标准在 stage 越过 standard phase 后锁定）。

---

## 8. 降级与并发

- **降级**：平板挂了 → 桌面独立完成（空白→draft→verified）。同一 checklist 打分组件保证体验一致。
- **并发**：多设备/多入口写同一 `BidScorePointDecision` → 靠 `@@unique([expertId, pointId, supplierId])` 幂等 upsert（last-write-wins）。分数汇总每次按最新 decisions 重算。
- **断网**：平板 PWA 本地暂存 point decisions（草稿 localStorage 机制已有 `page.tsx:228-239`），联网后同步。

---

## 9. API 变更清单

### 管理端（`bid`，角色 admin/bid_host）

- `GET / POST / PATCH / DELETE` `/bid/projects/:id/score-items/:itemId/points` — 得分点 CRUD
- `applyScoreItemTemplate` 扩展带得分点

### 专家端（`expert`，角色 bid_expert）

- 改造 `POST /expert/projects/:projectId/scores` — 接收 point 级 decisions（或新增 `…/point-decisions` 端点）
- 新增 `POST /expert/projects/:projectId/suppliers/:supplierId/review` — `draft → verified` 核对确认
- 新增 `GET /expert/projects/:projectId/suppliers/:supplierId/validity` — 废标状态 + 票数进度
- 新增 `POST/GET /expert/projects/:projectId/memos` — 手写备忘 CRUD

### 废标复核（`bid`，角色 admin/bid_host）

- 新增 `POST /bid/projects/:id/suppliers/:supplierId/invalid-bid/revoke` — 复核撤销（锁定前）

### 废标判定（内部）

- 抽取 `evaluateInvalidBid(projectId, supplierId, scoreItemId)`，专家提交审查后调用

---

## 10. 迁移与兼容

- **Prisma migration**：新增 5 表 + `BidSupplier.bidValidity` + 各 `@relation` 补全。
- **seed**：给现有 `BidScoreItem` 补充示例 `BidScorePoint`（演示用，尤其英雄项目）。
- **`BidScoreRecord.score` 语义变更**：新逻辑按 point 汇总；**向后兼容**——没有得分点的大类，专家仍可直接给 `BidScoreRecord.score`（退化为旧语义），保证渐进迁移不破坏现有项目。

---

## 11. 决策记录

| 决策点 | 选择 | 理由 |
|--------|------|------|
| 动机 | B 手写体验 + 双屏协同 | 屏幕小、看标书与打分来回切 |
| 连接方式 | WiFi 直连（封闭内网） | 人性化、工程最小、JWT 多点 OK、隔离在网络层 |
| 打分形态 | B2 二元勾选 + 档内微调 | 客观 + 主观兼顾 |
| 得分点细则来源 | 管理员手工录入（bid-portal standard tab） | seed 全空，AI 不可靠，MVP 先手工 |
| checklist 覆盖 | 客观条款全覆盖 + 主观微调；价格分公式 | 决策 2 |
| 手写备忘存储 | OCR 文字 + 墨迹原图 | 文字可检索、墨迹留痕；复用 :8100 + MinIO |
| 平板交付形态 | PWA 触屏路由 | 零新硬件、复用 Web 栈 |
| 降级对等 | 桌面与平板功能一模一样 | 决策 5 |
| 核对关口 | 审阅 + 可微调 + 确认，仅桌面 | 决策 6 |
| 废标阈值 | 过半制（复用现有） | 决策 A |
| 废标判定时机 | 实时聚合（接受票数跳变） | 决策 B |
| 废标范围 | 资格性 + 符合性 | 决策 C |
| 废标可逆性 | 锁定前可复核撤销；reportConfirmed 后不可逆 | 决策 D |

---

## 12. 未决 / 后续

- AI 从招标文件解析得分点（增强，非 MVP）。
- 无效投标是否通知供应商（需业务确认）。
- 平板 PWA 离线缓存/同步策略细节。
- 现有英雄项目的旧滑块打分数据是否需要回填为 point decisions（迁移时评估）。
