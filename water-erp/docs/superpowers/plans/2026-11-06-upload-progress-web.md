# 上传进度条（:3005 全上传点）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给 :3005 全部文件上传点装上字节级进度（水波+流光动效，.impeccable 令牌约束），传输层沉淀到 `@water-erp/client.upload()`。

**Architecture:** XHR 底座 `client.upload()`（复用头注入/ApiError/401/断网翻译，新增 onProgress+signal）→ web `api.upload` 透传 → `useFileUploads` 队列 hook（状态机+速度 EMA）→ `UploadProgressList`/`WaterBar` 组件 → 各上传点接线。设计规格：`docs/superpowers/specs/2026-11-06-upload-progress-design.md`。

**Tech Stack:** TypeScript、XMLHttpRequest、React 19 hook、纯 CSS keyframes（零新依赖）。

## Global Constraints

- 风格红线（spec §4.3）：无彩色渐变、无 Material 投影、波幅 ≤3px、循环周期 ≥2s；填充 `color-mix(in oklch, var(--accent) 14%, transparent)`；高光带 `oklch(1 0 0 / 0.35)`。
- `prefers-reduced-motion: reduce` → 全动效退静态（波纹/流光/涟漪停，数字直跳终值）。
- 失败不中断队列：逐文件标记失败可重试（spec §5.2）；取消=abort 当前+后续置 canceled。
- 顺序上传不变（不并发）；AI 分析时机不变（整批上传动作结束跑一次）。
- client 改后必须 `pnpm --filter @water-erp/client build`（dist 消费）。
- 两个 base64-JSON 通道（专家 OCR、头像）与纯本地解析不入本计划（spec §2）。
- 并行会话规则：只 add 自己改的文件；提交信息带 feat(web)/feat(client) 前缀。

---

### Task 1: `@water-erp/client` upload()（XHR 传输层）

**Files:**
- Modify: `packages/client/src/index.ts`
- Test: `packages/client/test.cjs`

**Interfaces:**
- Produces: `ApiClient.upload<T>(path: string, body: FormData, opts?: { onProgress?: (loaded: number, total: number) => void; signal?: AbortSignal }): Promise<T>`——后续所有任务的传输底座。

- [ ] **Step 1: 写失败测试**（test.cjs 追加；XHR 走 `globalThis.XMLHttpRequest` 运行时取用，测试注入 stub）

```js
// 3. upload()：XHR 进度/取消/错误归一（2026-11-06 上传进度条）
class FakeXHR {
  constructor() { this.readyState = 0; this.status = 0; this.upload = {}; this.headers = {}; }
  open(m, u) { this.method = m; this.url = u; }
  setRequestHeader(k, v) { this.headers[k] = v; }
  send(body) { this.body = body; FakeXHR.last = this; queueMicrotask(() => {
    if (this._abort) { const e = new DOMException('Aborted', 'AbortError'); this.onerror ? this.onerror(e) : this.onload(); return; }
    this.upload.onprogress && this.upload.onprogress({ lengthComputable: true, loaded: 50, total: 100 });
    this.status = 200; this.responseText = JSON.stringify({ ok: 1 });
    this.onload();
  }); }
  abort() { this._abort = true; }
}
async function testUpload() {
  const prev = globalThis.XMLHttpRequest; globalThis.XMLHttpRequest = FakeXHR;
  const { createApiClient } = require('./dist/index.js');
  const client = createApiClient({ portal: 'web', baseUrl: '' });
  // 3a. 进度回调 + 2xx JSON 解析 + 头注入
  let seen = null;
  const res = await client.upload('/x', new FormData(), { onProgress: (l, t) => seen = [l, t] });
  assert.deepEqual(seen, [50, 100]); assert.deepEqual(res, { ok: 1 });
  assert.equal(FakeXHR.last.headers['X-Portal'], 'web');
  // 3b. 非 2xx → ApiError（body.error 优先）
  FakeXHR.prototype.send = function () { this.status = 413; this.responseText = JSON.stringify({ code: 'FILE_TOO_LARGE', error: '文件超过大小限制' }); queueMicrotask(() => this.onload()); };
  await assert.rejects(() => client.upload('/x', new FormData()), (e) => e instanceof ApiError && e.code === 'FILE_TOO_LARGE' && e.message === '文件超过大小限制');
  // 3c. abort → AbortError 语义
  const ctl = new AbortController(); ctl.abort();
  await assert.rejects(() => client.upload('/x', new FormData(), { signal: ctl.signal }), (e) => e.name === 'AbortError');
  globalThis.XMLHttpRequest = prev;
}
```
（在 `main()` 里 `await testUpload();`，并把 3b/3c 对 `FakeXHR.prototype.send` 的覆写在 3a 断言后恢复，避免串测。）

