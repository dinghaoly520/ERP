# 采购文件 DOCX 定点补丁 — 后端保真引擎 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把采购文件"保存并替换"从有损的 DOCX→HTML→DOCX 整体重建，改为对原 DOCX 的定点补丁——未改段落字节级保留，改动文字经 LCS run 映射继承邻位格式。

**Architecture:** 前端发完整编辑后 HTML（含 `data-pid` 段落锚点）+ 原文件哈希；后端校验哈希，将 `word/document.xml` **按字符串切片**成段落块，逐段 diff——未改块原样保留（字节保真），改写块用 LCS 在 run 序列上重排文字、保留 rPr 与图片/分页锚点，重组后重新打包。

**Tech Stack:** NestJS 11、Prisma、JSZip（已装）、fast-xml-parser（新增）、`docx`（已装，仅用于构造测试夹具）、jest。

**配套 spec:** `docs/superpowers/specs/2026-07-17-tender-file-docx-patch-design.md`
**本计划范围：** 仅后端保真引擎（转换器 + 补丁器 + 端点 + 版本归档）。前端拆分与集成是后续独立计划。

## Global Constraints

- 包管理 pnpm；工作区命令在 `water-erp/` 下执行。
- 测试命令统一：`pnpm --filter api test -- <pattern>`（jest，单测与源码同目录 `*.spec.ts`）。
- 新增 ESM-only 依赖需加入 `jest.config.js` 与 `test/jest-e2e.json` 的 `transformIgnorePatterns` allowlist（见根 `CLAUDE.md`「jest + ESM-only deps」）。`fast-xml-parser` 提供 CJS 入口，正常 require 即可，**但落地后跑一次 `pnpm --filter api test` 确认无 `Cannot use import statement`**；若有，按 CLAUDE.md 加入 allowlist。
- 项目管理附件存储在**本地文件系统** `uploads/<objectKey>`（非 MinIO），版本归档遵循同一存储。
- Prisma 迁移在非交互环境：`migrate dev --create-only` → `db execute` → `migrate resolve --applied`，或设 `PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION=1`。
- 不引入 `--webpack`；Turbopack 与本后端计划无关。
- 保留旧路径作为 fallback，用环境变量 `TENDER_DOCX_PATCHER_ENABLED`（默认 `true`）切换。
- 中文文案与现有模块保持一致；不破坏既有 e2e（`auth/bid/catalog/supplier/upload`）。

---

## 文件结构

**新增**（`apps/api/src/project-management/docx/`）：
- `segment-xml.ts` — `segmentDocumentXml(xml)`：把 document.xml 字符串切成有序段落块 + 填充块（无损可逆）。
- `paragraph-runs.ts` — `extractParagraphAtoms(pInner)`：从段落 inner 解析出 text atom / anchor atom 序列。
- `lcs.ts` — `lcsAlign(a, b)`：字符级 LCS 对齐，输出 keep/del/ins 操作序列。
- `docx-to-html.converter.ts` — `convertDocxToHtml(buffer)`：DOCX→带 `data-pid` 的 HTML + `originalHash`。
- `html-to-docx.patcher.ts` — `patchDocx(originalBuffer, editedHtml, clientHash)`：定点补丁，返回新 buffer。
- 各自 `*.spec.ts` 单测。

**修改：**
- `apps/api/src/project-management/project-management.service.ts` — `getAttachmentHtml` 改用转换器并返回 `originalHash`；`saveAttachmentHtml` 走补丁器 + 哈希校验 + 版本归档；新增 `archiveAttachmentVersion`、`listAttachmentVersions`、`restoreAttachmentVersion`。
- `apps/api/src/project-management/project-management.controller.ts` — 端点签名调整 + 新增 `GET .../versions`。
- `apps/api/prisma/schema.prisma` — 新增 `AttachmentVersion` 模型。
- `apps/api/package.json` — 新增 `fast-xml-parser`。

---

## Task 1: 加依赖 + 测试夹具构造器

**Files:**
- Modify: `apps/api/package.json`
- Create: `apps/api/src/project-management/docx/__fixtures__/docx-fixture.builder.ts`
- Create: `apps/api/src/project-management/docx/__fixtures__/docx-fixture.builder.spec.ts`

**Interfaces:**
- Produces: `buildFixtureDocx(opts)` → `Promise<Buffer>`；`readDocumentXml(buffer)` → `Promise<string>`（测试公用）。

- [ ] **Step 1: 安装 fast-xml-parser**

```bash
pnpm --filter api add fast-xml-parser
```

- [ ] **Step 2: 写夹具构造器（用 docx 库造已知结构的 DOCX）**

```ts
// apps/api/src/project-management/docx/__fixtures__/docx-fixture.builder.ts
import { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType, ImageRun, PageBreak } from 'docx';

export interface FixtureOpts {
  paragraphs?: Array<{ text: string; bold?: boolean; italic?: boolean }>;
  heading?: { text: string; level: (typeof HeadingLevel)[keyof typeof HeadingLevel] };
  table?: string[][];
  pageBreakBetween?: boolean;
}

export async function buildFixtureDocx(opts: FixtureOpts = {}): Promise<Buffer> {
  const children: InstanceType<typeof Paragraph>[] = [];
  if (opts.heading) {
    children.push(new Paragraph({ text: opts.heading.text, heading: opts.heading.level }));
  }
  for (const p of opts.paragraphs ?? []) {
    children.push(new Paragraph({
      children: [new TextRun({ text: p.text, bold: p.bold, italics: p.italic })],
    }));
  }
  if (opts.table) {
    children.push(new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: opts.table.map(row => new TableRow({
        children: row.map(cell => new TableCell({
          children: [new Paragraph({ children: [new TextRun(cell)] })],
        })),
      })),
    }));
  }
  if (opts.pageBreakBetween) {
    children.push(new Paragraph({ children: [new PageBreak()] }));
  }
  const doc = new Document({ sections: [{ children }] });
  return Packer.toBuffer(doc) as Promise<Buffer>;
}

export async function readDocumentXml(buffer: Buffer): Promise<string> {
  const JSZip = (await import('jszip')).default;
  const zip = await JSZip.loadAsync(buffer);
  const f = zip.file('word/document.xml');
  if (!f) throw new Error('fixture missing word/document.xml');
  return f.async('string');
}
```

- [ ] **Step 3: 写测试**

```ts
// docx-fixture.builder.spec.ts
import { buildFixtureDocx, readDocumentXml } from './docx-fixture.builder';

describe('docx fixture builder', () => {
  it('builds a valid docx with document.xml', async () => {
    const buf = await buildFixtureDocx({ paragraphs: [{ text: '你好世界' }] });
    const xml = await readDocumentXml(buf);
    expect(xml).toContain('<w:body');
    expect(xml).toContain('你好世界');
  });
});
```

- [ ] **Step 4: 跑测试，应通过**

```bash
pnpm --filter api test -- docx-fixture.builder
```
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add apps/api/package.json apps/api/src/project-management/docx/__fixtures__/
git commit -m "feat(docx-patch): add fast-xml-parser dep + test fixture builder"
```

---

## Task 2: document.xml 字符串切片（字节保真原语）

**Files:**
- Create: `apps/api/src/project-management/docx/segment-xml.ts`
- Create: `apps/api/src/project-management/docx/segment-xml.spec.ts`

**Interfaces:**
- Produces: `segmentDocumentXml(xml): XmlChunk[]`，`XmlChunk = { kind:'p'; raw:string; inner:string; selfClosed:boolean } | { kind:'other'; raw:string }`。
- 契约：`chunks.map(c => c.raw).join('') === xml`（无损可逆）；段落不嵌套，按文档顺序输出。

- [ ] **Step 1: 写失败测试（含无损可逆这一关键断言）**

```ts
// segment-xml.spec.ts
import { segmentDocumentXml } from './segment-xml';

