# 采购文件修改 · DOCX 定点补丁保真 — 设计规格

> 日期：2026-07-17 | 方案：2（原 DOCX 定点补丁，纯净终稿）| 状态：待实现

---

## 1. 背景与目标

### 现状

:3005 采购管理工作台 → 项目管理 → 「采购文件修改」功能（`apps/web/src/components/projects/tender-file-editor-modal.tsx`，835 行单文件）当前实现：

- **加载**：`GET /api/project-management/:id/attachment-html/:attachmentId` → 后端用 **mammoth** 把 DOCX 转 HTML（有损，丢部分样式）。
- **编辑**：contentEditable + MutationObserver 追踪改动，包裹 `.tfe-modified` span + `data-old`，提供红标 / 修改历史 / 逐条撤销 / AI 润色 / 双栏审阅对照。
- **保存**：`POST /api/project-management/:id/save-attachment-html` → 后端用**自写 `htmlToDocxChildren` 解析器**把 HTML 重建为 `docx.Document` → 覆盖原附件。

### 核心缺陷

1. **往返有损**：DOCX →(mammoth)→ HTML →(自写解析器)→ DOCX。两套不同库的正反转换，格式必然漂移；`htmlToDocxChildren` 只识别 table/ul/ol/h1-6/p/div/li/blockquote/td/th，其余标签静默丢弃。**每次保存都在降级**，用户以为存了"最终版"，实际字体/间距/分页已变。
2. **保存判定依赖追踪器**：`handleSave` 读 `isDirty` 状态 + 裸 HTML 字符串判等来决定"能否保存"。存在 stale-closure bug（`useCallback` 依赖未含 `isDirty`）——已临时修复（改读 `isDirtyRef.current`），但根因是"保存正确性绑在了脆弱的前端追踪器上"。
3. **无版本/草稿**：`attachment.objectKey` 直接覆盖，旧 DOCX 在 MinIO 孤儿化；误关模态框 / 浏览器崩溃 → 工作全部丢失。
4. **单文件 835 行**：加载、contentEditable 规范化、MutationObserver 追踪、审阅导入、AI、历史、同步滚动、保存全混在一起，10+ 个 ref/state 相互耦合，"漏一处 ref"类的 bug 几乎必然。

### 目标

**将保存路径从"有损整体重建"改为"对原 DOCX 定点补丁"**，达成：

- **保真**：未修改的段落字节级保留（含 run 属性 rPr、图片、分页符）；仅修改的文字继承邻位格式。
- **稳健**：保存正确性与前端追踪器彻底解耦；版本快照 + 草稿自动保存兜底；并发覆盖守卫。
- **可维护**：835 行单文件拆分为单一职责的 hooks + 子组件。

### 使用场景（已确认）

采购人员**结合领导 / 法务部门的修改意见**，对采购文件**文字内容**进行修改并保存为**最终版本**。因此：

- 编辑以**文字替换**为主（润色、改措辞、补信息），结构变动偶发。
- 输出形态：**纯净终稿**（无 Word 修订痕迹）。
- 编辑模式：文字为主，偶有增删整段；结构变动按"删旧位置 + 新位置插入"建模，不追求识别"移动"。

---

## 2. 核心架构

**关键思想**：前端发送"完整编辑后 HTML"（真相），后端拿原 DOCX **逐段 diff、只补丁被改段落**，未改段落原样保留。

```
加载  原 DOCX ──自定义解析 document.xml──▶ HTML
        每个块级元素带 data-pid（段落锚点）+ 记录原文件哈希
                     │
编辑  contentEditable（UX 不变：红标 / 历史 / AI / 双栏全保留）
        用户改文字 → 编辑器 DOM 即真相
                     │
保存  发送「完整 HTML（含 data-pid）+ 原文件哈希」 ────▶ 后端
        后端校验哈希（并发守卫）→ 打开原 DOCX (JSZip) → 遍历 <w:p>
          ├ pid 在 HTML 存在、文字相同 → 跳过（字节级保留）
          ├ pid 存在、文字不同 → LCS run 映射重写该段文字
          ├ pid 缺失（被删） → 删除该 <w:p>
          └ HTML 有新 pid → 在相邻位置插入新 <w:p>
        重新打包 → 新 DOCX（未改部分 = 原始字节）+ 旧版本归档
```

### 关键抉择：前端送"完整 HTML"而非"操作清单"

