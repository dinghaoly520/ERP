# 项目管理场景的采购文件审查流重构（tender-review）设计

日期：2026-10-28
状态：已与用户确认设计，待实施
范围：`apps/api`（tender-review / user-settings / prisma 迁移）+ `apps/web`（:3005 编写弹窗与审查组件）

## 1. 背景

现状从项目管理「采购文件编写」进入审查的链路（`tender-write-modal.tsx` `handleExportAndReview`）存在以下问题：

1. **知识库碰运气**：写死 `kbs.find(kb => kb.isActive)` 取列表第一个启用库，用户无从选择，多库时审查可能跑在错误制度语料上。
2. **模式写死**：恒为 `reviewMode: 'general'`，规则审查（strict）模式不可达。
3. **上下文错配**：项目场景复用独立工作台 `TenderReviewWorkspace`，带着无意义的上传入口、最近审查记录、审查数统计——此时文件已生成、信息已确定。
4. **无「已审」概念**：`ReviewTask` 无项目关联，右上角「采购文件审查」每次点击都重建任务；误关浮层后只能重复建任务。
5. **报告无下载**：审查结果只能在线看，无 PDF 留档途径。

## 2. 用户裁定（2026-10-28 逐项确认）

| # | 问题 | 裁定 |
|---|------|------|
| 1 | 「已审」判定 | **指纹方案（A）**：ReviewTask 关联项目 + 记录草稿指纹；草稿在审查后变更 → 展示旧结果但标「过期」+ 重审入口，防过期结论直接提交 |
| 2 | 审查模式 | **单选二选一（A）**：智能审查（general，默认）/ 规则审查（strict）；后端零改动；将来需要再考虑综合模式 |
| 3 | 默认知识库 | **自动记忆（A）**：启动审查时把所选库写入 `UserSettings.defaultReviewKbId`，下次默认选中；零额外设置 UI |
| 4 | PDF 报告 | **后端生成（A）**：`docx@9` 组装 → `convertOfficeToPdf`（LibreOffice，评标签字包同款链路）→ 端点下载 |
| 5 | 附带改进 | 独立页保持现状仅加 PDF 按钮；导出确认框移除「是，导出并审查」；防重复任务；失败重试；误关自愈；「提交至项目阶段」闭环不动 |

## 3. 总体思路

新建 `ProjectReviewFlow` 专用组件承载项目场景的「配置卡 → 进度 → 结果」三态，复用：

- `TenderReviewProvider`：任务列表拉取、2s 轮询（有 running 任务时）、`onReviewComplete` context 机制——原样复用，零改动；
- `ReportViewCombined`：报告展示 + 逐条处置（接受/拒绝/编辑）UI——原样复用（其 context 依赖仅 `onReviewComplete`，包在 Provider 内即可）。

独立页 `TenderReviewWorkspace` 及其侧栏/任务条/统计零改动（仅报告视图加 PDF 下载按钮）。

不采用「给 Workspace 加 mode 开关藏功能」方案——条件分支堆砌，两场景互相牵连。

## 4. 数据模型与迁移

一次迁移、两个模型三个字段：

```
ReviewTask   + projectId        String?   // 关联 PMI（ProjectManagement）；项目场景必填，独立页场景 null
             + draftFingerprint String?   // 草稿指纹（见 §5）；项目场景必填
             // 加 @@index([projectId])

UserSettings + defaultReviewKbId String?  // 用户级默认审查知识库
```

- 迁移走非交互流程：`migrate dev --create-only` → `db execute` → `migrate resolve --applied`（并行会话高危文件 schema.prisma，提交内必须附迁移且先 `npx prisma validate`）。
- 不建 Prisma relation 外键到 ProjectManagement（软关联即可，避免删项目级联牵连审查留痕；留痕价值高于引用完整性）。存裸 id + 手查。

## 5. 草稿指纹

定义：`sha256(canonicalJSON({ documentType, answers }))`——键排序的规范 JSON 序列化后哈希，hex。

