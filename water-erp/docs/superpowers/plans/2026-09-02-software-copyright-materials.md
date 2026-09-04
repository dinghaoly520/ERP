# Software Copyright Materials Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Rebuild the ten “蜀水云采” software-copyright packages as twenty-one submission-ready DOCX files, with substantive illustrated manuals, deterministic 60-page source-code identification materials, and a final audit checklist.

**Architecture:** Keep every original file unchanged. Add a self-contained delivery toolchain under `/Users/qihao/ERP2/软著申请材料/_工具/交付版`, stage sanitized figures and rendered QA output outside the final folder, and publish only the twenty-one accepted DOCX files to `/Users/qihao/ERP2/软著申请材料/_交付版`. A single metadata/content model drives manual generation, source extraction, validation, and the final audit so names, dates, counts, and paths cannot drift.

**Tech Stack:** Python 3.11+, `python-docx`, Pillow, `lxml`, `pdfplumber`, LibreOffice/Poppler via the bundled document runtime, the Codex in-app browser for read-only screenshots, and `unittest` for deterministic generator checks.

---

## Fixed Decisions and Acceptance Gates

- Copyright owner: `四川省水利发展集团有限公司`
- Version: `V1.0`
- Development completion date: `2026-08-25`
- First publication date: `2026-08-26`
- Final output count: exactly 21 DOCX files
- Manual gate: 10 manuals, each 25–40 rendered pages and at least 6 useful, sanitized figures
- Source gate: 10 source documents, each exactly 60 rendered pages and at least 50 printed code lines on every page
- Privacy gate: no password, token, secret, phone number, email address, ID number, browser chrome, or contact-confirmation dialog in final artifacts
- Visual gate: no tofu boxes, clipping, overlap, stretched images, isolated headings, broken tables, or accidental blank pages
- Preservation gate: originals under `/Users/qihao/ERP2/软著申请材料/01-*` through `10-*` remain byte-for-byte untouched

## Task 1: Bootstrap the isolated delivery workspace and artifact operation

**Files:**

- Create: `/Users/qihao/ERP2/软著申请材料/_工具/交付版/README.md`
- Create: `/Users/qihao/ERP2/软著申请材料/_工具/交付版/config.py`
- Create: `/Users/qihao/ERP2/软著申请材料/_工具/交付版/tests/test_config.py`
- Create at runtime: `/Users/qihao/ERP2/软著申请材料/_工作区/figures/`
- Create at runtime: `/Users/qihao/ERP2/软著申请材料/_工作区/rendered/`
- Create at runtime: `/Users/qihao/ERP2/软著申请材料/_工作区/reports/`
- Create at runtime: `/Users/qihao/ERP2/软著申请材料/_交付版/`

- [ ] Read the document-skill references for document creation, rendered verification, images, captions, TOC, heading numbering, metadata privacy, accessibility, design presets, and header templates before the first authoring command.
- [ ] Locate `container_tools/mark_artifact_operation_started.mjs`, then run exactly once before generating a DOCX:

```bash
/Users/qihao/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node \
  container_tools/mark_artifact_operation_started.mjs \
  --operation-kind edit --expected-output-count 21 --output-format docx
```

Expected: exit code 0 and one artifact-operation record; do not rerun it during this delivery.

- [ ] Write `config.py` with immutable paths, the ten exact software names, confirmed registration metadata, per-software mapped modules, screenshot targets, and acceptance constants.
- [ ] Make `config.py` fail fast when the repository, logo, any `_映射/NN.json`, or any mapped source path is missing.
- [ ] Record SHA-256 hashes for every original DOCX/TXT/JSON file in `_工作区/reports/original-hashes.json` so preservation can be proven at the end.
- [ ] Write the failing test first:

```python
def test_catalog_is_complete_and_unique(self):
    self.assertEqual(10, len(SOFTWARES))
    self.assertEqual(10, len({item.code for item in SOFTWARES}))
    self.assertTrue(all(item.owner == "四川省水利发展集团有限公司" for item in SOFTWARES))
```

- [ ] Run the test before implementation:

```bash
cd /Users/qihao/ERP2/软著申请材料/_工具/交付版
/Users/qihao/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3 -m unittest tests.test_config -v
```

