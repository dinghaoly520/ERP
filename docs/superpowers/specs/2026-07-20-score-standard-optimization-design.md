# 评分标准编制优化设计 — 业务线 P0

| 字段 | 值 |
|------|-----|
| 日期 | 2026-07-20 |
| 状态 | 已确认，待实现 |
| 范围 | `apps/api/src/bid/` 评分标准编制（业务线 P0：B1 + B2 + B3） |
| 约束级别 | 折中 —— 合规要点到位，价格分公式引擎 / 评分标准版本化不做 |
| 实施顺序 | B1 → B2 → B3（业务线 P0 优先，提取线 E1/E2 列为下一阶段） |

---

## 1. 背景

评分标准编制（`BidScoreItem` / `BidScorePoint`）当前链路存在三类问题（详见 2026-07-20 评审）：

1. **合规边界**：`assertScoreItemsEditable`（`bid.service.ts:1919-1926`）只锁 `EVALUATING` / `ARCHIVED`，意味着 `DOWNLOAD` / `SUBMIT` / `OPENING` 三个阶段都能改评分标准。这与招投标「评标办法一经发布不得修改」的监管要求冲突 —— 开标过程中仍可改动满分/类别，供应商看到的评标办法与实际评标所用可能不一致。
2. **完整性闸门缺失**：`startEvaluation`（`bid.service.ts:576-583`，G9）仅校验 `bidScoreItem.count > 0`，不校验打分类（BUSINESS/TECHNICAL/PRICE）的 `ΣmaxScore === 100`，也不校验每个评分项是否至少有 1 个得分点。残缺标准可推进到评标阶段，`generateEvaluationResults`（`bid.service.ts:1090-1269`）随后静默生成 0 分 / 残缺排名。
3. **审计无法归因**：`BidSupervisionLog`（`schema.prisma:599-612`）**无操作者字段**，`role` 列硬编码中文展示字符串（`'开标主持人'`）；`updateScoreItem`（`bid.service.ts:1961-1980`）是评分标准写操作中**唯一不写审计**的方法。监督端无法回答「谁、在何时、把哪个评分项改成了什么」。

提取线问题（`score-point-extractor.service.ts` 硬截断 `tenderText.slice(0, 10000)`、无 RAG、无溯源、PRICE 无差别提取）真实存在，但列入后续阶段，不在本轮范围。

**关键旁证**：`bid.service.ts:464` 紧邻 `bidSupervisionLog.create` 已有一条 `auditLog.create({ data: { userId: actorId, ... } })` —— `actorId` 早就在调用上下文里，只是没透传给 `BidSupervisionLog`。B3 改造成本极低。

---

## 2. 目标 / 非目标

### 目标
- **B1**：评分标准写操作与 `startEvaluation` 的完整性校验集中化、强一致。
- **B2**：引入「发布评分标准」动作，发布后只读；锁定时机符合合规。
- **B3**：审计精确记录操作者；补 `updateScoreItem` 审计。

### 非目标（本轮不做）
- 价格分公式引擎（PRICE 按报价公式的真实算法）。
- 评分标准版本化 / 多版本快照。
- 软删（`deletedAt`）—— 本轮保留物理删，删除审计快照列为 P2。
- 提取线优化（E1 RAG 定位 / E2 fullScore 归一化）—— 同属 P0 但分阶段，下一轮做。
- 监督端 UI 展示 `operatorId` —— 后端先记录，展示改造随后。

---

## 3. 取舍决策（已拍板）

| 决策点 | 选择 | 理由 |
|--------|------|------|
| 锁定方式 | ①A：发布动作 + `scoreStandardPublishedAt` | 「评标办法公布」的合规锚点；改动 1 字段 + 1 端点；保留管理员「编制完主动确认」语义 |
| 删除策略 | ②A：物理删 + 审计快照（P2 落地） | 软删会牵动 `listScoreItems` / `submitScore` / `generateEvaluationResults` 多条查询路径；折中级 ROI 不足 |
| 招标文件定位（提取线） | ③A：规则定位优先 + embedding 兜底（E1，后续） | 招标文件几乎都有「评标办法」专章，规则命中率高、省 token；`EmbeddingService` 已存在可作兜底 |
| `publish` 是否强制完整性 | 是 | 发布 = 完整承诺；与 `startEvaluation` 复用同一 `assertScoreStandardComplete` |
| `operatorId` 是否加 relation | 否 | `BidSupervisionLog` 大量记录由「系统」自动产生、无对应用户，join 会丢数据；与姐妹表 `BidSupervisionAnnotation.createdBy` 同策略（`String?`，无 relation） |