- **服务端计算**（共享 util，API 内 `tender-review/services/draft-fingerprint.util.ts`）。不用 WebCrypto：局域网 http 演示环境 `crypto.subtle` 不存在（剪贴板工具同款坑，见 CLAUDE.md 前端约定）。
- 指纹仅用于「结果是否过期」判定，不作安全凭据，客户端传值可接受。
- check 与 execute 之间草稿被改：不阻断（下次进入自然判 stale），可接受。

## 6. 后端 API（tender-review 模块）

### 6.1 `POST /tender-review/review/project-status`

`@Roles('leader', 'admin', 'staff')`（与 execute 同口径）

body：`{ projectId, documentType, answers }`（answers 为草稿键值对象）

服务端：算指纹 → 查该项目（`projectId` 非空）最新任务（createdAt desc）→ 返回：

```
{
  fingerprint: string,
  state: 'none' | 'running' | 'matching' | 'stale',
  task?: ReviewTask            // running/matching/stale 时携带该最新任务
}
```

- `none`：该项目无任何任务
- `running`：最新任务 status ∈ {pending, running}（防重复任务：前端直接跟踪，不新建）
- `matching`：最新任务 completed 且 `draftFingerprint === fingerprint`
- `stale`：其余情形（completed 但指纹不符；或最新为 failed/其他状态）——task 照常携带，**前端按 `task.status` 细分渲染**：completed → 结果视图+过期提示条；failed → 失败重试视图

### 6.2 `POST /tender-review/review/execute` 扩展

DTO 加可选 `projectId` + `fingerprint`：

- 传 projectId 时校验项目存在（`projectManagement.findUnique`，404「项目不存在」）；
- 落库到 ReviewTask；
- 顺带 upsert `UserSettings.defaultReviewKbId = dto.knowledgeBaseId`（自动记忆）。

### 6.3 `GET /tender-review/review/tasks/:id/report.pdf`

- 任务须 completed，否则 400「任务未完成，暂无报告」；属主校验（本人或 admin，同 listTasks 口径）。
- 按需生成：`docx@9` 组装报告 → `convertOfficeToPdf` → `Content-Type: application/pdf` 流式返回，`Content-Disposition` 文件名 `<documentName去掉扩展名>-审查报告.pdf`。
- 每次请求现生成（单次 <10s，LibreOffice 同步转换，签字包同款），不做缓存。
- LibreOffice 缺失/转换失败：500 带明确 message（不吞错、不降级 docx——用户要的是 PDF）。

### 6.4 user-settings 扩展

`UpdateUserSettingsDto` + service.updateSettings 加 `defaultReviewKbId`（`defaultHomePage` 同款透传），GET 返回。前端默认知识库解析顺序：**设置值（该库仍对用户可见时）→ 第一个启用库 → 置空并引导去独立页建库**。

## 7. 前端：:3005 编写弹窗「采购文件审查」新流程

`handleExportAndReview` 重写为「check 分流」，浮层内渲染 `ProjectReviewFlow`（包在 `TenderReviewProvider` 内，`onReviewComplete=handleReviewComplete` 不变）：

```
点击「采购文件审查」（草稿须完整，否则现有 toast 拦截）
  └─ POST project-status ─┬─ none / stale+未跑过 → 配置卡
                          ├─ running            → 进度态（跟踪现有任务，不新建）
                          ├─ stale+task=completed → 结果视图（ReportViewCombined）+ 过期提示条
                          └─ stale+task=failed  → 失败重试视图
```