Expected: FAIL because the model does not exist.

- [ ] Implement the smallest complete metadata model, rerun the test, and confirm PASS.
- [ ] Commit only the plan/tooling files that reside in the Git repository, if any; artifacts outside the repository are not committed.

## Task 2: Audit the current packages and create a machine-readable baseline

**Files:**

- Create: `/Users/qihao/ERP2/软著申请材料/_工具/交付版/audit_originals.py`
- Create: `/Users/qihao/ERP2/软著申请材料/_工具/交付版/tests/test_audit_originals.py`
- Create: `/Users/qihao/ERP2/软著申请材料/_工作区/reports/original-audit.json`
- Create: `/Users/qihao/ERP2/软著申请材料/_工作区/reports/original-audit.md`

- [ ] Write tests that construct a small DOCX fixture and assert that the audit reports paragraph count, table count, inline-shape count, placeholder text, metadata, and source TXT line count.
- [ ] Run `python3 -m unittest tests.test_audit_originals -v`; expect FAIL before implementation.
- [ ] Implement read-only inspection of all current manuals, code DOCX/TXT files, extraction statistics, and mapping JSON files.
- [ ] Detect at least these defects: manuals with fewer than 25 rendered pages, fewer than 6 figures, copyright placeholders, missing figures, source documents not rendering to 60 pages, fewer than 50 printed lines on any source page, inconsistent metadata, and unavailable mapped paths.
- [ ] Render the original sample set needed to measure defects; keep these PDFs/PNGs in `_工作区`, never in `_交付版`.
- [ ] Generate the baseline JSON and Markdown reports and confirm they identify the known three-page manuals and pagination/font defects.
- [ ] Rerun tests and confirm PASS.

## Task 3: Build deterministic source collection, wrapping, and secret scanning

**Files:**

- Create: `/Users/qihao/ERP2/软著申请材料/_工具/交付版/source_material.py`
- Create: `/Users/qihao/ERP2/软著申请材料/_工具/交付版/tests/test_source_material.py`
- Create at runtime: `/Users/qihao/ERP2/软著申请材料/_工作区/source-selection/NN-front.txt`
- Create at runtime: `/Users/qihao/ERP2/软著申请材料/_工作区/source-selection/NN-back.txt`
- Create at runtime: `/Users/qihao/ERP2/软著申请材料/_工作区/reports/source-selection.json`

- [ ] Write failing tests for stable path sorting, exclusion of `node_modules/.next/dist/build/.venv`, exclusion of tests/declarations/maps, UTF-8 decoding, safe long-line wrapping, file-boundary markers, front selection, tail selection, exact 1,500-line segments, and secret detection.
- [ ] Define a printed-line representation that wraps only for presentation, preserves every character, and records `repository_path`, `logical_line`, and `wrapped_part` for traceability.
- [ ] Select exactly 1,500 printed lines for the frontend beginning segment and exactly 1,500 printed lines for the backend ending segment for each software; selections must be continuous within their normalized streams.
- [ ] Reject a selection if it contains `.env` content, PEM blocks, JWTs, access tokens, passwords, or high-confidence secret patterns; move the entire continuous window rather than deleting individual lines.
- [ ] Produce `source-selection.json` containing start/end file and logical-line coordinates, selected line counts, exclusions, and scan results for all ten packages.
- [ ] Run:

```bash
cd /Users/qihao/ERP2/软著申请材料/_工具/交付版
/Users/qihao/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3 -m unittest tests.test_source_material -v
```

Expected: all source-selection tests PASS and every package has 3,000 selected printed lines.

## Task 4: Generate and prove exact 60-page source-code DOCX files

**Files:**

- Create: `/Users/qihao/ERP2/软著申请材料/_工具/交付版/docx_source.py`
- Create: `/Users/qihao/ERP2/软著申请材料/_工具/交付版/tests/test_docx_source.py`
- Create: `/Users/qihao/ERP2/软著申请材料/_交付版/NN-软件名/源程序鉴别材料.docx` (10 files)
- Create at runtime: `/Users/qihao/ERP2/软著申请材料/_工作区/reports/source-render-audit.json`