---

## 4. 详细设计

### 4.1 B1 — 完整性闸门

**新组件**：`apps/api/src/bid/score-standard-validator.service.ts`

```ts
@Injectable()
export class ScoreStandardValidator {
  constructor(private readonly prisma: PrismaService) {}

  // 通过性类别（QUALIFICATION/RESPONSIVE）maxScore 必须 = 0
  assertPassFailMaxScore(category: ScoreCategory, maxScore: number): void;

  // item 的得分点 ΣfullScore + 增量 ≤ item.maxScore（事务内调用）
  async assertPointsSumWithinMax(
    tx: PrismaTransaction, itemId: string, itemMaxScore: number, delta: number,
  ): Promise<void>;

  // 评分标准整体完整：打分类 ΣmaxScore === 100；每个打分类 item ≥ 1 个得分点（通过性项豁免）
  async assertScoreStandardComplete(projectId: string): Promise<void>;
}
```

**校验规则与失败码**：

| 方法 | 规则 | 失败码 | HTTP |
|------|------|--------|------|
| `assertPassFailMaxScore` | `isPassFailCategory(category)` 且 `maxScore !== 0` | `PASS_FAIL_MUST_BE_ZERO` | 400 |
| `assertPointsSumWithinMax` | 现有 `ΣfullScore` + `delta` > `itemMaxScore` | `POINTS_SUM_EXCEEDS_MAX` | 409 |
| `assertScoreStandardComplete` | 打分类（BUSINESS/TECHNICAL/PRICE）`ΣmaxScore !== 100` | `MAX_SCORE_SUM_NOT_100` | 409 |
| `assertScoreStandardComplete` | 任一**打分类**评分项（BUSINESS/TECHNICAL/PRICE）`points.count === 0`（通过性项豁免） | `SCORE_ITEM_HAS_NO_POINTS` | 409 |

> 注：**通过性类别（QUALIFICATION/RESPONSIVE）豁免「≥1 得分点」**——专家可对整项做 `passed` 裁定（`BidScoreRecord.passed`，见 `schema.prisma:467`），不强制 checklist。仅打分类项要求 ≥1 得分点。又因 `assertPassFailMaxScore` 保证通过性项 `maxScore === 0`，「打分类 Σ=100」等价于「全部项 Σ=100」。本轮 PRICE 仍属打分类、要求 ≥1 点；待 B6（P1）落地后再特判 PRICE 豁免（改为公式分）。

**调用点改动**：

| 方法 | 加什么 | 备注 |
|------|--------|------|
| `createScoreItem` | `assertPassFailMaxScore(category, maxScore)` | |
| `updateScoreItem` | `assertPassFailMaxScore`（当 `category`/`maxScore` 变更时） | |
| `createScorePoint` | `assertPointsSumWithinMax` | **需包事务**（当前直接 `prisma.bidScorePoint.create`） |
| `updateScorePoint` | `assertPointsSumWithinMax`（`delta = newFullScore − oldFullScore`） | **需包事务** |
| `batchCreateScorePoints` | `assertPointsSumWithinMax`（`delta = ΣnewPoints.fullScore`） | **需包事务** |
| `startEvaluation` | 用 `assertScoreStandardComplete` 替换现有 G9（`count > 0`） | 升级为强校验 |
| `publishScoreStandard`（B2 新增） | `assertScoreStandardComplete` | 发布 = 完整承诺 |

### 4.2 B2 — 发布动作 + 锁定时机

**Schema 改动**：`BidProject` 增加
```prisma
scoreStandardPublishedAt DateTime?
```

**新端点**：`POST /bid/projects/:id/score-items/publish`（与现有 `/score-items/template` 风格一致）