- **配置卡**：知识库下拉（默认=defaultReviewKbId 回退第一个启用库）+ 模式单选（智能审查=默认/规则审查）+「开始审查」按钮 + 角注小字「将记住你的选择」。stale 时顶部提示条「文档在审查后有修改，审查结果可能已过期」。开始：导出 DOCX（现有 exportTenderDocument）→ 上传（现有 uploadReviewDocument）→ execute（带 projectId + fingerprint——指纹取自本次 project-status 响应）→ 进度态。
- **进度态**：任务运行状态轮询（provider 现成）+「停止审查」（现有 stop 端点）。停止/失败后 → 失败视图。
- **结果视图**：`ReportViewCombined`；stale 来源时带过期提示条；页头「重新审查」入口（回配置卡）；失败视图展示错误原因（task.results.error）+「重新审查」（预填该任务记录的库/模式）。
- **闭环不动**：处置完 →「审查结束，提交采购文件」→ 下载含已接受修改的任务文件（取不到时显式警告回退重导草稿，2026-09-28 审计 #15 语义）→ 确认上传 TENDER_DOCUMENT 阶段。
- **PDF 下载**：配置卡流程的结果视图 + 独立页报告视图，同款按钮，调 6.3 端点。

### 7.1 导出对话框简化

「导出采购文件」不再弹三按钮确认框——直接执行 `handleDirectExport`（下载 + 上传项目阶段 + 字段回填）。删除 `showExportDialog` 及「是，导出并审查」「否，直接导出」双按钮。审查唯一入口 = 右上角「采购文件审查」。

### 7.2 独立页 `/tender-review`

保持现状。仅 `ReportViewCombined` 加 PDF 下载按钮（对独立页无 onReviewComplete 场景同样可用，纯任务级能力）。

## 8. PDF 报告内容清单

- 报告头：系统名「智慧水发·蜀水云采」、项目名/编号（task.projectId 反查 PMI，无则略）、文档名、审查模式（智能/规则）、知识库名、审查时间、报告生成时间
- 概览统计：总检查项 / 通过 / 警告 / 不通过（按严重度分布，与在线报告一致口径）
- 逐条问题明细表：序号、章节、严重度、问题描述、原文证据、修改建议、**处置结果留痕**（已接受/已拒绝/未处置 + 处置时间）
- 页脚：页码 + 生成时间

## 9. 边界与错误处理

| 场景 | 行为 |
|------|------|
| 项目被删后查 project-status | 按 projectId 查不到任务 → none（软关联不炸） |
| execute 传不存在的 projectId | 404「项目不存在」 |
| 默认库被删/不可见 | 回退第一个启用库 |
| running 任务卡死 | 现有僵尸清扫/重启自愈不动；进度态停留可手动停止 |
| check 与 execute 间草稿被改 | 不阻断，下次判 stale |
| LibreOffice 失败 | 500 明确文案 |
| 独立页发起的任务 | projectId 为空，不进项目流（project-status 查不到，行为不变） |

## 10. 测试

- **单测**：指纹 util（键序稳定性、变更敏感性、嵌套对象）；execute 落 projectId/指纹 + UserSettings 记忆；project-status 四态判定；报告 docx 组装（标题/统计/明细行数）；report.pdf 端点权限与未完成拦截（LibreOffice 依赖不进单测断言）。
- **e2e**：项目流 happy path（建 PMI → check=none → execute → 完成 → check=matching；改草稿 → stale）+ 默认知识库记忆断言。PDF 端点 e2e 视 CI runner 是否有 LibreOffice 而定（可跳过，单测冒烟即可）。

## 11. 实施注意事项

- **并行会话**：schema.prisma / app.module.ts 为高危共享文件，改前 `git status` 确认对方无未提交改动；迁移与 schema 改动同提交；禁 `git add -A`。
- **迁移后必跑** `npx prisma validate`（validate 静默失败会让 generate 停旧版）；改完 `pnpm dev:kill && pnpm dev` 整体重启验证。
- **`@water-erp/client` 未涉及**（web 门户走自身 `lib/api/*` 底座）。
- UI 遵循 cgzxui 设计体系（neumorphic 凸起边框、1px 发丝线、rounded-2xl），文案全中文、禁英文黑话（2026-10-28 裁定）。
