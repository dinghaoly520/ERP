# Phase ⑤ 平板触屏 PWA + 手写备忘 — 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`).

**Goal:** 专家在平板上手写备忘（项目级/供应商级/评分项级），墨迹原图存 MinIO + OCR 成文字；触屏 PWA 打分（复用 phase ② `PointChecklistScoring`）；桌面端键盘输入 + 查看墨迹。

**Architecture:** 新建 `ExpertMemo`（contentText + inkFileId→FileAsset）。后端 memo CRUD service：上传 ink PNG → `StorageService.upload` + 写 `FileAsset`；OCR → `OcrService.ocrImage` → contentText（OCR 不可用降级仅存墨迹）。前端：平板手写 `<canvas>` + pointer events 导出 PNG；tablet 路由（触屏布局，复用 checklist）；PWA manifest + service worker；桌面键盘输入 + presigned ink 查看。

**Tech Stack:** NestJS 11 + Prisma + MinIO(StorageService) + OCR(:8100)；Next.js 16 + React 19 + Tailwind v4 + canvas；PWA(manifest+sw)。

## Global Constraints

- 工作目录 `water-erp/`。
- `StorageService.upload(objectKey, buffer, mime)` 返回 **void**（:23）——调用方先生成 objectKey + 写 `FileAsset`。
- `OcrService.ocrImage(buffer, mimeType, filename)` (:259) + `isAvailable()` (:39)——OCR 不可用时降级（仅存 inkFileId，contentText 空）。
- `ExpertMemo.inkFileId` 存 `FileAsset.id`（与既有 fileAssetId 模式一致）。
- 分数不进 WS（本 phase 不涉及）。
- commit：中文 conventional + 空行 + `Co-Authored-By: Claude <noreply@anthropic.com>`。
- DB drift：migration 用 surgical（见 memory）。
- PWA 从零（无 manifest/sw/icon/next-pwa）——本 plan 用原生 manifest + 轻量 sw（不引入 next-pwa，YAGNI）。

## 现状锚点（已核实）

- `StorageService`（storage.service.ts）：upload :23（void）/ download :35 / getPresignedUrl :49；`@Global` 可直接注入。
- `OcrService`（local-ai/ocr.service.ts）：ocrImage :259 / isAvailable :39；`@Global`。
- `FileAsset`（schema.prisma:970）：id/key(unique=objectKey)/originalName/mimeType/size/sha256/category/uploaderId/...
- `ExpertMemo` **不存在**。建在 BidScoreReview 后（~:467），字段 id/expertId/projectId/supplierId?/scoreItemId?/contentText?/inkFileId?(→FileAsset)/sourceDevice?/createdAt。
- expert-portal 路由：`(app)/` 组（AppShell 桌面 sidebar）；`evaluate/[id]/page.tsx` step 是 React state 非 URL。tablet 建议新路由组 `(tablet)/evaluate/[id]/page.tsx`（独立 layout，无桌面 sidebar）或 `evaluate/[id]/tablet`。
- PWA：next.config 仅 rewrites；public/ 无 manifest/sw/icon；layout 无 manifest 链接。
- expert.controller（:216 confirmReport 最后）；memo 端点插 :223。
- expert-portal api.ts（:60 verifyScoreReview 唯一具名函数）；types.ts re-export shared。
- canvas/pointer：全仓 0 命中（从零）。

## File Structure

| 文件 | 责任 |
|------|------|
| `apps/api/prisma/schema.prisma` | `ExpertMemo` 模型 + relations |
| `apps/api/src/expert/expert-memo.service.ts`（新） | memo CRUD + ink 上传 + OCR |
| `apps/api/src/expert/expert.controller.ts` | memo 端点 |
| `apps/api/src/expert/expert.module.ts` | 注册 ExpertMemoService |
| `packages/shared/src/types.ts` | `ExpertMemo` 类型 |
| `apps/expert-portal/src/lib/api.ts` | memo API 函数 |
| `apps/expert-portal/src/components/memo/handwriting-canvas.tsx`（新） | canvas 手写组件 |
| `apps/expert-portal/src/components/memo/memo-panel.tsx`（新） | 备忘面板（手写/键盘/列表）|
| `apps/expert-portal/src/app/(tablet)/layout.tsx`（新） | tablet 触屏 layout（无桌面 sidebar）|
| `apps/expert-portal/src/app/(tablet)/evaluate/[id]/page.tsx`（新） | tablet 打分页（复用 PointChecklistScoring + memo）|
| `apps/expert-portal/public/manifest.webmanifest` + `sw.js` | PWA |
| `apps/expert-portal/src/app/layout.tsx` | metadata 加 manifest |