- [ ] **Step 2: 跑测确认失败**：`cd packages/client && npm run build && node test.cjs` → 期望 `client.upload is not a function`。
- [ ] **Step 3: 实现**（index.ts：ApiClient 接口加 upload；实现块置于 return 前）

```ts
export interface UploadOptions {
  /** 上传字节进度（lengthComputable 才回调） */
  onProgress?: (loaded: number, total: number) => void;
  /** 取消：abort 后 reject DOMException('…','AbortError')，与 fetch 同语义 */
  signal?: AbortSignal;
}

// createApiClient 内：
  /** XHR 底座（fetch 无上传进度事件）：头注入/错误归一/401 回调与 doFetch 同语义。
   *  XMLHttpRequest 运行时取 globalThis（SSR 不触达，测试可注入 stub）。 */
  function upload<T>(path: string, body: FormData, opts: UploadOptions = {}): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const xhr = new globalThis.XMLHttpRequest();
      xhr.open('POST', `${base}${path}`);
      xhr.withCredentials = true;
      const headers = { 'X-Portal': options.portal, ...(options.extraHeaders?.() ?? {}) };
      for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v);
      const onAbort = () => { xhr.abort(); };
      opts.signal?.addEventListener('abort', onAbort);
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && opts.onProgress) opts.onProgress(e.loaded, e.total);
      };
      xhr.onerror = () => {
        opts.signal?.removeEventListener('abort', onAbort);
        reject(new ApiError(0, 'NETWORK_ERROR', '网络异常或请求超时，请检查网络'));
      };
      xhr.onload = () => {
        opts.signal?.removeEventListener('abort', onAbort);
        if (opts.signal?.aborted) { reject(new DOMException('Aborted', 'AbortError')); return; }
        if (xhr.status >= 200 && xhr.status < 300) {
          const text = xhr.responseText ?? '';
          resolve((text ? JSON.parse(text) : undefined) as T);
          return;
        }
        let code = 'UNKNOWN';
        let message = `请求失败 (${xhr.status})`;
        try {
          const data = JSON.parse(xhr.responseText);
          if (data?.code) code = String(data.code);
          if (data?.error) message = String(data.error);
          else if (data?.message) message = Array.isArray(data.message) ? String(data.message[0] ?? '') : String(data.message) || message;
          opts.signal; // 401 回调与 doFetch 同口径
          if (xhr.status === 401 && isBrowser && options.on401) options.on401(new ApiError(xhr.status, code, message, data));
          reject(new ApiError(xhr.status, code, message, data));
        } catch { reject(new ApiError(xhr.status, code, message)); }
      };
      xhr.send(body);
    });
  }
```
（`upload,` 加进 return 对象；接口注释同 §3 spec。）
- [ ] **Step 4: 跑测通过**：`npm run build && node test.cjs` 全绿。
- [ ] **Step 5: 重建 dist + 提交**：`pnpm --filter @water-erp/client build`；`git add packages/client && git commit -m "feat(client): upload() XHR 传输层——字节进度+取消+错误归一（上传进度条底座）"`。

### Task 2: web 门户管线（api.upload + useFileUploads 队列 hook）

