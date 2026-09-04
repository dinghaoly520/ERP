# 3004 Supplier Portal Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Every behavior change starts with a failing focused test and ends with a focused verification.

**Goal:** Repair the audited supplier-portal security and workflow gaps, improve the highest-impact UX/accessibility/responsive issues, and publish a post-fix GB/T 43711—2024 supplier-side gap matrix.

**Architecture:** Keep page-owned data loading and the existing visual language, but move repeated business rules into typed helpers and shared UI primitives. Put authorization in NestJS services, never controllers. Treat the current dirty checkout as the accepted baseline, use focused patches, and do not absorb unrelated work into commits.

**Tech Stack:** NestJS 11, Prisma 6, Jest 30, Next.js 16 App Router, React 19, TypeScript, ESLint 9, CSS, Node test runner through `tsx`.

---

## Working-tree guard

- Work on branch `codex/supplier-portal-hardening` in the current checkout because the target files already contain the user's latest uncommitted work.
- Inspect focused diffs before and after changes; do not reset, restore, or stage unrelated files.
- Do not commit mixed files automatically. Preserve all pre-existing registration, announcement, archive, contract, framework, API, and shared-package edits.

## Task 1: Restore executable frontend quality gates

**Files:**

- Modify: `apps/supplier-portal-next/package.json`
- Create: `apps/supplier-portal-next/eslint.config.mjs`
- Create: `apps/supplier-portal-next/src/lib/__tests__/test-harness.test.ts`
- Modify: `pnpm-lock.yaml`

- [ ] Add a minimal Node/TypeScript test that imports a portal module and prove the current package has no executable test script.
- [ ] Add `test` and `test:watch` scripts using `tsx --test`, plus the existing-repo ESLint 9 dependencies.
- [ ] Add a Next.js flat ESLint config aligned with `apps/web` and scoped ignores for generated output.
- [ ] Run the new test, lint, and `tsc --noEmit`; record baseline lint findings instead of hiding substantive errors.

## Task 2: Secure contract-fulfilment proof attachment and unify upload categories

**Files:**

- Modify: `apps/api/src/supplier-portal/supplier-portal.service.spec.ts`
- Modify: `apps/api/src/supplier-portal/supplier-portal.service.ts`
- Modify: `apps/api/src/supplier-portal/supplier-portal.controller.ts`
- Modify: `apps/api/src/upload/upload-categories.ts`
- Modify: `apps/api/src/upload/upload.service.spec.ts`
- Modify: `apps/api/src/upload/upload.service.ts`

- [ ] Add failing API tests for a valid proof, another supplier's contract, a fulfilment node from another contract, another user's asset, and a disallowed asset category.
- [ ] Move attachment logic into `SupplierPortalService`; authorize current supplier + contract + fulfilment as one relation and validate asset ownership/category.
- [ ] Keep the controller thin and return stable validation/authorization errors.
- [ ] Add failing tests proving the controller and storage service share one category source and that `contract_document` / `prequal_document` are accepted.
- [ ] Remove the duplicate upload allowlist, add the actual domain categories, and preserve existing secure filename/reference checks.
- [ ] Add an auditable record for a successful attachment without changing unrelated procurement state.
- [ ] Run the focused supplier-portal and upload Jest suites.

## Task 3: Complete the award-letter cross-portal workflow

**Files:**

- Modify: `apps/api/src/bid/bid.service.spec.ts`
- Modify: `apps/api/src/bid/bid.service.ts`
- Modify: `apps/api/src/upload/upload.service.spec.ts`
- Modify: `apps/api/src/upload/upload.service.ts`
- Modify: `apps/api/src/supplier-portal/supplier-portal.service.spec.ts`
- Modify: `apps/api/src/supplier-portal/supplier-portal.service.ts`
- Modify: `apps/api/src/supplier-portal/supplier-portal.controller.ts`
- Modify: `apps/supplier-portal-next/src/lib/api/supplier.ts`
- Modify: `apps/supplier-portal-next/src/app/(main)/award-letters/page.tsx`
- Modify: `apps/supplier-portal-next/src/components/shell/supplier-menu.ts`