---

### Task 1: `ExpertMemo` 模型 + migration

**Files:** `schema.prisma`

- [ ] **Step 1: relations** — `BidExpert.memos`、`BidProject.memos`、`BidSupplier.memos?`（可选）、`BidScoreItem.memos?`（可选）、`FileAsset.expertMemos`。
- [ ] **Step 2: 模型**（BidScoreReview 后 ~:467）：
```prisma
model ExpertMemo {
  id           String   @id @default(cuid())
  expertId     String
  projectId    String
  supplierId   String?
  scoreItemId  String?
  contentText  String?
  inkFileId    String?
  sourceDevice String?   // tablet | desktop
  expert       BidExpert @relation(fields: [expertId], references: [id], onDelete: Cascade)
  project      BidProject @relation(fields: [projectId], references: [id], onDelete: Cascade)
  supplier     BidSupplier? @relation(fields: [supplierId], references: [id], onDelete: SetNull)
  inkFile      FileAsset? @relation(fields: [inkFileId], references: [id], onDelete: SetNull)
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
  @@index([expertId, projectId])
  @@index([projectId, supplierId])
}
```
- [ ] **Step 3: migration**（surgical 若 drift）。
- [ ] **Step 4: 验证 + Commit** `feat(db): 新增 ExpertMemo 手写备忘模型` + trailer。

---

### Task 2: `ExpertMemoService`（ink 上传 + OCR）

**Files:** 新建 `apps/api/src/expert/expert-memo.service.ts`；`expert.module.ts` 注册

**Interfaces:** Produces `createMemo/getMemos/updateMemo/deleteMemo/getInkUrl`。

- [ ] **Step 1: 实现 ExpertMemoService**（注入 PrismaService、StorageService、OcrService）：
```ts
@Injectable()
export class ExpertMemoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly ocr: OcrService,
  ) {}

  async createMemo(userId: string, projectId: string, dto: { supplierId?: string; scoreItemId?: string; contentText?: string; inkBuffer?: Buffer; sourceDevice?: string }) {
    const expert = await this.prisma.bidExpert.findFirst({ where: { userId, projectId } });
    if (!expert) throw new ForbiddenException({ error: '您不是该项目的评审专家', code: 'NOT_PROJECT_EXPERT' });
    let inkFileId: string | undefined;
    let contentText = dto.contentText;
    if (dto.inkBuffer) {
      // 写 FileAsset + 上传 MinIO
      const objectKey = `expert-memo/${projectId}/${expert.id}/${Date.now()}.png`;
      const sha256 = createHash('sha256').update(dto.inkBuffer).digest('hex');
      await this.storage.upload(objectKey, dto.inkBuffer, 'image/png');
      const asset = await this.prisma.fileAsset.create({ data: { key: objectKey, originalName: 'memo-ink.png', mimeType: 'image/png', size: dto.inkBuffer.length, sha256, category: 'expert_memo_ink', uploaderId: userId } });
      inkFileId = asset.id;
      // OCR（可用则识别，不可用降级）
      if (await this.ocr.isAvailable()) {
        try { const r = await this.ocr.ocrImage(dto.inkBuffer, 'image/png', 'memo-ink.png'); if (r.text?.trim()) contentText = (contentText ? contentText + '\n' : '') + r.text.trim(); } catch { /* OCR 失败不阻塞，仅存墨迹 */ }
      }
    }
    return this.prisma.expertMemo.create({ data: { expertId: expert.id, projectId, supplierId: dto.supplierId, scoreItemId: dto.scoreItemId, contentText, inkFileId, sourceDevice: dto.sourceDevice } });
  }

  async getMemos(userId: string, projectId: string, supplierId?: string) {
    const expert = await this.prisma.bidExpert.findFirst({ where: { userId, projectId } });
    if (!expert) throw new ForbiddenException({ error: '您不是该项目的评审专家', code: 'NOT_PROJECT_EXPERT' });
    return this.prisma.expertMemo.findMany({ where: { expertId: expert.id, projectId, ...(supplierId ? { supplierId } : {}) }, orderBy: { createdAt: 'desc' } });
  }

  async updateMemo(userId: string, projectId: string, memoId: string, dto: { contentText?: string }) {
    const expert = await this.prisma.bidExpert.findFirst({ where: { userId, projectId } });
    if (!expert) throw new ForbiddenException({ error: 'NOT_PROJECT_EXPERT', code: 'NOT_PROJECT_EXPERT' } as any);
    const existing = await this.prisma.expertMemo.findFirst({ where: { id: memoId, expertId: expert.id, projectId } });
    if (!existing) throw new BadRequestException({ error: '备忘不存在', code: 'NOT_FOUND' });
    return this.prisma.expertMemo.update({ where: { id: memoId }, data: { ...(dto.contentText !== undefined && { contentText: dto.contentText }) } });
  }

  async deleteMemo(userId: string, projectId: string, memoId: string) {
    const expert = await this.prisma.bidExpert.findFirst({ where: { userId, projectId } });
    if (!expert) throw new ForbiddenException({ code: 'NOT_PROJECT_EXPERT' } as any);
    const existing = await this.prisma.expertMemo.findFirst({ where: { id: memoId, expertId: expert.id, projectId } });
    if (!existing) throw new BadRequestException({ error: '备忘不存在', code: 'NOT_FOUND' });
    await this.prisma.expertMemo.delete({ where: { id: memoId } });
    return { deleted: true };
  }

  async getInkUrl(userId: string, projectId: string, memoId: string) {
    const expert = await this.prisma.bidExpert.findFirst({ where: { userId, projectId } });
    if (!expert) throw new ForbiddenException({ code: 'NOT_PROJECT_EXPERT' } as any);
    const memo = await this.prisma.expertMemo.findFirst({ where: { id: memoId, expertId: expert.id, projectId }, include: { inkFile: true } });
    if (!memo?.inkFile) throw new BadRequestException({ error: '无墨迹原图', code: 'NO_INK' });
    return { url: await this.storage.getPresignedUrl(memo.inkFile.key) };
  }
}
```
> import `createHash` from `crypto`。
- [ ] **Step 2: expert.module.ts** providers 加 `ExpertMemoService`；constructor DI expert.controller 加 `ExpertMemoService`（Task 3 端点用）。
- [ ] **Step 3: tsc clean。Step 4: Commit** `feat(api): ExpertMemoService（ink 上传 MinIO + OCR 降级）` + trailer。

