# 附件上传统一限制（100MB + 格式白名单 + 多文件）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** :3005 信息发布中心与项目管理（含供应商邀请、公告发布配置）全部附件上传点实施「单文件 ≤100MB + 9 扩展名白名单 + 附件列表多选」，前后端双层强制。

**Architecture:** 后端在 `/api/upload` 与 PM 阶段附件端点的服务层加类目级大小/扩展校验（multer 上限对齐 100MB）；前端新建共享 `upload-rules.ts`，各上传点接 accept + onChange 预校验。解析型/业务文档型入口保持其既有格式约束，仅对齐 100MB。

**Tech Stack:** NestJS 11 + multer FileInterceptor（内存存储）、Next.js 16 + React 19、jest。

**Spec:** `docs/superpowers/specs/2026-10-19-attachment-upload-limits-design.md`

## Global Constraints

- 白名单 9 扩展名：`png jpg jpeg doc docx xls xlsx pdf zip rar`（大小写不敏感；无扩展名拒绝）
- 单文件上限 100MB = `100 * 1024 * 1024` 字节；总量/件数不设限
- **对已批 spec 的一处工程修正（须在交付时向用户明示）**：`contract_document` 类目（中标通知书、定标审批表）**不套 9 扩展白名单**——探索中发现该类目已有扩展名+MIME+魔数一致性安全闸（`file-content-policy.ts` 的 `PDF_WORD_IMAGE_MIME_TYPES`，防伪装业务凭证），为其放松属安全倒退；该类目仅把大小上限 50→100MB，前端 20MB 文案/校验同步放宽
- `/api/upload` 其余类目维持 50MB 旧口径（multer 提到 100 后由服务层补 50MB 闸，防外溢）
- 解析型入口（`extract-initiation`/`extract-demand`/通知书解析/立项解析）保持 PDF 约束，只对齐 100MB
- 系统自动上传流（公告 docx、通知书 docx、备案表 docx、邀请书 docx）不经过选择器，docx 均在白名单内，无需改动
- 错误码：`ATTACHMENT_FILE_TYPE_INVALID` / `ATTACHMENT_FILE_TOO_LARGE`（400）；multer 超限仍走默认 413
- 提交纪律：只 add 本计划明确列出的文件；并行会话在跑，禁 `git add -A`

---

### Task 1: 后端共享规则 + `/api/upload` 服务层校验（TDD）

**Files:**
- Create: `apps/api/src/upload/attachment-rules.ts`
- Create: `apps/api/src/upload/attachment-rules.spec.ts`
- Modify: `apps/api/src/upload/upload.service.ts`（`validateFile` 约 99-125 行 + `ALLOWED_MIME_TYPES` 16-28 行）
- Modify: `apps/api/src/upload/upload.controller.ts:88-90`（multer 50→100MB）
- Test: `apps/api/src/upload/upload.service.spec.ts`（追加用例）

**Interfaces:**
- Produces: `ATTACHMENT_MAX_BYTES`、`DEFAULT_MAX_BYTES`、`ATTACHMENT_EXTENSIONS`、`ATTACHMENT_WHITELIST_CATEGORIES: ReadonlySet<string>`（值为 `new Set(['announcement'])`）、`getFileExtension(name: string): string`、`isAttachmentExtensionAllowed(name: string): boolean`、`assertAttachmentRules(file: { originalname: string; size?: number; buffer?: Buffer }, category: string): void`（不合规则抛 BadRequestException）——Task 2 复用

- [ ] **Step 1: 写失败测试**（`attachment-rules.spec.ts`）

