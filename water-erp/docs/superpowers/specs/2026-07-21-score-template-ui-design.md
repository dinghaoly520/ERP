# 评分模板库前端 UI 设计

- 日期：2026-07-21
- 状态：design（待用户复核 spec）
- 关联：`docs/评分标准模板流程.md`、`apps/api/src/bid/bid.service.ts`（ScoreTemplate 段）

## 背景

后端 `ScoreTemplate` CRUD 四端点已完备（`bid.controller.ts:249-279`），但 bid-portal 无任何 UI 调用方，`lib/api/bid.ts` 也无封装。本设计补齐前端，使管理员可：

1. 把当前项目评分标准（items + points）**存为命名模板**；
2. **列表浏览**已保存模板（自己 + 公共）；
3. **应用**某模板到当前项目（按名称幂等合并，bootstrap 新项目）；
4. **删除**自己的 / 公共模板。

入口形态：**工具栏按钮 + Dialog**（用户已选 A）。

## 范围

- **前端**：bid-portal `bid/standard/page.tsx` + 2 个新组件 + `lib/api/bid.ts` 4 个封装。
- **后端**：1 处 select 微调（`listScoreTemplates` 补 `createdById`）。
- **非范围**：不新增端点；不改幂等 / B1 校验 / 审计逻辑；不加前端测试基建。

## 组件设计

### 1. `SaveTemplateDialog`

- 文件：`apps/bid-portal/src/app/(dashboard)/bid/standard/save-template-dialog.tsx`
- Props：`{ open: boolean; onClose: () => void; projectId: string }`
- UI：`Dialog`（width `max-w-sm`），标题「存为评分模板」，一个 `name` 输入框（必填），footer `[取消][确认保存]`。
- 逻辑：确认 → `saveScoreTemplate(projectId, name)` → toast 成功/失败 → `onClose`。
- 校验：name 必填（前端拦截，空则 toast）。
- 同名：后端无唯一约束、允许重复；前端不拦截、不提示（频率低，事后可在模板库删除）。（**默认 #2**）

### 2. `TemplateLibraryDialog`

- 文件：`apps/bid-portal/src/app/(dashboard)/bid/standard/template-library-dialog.tsx`
- Props：`{ open; onClose; projectId; locked: boolean; onChanged: (items: ScoreItem[]) => void }`
  - `locked`：控制 [应用] 是否可用。
  - `onChanged`：应用成功后回传最新 items 给父组件 `setItems`。
- 内部 state：`templates: ScoreTemplateSummary[]`、`loading`、`deleteTarget`。
- UI：`Dialog`（width `max-w-2xl`），标题「评分模板库」。
  - **顶部常驻说明**：「应用按名称合并到当前项目（已存在的项不重复添加），不会覆盖或删除已有项。」
  - 打开时：`listScoreTemplates()` → `setTemplates`。
  - 每行：`name` | 徽标（`mine = !!createdById` → 我的 / 公共）| `createdByName · createdAt` | `[应用][删除]`。
    - `[应用]`：`applyScoreTemplateById(projectId, id)` → 返回 `ScoreItem[]` → `onChanged(updated)` → toast → 关弹窗。`locked` 时 `disabled` + tooltip「评分标准已锁定」。
    - `[删除]`：设 `deleteTarget` → 二次确认 `Dialog` → `deleteScoreTemplate(id)` → 本地列表移除 → toast。公共模板同样二次确认。（**默认 #3**）
  - 空态：「尚无保存的模板。可在评分项页用「存为模板」创建。」

### 3. `page.tsx` 接线

工具栏当前：`!locked && ([发布][应用标准模板][新增])`。改为：

```
始终区：[存为模板](items.length>0 时)  [模板库]
!locked 区：[发布][应用标准模板][新增]
```