**Files:**
- Modify: `apps/web/src/lib/api.ts:28-35`（api 对象加 upload）
- Create: `apps/web/src/lib/upload/use-file-uploads.ts`
- Create: `apps/web/src/lib/upload/format.ts`

**Interfaces:**
- Consumes: `client.upload`（Task 1）。
- Produces:
  - `api.upload<T>(path, body, opts)`：`client.upload` 直通。
  - `useFileUploads<T>(opts)`：`{ uploadOne(file, id, onProgress, signal): Promise<T>; onEachDone?(item: { id: string; file: File; result: T }): void; onAllSettled?(summary: { done: number; failed: number; canceled: number }): void }` → `{ items, start(files: File[]), cancel(), retry(id), clear(), running, aggregate }`。
  - `UploadItem = { id: string; file: File; status: 'pending'|'uploading'|'done'|'failed'|'canceled'; loaded: number; total: number; error?: string; result?: T }`；`aggregate = { pct: number; loaded: number; total: number; speedBps: number | null; doneCount: number; failedCount: number }`。
  - `formatBytes(n)`（1024 进制，`12.4 MB`）、`formatSpeed(bps)`（`3.2 MB/s`）。

- [ ] **Step 1: 实现 api.upload**（api.ts）——`upload: <T>(path: string, body: FormData, opts?: { onProgress?: (l: number, t: number) => void; signal?: AbortSignal }) => client.upload<T>(path, body, opts),`
- [ ] **Step 2: 实现 use-file-uploads.ts**：核心逻辑（全量代码，测试经手动验收+Task 10）——`start` 建 items→顺序 for 循环（pending→uploading→done/failed；cancel 时 abort 当前 abortRef、余下置 canceled）→onAllSettled；`retry(id)` 单文件重走 uploadOne（done 后 onEachDone 同样触发）；速度=最近 2s 窗口字节差÷时间（数组记录 [t,loaded]，aggregate 时裁剪）；id=`crypto.randomUUID()`。
- [ ] **Step 3: tsc**：`cd apps/web && npx tsc --noEmit` → 0 错误。
- [ ] **Step 4: 提交**：`git add apps/web/src/lib/api.ts apps/web/src/lib/upload/ && git commit -m "feat(web): 上传管线——api.upload 直通 + useFileUploads 顺序队列（进度/取消/重试/速度）"`。

### Task 3: 进度组件（WaterBar 水波流光 + UploadProgressList + 数字滚动）

**Files:**
- Create: `apps/web/src/components/upload/water-bar.tsx`
- Create: `apps/web/src/components/upload/upload-progress-list.tsx`
- Create: `apps/web/src/lib/upload/use-count-up.ts`
- Modify: `apps/web/src/app/globals.css`（追加 keyframes 块）

**Interfaces:**
- Consumes: `UploadItem`/`formatBytes`（Task 2）。
- Produces:
  - `<WaterBar pct={62} state="uploading" | "done" | "failed" | "pending" />`——h-1.5 细条；track `color-mix(in oklch,var(--muted-foreground)_15%,transparent)`；fill 色随 state（uploading=accent 14% mix + 水面波纹 + 流光；done=success；failed=danger；pending=0%）。
  - `<UploadProgressList items={UploadItem[]} onRetry={(id)=>void} />`——每文件行：状态图标（Loader2 旋/CheckCircle2/AlertCircle/Circle）+文件名 truncate+`formatBytes(file.size)`+mono 百分比+`[重试]`（仅 failed/canceled）+行内 WaterBar。
  - `useCountUp(target: number, ms=200): number`——rAF 插值；reduced-motion 直返 target。

- [ ] **Step 1: globals.css 追加**（含 reduced-motion 静态退路；波幅 2px、双周期 8s/13s、流光 2.4s——全部常量写死遵守红线）：