```ts
import {
  ATTACHMENT_MAX_BYTES, DEFAULT_MAX_BYTES, ATTACHMENT_WHITELIST_CATEGORIES,
  getFileExtension, isAttachmentExtensionAllowed, assertAttachmentRules,
} from './attachment-rules';

describe('attachment-rules（100MB+白名单，2026-10-19）', () => {
  it('白名单类目=announcement，扩展名 9 项大小写不敏感', () => {
    expect([...ATTACHMENT_WHITELIST_CATEGORIES]).toEqual(['announcement']);
    for (const ext of ['png', 'jpg', 'jpeg', 'doc', 'docx', 'xls', 'xlsx', 'pdf', 'zip', 'rar']) {
      expect(isAttachmentExtensionAllowed(`a.${ext}`)).toBe(true);
      expect(isAttachmentExtensionAllowed(`A.${ext.toUpperCase()}`)).toBe(true);
    }
    expect(isAttachmentExtensionAllowed('a.gif')).toBe(false);
    expect(isAttachmentExtensionAllowed('a.txt')).toBe(false);
    expect(isAttachmentExtensionAllowed('无扩展名')).toBe(false);
  });

  it('大小上限：announcement 100MB、其余 50MB', () => {
    expect(ATTACHMENT_MAX_BYTES).toBe(100 * 1024 * 1024);
    expect(DEFAULT_MAX_BYTES).toBe(50 * 1024 * 1024);
  });

  it('assertAttachmentRules：announcement 类目拒格式/拒超大、放行合法文件', () => {
    const file = (name: string, size: number) => ({ originalname: name, size, buffer: Buffer.alloc(0) });
    expect(() => assertAttachmentRules(file('a.exe', 1024), 'announcement')).toThrow(/ATTACHMENT_FILE_TYPE_INVALID/);
    expect(() => assertAttachmentRules(file('a.pdf', ATTACHMENT_MAX_BYTES + 1), 'announcement')).toThrow(/ATTACHMENT_FILE_TOO_LARGE/);
    expect(() => assertAttachmentRules(file('a.pdf', ATTACHMENT_MAX_BYTES), 'announcement')).not.toThrow();
    expect(() => assertAttachmentRules(file('a.pdf', DEFAULT_MAX_BYTES + 1), 'general')).toThrow(/ATTACHMENT_FILE_TOO_LARGE/);
    expect(() => assertAttachmentRules(file('a.pdf', DEFAULT_MAX_BYTES), 'general')).not.toThrow();
    expect(() => assertAttachmentRules(file('a.zip', DEFAULT_MAX_BYTES + 1), 'contract_document')).toThrow(/ATTACHMENT_FILE_TOO_LARGE/);
    // contract_document 不套扩展白名单（PDF_WORD_IMAGE 安全闸另管格式）
    expect(() => assertAttachmentRules(file('a.zip', 1024), 'contract_document')).not.toThrow();
  });
});
```

- [ ] **Step 2: 跑测确认红**

Run: `cd apps/api && npx jest src/upload/attachment-rules.spec.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 `attachment-rules.ts`**

```ts
import { BadRequestException } from '@nestjs/common';

/** 附件统一限制（2026-10-19 spec：公告中心/项目管理）：单文件 ≤100MB、9 扩展名白名单 */
export const ATTACHMENT_MAX_BYTES = 100 * 1024 * 1024;
/** 其余类目维持旧 50MB 口径（/api/upload multer 提至 100MB 后由服务层把住，防外溢） */
export const DEFAULT_MAX_BYTES = 50 * 1024 * 1024;

export const ATTACHMENT_EXTENSIONS = ['png', 'jpg', 'jpeg', 'doc', 'docx', 'xls', 'xlsx', 'pdf', 'zip', 'rar'] as const;

/** 走 100MB+白名单的 /upload 类目（contract_document 仅 100MB，格式由 PDF_WORD_IMAGE 内容闸管） */
export const ATTACHMENT_WHITELIST_CATEGORIES: ReadonlySet<string> = new Set(['announcement']);

export function getFileExtension(name: string): string {
  const idx = name.lastIndexOf('.');
  return idx > 0 ? name.slice(idx + 1).toLowerCase() : '';
}

export function isAttachmentExtensionAllowed(name: string): boolean {
  const ext = getFileExtension(name);
  return (ATTACHMENT_EXTENSIONS as readonly string[]).includes(ext);
}

const HINT = '支持 PNG/JPG/Word/PDF/Excel/ZIP/RAR';