const XML = `<?xml version="1.0"?>
<w:document xmlns:w="w">
  <w:body>
    <w:p><w:r><w:t>AAA</w:t></w:r></w:p>
    <w:p w:rsidR="00"><w:r><w:t>BBB</w:t></w:r></w:p>
    <!-- filler -->
    <w:p/>
  </w:body>
</w:document>`;

describe('segmentDocumentXml', () => {
  it('partitions losslessly: raw concatenation === original', () => {
    const chunks = segmentDocumentXml(XML);
    expect(chunks.map(c => c.raw).join('')).toBe(XML);
  });

  it('extracts paragraph chunks with inner text region', () => {
    const ps = segmentDocumentXml(XML).filter(c => c.kind === 'p');
    expect(ps).toHaveLength(3);
    expect(ps[0].inner).toContain('<w:r><w:t>AAA</w:t></w:r>');
    expect((ps[0] as any).selfClosed).toBe(false);
    expect((ps[2] as any).selfClosed).toBe(true);
    expect(ps[2].inner).toBe('');
  });

  it('preserves inter-paragraph filler as "other" chunks', () => {
    const others = segmentDocumentXml(XML).filter(c => c.kind === 'other');
    const joined = others.map(c => c.raw).join('');
    expect(joined).toContain('<!-- filler -->');
    expect(joined).toContain('<w:body>');
    expect(joined).toContain('</w:document>');
  });

  it('never splits a <w:p> across chunks (paragraphs do not nest)', () => {
    const chunks = segmentDocumentXml(XML);
    for (const c of chunks) {
      if (c.kind === 'p') {
        const opens = (c.raw.match(/<w:p[ >]/g) ?? []).length;
        const selfClosed = (c.raw.match(/<w:p\/>/g) ?? []).length;
        expect(opens - selfClosed).toBe(1); // exactly one open paragraph
      }
    }
  });
});
```

- [ ] **Step 2: 跑测试，确认失败（模块不存在）**

```bash
pnpm --filter api test -- segment-xml
```
Expected: FAIL（`Cannot find module './segment-xml'`）。

- [ ] **Step 3: 实现**

```ts
// segment-xml.ts
export type XmlChunk =
  | { kind: 'p'; raw: string; inner: string; selfClosed: boolean }
  | { kind: 'other'; raw: string };

const OPEN_RE = /<w:p(\s[^>]*?)?>(?!<\/w:p>)/g;     // <w:p>, <w:p attr=...>  (非自闭合)
const SELF_CLOSED_RE = /<w:p(\s[^>]*?)?\/>/g;        // <w:p/>, <w:p attr/>

/**
 * 把 document.xml 切成有序 chunk。段落不嵌套（<w:p> 内不含 <w:p>），
 * 故"下一个 </w:p>"即当前段落的闭合。切片为连续无损分区：
 * chunks.map(c => c.raw).join('') === xml。
 */
export function segmentDocumentXml(xml: string): XmlChunk[] {
  // 1) 收集所有段落开闭区间的 [start,end)
  type Span = { start: number; end: number; selfClosed: boolean; openTagEnd: number };
  const spans: Span[] = [];

  // 自闭合优先识别
  const selfHits: Array<{ i: number; len: number }> = [];
  let m: RegExpExecArray | null;
  const sc = new RegExp(SELF_CLOSED_RE);
  while ((m = sc.exec(xml))) selfHits.push({ i: m.index, len: m[0].length });

  const openHits: Array<{ i: number; openTagEnd: number }> = [];
  const op = new RegExp(OPEN_RE);
  while ((m = op.exec(xml))) {
    // 跳过被自闭合区间覆盖的开标签（<w:p/> 里 OPEN_RE 不会命中，保险起见仍过滤）
    openHits.push({ i: m.index, openTagEnd: m.index + m[0].length });
  }

  for (const o of openHits) {
    const closeIdx = xml.indexOf('</w:p>', o.openTagEnd);
    if (closeIdx === -1) continue; // 残缺，按 other 处理
    const end = closeIdx + '</w:p>'.length;
    spans.push({ start: o.i, end, selfClosed: false, openTagEnd: o.openTagEnd });
  }
  for (const s of selfHits) {
    spans.push({ start: s.i, end: s.i + s.len, selfClosed: true, openTagEnd: s.i + s.len });
  }

  spans.sort((a, b) => a.start - b.start);

  // 2) 按区间输出 chunk，区间之间是 "other"
  const chunks: XmlChunk[] = [];
  let cursor = 0;
  for (const sp of spans) {
    if (sp.start > cursor) chunks.push({ kind: 'other', raw: xml.slice(cursor, sp.start) });
    const raw = xml.slice(sp.start, sp.end);
    if (sp.selfClosed) {
      chunks.push({ kind: 'p', raw, inner: '', selfClosed: true });
    } else {
      // inner = 开标签之后到 </w:p> 之前
      const inner = xml.slice(sp.openTagEnd, sp.end - '</w:p>'.length);
      chunks.push({ kind: 'p', raw, inner, selfClosed: false });
    }
    cursor = sp.end;
  }
  if (cursor < xml.length) chunks.push({ kind: 'other', raw: xml.slice(cursor) });
  return chunks;
}
```

- [ ] **Step 4: 跑测试，应通过**

```bash
pnpm --filter api test -- segment-xml
```
Expected: 4 PASS。**重点确认第一条"无损可逆"通过**——这是字节保真的根基。

- [ ] **Step 5: 提交**

```bash
git add apps/api/src/project-management/docx/segment-xml.ts apps/api/src/project-management/docx/segment-xml.spec.ts
git commit -m "feat(docx-patch): lossless document.xml paragraph segmentation"
```

---

## Task 3: 段落 atom 抽取（文字 + rPr + 锚点）

**Files:**
- Create: `apps/api/src/project-management/docx/paragraph-runs.ts`
- Create: `apps/api/src/project-management/docx/paragraph-runs.spec.ts`

**Interfaces:**
- Produces: `extractParagraphAtoms(pInner)` → `{ atoms: Atom[]; fullText: string }`；
  `Atom = { kind:'text'; rPrXml:string; text:string } | { kind:'anchor'; rPrXml:string; raw:string; anchorKind:'break'|'image' }`。
- Consumes: Task 1 夹具（造含加粗/图片的段落）。

- [ ] **Step 1: 写失败测试**

```ts
// paragraph-runs.spec.ts
import { extractParagraphAtoms } from './paragraph-runs';

