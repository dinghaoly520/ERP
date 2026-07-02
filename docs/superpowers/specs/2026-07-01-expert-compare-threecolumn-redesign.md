# 专家条款响应对比 — 三栏演化设计（整合方案）

> 日期：2026-07-01
> 状态：设计中（唯一待定：放置位置 A/B/C）
> 前置：原 spec `2026-06-30-expert-requirement-compare-design.md`（行式）已实现 + 7 fix + 验证通过。本文是对**交互形态**的演化整合。

## 背景与演化动因

原 spec 落地为「行式卡片 + 点链接跳转 PDF」，夹杂在 AssistPanel 的 5 个 AI 概览分区中。验证后用户澄清两点原意：

1. **三栏布局**：左条款清单 / 中投标 PDF **内嵌**预览 / 右标注——PDF 要在页面里实时看，不是跳新标签页。
2. **应独立于 AssistPanel**：AssistPanel 那 5 个是「AI 给的概览」（专家看），三栏是「专家逐条核对+标注」（专家做）——性质不同、空间需求不同（三栏要宽高、PDF 要大），夹杂割裂。

## 定位

三栏「条款响应对比」工具——专家逐条核对招标要求 ↔ 投标响应，标注认可/异议/存疑，辅助打分。**独立专注环境**。

## 三栏布局

| 栏 | 宽 | 内容 |
|---|---|---|
| 左 | 1/4 | **可切换**：条款清单 / 招标文件原文（tab） |
| 中 | 1/2 | 投标文件 PDF 内嵌（iframe，跟随选中条款跳页） |
| 右 | 1/4 | 选中条款的 AI 响应摘要 + 标注（认可/异议/存疑 + 备注） |

## 左栏双模式（tab 切换）

- **模式 1「条款清单」**（默认）：requirements 按 category 分组（资格/技术/商务），★号实质性标记，可点击选中。选中 → 中栏投标 PDF 跳该条款响应页 + 右栏标注/AI 响应切换。
- **模式 2「招标文件」**：iframe 渲染招标文件完整 PDF，专家自由翻阅原文。
  - **联动 A（已定）**：模式 2 是**参考视图**——中栏投标 PDF + 右栏标注**保持上一个选中条款不动**。专家对照着看，来回切 tab 不丢上下文。

## 中栏

- iframe 投标文件 PDF，`src = /api/expert/projects/:id/suppliers/:sid/documents/:fileId/download#page=N`（Fix 7 解密端点 + PDF Open Parameters 原生跳页）
- 跟随左栏（模式 1）选中条款的 `location.fileId` / `location.page`
- `location` 为 null（status=not_found）→ 占位"未定位到投标原文"

## 右栏

- 选中条款 AI 响应：status 徽标（met/partial/unmet/not_found）+ excerpt 摘录
- 标注：认可/异议/存疑 单选 + 备注 textarea，POST `/expert/projects/:id/assist/:sid/reviews`
- **维持 Fix 2/3**：setVerdict 失败回滚（prevReview）+ saveNote try/catch

## 放置位置：A 独立 step（已定）

评审向导加一步「**条款响应核对**」，位于 AI 概览（辅助评标）后 / 打分前。流程线性：身份核验 → 标书获取 → 辅助评标 → **条款响应核对** → 专家打分 → 评审报告。三栏独立空间，与打分联动（下节）衔接清晰。

## 联动：异议备注 → 打分备注（可选填入，已定）

条款响应核对 step 标的异议（dispute）note，**可选**填入打分 step 的 scoreItem reason 框。

**数据**（小扩展）：`getMyScores` 在现有 `disputeCategoriesBySupplier`（Fix 1，category 级高亮/拦截）基础上，增返 dispute 详情：`disputesBySupplier: Record<supplierId, Record<category, Array<{ requirementId, content, note }>>>`（content=招标条款原文，note=专家异议备注）。

**打分 step UI**：
- disputed category 分组（Fix 1 高亮 + checkbox 拦截不变）
- 该 category 有 dispute 时，分组顶部多一个「异议备注」区，列出每条：条款 content 摘要 + note
- 每个 scoreItem 的 reason textarea 旁加「📎 插入异议」按钮（仅该 category 有 dispute 时显示）→ 展开该 category dispute 列表 → **每条单独选**（1a）→ note 追加到**当前 scoreItem** 的 reason（2a，专家在哪个 scoreItem 点插入就进那个）
- 追加格式：`[异议：{note}]` 加到 reason 末尾（带前缀区分手写 vs 引用；不覆盖已有内容）

**语义**：可选（专家决定插不插）+ 追加（保留已写）+ 每条独立（1a）+ scoreItem 各自（2a）。

## 维持的修复（Fix 1–7，不动）

- Fix 1 per-supplier disputeCategories（打分页 category 级联动，不误拦）
- Fix 2/3 标注回滚 + saveNote try/catch
- Fix 4/5 matcher seq 强制 + 去重
- Fix 6 getReport brById Map
- Fix 7 投标文件解密下载端点（中栏 iframe 用）

## 后端依赖（全现有，零新增）

- `requirements` + `requirementResponses`（matcher 产，含 location.fileId/page）
- `GET /expert/projects/:id/tender-document/download`（招标文件解密 inline，左栏模式 2 用）
- `GET /expert/projects/:id/suppliers/:sid/documents/:fileId/download`（投标文件解密 inline，中栏用，Fix 7）
- `GET/POST /expert/projects/:id/assist/:sid/reviews`（标注 CRUD）

## 实现范围（待放置位置定后）

- ✅ 三栏 panel（已实现 `44f608a`，夹在 AssistPanel）
- ⏳ 左栏双模式（tab + 招标原文 iframe，联动 A）
- ⏳ 放置位置调整（从 AssistPanel 拆出 → A/B/C 之一）

## 非目标

- 不动后端 / 数据模型 / 7 个 fix。
- 不做 PDF.js 自定义渲染（用浏览器内置 viewer + `#page=N`）。
- 不做实时多人协同。