/** 服务层大小/格式闸（multer 之后、落 MinIO 之前）。size 取 file.size ?? buffer.length */
export function assertAttachmentRules(
  file: { originalname: string; size?: number; buffer?: Buffer },
  category: string,
): void {
  const size = file.size ?? file.buffer?.length ?? 0;
  const maxBytes = category === 'announcement' || category === 'contract_document'
    ? ATTACHMENT_MAX_BYTES
    : DEFAULT_MAX_BYTES;
  if (size > maxBytes) {
    throw new BadRequestException({
      error: `单个文件不能超过 ${maxBytes / (1024 * 1024)}MB（当前 ${(size / (1024 * 1024)).toFixed(1)}MB）`,
      code: 'ATTACHMENT_FILE_TOO_LARGE',
    });
  }
  if (category === 'announcement' && !isAttachmentExtensionAllowed(file.originalname)) {
    throw new BadRequestException({
      error: `不支持的附件格式，${HINT}（当前文件：${file.originalname}）`,
      code: 'ATTACHMENT_FILE_TYPE_INVALID',
    });
  }
}
```

- [ ] **Step 4: 跑测确认绿**　Run: `npx jest src/upload/attachment-rules.spec.ts`　Expected: PASS

- [ ] **Step 5: `upload.service.ts` 接线**（两处）
  1. `ALLOWED_MIME_TYPES`（16 行）追加 rar/zip 变体 MIME（白名单含 rar，现状会拒）：
  ```ts
  'application/vnd.rar',
  'application/x-rar-compressed',
  'application/x-zip-compressed',
  ```
  2. `validateFile`（99-125 行）末尾追加：
  ```ts
    // 附件统一限制（2026-10-19）：类目级大小上限 + announcement 扩展白名单
    assertAttachmentRules(file, category);
  ```
  并在文件头 import：`import { assertAttachmentRules } from './attachment-rules';`

- [ ] **Step 6: `upload.controller.ts` multer 50→100MB**（88-90 行）

```ts
  @UseInterceptors(FileInterceptor('file', {
    limits: { fileSize: 100 * 1024 * 1024 }, // 100MB（服务层按类目再收口：announcement/contract_document 100MB，其余 50MB）
  }))
```

- [ ] **Step 7: 追加 service 级测试**（`upload.service.spec.ts`，沿用现有 spec 的 service 实例化方式；若该 spec 为纯函数风格则按现有风格落成对 validateFile 的直接调用）

```ts
// 附件统一限制（2026-10-19）
it('announcement 类目拒绝白名单外扩展名', () => {
  const file = { originalname: 'a.exe', mimetype: 'application/pdf', buffer: Buffer.from('x') } as Express.Multer.File;
  expect(() => service.validateFile(file, 'announcement')).toThrow(/ATTACHMENT_FILE_TYPE_INVALID/);
});
it('announcement/contract_document 允许 100MB 内 rar', () => {
  const file = { originalname: 'a.rar', mimetype: 'application/vnd.rar', buffer: Buffer.from('x') } as Express.Multer.File;
  expect(() => service.validateFile(file, 'announcement')).not.toThrow();
});
it('其余类目 >50MB 由服务层拒绝', () => {
  const file = { originalname: 'a.pdf', mimetype: 'application/pdf', size: 51 * 1024 * 1024, buffer: Buffer.alloc(0) } as Express.Multer.File;
  expect(() => service.validateFile(file, 'general')).toThrow(/ATTACHMENT_FILE_TOO_LARGE/);
});
```

- [ ] **Step 8: 跑 upload 域测试**　Run: `npx jest src/upload`　Expected: 全 PASS（存量 + 新增）

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/upload/attachment-rules.ts apps/api/src/upload/attachment-rules.spec.ts apps/api/src/upload/upload.service.ts apps/api/src/upload/upload.service.spec.ts apps/api/src/upload/upload.controller.ts
git commit -m "feat(upload): 附件统一限制服务层——100MB+9扩展白名单（announcement/contract_document 100MB，其余维持50MB）"
```

---

### Task 2: PM 阶段附件端点 + 解析端点上限（TDD）

