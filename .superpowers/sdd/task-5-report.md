# Task 5 Report — `page.tsx` 工具栏接线

## Status: DONE

## Files Modified
- `apps/bid-portal/src/app/(dashboard)/bid/standard/page.tsx` (+53 / -22)

## Edits Applied (5/5)

1. **lucide import** — Added `Save` to the lucide-react import list.
2. **Dialog imports** — Added `SaveTemplateDialog` (from `./save-template-dialog`) and `TemplateLibraryDialog` (from `./template-library-dialog`) immediately after the `ScorePointsEditor` import.
3. **State vars** — Added `showSaveTpl` and `showLib` boolean state immediately after the `expanded` state declaration.
4. **Toolbar `action` prop rebuild** — Replaced the previous `!locked && (...)` block with a flex container that shows:
   - `[存为模板]` — gated on `items.length > 0` (visible even when locked).
   - `[模板库]` — always visible.
   - `[发布评分标准][应用标准模板][新增评分项]` — only when `!locked` (prior handlers + classNames preserved verbatim inside a Fragment).
5. **Dialog render** — Added `<SaveTemplateDialog>` and `<TemplateLibraryDialog>` between the existing delete-confirm `<Dialog>` and the component's outer closing `</div>`.

## Anchor Verification

All five brief-supplied "current code" anchors matched the live file byte-for-byte (no line-number drift). Each Edit used the actual file content as `old_string`.

## Lock Semantics (verified)

- `存为模板`: visible whenever `items.length > 0`, regardless of `locked` — users can save the current items as a template even after publish.
- `模板库`: always visible — users can browse/apply templates anytime; the dialog itself respects `locked` via its prop.
- `发布 / 应用标准模板 / 新增`: gated on `!locked` as before.

## Handlers Preserved

`handlePublish`, `handleApplyTemplate`, and the inline `() => { setShowAdd(true); setDraft({...}); }` for 新增 were carried into the new `!locked` block without modification. Button classNames (`bg-[#11a874]`, `border-[#dce6f3] bg-white`, `bg-[#064ea2]`) and icon sizes/`strokeWidth`s are identical to the prior implementation.

## Dialog Props

- `<SaveTemplateDialog open={showSaveTpl} onClose={() => setShowSaveTpl(false)} projectId={projectId} />`
- `<TemplateLibraryDialog open={showLib} onClose={() => setShowLib(false)} projectId={projectId} locked={locked} onChanged={setItems} />`

All five props (`open`, `onClose`, `projectId`, `locked`, `onChanged`) match the Task 4 component contract. `projectId` is guaranteed non-null at render site (the early `if (!projectId) return <NoProjectGuide />;` runs above).

## Build Result

`pnpm --filter bid-portal build` — **PASS**

- Compiled successfully in 3.3s (Turbopack)
- TypeScript: 0 errors
- 11/11 static pages generated
- Route `/bid/standard` listed in build output

## Commit

- SHA: `02f20b92b7f8f8f78c3e958b6c155b2c028dbc59`
- Subject: `feat(bid-portal): 评分标准页工具栏接入存模板/模板库`
- Trailer: `Co-Authored-By: Claude <noreply@anthropic.com>`
- Single file changed, path quoted to escape parens.

## Concerns

None. No collateral files touched; no handler logic changed; build clean.