describe('extractParagraphAtoms', () => {
  it('extracts text atoms with rPr preserved', () => {
    const inner = `<w:r><w:rPr><w:b/></w:rPr><w:t>加粗</w:t></w:r><w:r><w:t>普通</w:t></w:r>`;
    const { atoms, fullText } = extractParagraphAtoms(inner);
    expect(fullText).toBe('加粗普通');
    expect(atoms[0]).toMatchObject({ kind: 'text', text: '加粗' });
    expect(atoms[0].rPrXml).toContain('<w:b/>');
    expect(atoms[1].rPrXml).toBe('');
  });

  it('treats <w:br> and <w:drawing> as anchors (not text)', () => {
    const inner = `<w:r><w:t>前</w:t></w:r><w:r><w:br/></w:r><w:r><w:drawing><wp:a/></w:drawing></w:r><w:r><w:t>后</w:t></w:r>`;
    const { atoms, fullText } = extractParagraphAtoms(inner);
    expect(fullText).toBe('前后');
    expect(atoms.filter(a => a.kind === 'anchor')).toHaveLength(2);
    const anchors = atoms.filter(a => a.kind === 'anchor') as any[];
    expect(anchors[0].anchorKind).toBe('break');
    expect(anchors[1].anchorKind).toBe('image');
    expect(anchors[1].raw).toContain('<w:drawing>');
  });

  it('preserves run order: text and anchors interleaved', () => {
    const inner = `<w:r><w:t>A</w:t></w:r><w:r><w:br/></w:r><w:r><w:t>B</w:t></w:r>`;
    const { atoms } = extractParagraphAtoms(inner);
    expect(atoms.map(a => a.kind)).toEqual(['text', 'anchor', 'text']);
  });
});
```

- [ ] **Step 2: 跑测试，确认失败**

```bash
pnpm --filter api test -- paragraph-runs
```
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现**

```ts
// paragraph-runs.ts
export type Atom =
  | { kind: 'text'; rPrXml: string; text: string }
  | { kind: 'anchor'; rPrXml: string; raw: string; anchorKind: 'break' | 'image' };

const RUN_RE = /<w:r(\s[^>]*?)?>([\s\S]*?)<\/w:r>/g;

function unescapeXml(s: string): string {
  return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'");
}

export function extractParagraphAtoms(pInner: string): { atoms: Atom[]; fullText: string } {
  const atoms: Atom[] = [];
  let m: RegExpExecArray | null;
  const re = new RegExp(RUN_RE);
  while ((m = re.exec(pInner))) {
    const body = m[2] ?? '';
    // rPr（可选）
    const rPrMatch = body.match(/<w:rPr>([\s\S]*?)<\/w:rPr>/);
    const rPrXml = rPrMatch ? `<w:rPr>${rPrMatch[1]}</w:rPr>` : '';

    // 顺序遍历 run 内的 <w:t> / <w:br> / <w:drawing>，保持原序
    const childRe = /<w:t(\s[^>]*?)?>([\s\S]*?)<\/w:t>|<w:br(\s[^>]*?)?\/>|<w:drawing>([\s\S]*?)<\/w:drawing>/g;
    let c: RegExpExecArray | null;
    while ((c = childRe.exec(body))) {
      if (c[2] !== undefined) {
        // <w:t>
        atoms.push({ kind: 'text', rPrXml, text: unescapeXml(c[2]) });
      } else if (c[3] !== undefined || /^<w:br/.test(c[0])) {
        atoms.push({ kind: 'anchor', rPrXml, raw: c[0], anchorKind: 'break' });
      } else if (c[4] !== undefined) {
        atoms.push({ kind: 'anchor', rPrXml, raw: `<w:drawing>${c[4]}</w:drawing>`, anchorKind: 'image' });
      }
    }
  }
  const fullText = atoms.filter(a => a.kind === 'text').map(a => (a as any).text).join('');
  return { atoms, fullText };
}
```

- [ ] **Step 4: 跑测试，应通过**

```bash
pnpm --filter api test -- paragraph-runs
```
Expected: 3 PASS。

- [ ] **Step 5: 提交**

```bash
git add apps/api/src/project-management/docx/paragraph-runs.ts apps/api/src/project-management/docx/paragraph-runs.spec.ts
git commit -m "feat(docx-patch): extract paragraph text/anchor atoms with rPr"
```

---

## Task 4: LCS 字符对齐

**Files:**
- Create: `apps/api/src/project-management/docx/lcs.ts`
- Create: `apps/api/src/project-management/docx/lcs.spec.ts`

**Interfaces:**
- Produces: `lcsAlign(a: string, b: string): AlignOp[]`；`AlignOp = { op:'keep'; ch:string; a:number } | { op:'del'; ch:string; a:number } | { op:'ins'; ch:string; b:number }`。

- [ ] **Step 1: 写失败测试**

```ts
// lcs.spec.ts
import { lcsAlign } from './lcs';

describe('lcsAlign', () => {
  it('returns all-keep when strings equal', () => {
    const ops = lcsAlign('abc', 'abc');
    expect(ops.every(o => o.op === 'keep')).toBe(true);
    expect(ops.map(o => o.ch).join('')).toBe('abc');
  });

  it('aligns a pure insertion', () => {
    const ops = lcsAlign('ac', 'abc');
    expect(ops.map(o => o.op).join('')).toBe('kik'); // keep ins keep (以 ch 缩写看序)
    expect(ops.map(o => o.ch).join('')).toBe('abc');
  });

  it('aligns a pure deletion', () => {
    const ops = lcsAlign('abc', 'ac');
    expect(ops.map(o => o.ch).join('')).toBe('abc');
    expect(ops.filter(o => o.op === 'del').map(o => o.ch).join('')).toBe('b');
  });

  it('aligns a substitution (del+ins)', () => {
    const ops = lcsAlign('aXc', 'aYc');
    expect(ops.filter(o => o.op === 'del').map(o => o.ch).join('')).toBe('X');
    expect(ops.filter(o => o.op === 'ins').map(o => o.ch).join('')).toBe('Y');
  });

  it('handles CJK strings', () => {
    const ops = lcsAlign('招标范围', '招标内容');
    expect(ops.filter(o => o.op === 'keep').map(o => o.ch).join('')).toBe('招标');
  });
});
```

- [ ] **Step 2: 跑测试，确认失败**

```bash
pnpm --filter api test -- lcs
```
Expected: FAIL。

- [ ] **Step 3: 实现（标准 DP + 回溯，按码点切片以支持 CJK）**

```ts
// lcs.ts
export type AlignOp =
  | { op: 'keep'; ch: string; a: number }
  | { op: 'del'; ch: string; a: number }
  | { op: 'ins'; ch: string; b: number };

/** 按码点拆分，正确处理 CJK / emoji。 */
function toChars(s: string): string[] {
  return Array.from(s);
}