**Files:**
- Modify: `apps/api/src/project-management/project-management.controller.ts:70-95`（两个解析端点 multer 500→100）、`:168-174`（阶段附件 multer 500→100）
- Modify: `apps/api/src/project-management/project-management.service.ts:1300`（`addStageAttachment` 开头加校验）
- Test: `apps/api/src/project-management/project-management.service.spec.ts`（追加；若无该文件则新建仅测校验路径的用例）

**Interfaces:**
- Consumes: Task 1 的 `assertAttachmentRules`（PM 端点对**全部** stage 上传套 100MB+白名单——阶段附件全是自由附件语义，含供应商邀请函/回执）

- [ ] **Step 1: 写失败测试**（service spec 追加；PM 端点白名单走 `assertAttachmentRules` 直测已在 Task 1 覆盖，此处测「addStageAttachment 入口调用它」——用最小桩：mock prisma 使其在校验后即抛 NotFound，断言格式错误先行抛出）

```ts
it('addStageAttachment 拒绝白名单外扩展名（400 ATTACHMENT_FILE_TYPE_INVALID）', async () => {
  const bad = { originalname: 'a.exe', mimetype: 'application/octet-stream', buffer: Buffer.from('x'), size: 1 } as Express.Multer.File;
  await expect(service.addStageAttachment('p1', 'TENDER_DOCUMENT', bad)).rejects.toThrow(/ATTACHMENT_FILE_TYPE_INVALID/);
});
it('addStageAttachment 拒绝超 100MB 文件', async () => {
  const big = { originalname: 'a.pdf', mimetype: 'application/pdf', buffer: Buffer.alloc(0), size: 100 * 1024 * 1024 + 1 } as Express.Multer.File;
  await expect(service.addStageAttachment('p1', 'TENDER_DOCUMENT', big)).rejects.toThrow(/ATTACHMENT_FILE_TOO_LARGE/);
});
```

（service 实例化方式照抄该 spec 文件现有 beforeEach；若为新建文件，用 `new ProjectManagementService(prismaStub as any, ...)` 最小桩——校验先于任何 prisma 调用即可通过。）

- [ ] **Step 2: 跑测确认红**　Run: `npx jest src/project-management/project-management.service.spec.ts -t addStageAttachment`　Expected: FAIL（当前无校验，exe 会走到 prisma）

- [ ] **Step 3: 实现**——`addStageAttachment` 在 `const targetRound = ...` 之前插入：

```ts
    // 附件统一限制（2026-10-19）：阶段附件（含供应商邀请函/回执）100MB + 9 扩展白名单
    assertAttachmentRules(file, 'announcement');
```

（复用 announcement 规则集=100MB+白名单；import 自 `../upload/attachment-rules`。）

- [ ] **Step 4: controller 三处 multer `500 * 1024 * 1024` → `100 * 1024 * 1024`**（extract-initiation、extract-demand、stages attachments；各附注释 `// 100MB（2026-10-19 附件统一限制）`）

- [ ] **Step 5: 跑测确认绿 + PM 域全量**　Run: `npx jest src/project-management`　Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/project-management/project-management.controller.ts apps/api/src/project-management/project-management.service.ts apps/api/src/project-management/project-management.service.spec.ts
git commit -m "feat(project-management): 阶段附件100MB+白名单、解析端点上限对齐100MB"
```

---

### Task 3: 前端共享规则 `lib/upload-rules.ts`

**Files:**
- Create: `apps/web/src/lib/upload-rules.ts`

**Interfaces:**
- Produces（Task 4-7 全部消费）:
  - `ATTACHMENT_ACCEPT = '.png,.jpg,.jpeg,.doc,.docx,.xls,.xlsx,.pdf,.zip,.rar'`
  - `ATTACHMENT_HINT = '支持 PNG/JPG/Word/PDF/Excel/ZIP/RAR，单个不超过 100MB'`
  - `ATTACHMENT_MAX_MB = 100`
  - `validateAttachmentFile(file: File): string | null` —— 超大小→`「文件名」超过 100MB 上限（当前 X.XMB）`；格式→`不支持的附件格式：文件名（支持 PNG/JPG/Word/PDF/Excel/ZIP/RAR）`；通过→null
  - `validateFileSize(file: File, maxMb = 100): string | null` —— B 类/解析型入口只做大小

- [ ] **Step 1: 实现**

```ts
/** 附件上传统一规则（2026-10-19 spec）：与后端 upload/attachment-rules.ts 同口径 */
export const ATTACHMENT_ACCEPT = '.png,.jpg,.jpeg,.doc,.docx,.xls,.xlsx,.pdf,.zip,.rar';
export const ATTACHMENT_HINT = '支持 PNG/JPG/Word/PDF/Excel/ZIP/RAR，单个不超过 100MB';
export const ATTACHMENT_MAX_MB = 100;

