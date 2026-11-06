# 上传进度条全系统设计（client.upload 统一传输 + 分门户组件）

日期：2026-11-06
状态：设计已获用户口头认可（形态=聚合+每文件行、含取消与失败重试）；演示面=:3005 项目管理阶段附件上传

## 1. 需求与裁定

- 全系统所有用户上传文件的地方增加**字节级上传进度**展示，风格符合 .impeccable 设计体系（细线、等宽数字、新拟态内凹、无渐变）。
- **演示先行**：仅在 :3005「项目管理」各阶段步骤的上传处（project-detail-panel 阶段附件上传区，同一 UI 服务全部九阶段）落地，其余上传点按 §7 分批推广。
- 用户已选定形态：**sticky 聚合条（总百分比+速度+取消）+ 每文件行（文件名/大小/各自百分比/状态，失败可单文件重试）**。

## 2. 现状盘点（2026-11-06 全量扫描）

全系统 43 个真实上传点 + 3 个本地读取类 + 2 个 base64-JSON 通道：

| 门户 | 上传点 | 现有进度 | 传输 |
|------|--------|---------|------|
| supplier :3004 | 11 | **7 处有**（资质/凭证/CA 密文链路） | 自有 XHR 封装 `src/lib/api/upload.ts`（onprogress+120s 超时；CA 链路 >50MB 停滞看门狗） |
| web :3005 | 26（含 2 个 base64-JSON） | 0 | 三路混用：`api.postForm`/裸 `apiFetch`/组件内联 |
| expert :3006 | 4（摄像头/手写画布 Blob，无 file input） | 0 | `api.post` FormData |
| bid :3007 | 2 入口（覆盖 4 类签字扫描目标；其一为 `document.createElement('input')` 动态建） | 0 | fetch postForm |
| public/mobile/assistant | 0 | — | — |

关键事实：
1. **fetch 无上传进度事件**（规范缺失），唯一可靠途径是 XHR `xhr.upload.onprogress`——这是除 :3004 外全系统零进度的根因。
2. `@water-erp/client` 只有 fetch 版 `postForm`；`upload` 方法不存在（bid-portal 的 `api.upload` 只是 postForm 别名，非进度版）。
3. :3004 `supplier-portal-next/src/lib/api/upload.ts:36` 是**实战验证过的 XHR+进度实现**（含错误归一/超时/可取消），本设计的上移蓝本。
4. 全系统无真实 drag&drop（drop-zone 样式均点击触发）——不在本设计范围。
5. 大文件风险面：:3004 投标密文（已有进度+看门狗）；:3005 采购文件加密上传、专家抽取批量上传（fetch 零进度）。

## 3. 架构（用户已认可：方案 A）

```
@water-erp/client（共享传输层，一份实现）
  upload<T>(path, formData, { onProgress?, signal? })
    ├─ XHR 底座：withCredentials + X-Portal + extraHeaders()（与 doFetch 同头注入）
    ├─ onProgress(loaded, total)：xhr.upload.onprogress（lengthComputable 才回调）
    ├─ 错误规范化：非 2xx → 解析响应体 → ApiError(status, code, error 文案)（与 toApiError 同语义）
    ├─ 网络异常 → ApiError(0, 'NETWORK_ERROR', '网络异常或请求超时…')
    ├─ 401 → on401 回调（浏览器端，与 doFetch 同）
    ├─ signal.aborted → xhr.abort() → reject DOMException AbortError（保留取消语义）
    └─ 空响应体 → undefined（与 fetchApi 判空同）
各门户（组件层，按「无共享组件包」惯例每门户自包含一份）
  UploadProgressList 组件 + useUploadQueue 状态驱动（首版落 web，其余门户推广时同款复制）
```

- client 改后必须 `pnpm --filter @water-erp/client build`（dist 消费，CI 构建链已含）。
- :3004 的 CA 链路专属能力（停滞看门狗、双相位进度）保留在门户层不抽走；其 `upload.ts` 将来可薄封装到 `client.upload`（推广期任务，非本次）。

## 4. 组件规格（web 版，cgzxui/impeccable 令牌）