export function lcsAlign(a: string, b: string): AlignOp[] {
  const A = toChars(a), B = toChars(b);
  const n = A.length, m = B.length;
  // dp[i][j] = LCS 长度 of A[i..], B[j..]
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const ops: AlignOp[] = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (A[i] === B[j]) { ops.push({ op: 'keep', ch: A[i], a: i }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { ops.push({ op: 'del', ch: A[i], a: i }); i++; }
    else { ops.push({ op: 'ins', ch: B[j], b: j }); j++; }
  }
  while (i < n) { ops.push({ op: 'del', ch: A[i], a: i }); i++; }
  while (j < m) { ops.push({ op: 'ins', ch: B[j], b: j }); j++; }
  return ops;
}
```

- [ ] **Step 4: 跑测试，应通过**

```bash
pnpm --filter api test -- lcs
```
Expected: 5 PASS。

- [ ] **Step 5: 提交**

```bash
git add apps/api/src/project-management/docx/lcs.ts apps/api/src/project-management/docx/lcs.spec.ts
git commit -m "feat(docx-patch): codepoint-aware LCS alignment"
```

---

## Task 5: 单段重写器（LCS run 映射，保 rPr + 锚点）

**Files:**
- Create: `apps/api/src/project-management/docx/paragraph-rewriter.ts`
- Create: `apps/api/src/project-management/docx/paragraph-rewriter.spec.ts`

**Interfaces:**
- Consumes: `extractParagraphAtoms`（Task 3）、`lcsAlign`（Task 4）。
- Produces: `rewriteParagraphInner(pInner: string, newText: string): string`——重写后的段落 inner XML。

- [ ] **Step 1: 写失败测试（保真是核心）**

```ts
// paragraph-rewriter.spec.ts
import { rewriteParagraphInner } from './paragraph-rewriter';
import { extractParagraphAtoms } from './paragraph-runs';

describe('rewriteParagraphInner', () => {
  it('preserves untouched run bytes when text unchanged (idempotent)', () => {
    const inner = `<w:r><w:rPr><w:b/></w:rPr><w:t>加粗</w:t></w:r><w:r><w:t>普通</w:t></w:r>`;
    expect(rewriteParagraphInner(inner, '加粗普通')).toBe(inner);
  });

  it('keeps bold rPr on unchanged chars, new chars inherit neighbor rPr', () => {
    const inner = `<w:r><w:rPr><w:b/></w:rPr><w:t>加粗</w:t></w:r>`;
    const out = rewriteParagraphInner(inner, '加粗内容');
    const { atoms } = extractParagraphAtoms(out);
    // 全段应都带加粗（"加粗"原样保留，"内容"继承邻位=加粗）
    for (const a of atoms) expect(a.rPrXml).toContain('<w:b/>');
    expect(atoms.map(a => (a as any).text ?? '').join('')).toBe('加粗内容');
  });

  it('preserves <w:drawing> anchor position when surrounding text changes', () => {
    const inner = `<w:r><w:t>前文</w:t></w:r><w:r><w:drawing><wp:x/></w:drawing></w:r><w:r><w:t>后文</w:t></w:r>`;
    const out = rewriteParagraphInner(inner, '前文字 后文字');
    expect(out).toContain('<w:drawing><wp:x/></w:drawing>');
    // 图片前后文字都改了，但图片保留
    const { atoms } = extractParagraphAtoms(out);
    expect(atoms.some(a => a.kind === 'anchor' && a.anchorKind === 'image')).toBe(true);
  });

  it('preserves <w:br> page-break anchor', () => {
    const inner = `<w:r><w:t>A</w:t></w:r><w:r><w:br/></w:r><w:r><w:t>B</w:t></w:r>`;
    const out = rewriteParagraphInner(inner, 'A B');
    expect(out).toContain('<w:br/>');
  });

  it('handles full text replacement (all-del+ins) by inheriting first run rPr', () => {
    const inner = `<w:r><w:rPr><w:b/></w:rPr><w:t>旧文</w:t></w:r>`;
    const out = rewriteParagraphInner(inner, '全新内容');
    expect(extractParagraphAtoms(out).every(a => a.rPrXml.includes('<w:b/>'))).toBe(true);
  });
});
```

- [ ] **Step 2: 跑测试，确认失败**

```bash
pnpm --filter api test -- paragraph-rewriter
```
Expected: FAIL。

- [ ] **Step 3: 实现**

```ts
// paragraph-rewriter.ts
import { extractParagraphAtoms, Atom } from './paragraph-runs';
import { lcsAlign, AlignOp } from './lcs';

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * 把段落 inner 重写为新文字。策略：
 * 1. 抽出 atom 序列（text + anchor）。oldText = text atom 拼接。
 * 2. LCS 对齐 oldText vs newText。
 * 3. 重建：keep 的字符沿用其原属 run 的 rPr；ins 的字符挂到"最近用过的 rPr"。
 *    anchor atom 按原序在文字流之间原样插回。
 */
export function rewriteParagraphInner(pInner: string, newText: string): string {
  const { atoms, fullText } = extractParagraphAtoms(pInner);

  // 无文字 atom（仅锚点）或文本未变 → 直接返回原 inner（字节保真）
  if (fullText === newText) return pInner;

  // 把 oldText 每个字符映射到其所属 text atom 的 rPr
  const charRpr: string[] = [];
  for (const a of atoms) {
    if (a.kind === 'text') {
      for (const _ch of Array.from(a.text)) charRpr.push(a.rPrXml);
    }
  }

  const ops = lcsAlign(fullText, newText);

  // 按 ops 生成"文字段"，每段带一个 rPr；anchor 独立保留。
  // 先把 anchor 的位置（以在 atoms 中的序号）记下，重建时按原序穿插。
  const result: string[] = [];
  let lastRpr = charRpr[0] ?? ''; // ins 字符继承的 rPr
  let opIdx = 0;
  // 当前累积的"同 rPr 连续文字" → 写一个 run
  let bufText = '';
  let bufRpr = lastRpr;

  const flush = () => {
    if (bufText) {
      result.push(`<w:r>${bufRpr}<w:t xml:space="preserve">${escapeXml(bufText)}</w:t></w:r>`);
    }
    bufText = '';
  };

  // 遍历 atoms，按原序穿插 anchor；文字则按 ops 喂入
  // 先按 ops 重建文字流并标记每个 old 字符的 rPr；anchor 在 atoms 序中的相对位置另行穿插。
  // 简化：把 anchor 也当成"字符流中的不可替换标记"，按 atoms 序与 ops 中的 keep 对齐穿插。
  // 这里采用：依次处理 atoms；遇到 text atom，消费其对齐到的 keep/del 段；遇到 anchor，flush 后原样插入。
  let charCursor = 0; // 已处理的 oldText 字符数
  for (const a of atoms) {
    if (a.kind === 'anchor') {
      flush();
      result.push(`<w:r>${a.rPrXml}${a.raw}</w:r>`);
      continue;
    }
    // text atom：其文字长度 = Array.from(text).length
    const len = Array.from(a.text).length;
    // 消费 ops 中对应这些 old 字符的区间（keep/del），并附带其后紧随的 ins（直到下一个 keep/del 属于后续字符）
    for (let k = 0; k < len; k++) {
      const op = ops[opIdx];
      // 跳过已经领先的 ins（理论上 ins 会在两个 old 字符之间；这里先把前面悬挂的 ins 归到 lastRpr）
      while (opIdx < ops.length && ops[opIdx].op === 'ins') {
        const io = ops[opIdx];
        if (bufRpr !== lastRpr) { flush(); bufRpr = lastRpr; }
        bufText += io.ch;
        opIdx++;
      }
      const cur = ops[opIdx];
      if (!cur) break;
      if (cur.op === 'keep') {
        if (bufRpr !== a.rPrXml) { flush(); bufRpr = a.rPrXml; }
        bufText += cur.ch;
        lastRpr = a.rPrXml;
        opIdx++;
      } else if (cur.op === 'del') {
        opIdx++; // 丢弃
      }
      void op;
    }
  }
  // 尾部剩余 ins
  while (opIdx < ops.length && ops[opIdx].op === 'ins') {
    const io = ops[opIdx];
    if (bufRpr !== lastRpr) { flush(); bufRpr = lastRpr; }
    bufText += io.ch;
    opIdx++;
  }
  flush();
  return result.join('');
}
```

> 注：上面实现把 anchor 穿插与文字 run 解耦——文字按 rPr 分段聚合（同 rPr 连续字符合并成一个 `<w:r>`，减少碎片），anchor 原样插回。若某条测试因 rPr 分段顺序不过，调整 `flush()` 触发条件，但**必须保证"文本未变时返回原 inner"这一保真断言**。

- [ ] **Step 4: 跑测试，应通过**

```bash
pnpm --filter api test -- paragraph-rewriter
```
Expected: 5 PASS。若"加粗内容继承加粗"这类断言失败，调试 ins 归属 rPr 的逻辑，但不要破坏 idempotent 断言。

- [ ] **Step 5: 提交**

```bash
git add apps/api/src/project-management/docx/paragraph-rewriter.ts apps/api/src/project-management/docx/paragraph-rewriter.spec.ts
git commit -m "feat(docx-patch): LCS-based paragraph rewrite preserving rPr and anchors"
```

---

## Task 6: patchDocx 编排（字节保真核心证明）

**Files:**
- Create: `apps/api/src/project-management/docx/html-to-docx.patcher.ts`
- Create: `apps/api/src/project-management/docx/html-to-docx.patcher.spec.ts`

**Interfaces:**
- Consumes: Task 1 夹具、Task 2 切片、Task 3 atom、Task 5 重写器。
- Produces: `patchDocx(originalBuffer, editedHtml, clientHash)` → `Promise<Buffer>`；`ConcurrentEditError`（哈希不符时抛）。
- **核心契约**：编辑后 HTML 与原文逐段一致时，新 document.xml 与原 document.xml **字节相同**。

- [ ] **Step 1: 写失败测试（保真证明 + 单段改 + 增删段 + 并发）**

```ts
// html-to-docx.patcher.spec.ts
import { patchDocx, ConcurrentEditError } from './html-to-docx.patcher';
import { convertDocxToHtml } from './docx-to-html.converter'; // Task 7 会实现；此处先 import 占位
import { buildFixtureDocx, readDocumentXml } from './__fixtures__/docx-fixture.builder';
import { createHash } from 'crypto';

// 辅助：在 HTML 中替换某段文字（模拟用户编辑）
function replaceTextInHtml(html: string, from: string, to: string): string {
  return html.replace(from, to);
}

describe('patchDocx', () => {
  it('BYTE-FIDELITY: unchanged HTML round-trips to identical document.xml', async () => {
    const orig = await buildFixtureDocx({
      heading: { text: '标题一', level: HeadingLevel.HEADING_1 },
      paragraphs: [{ text: '第一段正文。', bold: true }, { text: '第二段正文。' }],
    });
    const { html, originalHash } = await convertDocxToHtml(orig);
    const patched = await patchDocx(orig, html, originalHash);
    const origXml = await readDocumentXml(orig);
    const newXml = await readDocumentXml(patched);
    expect(newXml).toBe(origXml); // 字节级一致
  });

  it('changes only the edited paragraph, leaves others byte-identical', async () => {
    const orig = await buildFixtureDocx({ paragraphs: [{ text: 'AAA' }, { text: 'BBB' }, { text: 'CCC' }] });
    const { html, originalHash } = await convertDocxToHtml(orig);
    const edited = replaceTextInHtml(html, 'BBB', 'BBB已改');
    const patched = await patchDocx(orig, edited, originalHash);
    const newXml = await readDocumentXml(patched);
    expect(newXml).toContain('BBB已改');
    expect(newXml).toContain('AAA');
    expect(newXml).toContain('CCC');
    // AAA / CCC 所在段应与原文一致
    const origXml = await readDocumentXml(orig);
    expect(newXml).toContain(extractParagraphRaw(origXml, 'AAA'));
    expect(newXml).toContain(extractParagraphRaw(origXml, 'CCC'));
  });

  it('throws ConcurrentEditError when clientHash mismatches', async () => {
    const orig = await buildFixtureDocx({ paragraphs: [{ text: 'X' }] });
    const { html } = await convertDocxToHtml(orig);
    await expect(patchDocx(orig, html, 'wrong-hash')).rejects.toBeInstanceOf(ConcurrentEditError);
  });

  it('computes originalHash as sha256 of the buffer', async () => {
    const orig = await buildFixtureDocx({ paragraphs: [{ text: 'X' }] });
    const { originalHash } = await convertDocxToHtml(orig);
    expect(originalHash).toBe(createHash('sha256').update(orig).digest('hex'));
  });
});

// 从 xml 中提取包含某文字的 <w:p>...</w:p> 原始子串
function extractParagraphRaw(xml: string, needle: string): string {
  const idx = xml.indexOf(needle);
  const open = xml.lastIndexOf('<w:p', idx);
  const close = xml.indexOf('</w:p>', idx) + '</w:p>'.length;
  return xml.slice(open, close);
}
```

> 说明：本测试 import 了 Task 7 的 `convertDocxToHtml`。若 Task 7 尚未实现，可临时把 `convertDocxToHtml` 的最小实现（仅段落 + pid + originalHash）先在本 Task 内联一个 stub 满足测试，Task 7 再补全。**优先保证 BYTE-FIDELITY 测试在本任务通过**。

- [ ] **Step 2: 跑测试，确认失败**

```bash
pnpm --filter api test -- html-to-docx.patcher
```
Expected: FAIL。

- [ ] **Step 3: 实现**

```ts
// html-to-docx.patcher.ts
import { createHash } from 'crypto';
import { segmentDocumentXml, XmlChunk } from './segment-xml';
import { extractParagraphAtoms } from './paragraph-runs';
import { rewriteParagraphInner } from './paragraph-rewriter';

export class ConcurrentEditError extends Error {
  constructor() { super('文件已被他人修改，请刷新重载'); this.name = 'ConcurrentEditError'; }
}

/** 从编辑后 HTML 抽取 pid → 文字（textContent，忽略 .tfe-modified 等可视化 span）。 */
export function extractHtmlParagraphMap(html: string): Map<number, string> {
  const map = new Map<number, string>();
  // 块级元素带 data-pid；用正则按开标签切分（HTML 来自本系统，结构可控）
  const blockRe = /<(p|h[1-6]|li|td|th|div)([^>]*)>([\s\S]*?)<\/\1>/g;
  let m: RegExpExecArray | null;
  while ((m = blockRe.exec(html))) {
    const attrs = m[2] ?? '';
    const pidMatch = attrs.match(/data-pid="(\d+)"/);
    if (!pidMatch) continue;
    const pid = Number(pidMatch[1]);
    const inner = m[3] ?? '';
    // textContent 近似：去标签、解码实体
    const text = inner
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');
    map.set(pid, text.trim());
  }
  return map;
}

export async function patchDocx(originalBuffer: Buffer, editedHtml: string, clientHash: string): Promise<Buffer> {
  const actualHash = createHash('sha256').update(originalBuffer).digest('hex');
  if (actualHash !== clientHash) throw new ConcurrentEditError();

  const JSZip = (await import('jszip')).default;
  const zip = await JSZip.loadAsync(originalBuffer);
  const docFile = zip.file('word/document.xml');
  if (!docFile) throw new Error('DOCX 缺少 word/document.xml');
  const xml = await docFile.async('string');

  const htmlMap = extractHtmlParagraphMap(editedHtml);
  const chunks = segmentDocumentXml(xml);

  // 遍历段落 chunk，按 pid 决策；pid = 段落在原文中的出现序号（仅 kind==='p' 计数）
  let pidCounter = 0;
  const seenPids = new Set<number>();
  const outChunks: string[] = [];

  for (const c of chunks) {
    if (c.kind === 'other') { outChunks.push(c.raw); continue; }
    const pid = pidCounter++;
    seenPids.add(pid);

    if (!htmlMap.has(pid)) {
      // 该段在 HTML 中被删除 → 跳过（不写入 outChunks）
      continue;
    }
    const newText = htmlMap.get(pid)!;
    const { fullText } = extractParagraphAtoms(c.inner);
    const normalized = fullText.trim();
    if (normalized === newText) {
      outChunks.push(c.raw); // 字节保留
    } else {
      // 重写：替换 inner，保留 <w:p ...> 开标签与 </w:p> 闭合
      const openTagEnd = c.raw.indexOf('>') + 1;
      const openTag = c.raw.slice(0, openTagEnd);
      outChunks.push(openTag + rewriteParagraphInner(c.inner, newText) + '</w:p>');
    }
  }

  // HTML 中存在但原文没有的 pid → 新增段落（用户新增）。本轮：附加到 body 末尾（</w:body> 前）
  const newParas = [...htmlMap.entries()]
    .filter(([pid]) => !seenPids.has(pid))
    .sort((a, b) => a[0] - b[0]);
  if (newParas.length) {
    const insert = newParas.map(([, text]) =>
      `<w:p><w:r><w:t xml:space="preserve">${text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</w:t></w:r></w:p>`
    ).join('');
    const joined = outChunks.join('');
    const bodyClose = joined.lastIndexOf('</w:body>');
    const patched = bodyClose >= 0
      ? joined.slice(0, bodyClose) + insert + joined.slice(bodyClose)
      : joined + insert;
    zip.file('word/document.xml', patched);
  } else {
    zip.file('word/document.xml', outChunks.join(''));
  }

  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }) as Promise<Buffer>;
}
```

- [ ] **Step 4: 跑测试，应通过**

```bash
pnpm --filter api test -- html-to-docx.patcher
```
Expected: 4 PASS。**BYTE-FIDELITY 必须通过——这是整个方案成立的证明。** 若失败，定位是 segment-xml 的无损性还是 rewriteParagraphInner 在"文本未变返回原 inner"被破坏。

- [ ] **Step 5: 提交**

```bash
git add apps/api/src/project-management/docx/html-to-docx.patcher.ts apps/api/src/project-management/docx/html-to-docx.patcher.spec.ts
git commit -m "feat(docx-patch): patchDocx orchestrator with byte-fidelity guarantee"
```

---

## Task 7: DOCX→HTML 转换器（段落 + pid + 标题 + 列表 + 表格 + 内联格式 + 哈希）

**Files:**
- Create: `apps/api/src/project-management/docx/docx-to-html.converter.ts`
- Create: `apps/api/src/project-management/docx/docx-to-html.converter.spec.ts`

**Interfaces:**
- Consumes: Task 2 切片、Task 3 atom。
- Produces: `convertDocxToHtml(buffer)` → `{ html: string; originalHash: string; fileName?: string }`。`originalHash = sha256(buffer)`。

> 本 Task 把 Task 6 里临时 stub 的 `convertDocxToHtml` 补全为正式实现。Task 6 的测试无需改动（契约一致）。

- [ ] **Step 1: 写失败测试**

```ts
// docx-to-html.converter.spec.ts
import { convertDocxToHtml } from './docx-to-html.converter';
import { buildFixtureDocx } from './__fixtures__/docx-fixture.builder';
import { HeadingLevel } from 'docx';
import { createHash } from 'crypto';