```ts
async publishScoreStandard(projectId: string, actor: Actor): Promise<BidProject> {
  const project = await this.prisma.bidProject.findUnique({
    where: { id: projectId },
    select: { stage: true, scoreStandardPublishedAt: true, name: true },
  });
  if (!project) throw new BadRequestException({ error: '项目不存在', code: 'NOT_FOUND' });
  if (project.scoreStandardPublishedAt) {
    throw new ConflictException({ error: '评分标准已发布，不可重复发布', code: 'SCORE_STANDARD_ALREADY_PUBLISHED' });
  }
  await this.scoreStandardValidator.assertScoreStandardComplete(projectId); // 复用 B1

  const published = await this.prisma.$transaction(async (tx) => {
    const updated = await tx.bidProject.update({
      where: { id: projectId },
      data: { scoreStandardPublishedAt: new Date() },
    });
    await this.logScoreStdOp(tx, projectId, project, actor, '编制评分标准', '发布评分标准');
    return updated;
  });
  this.gateway?.notifySupervisionLog(projectId, {
    role: '开标主持人', action: '编制评分标准', target: project.name,
    result: '发布评分标准', riskFlag: '无',
  });
  return published;
}
```

**锁定判定升级**：`assertScoreItemsEditable` 改签名
```ts
private assertScoreItemsEditable(stage: BidStage, publishedAt: Date | null) {
  if (publishedAt || stage === 'EVALUATING' || stage === 'ARCHIVED') {
    throw new ConflictException({
      error: '项目已进入评标/归档阶段，或评分标准已发布，已锁定',
      code: 'SCORE_ITEMS_LOCKED',
    });
  }
}
```
所有调用点（`createScoreItem` / `updateScoreItem` / `deleteScoreItem` / `assertScoreItemInProject` / `applyScoreItemTemplate`）的 `findUnique` 增加 `select: { ..., scoreStandardPublishedAt: true }`，并把 `publishedAt` 传入。

**前端**（`apps/bid-portal/src/app/(dashboard)/bid/standard/page.tsx` + `src/lib/api/bid.ts`）：
- `lib/api/bid.ts` 新增 `publishScoreStandard(projectId)` → `POST .../score-items/publish`；`ScoreItem` 同级的项目查询多取 `scoreStandardPublishedAt`。
- `page.tsx` 的 `locked = !!publishedAt || stage === 'EVALUATING' || stage === 'ARCHIVED'`。
- 锁定横幅区分文案：已发布 →「评分标准已发布（发布于 YYYY-MM-DD HH:mm），不可修改」；已进入评标 → 沿用旧文案。
- 顶部（`!locked` 时）新增「**发布评分标准**」按钮，点击弹确认框：本地展示完整性自检结果（打分类 `ΣmaxScore` 是否 = 100、每项是否有点），确认后调 `publishScoreStandard`；失败（后端 409）回显错误码对应的中文提示。

### 4.3 B3 — 审计归因

**Schema 改动**：`BidSupervisionLog` 增加
```prisma
operatorId   String?   // 操作者用户 id（系统自动产生的记录留空）
operatorRole String?   // 操作者 User.role 英文枚举（admin/bid_host/procurement_staff/leader/staff）
```
不加 relation（理由见 §3）。`role` 中文列保留作粗分类展示，与现有数据一致。

**Controller 改动**（`bid.controller.ts`）：5 个评分标准端点加 `@CurrentUser`
```ts
createScoreItem(@Param('id') id, @Body() dto, @CurrentUser('sub') userId, @CurrentUser('role') role, @CurrentUser('username') username)
```
涉及：`createScoreItem` / `updateScoreItem` / `deleteScoreItem` / `applyScoreItemTemplate` / `publishScoreStandard`。
（`request.user` payload = `{ sub, username, role }`，见 `auth.types.ts:1-5`、`auth.service.ts:121-124`、`auth.guard.ts:28-36`，三个字段均可用 `@CurrentUser(...)` 直接取。）

**新 helper**（`bid.service.ts` 私有方法，所有评分标准写操作复用）：
```ts
type Actor = { userId: string; role: string; username: string };

private async logScoreStdOp(
  tx: PrismaTransaction,
  projectId: string,
  project: { name: string },
  actor: Actor,
  action: string,
  result: string,
) {
  await tx.bidSupervisionLog.create({
    data: {
      projectId,
      time: new Date(),
      role: '开标主持人',          // 中文粗分类（与现有数据一致，保留展示语义）
      operatorId: actor.userId,    // ← 新增精确归因
      operatorRole: actor.role,    // ← 英文枚举
      target: project.name,
      action,
      result,
      riskFlag: '无',
    },
  });
}
```