- 新增 state：`showSaveTpl`、`showLib`。
- 渲染 `<SaveTemplateDialog open={showSaveTpl} .../>`、`<TemplateLibraryDialog open={showLib} locked={locked} onChanged={setItems} .../>`。
- 「模板库」按钮打开 `TemplateLibraryDialog`；「存为模板」打开 `SaveTemplateDialog`。

## API 封装（`lib/api/bid.ts`，`batchCreateScorePoints` 之后）

```ts
export interface ScoreTemplateSummary {
  id: string;
  name: string;
  createdById: string | null;
  createdByName: string | null;
  createdAt: string;
}

export function listScoreTemplates() {
  return api.get<ScoreTemplateSummary[]>('/bid/score-templates');
}
export function saveScoreTemplate(projectId: string, name: string) {
  return api.post<ScoreTemplateSummary>('/bid/score-templates', { projectId, name });
}
export function deleteScoreTemplate(templateId: string) {
  return api.delete<void>(`/bid/score-templates/${templateId}`);
}
export function applyScoreTemplateById(projectId: string, templateId: string) {
  return api.post<ScoreItem[]>(`/bid/projects/${projectId}/apply-score-template/${templateId}`, {});
}
```

## 后端微调

`bid.service.ts:2209` `listScoreTemplates` 的 `select` 增加 `createdById: true`。

理由：前端靠 `!!createdById` 区分「我的 / 公共」，无需当前 userId——后端过滤条件 `OR: [{createdById: userId}, {createdById: null}]` 保证返回项要么 `createdById` 非空（=我的），要么为 null（=公共）。

## 锁定与权限语义

| 操作 | 可用条件 |
|------|----------|
| 存为模板 | `items.length > 0`；**锁定后仍可用**（已定稿标准做快照） |
| 模板库浏览 / 删除 | 始终 |
| 模板库内 [应用] | `!locked` |
| 删除 | 跟随后端：自己 / 公共可删，他人模板不在列表 |

## 错误处理

所有动作 `try/catch` + sonner toast（sonner 已在 page.tsx 使用）。典型：

- `save` 抛 EMPTY → 「尚无评分项」（前端已按 `items.length>0` gate）。
- `apply` 409 `SCORE_ITEMS_LOCKED` → 「评分标准已锁定」（UI gate 兜底）。
- `apply` B1 `PASS_FAIL_MUST_BE_ZERO` → 原样透出后端 error。
- `delete` `FORBIDDEN` → 「只能删除自己 / 公共模板」（列表过滤后一般不会触发）。

## 测试

- **后端**：`bid.service.spec.ts` 若已有 `listScoreTemplates` 用例，补 `createdById` 断言；否则新增一条最小用例（返回项含 `createdById`）。
- **前端**：bid-portal 无测试基建，手动验证（与 `score-points-editor.tsx` 一致）。

## 验收清单

- [ ] 工具栏可见 [存为模板][模板库]，锁定后仍可见。
- [ ] 存为模板：命名保存 → 模板库出现新「我的」模板。
- [ ] 模板库：列出自己 + 公共，徽标正确。
- [ ] 应用：空项目从模板 bootstrap 出 items + points；锁定后 [应用] 禁用。
- [ ] 删除：自己的模板可删并从列表消失；有二次确认。
- [ ] 后端 `listScoreTemplates` 返回 `createdById`。
- [ ] 现有 score 相关单测仍通过。

## 待确认默认（spec review 时可改）

1. 锁定后允许「存为模板」—— ✅ 用户已确认。
2. 同名模板允许重复，不拦截不提示（频率低，事后可删）。
3. 公共模板任何人可删（后端现状），UI 加二次确认。

## 实施顺序（概览）

1. 后端：`listScoreTemplates` 加 `createdById` + spec。
2. `lib/api/bid.ts`：4 个封装 + `ScoreTemplateSummary` 类型。
3. `save-template-dialog.tsx` + `template-library-dialog.tsx`。
4. `page.tsx` 工具栏接线。
5. 手动走验收清单。