---

### Task 3: memo controller 端点

**Files:** `expert.controller.ts`（:223 后）；DTO

- [ ] **Step 1: DTO** `apps/api/src/expert/dto/create-memo.dto.ts`（contentText?/supplierId?/scoreItemId?/sourceDevice?）；`update-memo.dto.ts`（contentText?）。
- [ ] **Step 2: 端点**（:223 后，confirmReport 后）：
```ts
  @Get('projects/:projectId/memos')
  listMemos(@CurrentUser('sub') userId: string, @Param('projectId') projectId: string, @Query('supplierId') supplierId?: string) {
    return this.memoService.getMemos(userId, projectId, supplierId);
  }
  @Post('projects/:projectId/memos')
  @UseInterceptors(FileInterceptor('ink'))   // multipart: ink 文件可选
  async createMemo(@CurrentUser('sub') userId: string, @Param('projectId') projectId: string,
    @Body() dto: CreateMemoDto, @UploadedFile() ink?: Express.Multer.File) {
    return this.memoService.createMemo(userId, projectId, { ...dto, inkBuffer: ink?.buffer, sourceDevice: dto.sourceDevice });
  }
  @Patch('projects/:projectId/memos/:memoId')
  updateMemo(@CurrentUser('sub') userId, @Param('projectId') projectId, @Param('memoId') memoId, @Body() dto: UpdateMemoDto) {
    return this.memoService.updateMemo(userId, projectId, memoId, dto);
  }
  @Delete('projects/:projectId/memos/:memoId')
  deleteMemo(@CurrentUser('sub') userId, @Param('projectId') projectId, @Param('memoId') memoId) {
    return this.memoService.deleteMemo(userId, projectId, memoId);
  }
  @Get('projects/:projectId/memos/:memoId/ink')
  getInkUrl(@CurrentUser('sub') userId, @Param('projectId') projectId, @Param('memoId') memoId) {
    return this.memoService.getInkUrl(userId, projectId, memoId);
  }
```
> import `UseInterceptors, UploadedFile` from `@nestjs/common`，`FileInterceptor` from `@nestjs/platform-express`。controller 注入 `ExpertMemoService`。
- [ ] **Step 3: tsc clean。Step 4: Commit** `feat(api): 专家备忘 CRUD + 墨迹端点` + trailer。