```css
/* ── 上传进度·水波+流光（2026-11-06 spec §4.3；reduced-motion 全退静态） ── */
@keyframes uploadWaveA { from { transform: translateX(0); } to { transform: translateX(-50%); } }
@keyframes uploadWaveB { from { transform: translateX(-25%); } to { transform: translateX(-75%); } }
@keyframes uploadShimmer { from { left: -14%; } to { left: 100%; } }
@keyframes uploadRipple { from { transform: scale(1); opacity: 0.5; } to { transform: scale(1.6); opacity: 0; } }
.up-wave { position: absolute; inset: -2px 0 auto 0; height: 4px; background-repeat: repeat-x; background-size: 50% 100%;
  /* 波形由两层 div 共用：linear-gradient 90deg 斜率段模拟波峰（非彩色渐变，纯透明度波形） */
  background-image: linear-gradient(90deg, transparent 0%, color-mix(in oklch, var(--accent) 35%, transparent) 25%, transparent 50%); }
.up-wave--a { animation: uploadWaveA 8s linear infinite; opacity: 0.35; }
.up-wave--b { animation: uploadWaveB 13s linear infinite; opacity: 0.18; }
.up-shimmer { position: absolute; top: 0; bottom: 0; width: 12px; background: oklch(1 0 0 / 0.35); animation: uploadShimmer 2.4s ease-in-out infinite; }
.up-ripple { position: absolute; inset: 0; border-radius: inherit; box-shadow: inset 0 0 0 1px color-mix(in oklch, var(--success) 45%, transparent); animation: uploadRipple 400ms ease-out forwards; }
@media (prefers-reduced-motion: reduce) {
  .up-wave, .up-shimmer, .up-ripple { animation: none; display: none; }
}
```
- [ ] **Step 2: 实现 water-bar.tsx / upload-progress-list.tsx / use-count-up.ts**（按 Produces 签名；WaterBar 内 `requestAnimationFrame` 不用——纯 CSS；done 态一次性 `.up-ripple` 层 + CheckCircle2 描边由图标色切换承担）。
- [ ] **Step 3: tsc + 提交**：`feat(web): 上传进度组件——WaterBar 水波流光/UploadProgressList/数字滚动（reduced-motion 退路）`。

### Task 4: 旗舰面——PMI 阶段附件（project-detail-panel）

**Files:**
- Modify: `apps/web/src/lib/api/project-management.ts:331-349`（uploadProjectStageAttachment 换 api.upload）
- Modify: `apps/web/src/components/projects/project-detail-panel.tsx`（uploadStageFiles 队列化 + sticky 聚合条 + 每文件行）

**Interfaces:**
- Consumes: `api.upload`、`useFileUploads`、`UploadProgressList`、`WaterBar`、`useCountUp`。
- Produces（后续任务复用的「标准接线模式」）:
  - `uploadProjectStageAttachment(projectId, stageKey, file, round?, opts?: { onProgress?; signal? })`
  - 页面模式：`const up = useFileUploads({ uploadOne: (f, id, onProgress, signal) => uploadProjectStageAttachment(item.id, key, f, round, { onProgress, signal }), onEachDone: i => 注入附件/extractedInfo, onAllSettled: s => 进入 AI 分析 })`；`up.start(selectedFiles)`。