### 4.1 sticky 聚合条（改造现有 `project-detail-panel.tsx:2268` 处）

```
◈ 正在上传 2/5 · 47% · 3.2 MB/s                    [× 取消]
▓▓▓▓▓▓▓▓▓▓▓▓▓░░░░░░░░░░░░░░░░░░░░░░ 47%   ← h-1.5 细条，accent 填充
```

- 布局沿用现有 sticky（渐变白底 + `borderBottom: 1px solid oklch(0.6 0.04 258/0.12)`）。
- 数字全部 `font-mono`（等宽数字令牌）；「2/5」=已完成/总数；总百分比 = Σ已传字节/Σ总字节（非文件计数）。
- 速度：onProgress 时间窗内字节差（EMA 平滑，≤2s 窗口）；上传开始 <500ms 不显示速度（避免抖动）。
- 取消按钮：`neu-btn-soft !px-3 !py-1 !text-[11px]`——中止当前文件（AbortController）+ 后续文件置「已取消」；已完成文件保留。
- AI 分析阶段提示保持现状（不定态 Loader2 + 文案），不混入百分比。

### 4.2 每文件行（上传区选中文件列表的上传中变体）

```
✓ 立项申请表.pdf          2.4 MB    已完成      ← success 色 Check
▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓ 100%
⇡ 采购需求书.docx        8.1 MB    62%         ← accent 色 UploadCloud
▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓░░░░░░░░░ 62%
○ 评分办法.pdf           1.2 MB    等待中      ← muted 圆环，条 0%
✗ 营业执照.jpg           900 KB    失败·文件超过大小限制   ↻ 重试
▓▓▓▓▓▓▓▓▓░░░░░░░░ 40%（danger 色）
```

- 行结构：`状态图标 14px + 文件名(truncate) + 大小(font-mono 11px muted) + 状态文案/百分比(font-mono) + [重试]`。
- 细条：`h-1 rounded-full`，轨道 `color-mix(in oklch, var(--muted-foreground) 15%, transparent)`，填充色随状态（上传中 accent / 完成 success / 失败 danger / 等待 muted 0%）。
- 状态机：`等待中 → 上传中(loaded/total) → 已完成 | 失败(reason) | 已取消`；失败行内 ↻ 仅重传该文件（复用同一 abort 链）。
- 非上传期（仅选择未上传）：保持现有芯片形态，不预渲染行。

### 4.3 动效层（2026-11-06 用户裁定：水波+流光叠加——「炫酷但须契合系统风格」）

全部动效只用系统既有语言（令牌色、hairline、inset 顶光线、等宽数字），禁区：彩色渐变、
Material 投影、emoji、波幅 >3px、循环周期 <2s。

- **水面（水槽隐喻，贴水利品牌）**：填充本体 `--accent` 半透明（`color-mix(in oklch, var(--accent) 14%, transparent)`，同徽章底色口径）；填充缘两层错相波纹——纯 CSS 波形，波幅 2px、透明度 0.35/0.18、8s/13s 双周期 translateX 循环，颜色 accent-soft；轨道维持内凹 hairline（§4.2 既有轨道样式）。
- **流光**：波峰上一道 12px 宽白色高光带（`oklch(1 0 0 / 0.35)`）每 2.4s 自左向右扫过填充区一次——与卡片 `inset 0 1px 0 oklch(1 0 0/0.7)` 顶光线同一语言，非彩色渐变。
- **数字滚动**：总百分比/单行百分比/速度 tabular-nums 逐帧播值（rAF 插值 ~200ms 到达目标值），仪表感；到达 100% 定格。
- **完成涟漪**：单文件到 100% 一次性对勾描边（SVG stroke-dashoffset 250ms，success 色）+ 水面一圈涟漪（scale 1→1.6 淡出 400ms，一次性）。
- **无障碍**：`prefers-reduced-motion: reduce` → 全部动效退静态填充（波纹/流光/涟漪停用，数字直接跳变终值）。
- 实现：纯 CSS keyframes + 一段 rAF 播值 hook，零依赖零库；组件外不可见任何新增装饰元素。