---

### Task 4: shared ExpertMemo 类型 + api client

**Files:** `packages/shared/src/types.ts`；`apps/expert-portal/src/lib/api.ts`

- [ ] **Step 1: shared 加** `ExpertMemo` interface（id/expertId/projectId/supplierId?/scoreItemId?/contentText?/inkFileId?/sourceDevice?/createdAt/updatedAt）+ re-export。
- [ ] **Step 2: build shared** `pnpm --filter @water-erp/shared build`。
- [ ] **Step 3: api.ts 加具名函数** listMemos/createMemo（FormData: ink + fields）/updateMemo/deleteMemo/getInkUrl。
```ts
export async function listMemos(projectId: string, supplierId?: string) {
  return api.get<ExpertMemo[]>(`/expert/projects/${projectId}/memos${supplierId ? `?supplierId=${supplierId}` : ''}`);
}
export async function createMemo(projectId: string, data: { contentText?: string; supplierId?: string; scoreItemId?: string; sourceDevice?: string; inkBlob?: Blob }) {
  const fd = new FormData();
  if (data.contentText !== undefined) fd.append('contentText', data.contentText);
  if (data.supplierId) fd.append('supplierId', data.supplierId);
  if (data.scoreItemId) fd.append('scoreItemId', data.scoreItemId);
  if (data.sourceDevice) fd.append('sourceDevice', data.sourceDevice);
  if (data.inkBlob) fd.append('ink', data.inkBlob, 'memo-ink.png');
  return api.post<ExpertMemo>(`/expert/projects/${projectId}/memos`, fd);
}
export async function updateMemo(projectId: string, memoId: string, contentText: string) {
  return api.patch<ExpertMemo>(`/expert/projects/${projectId}/memos/${memoId}`, { contentText });
}
export async function deleteMemo(projectId: string, memoId: string) {
  return api.delete<void>(`/expert/projects/${projectId}/memos/${memoId}`);
}
export async function getMemoInkUrl(projectId: string, memoId: string) {
  return api.get<{ url: string }>(`/expert/projects/${projectId}/memos/${memoId}/ink`);
}
```
> api.post 需支持 FormData（不设 Content-Type，浏览器自动 multipart）——确认 api.ts fetchApi 不强制 JSON Content-Type for FormData（读 fetchApi :15，若强制需分支）。
- [ ] **Step 4: tsc clean。Step 5: Commit** `feat(shared+expert-portal): ExpertMemo 类型 + memo API client` + trailer。

---

### Task 5: 平板手写 canvas 组件

**Files:** 新建 `apps/expert-portal/src/components/memo/handwriting-canvas.tsx`

- [ ] **Step 1: 实现 HandwritingCanvas**（pointer events，导出 PNG Blob）：
```tsx
'use client';
import { useImperativeHandle, useRef, forwardRef } from 'react';

export interface HandwritingCanvasHandle { clear: () => void; toBlob: () => Promise<Blob | null>; isEmpty: () => boolean; }

export const HandwritingCanvas = forwardRef<HandwritingCanvasHandle, { width?: number; height?: number; strokeColor?: string }>(
  ({ width = 600, height = 320, strokeColor = '#1e3a5f' }, ref) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const drawing = useRef(false);
    const hasInk = useRef(false);
    const getCtx = () => { const c = canvasRef.current; const ctx = c?.getContext('2d'); if (ctx) { ctx.strokeStyle = strokeColor; ctx.lineWidth = 2.5; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; } return ctx; };
    const pos = (e: React.PointerEvent) => { const r = canvasRef.current!.getBoundingClientRect(); return { x: (e.clientX - r.left) * (width / r.width), y: (e.clientY - r.top) * (height / r.height) }; };
    const down = (e: React.PointerEvent) => { e.preventDefault(); drawing.current = true; hasInk.current = true; const ctx = getCtx(); const p = pos(e); ctx?.beginPath(); ctx?.moveTo(p.x, p.y); canvasRef.current?.setPointerCapture(e.pointerId); };
    const move = (e: React.PointerEvent) => { if (!drawing.current) return; e.preventDefault(); const ctx = getCtx(); const p = pos(e); ctx?.lineTo(p.x, p.y); ctx?.stroke(); };
    const up = (e: React.PointerEvent) => { drawing.current = false; };
    useImperativeHandle(ref, () => ({
      clear: () => { const ctx = getCtx(); ctx?.clearRect(0, 0, width, height); hasInk.current = false; },
      isEmpty: () => !hasInk.current,
      toBlob: () => new Promise(resolve => canvasRef.current?.toBlob(b => resolve(b), 'image/png') ?? resolve(null)),
    }));
    return <canvas ref={canvasRef} width={width} height={height} touch-action="none"
      onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerLeave={up}
      className="w-full rounded-xl border border-[oklch(0.88_0.005_264)] bg-white" style={{ aspectRatio: `${width}/${height}` }} />;
  });
HandwritingCanvas.displayName = 'HandwritingCanvas';
```
> `touch-action: none` 关键（防平板滚动/缩放干扰手写）。
- [ ] **Step 2: tsc clean。Step 3: Commit** `feat(expert-portal): HandwritingCanvas 手写画布组件` + trailer。