- [ ] **Step 1: API 函数换轨**：函数体 `apiFetch` → `api.upload(...)`，`apiFetch`/`parseJsonResponse` 导入若无他处使用则从该文件移除导入（有则保留）；签名加 `opts`。错误语义不变（api.upload 抛 ApiError，message 同）。
- [ ] **Step 2: uploadStageFiles 重写**：validation 前置不变（actionsDisabled/isPastRound/isLockedByBid/stageLocked）；`setUploadProgress` 计数状态删除，改 `up.start(selectedFiles)`；`onEachDone` 里做原「注入 localItem 附件 + extractedInfoOverride」；`onAllSettled` 里做原「setSelectedFiles([]) + 清 fileInput + handleUpdated + AI 分析链（analysisSeqRef 守卫）」——失败>0 时 toast.warning(`X 个文件上传失败，可逐个重试`) 且**仍触发分析**（成功件已入库）；`uploading` 态改由 `up.running` 派生；取消按钮 → `up.cancel()`。
- [ ] **Step 3: sticky 聚合条改造**（替换 :2267-2284 块）：`uploading` 分支改 `up.running`；文案 `正在上传 {done}/{total} · {useCountUp(pct)}%{speed?` · ${formatSpeed(speed)}`:''}`；细条换 `<WaterBar pct={pct} state="uploading" />`；右侧 `[× 取消]`（`up.cancel`）；`analysisLoading` 分支原样。
- [ ] **Step 4: 每文件行**：上传区选中文件 chips 块（:2358-2366）改为 `{up.items.length > 0 ? <UploadProgressList items={up.items} onRetry={up.retry} /> : 原芯片渲染（未 start 前 items 空）}`——即选择后未点上传仍显示芯片，start 后切换为进度行；`up.clear()` 在阶段切换/关闭面板 useEffect 调用。
- [ ] **Step 5: 手工验收**（:3005 dev 实测）：多文件（含 1 个 >50MB）进度推进/速度合理；中途取消；拔网线失败行+其余继续；单文件重试；上传后 AI 分析照常；只读/归档态上传区禁用不变；reduced-motion（devtools 模拟）退静态。
- [ ] **Step 6: 提交**：`feat(web): 阶段附件上传进度——水波流光聚合条+每文件行+取消/重试（旗舰面）`。

### Task 5: 同函数消费者（采购文件向导/公告发布向导/重新招标弹窗）

**Files:**
- Modify: `apps/web/src/components/projects/official-tender-wizard.tsx`（:224 调用点）
- Modify: `apps/web/src/components/projects/announcement-publish-wizard.tsx`（:2201 附件循环）
- Modify: `apps/web/src/components/projects/abort-restart-dialog.tsx`（:506 附件+提取）

**Interfaces:**
- Consumes: Task 4 的 `uploadProjectStageAttachment(path, ..., opts)` 新签名 + `useFileUploads`/`UploadProgressList`。

- [ ] 每处：单文件/小批量位（向导内上传卡）——`useFileUploads` + 弹窗内嵌 `<UploadProgressList>`（无 sticky，聚合百分比用行内 `WaterBar` 置于上传卡下）；`extractInitiationFields/extractDemandFields`（裸 apiFetch POST FormData，project-management.ts:166/183）同步加 opts 换 `api.upload`，create-project-dialog 的导入进度同接线（该文件一并改）。
- [ ] tsc + 手工验收（向导走一遍）+ 提交 `feat(web): 项目域向导/弹窗上传进度接线`。

### Task 6: 公告域（附件 + 采购文件加密上传）

**Files:**
- Modify: `apps/web/src/lib/api/announcement.ts:255-300`（uploadFile/uploadBidDocument 加 opts 换 api.upload）
- Modify: `apps/web/src/app/(main)/notice/new/page.tsx:556`、`apps/web/src/app/(main)/notice/[id]/page.tsx:678,843`、`apps/web/src/components/projects/bid-confirm-panel.tsx:1516`、`apps/web/src/components/tender-write/notification-letter-dialog.tsx:910`

**Interfaces:**
- Consumes/Produces: `uploadFile(file, category, opts?)`、`uploadBidDocument(announcementId, file, opts?)`——全 web 通用附件函数自此带进度。

- [ ] announcement.ts 两函数换 `api.upload`（FormData 组装/密码字段不变）。
- [ ] 五个调用位：列表型（notice 两处附件批量）用 `useFileUploads`+`UploadProgressList`；单文件位（中标通知书/通知函 PDF）用紧凑型——`WaterBar` + mono 百分比文本置于上传按钮下方（无行列表）。
- [ ] tsc + 手工验收（发布一条公告带附件；采购文件加密上传走大文件）+ 提交 `feat(web): 公告域上传进度（附件批量+加密上传大文件）`。

### Task 7: 项目域其余（导入评审文件/归档登记/谈判配置附件）