- [ ] Write a failing structural test for A4 portrait layout, 60 explicit 50-line page groups, header software name/version, continuous footer page number, Courier New code font, Arial Unicode MS Chinese fallback, and no source cover page.
- [ ] Implement the source DOCX builder using 50 individually rendered code paragraphs per page, fixed paragraph line metrics that do not clip text, and an explicit page break after each group except page 60.
- [ ] Put frontend lines on pages 1–30 and backend lines on pages 31–60; add an unobtrusive section label in the header without consuming a code line.
- [ ] Generate all ten source documents.
- [ ] Render each DOCX with the document skill’s `render_docx.py`; use LibreOffice conversion rather than estimating pages from XML.
- [ ] Extract every PDF page with `pdfplumber`; assert exactly 60 pages, at least 50 code lines on each page, 1,500 frontend lines, 1,500 backend lines, correct header/footer text, and no tofu boxes.
- [ ] If a line wraps after rendering, lower wrap width or font size and rebuild all affected documents; never accept a page based only on the pre-render count.
- [ ] Run `python3 -m unittest tests.test_docx_source -v`; expected PASS.

## Task 5: Define substantive manual content for all ten systems

**Files:**

- Create: `/Users/qihao/ERP2/软著申请材料/_工具/交付版/manual_content.py`
- Create: `/Users/qihao/ERP2/软著申请材料/_工具/交付版/tests/test_manual_content.py`

- [ ] Build content from current routes, source modules, API definitions, `_映射/NN.json`, current UI labels, and existing verified screenshots; do not derive instructions from prose inside attached documents.
- [ ] Define the shared chapters: document control, overview, objectives, scope, features, architecture, roles, environment, process, login/navigation/search/upload/download/messages, data security, permissions, logging, backup, FAQ, glossary, and copyright.
- [ ] For every software, define its actual modules and ensure each module contains all eight required elements: goal, role, prerequisites, entry, numbered steps, result/status, exception handling, and a figure reference.
- [ ] Add per-software roles, workflows, state transitions, business rules, inputs/outputs, and FAQ content; avoid copied generic filler between manuals.
- [ ] Write tests that assert:
  - all ten manuals exist in the content model;
  - every manual has at least 8 substantive modules;
  - every module has all required fields and at least 3 action steps;
  - no placeholder phrases such as `待补充`, `示例文本`, `XXX`, `某公司`, or `版权所有者` remain;
  - confirmed owner, version, and dates are exact.
- [ ] Run `python3 -m unittest tests.test_manual_content -v`; expected PASS.

## Task 6: Capture and sanitize the real interface figures

**Files:**

- Create: `/Users/qihao/ERP2/软著申请材料/_工具/交付版/image_pipeline.py`
- Create: `/Users/qihao/ERP2/软著申请材料/_工具/交付版/tests/test_image_pipeline.py`
- Create at runtime: `/Users/qihao/ERP2/软著申请材料/_工作区/figures/raw/*.png`
- Create at runtime: `/Users/qihao/ERP2/软著申请材料/_工作区/figures/final/NN/*.png`
- Create at runtime: `/Users/qihao/ERP2/软著申请材料/_工作区/reports/figure-manifest.json`

- [ ] Reuse the already authorized local demo sessions and navigate only through read-only screens. Do not create, submit, approve, publish, archive, score, delete, confirm contact details, or otherwise mutate business data.
- [ ] Capture current UI screenshots for the public, procurement, supplier, expert, bid-opening, mall, AI authoring/review, assistant/OCR, and platform-support areas that are available.
- [ ] Supplement empty or unavailable pages with repository verification PNGs and generated process/architecture figures grounded in actual code; record the provenance of every figure.
- [ ] Exclude the expert contact-confirmation dialog that exposes phone/email. Crop browser chrome and unrelated whitespace.
- [ ] Write image tests for valid PNG/JPEG decoding, minimum effective width 1,200 px, non-blank content, bounded aspect ratio, deterministic cropping, redaction-box placement, and figure-manifest completeness.
- [ ] Normalize figures to a consistent maximum width, edge border, lossless or high-quality compression, and readable text; use Pillow only for post-processing, not for inventing UI screenshots.
- [ ] Ensure every manual has 6–12 accepted figures and no figure is referenced before it exists.
- [ ] Run `python3 -m unittest tests.test_image_pipeline -v`; expected PASS.