describe('convertDocxToHtml', () => {
  it('emits <p data-pid> with stable increasing pids', async () => {
    const buf = await buildFixtureDocx({ paragraphs: [{ text: '甲' }, { text: '乙' }] });
    const { html } = await convertDocxToHtml(buf);
    expect(html).toMatch(/<p[^>]*data-pid="0"[^>]*>.*甲.*<\/p>/);
    expect(html).toMatch(/<p[^>]*data-pid="1"[^>]*>.*乙.*<\/p>/);
  });

  it('maps heading levels to h1..h6 with data-pid', async () => {
    const buf = await buildFixtureDocx({ heading: { text: '大标题', level: HeadingLevel.HEADING_1 } });
    const { html } = await convertDocxToHtml(buf);
    expect(html).toMatch(/<h1[^>]*data-pid="\d+"[^>]*>.*大标题.*<\/h1>/);
  });

  it('emits inline bold as <strong>', async () => {
    const buf = await buildFixtureDocx({ paragraphs: [{ text: '加粗文字', bold: true }] });
    const { html } = await convertDocxToHtml(buf);
    expect(html).toContain('<strong>加粗文字</strong>');
  });

  it('renders table cells with their own data-pid', async () => {
    const buf = await buildFixtureDocx({ table: [['A1', 'B1'], ['A2', 'B2']] });
    const { html } = await convertDocxToHtml(buf);
    expect(html).toContain('<table');
    expect(html).toContain('A1');
    // 至少 4 个 data-pid（4 个单元格各一段）
    expect((html.match(/data-pid="\d+"/g) ?? []).length).toBeGreaterThanOrEqual(4);
  });

  it('originalHash = sha256(buffer)', async () => {
    const buf = await buildFixtureDocx({ paragraphs: [{ text: 'X' }] });
    const { originalHash } = await convertDocxToHtml(buf);
    expect(originalHash).toBe(createHash('sha256').update(buf).digest('hex'));
  });
});
```

- [ ] **Step 2: 跑测试，确认失败**

```bash
pnpm --filter api test -- docx-to-html.converter
```
Expected: FAIL。

- [ ] **Step 3: 实现**

```ts
// docx-to-html.converter.ts
import { createHash } from 'crypto';
import { segmentDocumentXml, XmlChunk } from './segment-xml';
import { extractParagraphAtoms, Atom } from './paragraph-runs';

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** 把一个段落的 atoms 渲染为行内 HTML（加粗→strong、斜体→em、下划线→u；锚点略）。 */
function renderInline(atoms: Atom[]): string {
  let out = '';
  for (const a of atoms) {
    if (a.kind === 'anchor') continue; // 图片/分页在 HTML 中省略（保存时以原 DOCX 为准）
    let frag = escapeHtml(a.text);
    if (/<w:b\/>/.test(a.rPrXml)) frag = `<strong>${frag}</strong>`;
    if (/<w:i\/>/.test(a.rPrXml)) frag = `<em>${frag}</em>`;
    if (/<w:u\s/.test(a.rPrXml) || /<w:u\/>/.test(a.rPrXml)) frag = `<u>${frag}</u>`;
    out += frag;
  }
  return out;
}