**Files:**
- Modify: `apps/web/src/lib/api/procurements.ts`（archive-volume 上传函数若有封装；无则页内联）
- Modify: `apps/web/src/components/projects/tender-file-editor-modal.tsx:915`（内联 import-review-file → 抽 `api.upload` 直调带 opts）
- Modify: `apps/web/src/components/procurements/archive-volume-modal.tsx:326`
- Modify: `apps/web/src/app/(main)/supplier/selection/page.tsx:2790`（:1517 循环）

- [ ] 每处：小文件紧凑型（WaterBar+百分比）；selection 页批量循环改 `useFileUploads`。
- [ ] tsc + 提交 `feat(web): 项目域散点上传进度接线`。

### Task 8: 标书域 + 知识库/审查

**Files:**
- Modify: `apps/web/src/lib/api/tender-write-import.ts:12,42`（importAutofill/announcementImportAutofill 加 opts）
- Modify: `apps/web/src/lib/api/announcement.ts`（importWinningBidFromPdf:395）
- Modify: `apps/web/src/lib/api/review.ts:29`（uploadDocument 加 opts 换 api.upload）
- Modify: `apps/web/src/lib/api/knowledge.ts:64,106`（两处上传加 opts）
- Modify: 消费页 `tender-write/import-autofill-dialog.tsx:307`、`tender-write/announcement-dialog.tsx:1667`、`tender-review/review-workspace-content.tsx:214`、`tender-review/files-panel-compact.tsx:94`、`assistant/knowledge-panel.tsx:170`

- [ ] API 函数换轨（同 Task 6 模式：FormData 不变 + opts 透传）。
- [ ] 消费页：批量导入对话框用 `UploadProgressList`；单文件位紧凑型。
- [ ] tsc + 提交 `feat(web): 标书/审查/知识库上传进度接线`。

### Task 9: 专家抽取 + 供应商域 + 合同凭证 + 聊天

**Files:**
- Modify: `apps/web/src/lib/api/expert.ts:255`（uploadExtractionFile 加 opts）
- Modify: `apps/web/src/lib/api/supplier.ts:663,767`（uploadSupplierFile/uploadReviewAttachment 加 opts）
- Modify: `apps/web/src/lib/api/contract.ts:118`（uploadContractProof 加 opts）
- Modify: `apps/web/src/lib/api/chat.ts:76`（uploadChatFile 加 opts）
- Modify: 消费页 `expert/extract/page.tsx:2201`、`supplier/[id]/page.tsx:1624`、`supplier/review-center-modal.tsx:835`、`contracts/contract-stage-modal.tsx:316,348,417`、`chat/chat-dialog.tsx:434,445`

- [ ] API 函数换轨；extract 页批量用 `UploadProgressList`；supplier/contract 位紧凑型；chat 发送按钮内联 mono 百分比（`发送中 62%`，无条）。
- [ ] tsc + 提交 `feat(web): 专家/供应商/合同/聊天上传进度接线`。

### Task 10: 回归与收尾

- [ ] `cd apps/web && npx tsc --noEmit && pnpm --filter web lint`（0 error）。
- [ ] `pnpm --filter @water-erp/client test`（含 Task 1 新用例）。
- [ ] 全点抽查清单（每域抽 1 处实测：阶段附件大文件/公告加密/抽取批量/聊天单发）+ reduced-motion 抽查。
- [ ] spec 状态行更新「已实施（提交范围）」+ 提交 `docs(spec): 上传进度条 :3005 落地完成`。

## Self-Review 结论

- 覆盖：spec §3（Task 1-2）、§4.1/4.2（Task 3-4）、§4.3（Task 3 CSS）、§5（Task 4）、§7 P2 批（Task 5-9 = :3005 全部 multipart 上传点，base64 通道按 spec 排除）、§8（Task 1 测试 + Task 4/10 手工清单）。
- 类型一致：`UploadOptions{onProgress,signal}`/`UploadItem`/`useFileUploads` 签名在 Task 2 定义、Task 3-9 同名引用；`api.upload` 三处签名一致。
- 占位符：无 TBD；Task 5-9 为同模式机械接线，模式代码在 Task 4 全量给出。