const ALLOWED = new Set(['png', 'jpg', 'jpeg', 'doc', 'docx', 'xls', 'xlsx', 'pdf', 'zip', 'rar']);

function extOf(name: string): string {
  const i = name.lastIndexOf('.');
  return i > 0 ? name.slice(i + 1).toLowerCase() : '';
}

/** A 类（自由附件）：大小 + 9 扩展白名单；返回错误文案或 null */
export function validateAttachmentFile(file: File): string | null {
  const sizeErr = validateFileSize(file);
  if (sizeErr) return sizeErr;
  if (!ALLOWED.has(extOf(file.name))) {
    return `不支持的附件格式：${file.name}（${ATTACHMENT_HINT}）`;
  }
  return null;
}

/** B 类/解析型入口：仅大小 */
export function validateFileSize(file: File, maxMb = ATTACHMENT_MAX_MB): string | null {
  if (file.size > maxMb * 1024 * 1024) {
    return `「${file.name}」超过 ${maxMb}MB 上限（当前 ${(file.size / (1024 * 1024)).toFixed(1)}MB）`;
  }
  return null;
}
```

- [ ] **Step 2: tsc 验证**　Run: `cd apps/web && npx tsc --noEmit`　Expected: 0 错误

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/lib/upload-rules.ts
git commit -m "feat(web): 附件上传共享规则 util（100MB+9扩展白名单）"
```

---

### Task 4: 信息发布中心附件（多选 + 白名单）

**Files:**
- Modify: `apps/web/src/app/(main)/notice/new/page.tsx`（`AttachmentUploader` 组件，约 516-553 行）
- Modify: `apps/web/src/app/(main)/notice/[id]/page.tsx`（同名组件，结构同款——以实际代码为准）

- [ ] **Step 1: `notice/new` AttachmentUploader 改多选**——`onUpload` 换 `onUploadMultiple`：

```tsx
import { ATTACHMENT_ACCEPT, ATTACHMENT_HINT, validateAttachmentFile } from '@/lib/upload-rules';
// ...
  const onUploadMultiple = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    const invalid = files.map((f) => validateAttachmentFile(f)).filter(Boolean) as string[];
    const okFiles = files.filter((f) => !validateAttachmentFile(f));
    if (invalid.length > 0) toast.error(invalid[0] + (invalid.length > 1 ? ` 等 ${invalid.length} 个文件被跳过` : ''));
    if (okFiles.length === 0) { e.target.value = ''; return; }
    setUploading(true);
    let done = 0;
    for (const f of okFiles) {
      try { const asset = await uploadFile(f, 'announcement'); await addAttachment(annId, asset.id, title || f.name); done++; }
      catch (err: any) { toast.error(`${f.name}：${err?.message || '上传失败'}`); }
    }
    if (done > 0) { setTitle(''); toast.success(`已添加 ${done} 个附件`); }
    setUploading(false); e.target.value = ''; onChanged();
  };
```

input 加 `multiple accept={ATTACHMENT_ACCEPT}`，按钮文案 `上传中...` 保留；附件列表下方加提示行：

```tsx
<p className="text-[11px] text-[var(--muted-foreground)]">{ATTACHMENT_HINT}，可选择多个文件</p>
```

- [ ] **Step 2: `notice/[id]` 同款改造**（该页有独立 AttachmentUploader 或复用——找到其 `<input type="file"` 与上传 handler，做同款多选+accept+校验+提示）