## Task 7: Implement the formal illustrated manual DOCX builder

**Files:**

- Create: `/Users/qihao/ERP2/软著申请材料/_工具/交付版/docx_manual.py`
- Create: `/Users/qihao/ERP2/软著申请材料/_工具/交付版/docx_common.py`
- Create: `/Users/qihao/ERP2/软著申请材料/_工具/交付版/tests/test_docx_manual.py`

- [ ] Use the document skill’s selected `compact_reference_guide` preset as the baseline, with the approved formal blue-gray system and Arial Unicode MS substitutions required for Chinese rendering.
- [ ] Write a failing fixture test for A4 portrait sections, cover metadata, revision table, real Word heading styles, numbered headings, generated TOC field, figure captions, table captions, page headers, continuous page-number fields, image alt text, and clean core properties.
- [ ] Implement reusable helpers for colors, typography, spacing, non-splitting captions, keep-with-next headings, table repeat headers, cell padding, shaded callouts, image sizing, and captions/cross-references.
- [ ] Create a restrained cover using the existing group logo, exact software title, `操作说明书`, `V1.0`, owner, and date; do not add unrequested decorative artwork.
- [ ] Use tables only for revision history, role/permission matrices, environment requirements, structured comparison, and audit summaries; keep narrative and procedures as paragraphs and numbered lists.
- [ ] Insert figures immediately after their explanatory paragraph and keep captions with the image; ensure each figure has a unique sequential number and meaningful alt text.
- [ ] Run `python3 -m unittest tests.test_docx_manual -v`; expected PASS.

## Task 8: Generate the ten illustrated manuals and tune them to 25–40 pages

**Files:**

- Create: `/Users/qihao/ERP2/软著申请材料/_工具/交付版/build_manuals.py`
- Create: `/Users/qihao/ERP2/软著申请材料/_交付版/NN-软件名/操作说明书.docx` (10 files)
- Create at runtime: `/Users/qihao/ERP2/软著申请材料/_工作区/reports/manual-render-audit.json`

- [ ] Generate all ten manuals from the shared metadata/content model and figure manifest.
- [ ] Render every manual to PDF and page PNGs with `render_docx.py`.
- [ ] Extract structural metrics: rendered pages, figures, tables, heading counts, TOC, owner/version/dates, page-number field, and missing image relationships.
- [ ] Tune content distribution and figure sizing until every manual renders to 25–40 pages with 6–12 useful figures; add substantive workflow explanation when short and tighten spacing only when long.
- [ ] Inspect every page at readable resolution, not merely a contact sheet. Record a page-level pass/fail and defect note in `manual-render-audit.json`.
- [ ] Rebuild any manual containing a stray blank page, broken TOC, clipped table, isolated heading, low-resolution figure, unreadable label, tofu character, overlap, or excessive whitespace.

## Task 9: Generate the final audit and submission checklist from accepted artifacts

**Files:**

- Create: `/Users/qihao/ERP2/软著申请材料/_工具/交付版/build_audit_doc.py`
- Create: `/Users/qihao/ERP2/软著申请材料/_工具/交付版/tests/test_audit_doc.py`
- Create: `/Users/qihao/ERP2/软著申请材料/_交付版/00-材料总审查与申报清单.docx`

- [ ] Write a failing test that rejects an audit row unless the referenced final file exists and its page/image/line counts match the accepted render reports.
- [ ] Build the checklist last, from final audit JSON rather than handwritten counts.
- [ ] Include the ten exact software names and confirmed registration metadata; original issue, corrective action, final result, output path, manual page/figure counts, source page/min-line counts, continuity result, sensitive-data result, metadata result, and visual-QA result.
- [ ] Clearly list applicant-supplied items still required outside this delivery: official online application form, group qualification certificate, ownership/cooperation evidence if applicable, signatures/seals, and later correction materials.
- [ ] State that the checklist is not and does not imitate the China Copyright Protection Center’s official application form.
- [ ] Render the checklist, inspect every page, and rerun `python3 -m unittest tests.test_audit_doc -v`; expected PASS.

## Task 10: Run whole-delivery privacy, accessibility, and metadata cleanup

**Files:**

