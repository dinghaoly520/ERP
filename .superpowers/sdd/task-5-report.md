# Task 5 Report — B2 publish 端点 + 锁定判定升级

## Commit

- **SHA:** `0e2397e5`
- **Subject:** `feat(bid): B2 评分标准发布动作 + 锁定判定(publishedAt)`
- **Branch:** `feat/score-standard-biz-p0`

## 1. `assertScoreItemsEditable` 签名升级

`apps/api/src/bid/bid.service.ts:1916`
```ts
private assertScoreItemsEditable(stage: BidStage, publishedAt: Date | null) {
  if (publishedAt || stage === 'EVALUATING' || stage === 'ARCHIVED') {
    throw new ConflictException({
      error: '评分标准已发布或项目已进入评标/归档阶段,已锁定',
      code: 'SCORE_ITEMS_LOCKED',
    });
  }
}
```

## 2. 5 调用点变更（file:line）

| # | Method | File:Line (post-edit) | select change | call change |
|---|--------|----------------------|---------------|-------------|
| a | `createScoreItem` | `bid.service.ts:1936` | `select: { stage: true, name: true, scoreStandardPublishedAt: true }` | `assertScoreItemsEditable(project.stage, project.scoreStandardPublishedAt)` |
| b | `updateScoreItem` | `bid.service.ts:1962` | `select: { stage: true, scoreStandardPublishedAt: true }` | same |
| c | `deleteScoreItem` | `bid.service.ts:1989` | `select: { stage: true, name: true, scoreStandardPublishedAt: true }` | same |
| d | `applyScoreItemTemplate` | `bid.service.ts:2104` | `select: { stage: true, name: true, scoreStandardPublishedAt: true }` | same |
| e | `assertScoreItemInProject` | `bid.service.ts:2016` | `include: { project: { select: { stage: true, scoreStandardPublishedAt: true } } }` | `assertScoreItemsEditable(item.project.stage as BidStage, item.project.scoreStandardPublishedAt)` |

## 3. `publishScoreStandard` service method

`apps/api/src/bid/bid.service.ts:2136-2164`
```ts
/** 发布评分标准:校验完整性 → 置 publishedAt → 此后写操作锁定。 */
async publishScoreStandard(projectId: string, actor: { userId: string; role: string; username: string }) {
  const project = await this.prisma.bidProject.findUnique({
    where: { id: projectId },
    select: { stage: true, scoreStandardPublishedAt: true, name: true },
  });
  if (!project) throw new BadRequestException({ error: '项目不存在', code: 'NOT_FOUND' });
  if (project.scoreStandardPublishedAt) {
    throw new ConflictException({ error: '评分标准已发布,不可重复发布', code: 'SCORE_STANDARD_ALREADY_PUBLISHED' });
  }
  await this.scoreStandardValidator!.assertScoreStandardComplete(projectId);

  const updated = await this.prisma.$transaction(async (tx) => {
    const result = await tx.bidProject.update({
      where: { id: projectId },
      data: { scoreStandardPublishedAt: new Date() },
    });
    await tx.bidSupervisionLog.create({
      data: {
        projectId, time: new Date(), role: '开标主持人',
        operatorId: actor.userId, operatorRole: actor.role,
        target: project.name, action: '编制评分标准', result: '发布评分标准', riskFlag: '无',
      },
    });
    return result;
  });
  this.gateway?.notifySupervisionLog(projectId, { role: '开标主持人', action: '编制评分标准', target: project.name, result: '发布评分标准', riskFlag: '无' });
  return updated;
}
```

Audit log write is inline (not refactored into `logScoreStdOp`) per Task 5 critical constraint — Task 6 will introduce the helper.

## 4. Controller publish endpoint

`apps/api/src/bid/bid.controller.ts:195-198`
```ts
@Post('projects/:id/score-items/publish')
@ApiOperation({ summary: '发布评分标准(发布后只读)' })
publishScoreStandard(@Param('id') id: string, @CurrentUser('sub') userId: string, @CurrentUser('role') role: string, @CurrentUser('username') username: string) {
  return this.bidService.publishScoreStandard(id, { userId, role, username });
}
```

Only the NEW endpoint receives `@CurrentUser` — existing 4 endpoints (`create/update/delete/applyTemplate`) untouched, deferred to Task 6.

## 5. e2e publish-loop case

`apps/api/test/bid.e2e-spec.ts:332-388`

Covers all 4 transitions:
- 残缺（1 项 maxScore=20, Σ≠100）→ `MAX_SCORE_SUM_NOT_100` (409)
- 补齐完整标准 → 201
- 此后 `POST /score-items` → `SCORE_ITEMS_LOCKED` (409)
- 重复 publish → `SCORE_STANDARD_ALREADY_PUBLISHED` (409)

Cleanup deletes BidScorePoint / BidScoreItem / BidSupervisionLog / BidProject for the temp project.

## 6. Verification output

```
pnpm --filter api test:e2e -- test/bid.e2e-spec.ts
Test Suites: 1 passed, 1 total
Tests:       14 passed, 14 total
Time:        4.757 s
```

```
pnpm --filter api exec tsc --noEmit
(no output — clean)
```

## 7. Files Changed

- `water-erp/apps/api/src/bid/bid.service.ts` — `assertScoreItemsEditable` signature + 5 call-site selects + `publishScoreStandard` method (+58/−14)
- `water-erp/apps/api/src/bid/bid.controller.ts` — `publish` endpoint (+6)
- `water-erp/apps/api/test/bid.e2e-spec.ts` — publish-loop case (+48)

## 8. Self-Review

- ✅ `assertScoreItemsEditable(stage, publishedAt)` — locks when `publishedAt != null || stage in {EVALUATING, ARCHIVED}` (per brief).
- ✅ All 5 call sites select `scoreStandardPublishedAt` and pass it through.
- ✅ `publishScoreStandard` order: not-found → already-published → completeness → `$transaction(update + supervision log)` → gateway notify.
- ✅ Audit log inline with `operatorId`/`operatorRole` from `actor` — no `logScoreStdOp` pre-created (Task 6 scope).
- ✅ Controller endpoint is the only NEW place with `@CurrentUser`; existing 4 endpoints untouched.
- ✅ Used `scoreStandardValidator!.assertScoreStandardComplete(...)` to match Task 3 `!` pattern at call sites (brief omitted `!` but the field is `@Optional()`, so strict-nullable would fail without `!`).
- ✅ e2e temp project includes required schema fields (`procurementMethod`/`openTime`/`deadline`) — brief omitted them; added to match Prisma schema, mirroring Task 3 e2e pattern.
- ✅ All 14 e2e cases green (10 pre-existing + 3 from Task 3 + 1 new); tsc clean.

## 9. Concerns

- **Brief omission 1**: Brief's Step 3 code uses `this.scoreStandardValidator.assertScoreStandardComplete(...)` (no `!`). I used `!` to match the Task 3 pattern at the 5 existing call sites — without it TypeScript strict null check fails. No behavior change.
- **Brief omission 2**: Brief's Step 5 e2e `prisma.bidProject.create()` data omits required schema fields (`procurementMethod`, `openTime`, `deadline`). I added them (same shape as Task 3 e2e projects) — test logic is verbatim from brief.
- **Branch**: Commit landed on `feat/score-standard-biz-p0` (the active Task-chain branch), not `main`. No push performed per project policy.