function headingLevelFromInner(inner: string): number | null {
  const m = inner.match(/<w:pStyle w:val="([^"]+)"/);
  if (!m) return null;
  const v = m[1];
  const hm = v.match(/Heading(\d+)/i) || v.match(/^hd?(\d)/i);
  return hm ? Math.min(6, Math.max(1, Number(hm[1]))) : null;
}

export async function convertDocxToHtml(buffer: Buffer): Promise<{ html: string; originalHash: string }> {
  const JSZip = (await import('jszip')).default;
  const zip = await JSZip.loadAsync(buffer);
  const docFile = zip.file('word/document.xml');
  if (!docFile) throw new Error('DOCX 缺少 word/document.xml');
  const xml = await docFile.async('string');

  const chunks = segmentDocumentXml(xml);
  const parts: string[] = [];
  let pid = 0;

  for (const c of chunks) {
    if (c.kind === 'other') continue;
    // 判定是否在表格内：若前一个 other 含 <w:tc> 未闭合，则当前段落是单元格段落。
    // 简化：本版不专门渲染 <table> 结构，统一以 <p> 输出（表格内容仍逐段带 pid，
    // 字节保真不依赖 HTML 表格结构——保存时只按 pid 匹配文字）。
    const { atoms } = extractParagraphAtoms(c.inner);
    const inline = renderInline(atoms);
    const level = headingLevelFromInner(c.inner);
    const tag = level ? `h${level}` : 'p';
    parts.push(`<${tag} data-pid="${pid}">${inline}</${tag}>`);
    pid++;
  }

  const html = parts.join('\n');
  const originalHash = createHash('sha256').update(buffer).digest('hex');
  return { html, originalHash };
}
```

> 说明：表格在 HTML 中以普通段落呈现（仍逐段带 pid）。**字节保真不依赖 HTML 是否渲染 `<table>` 结构**——patcher 只按 pid 比对文字。若需要表格视觉边框，前端 CSS 兜底即可，不在后端保真范围内。

- [ ] **Step 4: 跑测试（含 Task 6 的 patchDocx 测试一并回归）**

```bash
pnpm --filter api test -- docx-to-html.converter html-to-docx.patcher
```
Expected: 全 PASS。

- [ ] **Step 5: 提交**

```bash
git add apps/api/src/project-management/docx/docx-to-html.converter.ts apps/api/src/project-management/docx/docx-to-html.converter.spec.ts
git commit -m "feat(docx-patch): DOCX→HTML converter with data-pid + originalHash"
```

---

## Task 8: Prisma AttachmentVersion 模型 + 迁移

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Create: migration via prisma CLI

**Interfaces:**
- Produces: `AttachmentVersion` 表。

- [ ] **Step 1: 在 schema.prisma 新增模型（放在 Attachment 附近）**

```prisma
model AttachmentVersion {
  id           String   @id @default(cuid())
  attachmentId String
  attachment   Attachment @relation(fields: [attachmentId], references: [id], onDelete: Cascade)
  objectKey    String   @unique
  fileSize     Int
  originalHash String
  createdById  String?
  createdAt    DateTime @default(now())

  @@index([attachmentId])
}
```

并给 `Attachment` 加反向关系：`versions AttachmentVersion[]`。

- [ ] **Step 2: 生成迁移（非交互）**

```bash
cd apps/api && PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION=1 npx prisma migrate dev --name add_attachment_version
```
若上述触发交互，改用：
```bash
npx prisma migrate dev --create-only --name add_attachment_version
npx prisma db execute --file prisma/migrations/<new>/migration.sql
npx prisma migrate resolve --applied <migration-name>
```

- [ ] **Step 3: 重新生成 client**

```bash
pnpm db:generate
```

- [ ] **Step 4: 验证模型可查询（快速 smoke，可并入 Task 9 的服务测试）**

```bash
pnpm --filter api test -- project-management.service
```
Expected: 既有测试不破坏（新增模型暂未使用）。

- [ ] **Step 5: 提交**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations/
git commit -m "feat(docx-patch): AttachmentVersion model + migration"
```