- [ ] **Step 3: tsc + lint**　Run: `npx tsc --noEmit && npx eslint <两个文件>`　Expected: 0 错误、无新增告警

- [ ] **Step 4: Commit**

```bash
git add "apps/web/src/app/(main)/notice/new/page.tsx" "apps/web/src/app/(main)/notice/[id]/page.tsx"
git commit -m "feat(notice): 信息发布中心附件多选+100MB白名单"
```

---

### Task 5: 公告向导附件 + 项目阶段附件 + 正式盖章版上传

**Files:**
- Modify: `apps/web/src/components/projects/announcement-publish-wizard.tsx:2065-2089`（`onSelect` + input + 提示）
- Modify: `apps/web/src/components/projects/project-detail-panel.tsx:2107`（阶段附件 input onChange）
- Modify: `apps/web/src/components/projects/official-tender-wizard.tsx:219-225`（正式盖章版 input + handleUpload 前 207 行空态文案处加提示）

- [ ] **Step 1: 向导 `onSelect`**（单选保留，改 accept+校验）：

```tsx
  const onSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const err = validateAttachmentFile(f);
    if (err) { toast.error(err); e.target.value = ''; return; }
    onAdd(f, attTitle);
    setAttTitle('');
    e.target.value = '';
  };
```

input：`<input type="file" className="hidden" accept={ATTACHMENT_ACCEPT} onChange={onSelect} />`；「暂无附件」提示行下加 `<p className="text-[11px] text-[var(--muted-foreground)]">{ATTACHMENT_HINT}</p>`；import 加 `toast`（已有）与 `@/lib/upload-rules` 三常量。

- [ ] **Step 2: `project-detail-panel` 2107 行 onChange 过滤**（已 multiple）：

```tsx
onChange={(event) => {
  const picked = Array.from(event.target.files ?? []);
  const invalid = picked.map((f) => validateAttachmentFile(f)).filter(Boolean) as string[];
  const okFiles = picked.filter((f) => !validateAttachmentFile(f));
  if (invalid.length > 0) toast.error(invalid[0] + (invalid.length > 1 ? ` 等 ${invalid.length} 个文件被跳过` : ''));
  if (okFiles.length > 0) setSelectedFiles(okFiles);
  event.target.value = '';
}}
```

（原实现是 `setSelectedFiles(Array.from(...))`——确认 toast import 已存在，无则补。）input 加 `accept={ATTACHMENT_ACCEPT}`；上传按钮附近加提示行 `{ATTACHMENT_HINT}`（找到现有附件区文案位置，紧邻追加）。

- [ ] **Step 3: `official-tender-wizard` input** 加 `accept={ATTACHMENT_ACCEPT}`，`handleUpload` 入口加：

```ts
const err = validateAttachmentFile(f);
if (err) { toast.error(err); return; }
```

空态文案「请上传正式盖章版采购文件（扫描 PDF / 图片 / 盖章 docx）」下加一行 `{ATTACHMENT_HINT}`。

- [ ] **Step 4: tsc + lint + Commit**

```bash
git add apps/web/src/components/projects/announcement-publish-wizard.tsx apps/web/src/components/projects/project-detail-panel.tsx apps/web/src/components/projects/official-tender-wizard.tsx
git commit -m "feat(projects): 公告附件/阶段附件/正式盖章版上传接入100MB白名单"
```

---

### Task 6: B 类点——中标通知书 20→100MB、定标审批表/立项解析大小校验

**Files:**
- Modify: `apps/web/src/lib/api/bid.ts:450,458`（`AWARD_LETTER_MAX_BYTES` 20→100MB + 文案）
- Modify: `apps/web/src/components/projects/bid-confirm-panel.tsx:1461`（帮助文案 20MB→100MB）
- Modify: `apps/web/src/components/tender-write/notification-letter-dialog.tsx:312`（`handleFileSelected` 加大小校验，accept 保持 `.pdf`）
- Modify: `apps/web/src/components/projects/create-project-dialog.tsx:484`（onFileChange 加大小校验，accept 保持 `application/pdf`）

- [ ] **Step 1: `bid.ts`**：