| | 方案 X：完整 HTML（采用） | 方案 Y：操作清单 |
|---|---|---|
| 后端判定 | 自行 diff 原文 vs 现文 | 信任前端 `{pid,旧文,新文}` 列表 |
| 自愈性 | **强**：前端追踪器漏判不影响保存 | 弱：追踪器一漏即错 |
| 复杂度 | 后端多一段 diff | 前端需维护精确 op 序列 |

**采用 X**：把"保存正确性"从前端追踪器正确性中解耦，根治"未检测到修改"类 bug 的根因。追踪器从此**仅负责可视化**（红标 / 历史），永不参与判定存得对不对。

---

## 3. 后端设计

涉及文件：`apps/api/src/project-management/project-management.service.ts`（现有 `getAttachmentHtml` / `saveAttachmentHtml` / `importReviewFile`）、`project-management.controller.ts`。

### 3.1 加载：自定义 DOCX→HTML 转换器（替换 mammoth）

新建 `apps/api/src/project-management/docx/docx-to-html.converter.ts`。用 JSZip 解析 `word/document.xml`，**保留段落身份与格式**：

- 遍历 `<w:body>` 下节点，按文档顺序给每个 `<w:p>` 分配 **pid = 不可变序号**（含表格单元格内段落）。
- 输出语义 HTML：`<p data-pid="N">`、`<h1..6 data-pid="N">`（按 `w:pStyle` / `w:outlineLvl` 映射）、`<ul>/<ol>/<li data-pid>`、`<table>/<tr>/<td>/<th>`（单元格内 `<w:p>` 同样带 pid）。
- **行内格式**：`<w:b>`→`<strong>`、`<w:i>`→`<em>`、`<w:u>`→`<u>`；字体 / 字号 / 颜色按需保留为 inline style 或忽略（编辑可视即可，最终格式以原 DOCX 为准）。
- **图片**：`<w:drawing>` → `<img src="data:image/...;base64,...">`（从 `word/media/` 抽取，base64 内嵌）。
- **分页 / 特殊**：`<w:br w:type="page"/>` → `<hr class="tfe-page-break">`（与现有前端样式一致）。
- 计算并返回**原文件哈希**（sha256，随响应体返回 `{ fileName, html, originalHash }`），供保存时并发校验。

> mammoth 仅在此流程退役；若别处仍在用 mammoth，保留依赖。`getAttachmentHtml` 改为调用新转换器。

### 3.2 保存：HTML→DOCX 定点补丁器

新建 `apps/api/src/project-management/docx/html-to-docx.patcher.ts`。

```
patchDocx(originalBuffer, editedHtml, clientHash):
  1. 校验 sha256(originalBuffer) === clientHash；不符 → 抛 409 ConflictException
  2. JSZip 打开 originalBuffer，读 word/document.xml
  3. 解析 editedHtml → Map<pid, { text, order }>（textContent，忽略 .tfe-modified 等可视化 span）
  4. 遍历 document.xml 的 <w:p>（同样文档顺序）:
     - i = 当前段落序号
     - Map 有 pid=i 且 text 一致            → 跳过（字节保留）
     - Map 有 pid=i 且 text 不同            → patchParagraph(xml, <w:p>, newText)（见 3.3）
     - Map 无 pid=i                         → 标记删除该 <w:p>
     - HTML 中出现 new-* pid                → 在前一段后插入（格式继承相邻段）
  5. 写回 word/document.xml → 重新打包 → 返回新 buffer
```

### 3.3 patchParagraph：LCS run 映射（格式保真核心）

Word 把一段文字拆成多个 `<w:r>`（run），每个 run 各自带 `<w:rPr>`。直接整段重写会丢格式。算法：

1. 收集段落内 run 的**有序文字片段**：`runs = [{ text, rPr, extras }, ...]`（`extras` = 非文字子节点，如 `<w:drawing>` / `<w:br>`，作为不可替换锚点）。
2. 拼接 `oldConcat = runs.map(r => r.text).join('')`。
3. 对 `oldConcat` 与 `newText` 做字符级 **LCS 对齐**。
4. 重建 run 序列：
   - 未变字符 → 沿用原 run 及其 `rPr`（字节级保真，含加粗 / 字体 / 字号）。
   - 变更 / 插入字符 → 挂到**最近的原 run 的 `rPr`** 上。
   - `extras` 锚点（图片 / 分页）按原相对位置保留，不被文字替换冲掉。
5. 用新 run 序列替换原段落内 runs（保留 `<w:pPr>` 段落属性：对齐 / 缩进 / 样式）。

结果：**未改文字字节级保真，改动的文字继承邻位格式**。对"按领导法务意见改措辞"的场景，改完不串味。

### 3.4 版本归档（稳健性兜底）