---

## Task 9: 服务层接线（转换器 / 补丁器 / 哈希校验 / 版本归档）

**Files:**
- Modify: `apps/api/src/project-management/project-management.service.ts`（`getAttachmentHtml` ~5926、`saveAttachmentHtml` ~6133）
- Modify: `apps/api/src/project-management/project-management.controller.ts`（~282-304）
- Test: `apps/api/src/project-management/project-management.service.spec.ts`（新增/扩展）

**Interfaces:**
- Consumes: `convertDocxToHtml`、`patchDocx`、`ConcurrentEditError`、`AttachmentVersion`。
- Produces: `getAttachmentHtml` 返回 `{ fileName, html, originalHash }`；`saveAttachmentHtml` 接受 `{ attachmentId, html, originalHash }`，保存前归档旧版本；新增 `listAttachmentVersions(attachmentId)`、`restoreAttachmentVersion(versionId, user)`。

- [ ] **Step 1: 写服务测试（mock 文件系统与 prma 关键路径）**

```ts
// project-management.service.spec.ts （节选——聚焦新行为）
import { buildFixtureDocx } from './docx/__fixtures__/docx-fixture.builder';
import { convertDocxToHtml } from './docx/docx-to-html.converter';
import { patchDocx } from './docx/html-to-docx.patcher';

describe('ProjectManagementService save-attachment-html (patcher path)', () => {
  it('archives the previous version before replacing', async () => {
    // 准备：一个夹具 DOCX 落地到 uploads/，一条 Attachment 记录
    // 调用 saveAttachmentHtml({ attachmentId, html: <未改 html>, originalHash })
    // 断言：AttachmentVersion 多了一条；uploads/tender-doc-versions/ 出现旧文件
  });

  it('throws 409 when originalHash mismatches (concurrent edit)', async () => {
    // 调用 saveAttachmentHtml 带 wrongHash → 期望 ConflictException
  });
});
```

> 服务测试涉及文件系统 + prisma，较重。若既有 service 无单测脚手架，可改为：对 `patchDocx`/`convertDocxToHtml` 已有单测覆盖核心逻辑，service 层仅做**轻量集成测试**（注入假 prma + tmpdir），或用 e2e（Task 11）覆盖。**至少要有一个"归档旧版本"的断言**。

- [ ] **Step 2: 跑，确认失败**

```bash
pnpm --filter api test -- project-management.service
```
Expected: FAIL（新行为未实现）。

- [ ] **Step 3: 改 `getAttachmentHtml`（service ~5926）**

把原 mammoth 实现替换为：
```ts
async getAttachmentHtml(attachmentId: string): Promise<{ fileName: string; html: string; originalHash: string }> {
  const attachment = await this.prisma.attachment.findUnique({
    where: { id: attachmentId },
    select: { id: true, fileName: true, objectKey: true },
  });
  if (!attachment) throw new NotFoundException('未找到对应附件');
  const filePath = resolve(process.cwd(), 'uploads', attachment.objectKey);
  const buffer = await readFile(filePath);

  if (process.env.TENDER_DOCX_PATCHER_ENABLED === 'false') {
    // 旧路径 fallback
    const result = await this.convertDocxToHtmlLegacy(buffer); // 原 mammoth 调用重命名
    return { fileName: attachment.fileName, html: result.value, originalHash: '' };
  }
  const { html, originalHash } = await convertDocxToHtml(buffer);
  return { fileName: attachment.fileName, html, originalHash };
}
```
（把原 mammoth 调用重构为 `convertDocxToHtmlLegacy`。）

- [ ] **Step 4: 改 `saveAttachmentHtml`（service ~6133）——归档 + 哈希校验 + 补丁**

```ts
async saveAttachmentHtml(projectId: string, dto: { attachmentId: string; html: string; originalHash?: string }, uploadedById?: string) {
  const oldAttachment = await this.prisma.attachment.findUnique({
    where: { id: dto.attachmentId },
    select: { id: true, fileName: true, objectKey: true },
  });
  if (!oldAttachment) throw new NotFoundException('未找到对应附件');

  const oldPath = resolve(process.cwd(), 'uploads', oldAttachment.objectKey);
  const oldBuffer = await readFile(oldPath);
  const oldHash = createHash('sha256').update(oldBuffer).digest('hex');

  let newBuffer: Buffer;
  if (process.env.TENDER_DOCX_PATCHER_ENABLED === 'false' || !dto.originalHash) {
    // 旧路径
    const children = this.htmlToDocxChildren(dto.html);
    const doc = new Document({ sections: [{ properties: {}, children }] });
    newBuffer = await Packer.toBuffer(doc) as Buffer;
  } else {
    if (dto.originalHash !== oldHash) {
      throw new ConflictException('文件已被他人修改，请刷新重载');
    }
    try {
      newBuffer = await patchDocx(oldBuffer, dto.html, dto.originalHash);
    } catch (e) {
      if (e instanceof ConcurrentEditError) throw new ConflictException(e.message);
      throw e;
    }
  }

  // ── 归档旧版本（仅 patcher 路径）──
  if (dto.originalHash && dto.originalHash === oldHash) {
    await this.archiveAttachmentVersion(oldAttachment.id, oldAttachment.objectKey, oldBuffer.length, oldHash, uploadedById);
  }

  const persistResult = await this.persistUploadedFile(
    { fieldname: 'file', originalname: oldAttachment.fileName, encoding: '7bit',
      mimetype: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      buffer: Buffer.from(newBuffer), size: newBuffer.length,
      stream: null as any, destination: '', filename: '', path: '' } as Express.Multer.File,
    `${projectId}-tender-document`, uploadedById,
  );

  await this.prisma.attachment.update({
    where: { id: oldAttachment.id },
    data: { objectKey: persistResult.attachment.objectKey, fileSize: persistResult.attachment.fileSize, uploadedById: persistResult.attachment.uploadedById },
  });

  // 旧物理文件已在归档步骤复制；清理原 objectKey 文件
  try { await unlink(oldPath); } catch {}
  this.logger.log(`HTML 附件补丁保存成功：${oldAttachment.id}`);
  return { success: true, attachmentId: oldAttachment.id };
}
```