```ts
const AWARD_LETTER_MAX_BYTES = 100 * 1024 * 1024;
// ...
  if (file.size > AWARD_LETTER_MAX_BYTES) return '通知书文件不得超过 100 MB';
```

`bid-confirm-panel.tsx:1461` 文案改：`支持 PDF、DOC、DOCX，最大 100 MB；供应商将在门户内查看、下载并签收该文件。`

- [ ] **Step 2: `notification-letter-dialog` handleFileSelected**（`if (!file) return;` 之后）：

```ts
    const sizeErr = validateFileSize(file);
    if (sizeErr) { toast.error(sizeErr); e.target.value = ""; return; }
```

（import `validateFileSize`；`toast` 已有。）

- [ ] **Step 3: `create-project-dialog` 484 行 onFileChange**：

```tsx
onChange={(event) => {
  const file = event.target.files?.[0] ?? null;
  if (file) {
    const sizeErr = validateFileSize(file);
    if (sizeErr) { toast.error(sizeErr); event.target.value = ''; return; }
  }
  onFileChange(file);
}}
```

（import `validateFileSize` 与 toast——确认该文件 toast 现状，无则从 'sonner' 引入。）

- [ ] **Step 4: tsc + lint + Commit**

```bash
git add apps/web/src/lib/api/bid.ts apps/web/src/components/projects/bid-confirm-panel.tsx apps/web/src/components/tender-write/notification-letter-dialog.tsx apps/web/src/components/projects/create-project-dialog.tsx
git commit -m "feat(web): 中标通知书/定标审批表/立项解析统一100MB上限（格式业务约束保持）"
```

---

### Task 7: 剩余上传点——导入审阅/其他 input 兜底扫描

**Files:**
- Modify: `apps/web/src/components/projects/tender-file-editor-modal.tsx:915`（`accept=".docx,.doc"` 导入审阅——业务保持 docx/doc，仅加 `validateFileSize`）
- Modify: `apps/web/src/components/projects/direct-filing-dialog.tsx`、`tender-write-modal.tsx`（若扫描发现 `type="file"`/上传入口则同款接入；当前无 input 则确认无用户直传路径，记录结论）

- [ ] **Step 1: `tender-file-editor-modal` handleImportReview 入口加 `validateFileSize`（accept 不动——导入解析链仅 docx/doc）**

- [ ] **Step 2: 全量兜底扫描**　Run: `cd apps/web/src && grep -rn 'type="file"' app/\(main\)/notice components/projects components/supplier/invitation-letter-modal.tsx components/tender-write | grep -v node_modules`
逐个核对：每处要么 `accept={ATTACHMENT_ACCEPT}`+`validateAttachmentFile`（A 类），要么业务 accept+`validateFileSize`（B 类/解析型）。发现遗漏点同款接入。

- [ ] **Step 3: tsc + lint + Commit**

```bash
git add apps/web/src/components/projects/tender-file-editor-modal.tsx  # 及扫描发现的其他文件
git commit -m "feat(web): 上传点兜底——导入审阅100MB+全量input扫描收口"
```

---

### Task 8: 回归验证 + live 冒烟

- [ ] **Step 1: 全量 API 单测**　Run: `cd apps/api && npx jest --testPathIgnorePatterns='test/'`　Expected: 全绿
- [ ] **Step 2: api/web tsc + 双端 lint**　Expected: 0 错误、无新增告警
- [ ] **Step 3: live 冒烟**（dev 栈在跑，API watch 自动热更）
  - `curl` 登录 staff → `POST /api/upload?category=announcement` 传一个 `.txt`（构造 multipart）→ 期望 400 `ATTACHMENT_FILE_TYPE_INVALID`
  - 同端点传 `.zip` 小文件 → 期望 200
  - `POST /api/project-management/:id/stages/.../attachments` 传 `.exe` → 期望 400（需先有一条可写 PMI；可复用 /tmp/wk-token.txt 会话，被踢则重登）
- [ ] **Step 4: 交付说明**——向用户报告：改动清单、live 冒烟结果、**spec 偏离点（contract_document 不套白名单的安全闸理由）**、20MB→100MB 的文案变更