- `saveAttachmentHtml` 在覆盖 `attachment.objectKey` 前，把当前 DOCX 写入 MinIO 的 `tender-doc-versions/` 前缀，并在新表 `AttachmentVersion` 记一条（attachmentId / objectKey / createdById / createdAt / 原哈希）。
- 提供 `GET /api/project-management/:id/attachment/:attachmentId/versions` 列出历史；`POST .../versions/:versionId/restore` 恢复（恢复也走哈希守卫）。
- 第一版可仅做"归档 + 列表"，恢复按钮后续再加；但**归档必须在改造首版上线**，否则补丁出错无回滚。

### 3.5 端点调整

| 端点 | 变更 |
|------|------|
| `GET .../attachment-html/:attachmentId` | 改用新转换器；响应增 `originalHash` |
| `POST .../save-attachment-html` | body 增 `originalHash`；改走 patcher；保存前归档旧版本 |
| `GET .../attachment/:attachmentId/versions` | 新增（列表） |

---

## 4. 前端设计

### 4.1 文件拆分（835 行 → 单一职责单元）

```
apps/web/src/components/projects/tender-file-editor/
├─ index.tsx              编排器：组装 hooks + 布局（~150 行）
├─ EditorPane.tsx         左：contentEditable + 还原栏 + 页卡
├─ ReviewPane.tsx         右：只读审阅版 + 标注图例 + 批注气泡
├─ HistoryPanel.tsx       右侧常驻：修改历史 + 撤销单条
├─ AiToolbar.tsx          浮动选中工具条
└─ AiDialog.tsx           AI 面板 / diff 确认

apps/web/src/hooks/projects/
├─ useAttachmentHtml.ts   加载 + rawHtml + originalHash（并发守卫）
├─ useEditTracking.ts     MutationObserver / 块快照 / 标红 / 撤销 / 历史（纯可视化）
├─ useReviewImport.ts     导入审阅 docx
├─ useSyncScroll.ts       双栏滚动同步
└─ useAiPolish.ts         选中→建议→diff→确认
```

**编辑体验完全不变**：红标、修改历史、AI 优化、双栏审阅、同步滚动、Ctrl+S 全部保留。原 `tender-file-editor-modal.tsx` 保留为薄 re-export 或删除（视调用方而定）。

### 4.2 保存链路改造（三处）

1. **保留 `data-pid`**：编辑器装入 HTML 时，块级元素 `data-pid` 原样保留；MutationObserver 标红只包裹内联 `<span class="tfe-modified">`，**绝不修改块级属性**。保存时序列化整个 `editorRef.innerHTML`（含 `data-pid`）发出。
2. **去依赖化**：`handleSave` 不再读 `isDirty` / `.tfe-modified` 决定"能不能存"——只要编辑器内容与原文不同即存（后端 diff 判定）。追踪器仅负责红标 / 历史展示。
3. **并发守卫**：加载时存 `originalHash`，保存时随 body 带上；后端校验不符 → 前端提示"文件已被修改，请刷新重载"，避免静默覆盖。

### 4.3 草稿自动保存（localStorage）

- 新建 `hooks/projects/useDraftAutosave.ts`：按 `attachmentId` 分键，防抖 2s 写入 `{ html, savedAt }`。
- 保存成功后清除草稿。
- 打开模态框时若存在草稿且与服务器原文不同，弹"检测到未保存的修改（{相对时间}），是否恢复？"。
- 草稿仅存编辑器 HTML（含 `data-pid`），不含二进制；体积可控（采购文件多在百 KB 级，localStorage 5MB 上限内）。

---

## 5. 端到端数据流

```
1. 用户打开「采购文件修改」
   → useAttachmentHtml: GET attachment-html → { html(含 data-pid), originalHash }
   → 检测 localStorage 草稿 → 有则提示恢复
   → 编辑器装入 HTML（data-pid 保留）

2. 用户改文字（contentEditable）
   → useEditTracking: MutationObserver 标红 + 历史（仅可视化）
   → useDraftAutosave: 防抖 2s 写入草稿

3. 用户点「保存并替换」/ Ctrl+S
   → handleSave: 序列化 innerHTML（含 data-pid）+ originalHash
   → POST save-attachment-html
   → 后端: 哈希校验 → patchDocx → 归档旧版本 → 存新 DOCX → 更新 objectKey
   → 成功 → 清除草稿 → onFileReplaced() → 关闭

4. 并发冲突
   → 哈希不符 → 409 → 前端提示刷新 → 用户刷新后以最新 DOCX 重新加载
```