---

### Task 6: memo 面板 + tablet 路由 + PWA

**Files:** 新建 `memo-panel.tsx`、`(tablet)/layout.tsx`、`(tablet)/evaluate/[id]/page.tsx`、`public/manifest.webmanifest` + `sw.js`、`app/layout.tsx`

- [ ] **Step 1: memo-panel.tsx** —— 手写区（HandwritingCanvas）+ 键盘 textarea（sourceDevice 切换）+ 保存按钮（createMemo：inkBlob or contentText）+ 列表（listMemos，显示 contentText + 墨迹原图链接 getMemoInkUrl）+ 删除。
- [ ] **Step 2: (tablet)/layout.tsx** —— 无桌面 sidebar 的触屏 layout（紧凑 header + 全宽 content）。
- [ ] **Step 3: (tablet)/evaluate/[id]/page.tsx** —— 复用 phase ② PointChecklistScoring（触屏布局）+ MemoPanel。登录/鉴权同 (app)（cookie + X-Portal: expert）。
- [ ] **Step 4: PWA** —— `public/manifest.webmanifest`（name/icons 192+512/theme_color/display:standalone）；`public/sw.js`（轻量缓存 app shell）；`app/layout.tsx` metadata 加 manifest + themeColor + apple touch icon；注册 sw（app/main.tsx 或 layout client component）。
- [ ] **Step 5: tsc clean。Step 6: Commit** `feat(expert-portal): memo 面板 + tablet 路由 + PWA` + trailer。

---

### Task 7: 桌面端备忘查看 + 键盘输入

**Files:** `(app)/evaluate/[id]/page.tsx`（memo panel 入口，桌面用键盘输入 + 查看墨迹）

- [ ] **Step 1: 桌面 evaluate page** —— 加 MemoPanel（sourceDevice='desktop'，键盘输入为主；手写 canvas 可选隐藏）；备忘列表显示 contentText + 墨迹原图（getMemoInkUrl → img）。
- [ ] **Step 2: tsc clean + 手动验证。Step 3: Commit** `feat(expert-portal): 桌面端备忘查看 + 键盘输入` + trailer。

---

## Self-Review 结论

- **Spec 覆盖**：§6.1 平板手写（canvas+OCR+MinIO）→ Task 2/5；§6.2 桌面键盘+查看墨迹 → Task 7；项目/供应商/评分项三级挂载 → Task 1（supplierId?/scoreItemId?）；OCR 降级 → Task 2 isAvailable。✅
- **PWA 从零**：本 plan 用原生 manifest + 轻量 sw（不引入 next-pwa）——YAGNI；若需离线深度缓存后续增强。
- **FormData 上传 ink**：Task 4 api.ts createMemo 用 FormData；需确认 fetchApi 不强制 JSON Content-Type（Task 4 Step 3 标注）。
- **复用 phase ②**：tablet 路由复用 PointChecklistScoring（触屏布局，compact prop）。
- **行号锚点**基于 phase ④ 后调研；SDD implementer 按实际确认。
- **风险**：Task 6（tablet 路由 + PWA）最大（多文件 + 从零）；建议 SDD 时 Task 6 拆细（tablet 路由 / memo 面板 / PWA 可分子 task）。