## 5. 演示面集成（:3005 项目管理阶段附件）

1. **传输切换**：`uploadProjectStageAttachment`（project-management.ts:331）从裸 `apiFetch` 改为 `api.upload`（web `lib/api.ts` 新增 `upload: (path, body, opts) => client.upload(path, body, opts)`），FormData 组装不变、round 参数不变。
2. **队列化**：`uploadStageFiles`（project-detail-panel.tsx:1020）改为队列状态驱动：
   - 逐文件**顺序上传**（保持现行为——服务端逐个写附件+extractedInfo 回填，不引入并发）；
   - 每文件 `onProgress` 更新行 `loaded/total`；成功即注入 localItem 附件（现有逻辑）；
   - **失败不再中断队列**（现行为=首个异常即停）：逐文件标记失败并继续，结束后汇总；语义变化写入提交说明。
   - 全部结束后进入 AI 分析阶段（现有 `analyzeProjectManagementItem` 链路不动）。
3. **取消**：`AbortController` 存 ref；触发即 abort 当前 + 未开始文件置「已取消」；上传结束后 `selectedFiles` 照常清空，但行列表保留（含失败/已取消行），直至全部处理完或用户切换步骤。
4. **重试**：失败/已取消行 ↻ 单文件重走 `uploadProjectStageAttachment`，成功后同样注入附件。AI 分析时机维持现状不变：只在整批上传动作结束时跑一次（当初成功的文件已纳入）；**事后单文件重试不重跑分析**，其内容待下次阶段操作自然进入分析。
5. 状态放在组件内 `useState<UploadItem[]>`（文件行渲染直接消费），不引全局 store。

## 6. 错误处理与边界

- 文件大小/类型预校验（现有 `validateAttachmentFile` 100MB+白名单）不动，坏文件在选择时已剔除。
- 服务端错误（401/403/413/500…）经 ApiError 归一，行内显示 `error` 中文文案（截断 40 字），聚合条不中断。
- 断网：NETWORK_ERROR 同行内失败处理；已上传部分保留。
- 浏览器兼容：XHR upload progress 全绿（Chrome/Edge/Safari/Firefox 均支持）；SSR 路径不触发（仅事件回调内使用）。
- 取消后的 in-flight 服务端写入：服务端幂等（附件追加型），中断即止，无需回滚。

## 7. 推广路线（演示验证后的后续批次，非本次范围）

| 批次 | 内容 | 备注 |
|------|------|------|
| P2 | :3005 其余高频上传：专家抽取批量、采购文件加密上传（notice/[id]）、公告附件、tender 导入族 | 逐点换 `api.upload` + 复用 UploadProgressList |
| P3 | :3007 签字扫描两入口；:3006 四处 Blob 上传（签到照等，小文件仅轻量指示） | |
| P4 | :3004 `upload.ts` 薄封装收敛到 client.upload（CA 看门狗等留在门户层） | 消除最后一套独立 XHR |

## 8. 测试

- `packages/client/test.cjs`（build 后 node 断言，现有模式）新增 upload 用例：onProgress 回调映射、非 2xx → ApiError(code/error)、网络错误 → NETWORK_ERROR、abort → AbortError、空响应 → undefined。
- web 无组件测试基建，演示面走手工验收清单：
  1. 多文件（含 >50MB 大文件）上传——聚合条与每文件行同步推进、速度合理；
  2. 中途取消——当前文件停止、后续置已取消、已完成文件在列表；
  3. 拔网线/断网——失败行文案、其余文件继续；
  4. 单文件重试成功——附件注入、列表状态翻转；
  5. 回归：上传后 AI 分析照常、阶段完成闸不受影响、只读/归档态上传区禁用不变。

## 9. 明确不做（YAGNI）

- 分片续传/断点续传（tus）——仅进度可视化，500MB 密文链路已有停滞看门狗兜底；
- 真实 drag&drop——现状零拖拽，另行立项；
- 上传并发化——保持顺序，避免服务端行为变化；
- 共享 UI 组件包——沿用各门户自包含惯例。