- [ ] Add failing tests that delivery resolves a `BidSupplier` to its real supplier user, emits `/award-letters`, and grants only the recipient access to the letter asset.
- [ ] Correct recipient lookup and notification link creation; keep delivery ownership based on `BidSupplier.id` where required by the schema.
- [ ] Extend file authorization for recipient award letters, owned contract documents, and owned fulfilment proof assets.
- [ ] Type the supplier award-letter response and expose safe asset metadata plus server-generated receipt state.
- [ ] Add persistent navigation entries for “成交通知书” and “合作历史”.
- [ ] Render explicit view/download actions before signing; mark received only on explicit view, and show signed-at, signer, and receipt identifier afterward.
- [ ] Verify API suites, frontend unit tests, type check, and both routes in-browser.

## Task 4: Replace fake/ambiguous entry points with real forms

**Files:**

- Create: `apps/supplier-portal-next/src/components/auth/password-reset-request-dialog.tsx`
- Modify: `apps/supplier-portal-next/src/app/login/page.tsx`
- Modify: `apps/supplier-portal-next/src/lib/api/auth.ts`
- Create: `apps/supplier-portal-next/src/components/prequal/prequal-application-dialog.tsx`
- Modify: `apps/supplier-portal-next/src/app/(main)/prequal/page.tsx`
- Create: `apps/supplier-portal-next/src/components/contracts/satisfaction-dialog.tsx`
- Create: `apps/supplier-portal-next/src/components/contracts/proof-upload-dialog.tsx`
- Modify: `apps/supplier-portal-next/src/app/(main)/contracts/page.tsx`

- [ ] Add failing validation tests for password-reset request fields, optional prequalification notes, 1–5 satisfaction scores, and proof file type/size.
- [ ] Split “查询审核进度” and “忘记密码”; submit the reset request to the existing anonymous API with neutral success/error copy.
- [ ] Replace the prequalification `prompt()` with a controlled dialog where an empty note is truly valid.
- [ ] Replace contract `prompt()` and hidden dynamic file input with labelled dialogs showing constraints, selected file, progress, retry, and completion receipt.
- [ ] Verify keyboard submit/cancel, validation, and error states with frontend tests and browser checks.

## Task 5: Build a server-clock supplier task dashboard

**Files:**

- Create: `apps/supplier-portal-next/src/lib/supplier-tasks.ts`
- Create: `apps/supplier-portal-next/src/lib/__tests__/supplier-tasks.test.ts`
- Modify: `apps/supplier-portal-next/src/app/(main)/dashboard/page.tsx`
- Modify: `apps/supplier-portal-next/src/app/(main)/bids/page.tsx`
- Modify: `apps/supplier-portal-next/src/components/shell/supplier-menu.ts`

- [ ] Add failing pure tests for deadline ordering and tasks derived from correction requests, bid drafts, openings, unread clarifications, unsigned awards, fulfilment proofs, and expiring qualifications.
- [ ] Use the shared server-clock offset for every deadline/status calculation; remove direct business use of `Date.now()`.
- [ ] Add an actionable “当前待办” section with source, due time, urgency, and one canonical route per task.
- [ ] Expose completed projects/history through navigation and preserve permission differences for temporary suppliers.
- [ ] Verify equal deadline status on dashboard and bid list at a fixed server time.

## Task 6: Normalize notification taxonomy, summaries, and links

**Files:**

- Create: `apps/supplier-portal-next/src/lib/notification-meta.ts`
- Create: `apps/supplier-portal-next/src/lib/__tests__/notification-meta.test.ts`
- Modify: `apps/supplier-portal-next/src/app/(main)/notifications/page.tsx`
- Modify: `apps/supplier-portal-next/src/components/shell/app-shell.tsx`

- [ ] Add failing tests for all notification types emitted by the API and for relative, same-origin absolute, malformed, and external URLs.
- [ ] Implement typed metadata grouped into 待办 / 项目动态 / 审批 / 合同 / 系统.
- [ ] Normalize same-origin links to internal paths, label external destinations, and never display raw development hostnames.
- [ ] Replace clickable `div` rows with links/buttons; add concise summaries, unread state, action labels, and a detail fallback.
- [ ] Pause polling while the document is hidden and clean it up on unmount.

## Task 7: Harden shared accessibility and responsive primitives

**Files:**