---

## 6. 范围边界

### 本版做到

- 正文 / 标题 / 列表项 / 表格单元格的**文字替换**（LCS run 映射，保格式）。
- 整段**增 / 删**（插入新 `<w:p>` / 删除 `<w:p>`）。
- 图片、分页符、段落属性（对齐 / 缩进 / 样式）在**未改段落**字节级保留。
- 版本归档 + 草稿自动保存 + 并发守卫。

### 本版不追求（best-effort 或后续）

- **表格结构变动**（增删行列）——采购文件编辑罕见，留待后续。
- **页眉页脚 / 复杂 drawing / 分节符** —— 不触碰，原样保留。
- **段落内"混合格式 + 改动恰好落在格式边界"** —— LCS 兜底，不保证完美。
- **Word 原生修订痕迹（track-changes）输出** —— 本版输出纯净终稿；如需留痕交付另开设计。
- **多人实时协同编辑** —— 仅并发守卫（防覆盖），不做协同。

---

## 7. 边缘情况与降级

| 情况 | 处理 |
|------|------|
| 补丁器遇到无法识别的 `<w:p>` 结构 | 跳过该段（保留原样）+ 记日志，不中断保存 |
| LCS 对齐失败（极端文本） | 降级：整段取首 run 的 `rPr` 重写，保段落级格式 |
| 编辑器 HTML 含无法映射的 pid | 忽略该 HTML 块 + 记日志 |
| 图片 base64 过大导致请求超限 | 保存时图片随原 DOCX 保留，HTML 仅作编辑载体（不回传图片） |
| 草稿与服务器冲突 | 以服务器为基准，提示用户选择恢复草稿或丢弃 |

---

## 8. 测试策略

### 后端单元测试（`apps/api`，jest）

- `docx-to-html.converter.spec.ts`：典型 DOCX（标题 / 正文 / 列表 / 表格 / 图片 / 分页）→ HTML 结构 + `data-pid` 正确性 + 哈希稳定。
- `html-to-docx.patcher.spec.ts`（核心）：
  - **往返保真**：DOCX→HTML→（不改）→patchDocx → 新 DOCX 的 `document.xml` 与原 `document.xml` **字节相同**（未改不动）。
  - **单段文字替换**：改一段 → 仅该段 runs 变化，其余段字节不变；改后文字 + 邻位 rPr 正确。
  - **加粗保留**：原文一段含加粗词，改其周围文字 → 加粗词所在 run 字节保留。
  - **增删段**：新增 / 删除 `<w:p>` → document.xml 段落数对应增减，其余不变。
  - **图片保留**：含图段落文字微调 → `<w:drawing>` 原位保留。
  - **并发守卫**：`clientHash` 不符 → 抛 409。
- 回归：保留现有 `project-management` 相关 e2e。

### 前端

- `useEditTracking` 行为：改文字→标红+历史；撤销→还原；不依赖追踪器的保存路径（mock 后端，验证发出 body 含 `data-pid` + `originalHash`）。
- `useDraftAutosave`：写入 / 清除 / 恢复提示。
- 视觉验证（依用户偏好）：真实渲染截图确认红标 / 历史 / AI / 双栏体验与改造前一致。

---

## 9. 风险与回滚

| 风险 | 缓解 |
|------|------|
| 自写 DOCX→HTML 转换器覆盖面不足 | 单测覆盖典型结构 + 上线后保留 mammoth 路径一个版本作为 fallback 开关 |
| LCS run 映射在复杂段落出错 | 降级策略（整段首 run rPr）+ 版本归档可回滚 |
| `data-pid` 在编辑中被破坏 | 块级属性只读保护 + 后端忽略无法映射 pid 并记日志 |
| 现有调用方依赖 mammoth 风格 HTML | 排查 `attachment-html` 调用方；新转换器输出语义等价 HTML |

**回滚**：feature flag（`TENDER_DOCX_PATCHER_ENABLED`）。关闭后回退到旧 mammoth + `htmlToDocxChildren` 路径。版本归档表独立，回滚不丢历史。

---

## 10. 实现顺序（建议）

1. **后端转换器 + patcher + 单测**（含往返保真测试）——地基，先证明保真成立。
2. **后端端点改造 + 版本归档 + 哈希守卫**。
3. **前端保存链路改造**（保留 `data-pid` / 去依赖 / 并发守卫）。
4. **前端文件拆分**（hooks + 子组件），保持行为等价。
5. **草稿自动保存**。
6. **视觉回归 + 真实采购文件验证**。

每步可独立验证、独立合入。