- Create: `/Users/qihao/ERP2/软著申请材料/_工具/交付版/finalize_delivery.py`
- Create: `/Users/qihao/ERP2/软著申请材料/_工具/交付版/tests/test_finalize_delivery.py`
- Create at runtime: `/Users/qihao/ERP2/软著申请材料/_工作区/reports/final-audit.json`

- [ ] Remove author, last-modified-by, company, manager, revision, comments, tracked changes, hidden text, custom XML properties, and thumbnail metadata unless required for normal document operation.
- [ ] Normalize image descriptions, heading hierarchy, table header semantics, document language (`zh-CN`), and reading order within DOCX limitations.
- [ ] Scan DOCX XML, relationships, embedded images (OCR where practical), extracted PDF text, and source selections for secrets and personal data.
- [ ] Reject placeholder tokens, unapproved owner names, inconsistent dates, missing alt text, broken external links, and unexpected embedded files.
- [ ] Rerun the full unit suite:

```bash
cd /Users/qihao/ERP2/软著申请材料/_工具/交付版
/Users/qihao/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3 -m unittest discover -s tests -v
```

Expected: all tests PASS.

## Task 11: Perform final render verification of all 21 deliverables

**Files:**

- Verify: `/Users/qihao/ERP2/软著申请材料/_交付版/00-材料总审查与申报清单.docx`
- Verify: `/Users/qihao/ERP2/软著申请材料/_交付版/01-*` through `10-*`
- Update at runtime: `/Users/qihao/ERP2/软著申请材料/_工作区/reports/final-audit.json`

- [ ] Delete only stale files inside the task-owned `_工作区/rendered` directory, then render the final accepted DOCX files again from scratch.
- [ ] Assert the file count and names:

```bash
find /Users/qihao/ERP2/软著申请材料/_交付版 -type f -name '*.docx' | sort
```

Expected: exactly 21 paths: one checklist plus two files in each of ten software folders.

- [ ] Verify all ten manuals are 25–40 pages and have at least 6 figures.
- [ ] Verify all ten source documents are exactly 60 pages, each page has at least 50 extracted printed-code lines, and pages 1–30/31–60 map to the recorded frontend/backend continuous segments.
- [ ] Inspect every rendered page at 100% or higher. Update `final-audit.json` with `accepted: true` only after all pages have an explicit pass.
- [ ] Compare current original hashes with `original-hashes.json`; expected: no changed original file.
- [ ] Run a final placeholder search over extracted DOCX text:

```bash
rg -n '待补充|示例文本|XXX|某公司|版权所有者|PASSWORD|TOKEN|SECRET' \
  /Users/qihao/ERP2/软著申请材料/_工作区/reports \
  /Users/qihao/ERP2/软著申请材料/_工作区/source-selection
```

Expected: no unwaived matches.

## Task 12: Self-review and delivery handoff

**Files:**

- Review: `/Users/qihao/ERP2/ERP/water-erp/docs/superpowers/specs/2026-09-02-software-copyright-materials-design.md`
- Review: `/Users/qihao/ERP2/ERP/water-erp/docs/superpowers/plans/2026-09-02-software-copyright-materials.md`
- Review: `/Users/qihao/ERP2/软著申请材料/_工作区/reports/final-audit.json`

- [ ] Check every design requirement against the final audit: 21 DOCX, ten names, exact owner/version/dates, illustrated 25–40-page manuals, 60-page source documents, code continuity, line counts, privacy, metadata, and original-file preservation.
- [ ] Search the final extracted text for placeholders and inconsistent company/version/date values.
- [ ] Confirm schema and runtime type consistency among configuration, content, figure manifest, audit JSON, and generators.
- [ ] Confirm no PDF, PNG, temporary lock file, or internal report was copied into `_交付版`.
- [ ] Open the final checklist and one representative manual in Codex for immediate review.
- [ ] Deliver one concise completion note with the output folder, key measured results, unresolved applicant-supplied items, and exactly one `:codex-file-citation` for each of the 21 final DOCX files.

## Final Definition of Done

The work is complete only when all checkboxes above are satisfied, `final-audit.json` marks every artifact accepted, all originals still match their recorded hashes, and the final folder contains exactly the 21 requested DOCX files and nothing else.
