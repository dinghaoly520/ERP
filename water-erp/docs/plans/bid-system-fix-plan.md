# Plan: 开评标系统全面修复

> Generated: 2026-06-17 | Based on comprehensive audit of bid portal + backend bid service

---

## Problem Analysis

The audit revealed 18 issues across 4 severity levels. The fundamental problems are:

1. **Data integrity is at risk** — 6 write methods lack transaction wrapping, meaning partial failures can corrupt the database. `archiveAll()` has a particularly dangerous race condition where concurrent calls can create duplicate archive items and skip validation.

2. **A production security hole exists** — `simulateDanger` allows any authenticated user to mark a supplier's bid as DANGER, bypassing all cryptographic integrity checks. This is a sabotage vector in a bidding system where integrity is paramount.

3. **Performance degrades badly at scale** — `generateEvaluationResults()` does N+1 queries; 6 models lack indexes on `projectId`. A project with 50 suppliers generates 50+ sequential DB round-trips.

4. **Frontend fragility** — No `error.tsx` or `loading.tsx` boundaries mean a single component crash can white-screen the entire page. Duplicate toast errors degrade UX on every failed API call.

### What we're optimizing for

- **Correctness** over speed: Transaction fixes take priority over performance
- **Security** over convenience: `simulateDanger` must be gated
- **Reliability** over features: Error boundaries and graceful degradation before new functionality
- **Consistency** over cleverness: Standard patterns (`loading.tsx`, typed API functions) over ad-hoc implementations

---

## First-Principles Breakdown

### True constraints

1. **Prisma's `$transaction` requires all writes to use the passed `tx` client** — this is the root cause of the `decryptSupplier` bug (using `this.prisma` inside the callback). Fixing this requires careful code review of every line inside transaction callbacks.

2. **Database indexes require a migration** — `prisma migrate dev` generates the migration file. This is a safe, reversible operation.

3. **Next.js `error.tsx` must be a Client Component** — it wraps the page in an ErrorBoundary. Adding it won't change the existing behavior of pages that already handle errors; it adds a safety net for unhandled errors.

4. **Removing `simulateDanger` may break tests** — need to check if any test or E2E flow depends on it.

5. **The duplicate toast is architectural** — `fetchApi` in `api.ts` fires `toast.error()` for every non-2xx response. Pages also `.catch(e => toast.error(...))`. We can't remove it from one place without auditing all consumers.

### What can be simplified

- The "7 pages repeat project selection" pattern can be extracted to a single hook without changing any page's behavior
- `loading.tsx` and `error.tsx` are single-file additions per route segment, not rewriting existing code
- Dead code removal is purely subtractive — no risk of breakage if we verify references first

---

## Proposed Approach

**Two parallel tracks, gated by a single sequential prerequisite:**

Track A (Backend): Transaction fixes → Index migration → N+1 fix → simulateDanger gate

Track B (Frontend): Error boundaries → Dead code removal → Toast fix → Hook extraction → WebSocket visibility → Audio context fix → API consistency

The prerequisite is the DB migration (indexes), which must be committed before any code that depends on the new indexes.

### Why this order

1. **Transaction fixes first** — they're the highest risk to data integrity. Every other fix is cosmetic or performance-related compared to partial writes corrupting the database.
2. **Index migration next** — it's a prerequisite for the N+1 fix (the new query pattern benefits from the `@@index([scoreItemId, supplierId])` on `BidScoreRecord`).
3. **`simulateDanger` gate** — simple conditional change, low risk, high security impact.
4. **Frontend error boundaries** — these don't change any existing behavior; they add a safety net. Low risk, high reliability gain.
5. **Dead code and toast fix** — pure subtraction, no new logic.
6. **Hook extraction and API consistency** — refactoring, higher risk of regression, done last when all other changes are stable.

---

## Alternative Approaches Considered

| Approach | Pros | Cons | Verdict |
|----------|------|------|---------|
| **A: Fix everything in one massive PR** | Single review, single deploy | 18 changes touching 15+ files; impossible to roll back individually; high regression risk | ❌ Rejected |
| **B: Fix only critical + high, defer medium/low** | Faster, less risk | Leaves known bugs (wrong DELETE ID, dead code) in production | ❌ Rejected — the medium items include actual bugs |
| **C: Sequential PRs by severity (chosen)** | Each PR is reviewable, reversible, and independently testable | More commits, more coordination | ✅ Chosen |

---

## Potential Issues & Edge Cases