- Modify: `apps/supplier-portal-next/src/components/sp-page-hero.tsx`
- Modify: `apps/supplier-portal-next/src/components/ui.tsx`
- Modify: `apps/supplier-portal-next/src/components/shell/app-shell.tsx`
- Modify: `apps/supplier-portal-next/src/app/(main)/announcements/page.tsx`
- Modify: `apps/supplier-portal-next/src/app/(main)/bids/page.tsx`
- Modify: `apps/supplier-portal-next/src/app/(main)/completed-projects/page.tsx`
- Create: `apps/supplier-portal-next/src/components/__tests__/accessibility-markup.test.tsx`

- [ ] Add failing static-markup/pure interaction tests for one `h1`, labelled pagination/switch controls, progress semantics, dialog labels, tabs, and native interactive rows.
- [ ] Implement labelled modal semantics, initial focus, Tab trapping, Escape close, and trigger-focus restoration.
- [ ] Add proper tabs, progressbar values, live regions, visible focus, and 44px critical touch targets.
- [ ] Give the mobile drawer a name, modal semantics, Escape handling, focus management, backdrop action, and body scroll lock.
- [ ] Convert key page rows/KPIs to native links or buttons; preserve current visual treatment.
- [ ] Add compact mobile field-label layouts for high-value tables rather than hiding columns.

## Task 8: Reduce visual debt and first-load weight in touched surfaces

**Files:**

- Modify: `apps/supplier-portal-next/src/app/globals.css`
- Modify: `apps/supplier-portal-next/src/app/(main)/frameworks/page.tsx`
- Create: `apps/supplier-portal-next/src/lib/framework-format.ts`
- Create: `apps/supplier-portal-next/src/lib/__tests__/framework-format.test.ts`
- Create: optimized assets under `apps/supplier-portal-next/public/images/`

- [ ] Add failing formatter tests for framework quantity/share JSON and invalid legacy data.
- [ ] Render structured framework rules as Chinese business copy, with a safe fallback rather than raw JSON.
- [ ] Add a final semantic-token section for touched components, reduce nested neumorphic surfaces, unify spacing/type/focus, and avoid new literal colors.
- [ ] Produce modern compressed login background variants from the existing artwork and wire responsive `image-set()` fallbacks.
- [ ] Compare asset sizes and confirm desktop/tablet/mobile layouts at 1280px, 768px, and 390px.

## Task 9: Run complete verification and request review

**Files:**

- Modify only files required by discovered regressions.

- [ ] Run focused frontend tests and all touched API specs.
- [ ] Run `pnpm --filter supplier-portal-next lint`, `tsc --noEmit`, and production build.
- [ ] Run the broader API test subset for bid, upload, supplier portal, auth, contract, prequalification, and framework modules.
- [ ] Re-run `git diff --check` and inspect only the target-file diffs.
- [ ] Browser-test login, dashboard, bids, prequalification, award letters, history, contracts, frameworks, notifications, announcements, and objections, including keyboard-only and narrow-screen flows.
- [ ] Ask an independent reviewer agent to inspect security, behavior, tests, and scope; fix confirmed findings and repeat affected checks.

## Task 10: Publish the post-fix GB/T 43711—2024 gap matrix

**Files:**

- Create: `docs/reviews/2026-09-03-gbt-43711-supplier-portal-gap-analysis.md`

- [ ] Map supplier-relevant clauses and Appendix A/B/C/D flows to evidence in supplier portal, procurement/admin portal, API, expert portal, public portal, or external integration boundaries.
- [ ] Classify every item as 已落实 / 部分落实 / 未落实 / 其他端职责 / 外部系统对接, with priority, owner, and concrete acceptance criteria.
- [ ] Explicitly cover identity/certificate/signature, invitation/discovery, prequalification, document/version receipt, response encryption/submission/withdrawal, opening/decryption, auction/negotiation, evaluation confidentiality, notices, objections, guarantees/fees, contracts/performance, frameworks, archive/audit, privacy, standard data, availability, and feedback.
- [ ] Distinguish normative requirements from product recommendations; do not claim the standard mandates features it does not mention.
- [ ] Remove or organize temporary PDF render files, verify the report, and cite the original PDF once in the user-facing handoff.

