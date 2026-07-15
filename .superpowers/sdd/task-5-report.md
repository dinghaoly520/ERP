# Task 5: 代评 submitScore 同步（复用纯函数）— TDD

## Changes

### `apps/api/src/bid/bid.service.ts`
- **L29** (import block): added `import { recomputeExpertProgress, recomputeItemFromDecisions } from './score-recalculate.helper';`
- **L1298-1329** (`submitScore`): inserted checklist-decision handling block after the maxScore check — queries `bidScorePoint`, validates `pointDecisions` against points (POINT_NOT_IN_ITEM / POINT_SCORE_EXCEEDS_MAX), calls `recomputeItemFromDecisions` to derive `finalScore`/`finalPassed`, and upserts each `bidScorePointDecision`. Backward-compat: block is skipped when no points or no `pointDecisions`.
- **L1340-1348** (`bidScoreRecord.upsert`): replaced `dto.score`/`dto.passed` with `finalScore`/`finalPassed`.
- **L1388-1393**: replaced inline progress/totalScore recompute (7 prisma calls + math) with `recomputeExpertProgress(this.prisma, dto.expertId, projectId)` + single `bidExpert.update`. Non-transactional behavior preserved (uses `this.prisma` directly per brief).

### `apps/api/src/bid/bid.service.spec.ts`
- **L89-91** (`beforeEach` mock): added `bidScorePoint` + `bidScorePointDecision` mocks.
- **L838-862** (new test): "代评：有 points 走 decision 汇总，与专家端口径一致" — verifies `bidScorePointDecision.upsert` is called once and `bidScoreRecord.upsert` receives `update.score = 15` (Σ of pointDecisions, not the `score: 0` from dto).

## TDD Evidence
- **RED**: new test failed with `Expected number of calls: 1, Received: 0` on `bidScorePointDecision.upsert`; all 115 pre-existing tests still passed.
- **GREEN**: after impl, 116/116 pass in `bid.service.spec`; 6/6 pass in `score-recalculate.helper.spec` (regression).

## tsc
`npx tsc --noEmit` clean (no output).

## Self-Review

**KEY: Does the proxy path produce the SAME score as the expert path for identical pointDecisions?**
YES. Both paths now share the same pure helpers:
- `recomputeItemFromDecisions({ category, points, decisions })` — identical signature, identical inputs (`points.map(p => ({ id, objective, fullScore }))`, `decisionMap = new Map(dto.pointDecisions.map(...))`). Produces the same `{ score, passed }` for identical inputs.
- `recomputeExpertProgress(tx, expertId, projectId)` — identical signature; proxy passes `this.prisma`, expert passes the `tx` from `$transaction`, but the function only reads via the same prisma client methods.
- Same validation error codes (POINT_NOT_IN_ITEM, POINT_SCORE_EXCEEDS_MAX).
- Same `bidScorePointDecision` upsert contract (unique `expertId_pointId_supplierId`).

**Pre-existing submitScore tests still green?**
YES — all 3 pre-existing tests pass unchanged:
- "validates expert belongs to project" — fails before reaching new block.
- "validates scoreItem belongs to project" — fails before reaching new block.
- "upserts score record on valid input" — `bidScorePoint.findMany` defaults to `[]` → `points.length === 0` → new block skipped → `finalScore = Number(dto.score) = 10` → identical upsert assertion.

## Concerns / Notes
- The proxy path remains non-transactional (per brief) — TOCTOU window vs. ExpertService's `$transaction` is a known, accepted difference. R1 (score divergence) is mitigated because both paths converge on the same pure helpers.
- Audit log still records `dto.score` (the raw input), not `finalScore`. This preserves the existing audit contract (what the operator sent) and is arguably more useful for forensics; flagging in case reviewers expect `finalScore`.

## Fix (I1)

`pnpm --filter api test -- bid.service.spec` → 116 passed, 0 failed (output pristine).