1. **Transaction wrapping may expose latent bugs** — if a method currently "succeeds" despite partial failure (stage updated but log failed), wrapping in a transaction will cause the ENTIRE operation to fail. This is correct behavior, but may surface as "new" errors to users.

2. **Index migration on large tables** — if `BidOpeningRecord` or `BidSupervisionLog` have millions of rows, `CREATE INDEX` could lock the table briefly. For the current seed-data scale, this is milliseconds.

3. **`@@unique([projectId, name])` on `BidArchiveItem` may fail migration** — if duplicate entries already exist from previous race conditions, the migration will fail. Need to add a dedup step before the unique constraint.

4. **Removing `simulateDanger` may require updating the DTO** — if any frontend code or test sends this field, we need to update it simultaneously or make it a no-op (accept but ignore) rather than rejecting the request.

5. **`error.tsx` boundaries won't catch errors in `loading.tsx`** — this is expected Next.js behavior. Both files are needed for full coverage.

---

## Todo List

### Phase 1: 🔴 Critical — Data Integrity & Security (est. 2-3 hours)

- [ ] **1.1** Wrap `openSubmission()` in `$transaction`: move `stage=BidStage.SUBMIT` update + `supervisionLog.create` + audit log into a single `this.prisma.$transaction(async (tx) => {...})`. Use `tx` for all writes.
- [ ] **1.2** Wrap `startEvaluation()` in `$transaction`: stage update + supervision log + audit log.
- [ ] **1.3** Wrap `enterOpeningRecord()` in `$transaction`: `findFirst` + `create`/`update` + supervision log. This fixes the check-then-act race.
- [ ] **1.4** Wrap `resolveOpeningDispute()` in `$transaction`: opening record update + BidSupplier status update + supervision log.
- [ ] **1.5** Wrap `createScoreItem()` and `deleteScoreItem()` in `$transaction`: score item mutation + supervision log.
- [ ] **1.6** Fix `archiveAll()`: (a) Move `ensureArchiveItems()` inside the `$transaction` block. (b) Move the counts check inside the transaction. (c) Use `tx` for ALL queries inside the callback.
- [ ] **1.7** Add `@@unique([projectId, name])` on `BidArchiveItem` in `schema.prisma` + generate migration. Include dedup step in migration SQL.
- [ ] **1.8** Fix `decryptSupplier`: Replace `this.prisma.supplierBidSubmission.findUnique` and `this.prisma.fileAsset.findUnique` inside the `$transaction` callback with `tx.supplierBidSubmission.findUnique` and `tx.fileAsset.findUnique`.
- [ ] **1.9** Defer WebSocket notifications in `decryptSupplier` and `startOpeningInternal` to AFTER the transaction commits (move `this.gateway?.send*` calls outside the `$transaction` callback).
- [ ] **1.10** Gate `simulateDanger`: In `DecryptSupplierDto`, keep the field as `@IsBoolean() @IsOptional()`. In `bid.service.ts`, check `process.env.NODE_ENV !== 'production'` before honoring it. Return a clear error if attempted in production.
- [ ] **1.11** Fix frontend DELETE bug: In `supervise/page.tsx`, track the returned annotation `id` from the POST response and use that `id` in the DELETE call instead of `s.id` (which is the supplier's ID).

### Phase 2: 🟠 High — Performance & Reliability (est. 1-2 hours)

- [ ] **2.1** Add `@@index([projectId])` to: `BidOpeningRecord`, `BidSupervisionLog`, `BidClarification`, `BidScoreItem`, `BidArchiveItem` in `schema.prisma`.
- [ ] **2.2** Add `@@index([scoreItemId, supplierId])` to `BidScoreRecord` in `schema.prisma`.
- [ ] **2.3** Generate and apply Prisma migration for all index changes (Phase 1.7 + Phase 2.1 + Phase 2.2 combined).
- [ ] **2.4** Fix N+1 in `generateEvaluationResults()`: Replace the per-supplier `bidScoreRecord.findMany` loop (line ~793) with a single `findMany({ where: { supplierId: { in: activeIds } } })` and group in memory with a `Map<supplierId, scores[]>`.
- [ ] **2.5** Create `loading.tsx` for all 6 bid sub-routes (`open/`, `evaluate/`, `supervise/`, `archive/`, `clarifications/`, `standard/`). Each renders `<TableSkeleton />` or equivalent.
- [ ] **2.6** Create `error.tsx` for ALL 7 bid routes (including root `bid/`). Each uses the `'use client'` Error Boundary pattern with a "重试" (retry) button calling `reset()`.

### Phase 3: 🟡 Medium — Frontend Architecture & UX (est. 2-3 hours)

- [ ] **3.1** Fix duplicate toast: Remove `toast.error(message, { id, duration: 5000 })` from `fetchApi` in `apps/bid-portal/src/lib/api.ts`. Keep the `throw new ApiError(...)`. All pages already call `toast.error` in their `.catch` blocks.
- [ ] **3.2** Extract `useAutoSelectProject` hook: Create `apps/bid-portal/src/hooks/use-auto-select-project.ts`. Returns `{ projectId, setProjectId, projects, loading, error }`. Fetches `/bid/projects` on mount, auto-selects first item.
- [ ] **3.3** Apply `useAutoSelectProject` to open, evaluate, supervise, archive, clarifications, standard pages (6 pages). The dashboard page uses a different pattern and stays as-is.
- [ ] **3.4** Fix bulk decrypt in `open/page.tsx`: Replace sequential `for...of` loop with `await Promise.all(suppliers.map(s => executeSingleDecrypt(s)))`. Add `Promise.allSettled` to handle partial failures gracefully.
- [ ] **3.5** Add WebSocket visibility suspend/resume: In the WebSocket hook, add a `visibilitychange` listener. On `document.hidden`, disconnect socket. On `document.visible`, reconnect. Clean up listener on unmount.
- [ ] **3.6** Remove dead code: (a) `liveScores` state in `evaluate/page.tsx`. (b) `realtimeAnomalies` state + related JSX in `supervise/page.tsx`. (c) Unused `connection` destructure in `open/page.tsx` and `evaluate/page.tsx`. (d) Unwired `Pagination` import in `supervise/page.tsx` — remove it (logs are real-time, pagination doesn't make sense).
- [ ] **3.7** Fix audio context leak in `open/page.tsx`: Move `let audioCtx: AudioContext | null = null` from module scope to a `useRef<AudioContext | null>(null)` inside the component. Add cleanup: `useEffect(() => { return () => { audioCtxRef.current?.close(); }; }, [])`.

### Phase 4: 🟢 Low — Code Quality & Consistency (est. 1-2 hours)

- [ ] **4.1** Unify API access in open page: Replace raw `api.get/post` calls with typed functions from `@/lib/api/bid` where equivalents exist.
- [ ] **4.2** Unify API access in evaluate page: Same as above.
- [ ] **4.3** Unify API access in supervise page: Same as above.
- [ ] **4.4** Unify API access in archive page: Fix CSV export to use `api` wrapper with credentials (add `fetchApi` support for blob/text responses or use a direct `fetch` with `credentials: 'include'`).
- [ ] **4.5** Unify API access in clarifications page: Use `listClarifications`/`createClarification` from `bid.ts` instead of raw `api.get/post`.
- [ ] **4.6** Replace `window.confirm` in `standard/page.tsx`: Use a simple inline confirmation state (`const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)`) with a modal or inline confirmation UI.
- [ ] **4.7** Add missing typed functions to `bid.ts`: `resolveDispute`, `enterRecord`, `deleteAnnotation`, `getSupervisionAnnotations`, `exportArchivePackage`.
- [ ] **4.8** Build verification: Run `pnpm --filter api build && pnpm --filter bid-portal build` at the end of each phase.

---

## Success Criteria

1. **All 6 write methods are transaction-wrapped** — verified by code review: every method that does multiple writes uses `$transaction`.
2. **`simulateDanger` is gated behind `NODE_ENV !== 'production'`** — verified by reading the service code.
3. **Database migration runs cleanly** — `prisma migrate dev` generates the migration without errors, including the dedup step for `BidArchiveItem`.
4. **`generateEvaluationResults` makes exactly 1 score query** — verified by counting `findMany` calls in the method.
5. **Every bid route has `loading.tsx` and `error.tsx`** — verified by glob: `apps/bid-portal/src/app/(dashboard)/bid/**/loading.tsx` and `error.tsx` for all 7 routes.
6. **No duplicate toasts** — verified by removing the toast from `fetchApi` and confirming all pages still show exactly one error toast on failure.
7. **Dead code is actually gone** — grep for `liveScores`, `realtimeAnomalies`, unused `connection` returns zero results.
8. **Full build passes** — `pnpm --filter api build && pnpm --filter bid-portal build` succeeds with zero errors.