**`updateScoreItem` 补审计**：当前是评分标准写操作中唯一不写审计的。改为事务，记录 diff：
```ts
async updateScoreItem(projectId, itemId, dto, actor) {
  // ... 锁定校验、归属校验 ...
  const result = `修改评分项「${existing.name}」：${describeDiff(existing, dto)}`;
  // 例：「maxScore 50→30」「category TECHNICAL→BUSINESS」「name 技术方案→技术评分」
  return this.prisma.$transaction(async (tx) => {
    const updated = await tx.bidScoreItem.update({ where: { id: itemId }, data: { ... } });
    await this.logScoreStdOp(tx, projectId, project, actor, '编制评分标准', result);
    return updated;
  });
}
```
`describeDiff` 仅对实际变更的字段产文本，无变更时不写审计记录（避免噪声）。

`createScoreItem` / `deleteScoreItem` / `applyScoreItemTemplate` 现有审计逻辑迁移到 `logScoreStdOp`，补上 `operatorId` / `operatorRole`。

---

## 5. Schema 改动汇总（一次 migration）

```prisma
model BidProject {
  // ...
  scoreStandardPublishedAt DateTime?   // 新增
}

model BidSupervisionLog {
  // ...
  operatorId   String?                 // 新增
  operatorRole String?                 // 新增
}
```

migration 命令：`prisma migrate dev --create-only` → 审核 SQL → `prisma migrate resolve --applied`（或 `PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION=1`）。三个新字段均可空，向后兼容现有数据。

---

## 6. 数据流（发布闭环）

```
编制期（stage ∉ {EVALUATING,ARCHIVED}，publishedAt = null）
  create / update / delete
    → ScoreStandardValidator 校验（maxScore=0 / Σpoints≤max）
    → 写 BidScoreItem / BidScorePoint（事务）
    → logScoreStdOp 写 BidSupervisionLog（带 operatorId / operatorRole）

管理员点「发布评分标准」
  publishScoreStandard
    → assertScoreStandardComplete（打分类 Σ=100 + 每个打分类项 ≥1 得分点）
    → 事务：设 scoreStandardPublishedAt = now() + 审计
    → gateway 推送

发布后
  assertScoreItemsEditable 因 publishedAt ≠ null 锁定全部写操作（409 SCORE_ITEMS_LOCKED）

进入评标
  startEvaluation → assertScoreStandardComplete（双保险，防数据被外部 SQL 绕过）
```

---

## 7. 新增错误码

| code | HTTP | 触发 | 说明 |
|------|------|------|------|
| `PASS_FAIL_MUST_BE_ZERO` | 400 | `assertPassFailMaxScore` | 通过性类别 maxScore ≠ 0 |
| `POINTS_SUM_EXCEEDS_MAX` | 409 | `assertPointsSumWithinMax` | 得分点 ΣfullScore > 大类 maxScore |
| `MAX_SCORE_SUM_NOT_100` | 409 | `assertScoreStandardComplete` | 打分类 ΣmaxScore ≠ 100 |
| `SCORE_ITEM_HAS_NO_POINTS` | 409 | `assertScoreStandardComplete` | 打分类项无得分点（通过性项豁免） |
| `SCORE_STANDARD_ALREADY_PUBLISHED` | 409 | `publishScoreStandard` | 重复发布 |

前端需为每个 code 提供中文提示。

---

## 8. 测试计划

### 单元测试（`score-standard-validator.spec.ts`，co-located）
- `assertPassFailMaxScore`：QUALIFICATION + maxScore=0 通过；QUALIFICATION + maxScore=5 抛 400；TECHNICAL + maxScore=50 通过。
- `assertPointsSumWithinMax`：现有 30 + delta 15 ≤ 50 通过；现有 30 + delta 25 > 50 抛 409；delta 为负（删点）通过。
- `assertScoreStandardComplete`：打分类 Σ=100 + 全打分类项有点 → 通过；Σ=55 → 抛 409 `MAX_SCORE_SUM_NOT_100`；某**打分类**项无点 → 抛 409 `SCORE_ITEM_HAS_NO_POINTS`；通过性项无点（走 `passed` 裁定）→ 通过。