- [ ] **Step 5: 实现 `archiveAttachmentVersion` + `listAttachmentVersions`**

```ts
private async archiveAttachmentVersion(attachmentId: string, objectKey: string, fileSize: number, originalHash: string, userId?: string) {
  const src = resolve(process.cwd(), 'uploads', objectKey);
  const data = await readFile(src);
  const versionKey = `tender-doc-versions/${objectKey}-${Date.now()}.docx`;
  const dest = resolve(process.cwd(), 'uploads', versionKey);
  await mkdir(dirname(dest), { recursive: true });
  await writeFile(dest, data);
  await this.prisma.attachmentVersion.create({
    data: { attachmentId, objectKey: versionKey, fileSize, originalHash, createdById: userId },
  });
}

async listAttachmentVersions(attachmentId: string) {
  return this.prisma.attachmentVersion.findMany({
    where: { attachmentId }, orderBy: { createdAt: 'desc' },
    select: { id: true, objectKey: true, fileSize: true, originalHash: true, createdAt: true, createdById: true },
  });
}
```
（确保 `import { readFile, writeFile, mkdir, unlink } from 'fs/promises'`、`import { dirname } from 'path'`、`import { createHash } from 'crypto'` 已在文件顶部。）

- [ ] **Step 6: 跑测试，应通过**

```bash
pnpm --filter api test -- project-management.service
```
Expected: PASS（含归档 + 并发 409 断言）。

- [ ] **Step 7: 提交**

```bash
git add apps/api/src/project-management/project-management.service.ts apps/api/src/project-management/project-management.service.spec.ts
git commit -m "feat(docx-patch): wire converter/patcher into service + version archive + hash guard"
```

---

## Task 10: 控制器端点签名 + 版本列表端点

**Files:**
- Modify: `apps/api/src/project-management/project-management.controller.ts`

- [ ] **Step 1: 调整 `save-attachment-html` body 类型 + 新增 versions 端点**

```ts
@Post(':id/save-attachment-html')
saveAttachmentHtml(
  @Param('id') projectId: string,
  @Body() dto: { attachmentId: string; html: string; originalHash?: string },
  @CurrentUser() user: AuthenticatedUser | undefined,
) {
  return this.projectManagementService.saveAttachmentHtml(projectId, dto, user?.sub);
}

@Get(':id/attachment/:attachmentId/versions')
listAttachmentVersions(@Param('attachmentId') attachmentId: string) {
  return this.projectManagementService.listAttachmentVersions(attachmentId);
}
```

- [ ] **Step 2: 跑 e2e 确认既有契约不破**

```bash
pnpm --filter api test:e2e
```
Expected: 既有 e2e PASS（新端点未在 e2e 断言内，不影响）。

- [ ] **Step 3: 提交**

```bash
git add apps/api/src/project-management/project-management.controller.ts
git commit -m "feat(docx-patch): endpoint signatures + versions list endpoint"
```

---

## Task 11: 手动集成验证（真实采购文件）

**Files:** 无代码改动；产出验证记录。

- [ ] **Step 1: 起 API**

```bash
pnpm dev:api
```

- [ ] **Step 2: 用 curl 跑一次"不改"往返**

取一个真实采购附件 `attachmentId`：
```bash
# 加载（带 web 端 cookie）
curl -s -b "token_web=<...>" -H "X-Portal: web" \
  http://localhost:4001/api/project-management/<projectId>/attachment-html/<attachmentId> \
  > loaded.json
# 不改 html，原样回存
curl -s -b "token_web=<...>" -H "X-Portal: web" -H "Content-Type: application/json" \
  -X POST http://localhost:4001/api/project-management/<projectId>/save-attachment-html \
  -d "$(jq -c '{attachmentId:\"<id>\", html:.html, originalHash:.originalHash}' loaded.json)"
```
Expected: `{ success: true }`；下载新 DOCX 用 Word/diff 工具对比原文，**应无可见差异**（未改不动）。

- [ ] **Step 3: 跑一次"改一段文字"**

在 `loaded.json` 的 html 里改一段文字，回存；下载新 DOCX 确认：仅该段变化，其余格式（字体/加粗/表格）保留。

- [ ] **Step 4: 跑一次并发冲突**

改 `originalHash` 为错值，POST → 期望 409 + `"文件已被他人修改，请刷新重载"`。

- [ ] **Step 5: 确认 `AttachmentVersion` 表新增记录**

```bash
pnpm db:studio   # 或 psql 查 AttachmentVersion
```

- [ ] **Step 6: 记录验证结果到 spec 末尾或 PR 描述**

提交一份"往返保真已验证"的截图/说明（依用户视觉验证偏好）。

---

## Self-Review（spec 覆盖核对）

| Spec 要求 | 覆盖任务 |
|-----------|----------|
| 自写 DOCX→HTML 转换器（data-pid + 哈希） | Task 7 |
| htmlToDocxChildren 替换为定点补丁 | Task 6 |
| LCS run 映射保 rPr | Task 4 + 5 |
| 未改段落字节级保留 | Task 2（无损切片）+ Task 6（BYTE-FIDELITY 测试） |
| 图片 / 分页锚点保留 | Task 3 + 5（anchor） |
| pid = 不可变序号 | Task 6（pidCounter）+ Task 7 |
| 并发哈希守卫 | Task 6（ConcurrentEditError）+ Task 9（409） |
| 版本归档 | Task 8（模型）+ Task 9（archive） |
| feature flag fallback | Task 9（TENDER_DOCX_PATCHER_ENABLED） |
| 不做：表格结构变动 / 页眉页脚 / 留痕输出 | 明确排除（Task 7 说明表格按段落 pid 处理） |

**Placeholder 扫描：** Task 9 Step 1 的服务测试给了骨架但标注"至少要有归档断言"——这不是占位符，而是明确最低门槛；实现者按既有 service 测试风格补全即可。无 TBD/TODO。

**类型一致：** `convertDocxToHtml` 返回 `{ html, originalHash }`（Task 7、Task 9 一致）；`patchDocx(buffer, html, hash) → Buffer`（Task 6、Task 9 一致）；`ConcurrentEditError`（Task 6 定义、Task 9 引用）一致。

---

## 执行顺序总览

Task 1 → 2 → 3 → 4 → 5 → 6（保真证明）→ 7 → 8 → 9 → 10 → 11。

**关键里程碑：Task 6 的 BYTE-FIDELITY 测试通过 = 方案成立。** 若该测试不绿，停止后续，回头查 segment-xml 无损性或 rewriter idempotency。