### E2E 测试（`apps/api/test/bid`，cookie auth）
1. 残缺标准（Σ=55）→ `publish` 返回 409 `MAX_SCORE_SUM_NOT_100`。
2. 完整标准 → `publish` 成功 → 此后 `create/update/delete` 均返回 409 `SCORE_ITEMS_LOCKED`。
3. 通过性类别提交 maxScore=5 → 400 `PASS_FAIL_MUST_BE_ZERO`。
4. 得分点 fullScore 合计超出大类满分 → 409 `POINTS_SUM_EXCEEDS_MAX`。
5. `updateScoreItem` 改 maxScore 后，`BidSupervisionLog` 新增一条含 `operatorId`、`result` 含「50→30」字样。
6. 重复 `publish` → 409 `SCORE_STANDARD_ALREADY_PUBLISHED`。

---

## 9. 实施风险

1. **种子数据撞新闸门**：`startEvaluation` 升级为 `assertScoreStandardComplete` 后，种子项目的 `BidScoreItem` 若不满足「打分类 Σ=100 + 每个打分类项 ≥1 得分点」，启动评标会 409。实施前必须检查 `apps/api/prisma/seed-data/` 中的评分项快照，缺则补齐（尤其补 `BidScorePoint` 种子）。这是正向暴露残缺数据，但 seed 须同步更新。
2. **事务边界变更**：`createScorePoint` / `updateScorePoint` / `batchCreateScorePoints` / `updateScoreItem` 由「直接 prisma 写」改为 `prisma.$transaction`。需确认这些方法返回值结构不变（事务内 return 即可），且 `assertScoreItemInProject` 在事务外先调用、事务内不再重复读 stage（避免 TOCTOU；可接受，因锁是发布/阶段级，非行级并发）。
3. **`assertScoreItemsEditable` 签名变更**：所有调用点都要改。漏改会在编译期暴露（TS 签名）。
4. **前端 `stage` 缓存滞后**：本轮保留 `stage` 一次性拉取；发布成功后前端用返回的 `publishedAt` 即时置 `locked = true`，避免再请求。若他人推进阶段导致本地 `locked` 失准，提交时后端 409 兜底 + 前端回滚提示。

---

## 10. 后续阶段（占位，本轮不做）

| 阶段 | 内容 | 优先级 |
|------|------|--------|
| 提取线 P0 | E1：规则定位 + embedding 兜底替代 `slice(0,10000)`；E2：fullScore 归一化 + `adjusted` 标记 | 下一轮 |
| P1 | B5：跨「通过性↔打分」类切换冲突校验；B6：PRICE 轻处理（禁用得分点）；E3：溯源 `evidenceSection` + `confidence`；E4：去重；E5：PRICE 跳过提取；E6：LLM 失败降级 | |
| P2 | B4：物理删 + 审计快照（删除前落 `name/category/maxScore/scoreRecords 条数`）；E7：公告重发清缓存 | |

监督端 UI 展示 `operatorId`（join `User` 显示姓名 + 真实角色中文映射）可在 B3 后端落地后随时补，不阻塞本轮。

---

## 11. 实施顺序

用户指定：**业务线 P0 优先**。

1. **B1** 先行：新增 `ScoreStandardValidator`，接入 `createScoreItem` / `updateScoreItem` / 得分点 CRUD / `startEvaluation`。单元测试先行。
2. **B2**：schema migration（`scoreStandardPublishedAt`）+ `publishScoreStandard` 端点 + `assertScoreItemsEditable` 签名升级 + 前端发布按钮与锁定横幅。
3. **B3**：schema migration（`operatorId` / `operatorRole`）+ Controller `@CurrentUser` + `logScoreStdOp` helper + `updateScoreItem` 补审计。可与 B2 的 migration 合并为一次。

B1 与 B3 的 Validator / helper 可同一 PR；B2 涉及前端，建议独立 PR 便于评审。
