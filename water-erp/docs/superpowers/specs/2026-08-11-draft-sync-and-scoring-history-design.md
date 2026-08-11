# 草稿实时同步 + 评分变更保护 + 评分历史 技术方案

> **日期**：2026-08-11（代码审核修订版）
> **范围**：expert-portal 平板端 + 桌面端 + expert API
> **前置**：批注与备忘统一改造（2026-08-10）已完成并 push

---

## 1. 背景

当前平板、桌面打分 tab、条款核对面板三处打分界面存在以下问题：

1. **草稿不同步**：平板保存的草稿需要手动点"恢复"才出现在桌面，反之亦然
2. **修改无保护**：平板触屏误触可翻转通过/不通过或改分数，无二次确认
3. **无变更审计**：专家看不到自己修改评分的历史轨迹
4. **平板按钮冗余**：auto-save 已覆盖「暂存草稿」的功能

## 2. 目标

1. **累积模型**：平板/条款核对的评分自动流入桌面 scores（新增静默、修改提醒），桌面「提交」是唯一闸门
2. **平板修改保护**：已有值的修改/取消触发 ConfirmDialog + 所有设备的 undo toast
3. **评分历史**：桌面打分 tab 右上角「备忘」按钮改为「评分历史」抽屉，按供应商展示创建+修改时间线
4. **平板操作栏精简**：删除「暂存草稿」，保留「重置」（本地清空不同步）

## 3. 评分变更分级（三端统一规则）

| 操作类型 | 判定 | 跨设备同步 | 平板 UI |
|---------|------|-----------|---------|
| **新增** | 本地空/0 → 对方有值 | 静默自动合并 | 无提示 |
| **修改** | 双方都有值且不同 | 桌面琥珀横幅 → 弹窗裁决 | ConfirmDialog + undo toast |
| **删减** | 本地有值 → 对方空/0 | 同"修改" | 同"修改" |

## 4. 平板修改二次确认（仅平板）

### 4.1 触发条件

- **Checkbox 取消勾选**：`v.checked === true` 时用户点击 → 弹确认
- **分数修改**：`v.awardedScore > 0` 时用户改分数 → 弹确认
- **新增**（unchecked→checked, 0→N）：不弹确认

### 4.2 实现：父组件回滚模式（代码审核修正）

**原方案**（`onBeforeModify` prop）不可行——`<input type="checkbox">` 的原生 `onChange` 事件无法异步取消，浏览器会立即切换状态。

**修正方案**：PointChecklistScoring **不改**，在**父组件（平板页）的 onChange 回调**中处理：

1. PointChecklistScoring 正常触发 `onChange(pointId, newVal)`——此时 React state 尚未更新
2. 父组件收到 newVal，检测是否为修改（oldVal 有值且 newVal 与 oldVal 不同）
3. 如果是修改：
   - **不写入 scores**（或先写入再立即回滚）
   - 设置 `pendingModify` state：`{ pointId, pointName, oldVal, newVal, scoreItemId }`
   - 弹 ConfirmDialog
4. 用户确认 → `setScores` 写入 newVal + undo toast
5. 用户取消 → 不变（oldVal 仍在 scores 中）

平板页的 PointChecklistScoring `onChange` 回调改为：

```typescript
const handlePointChangeTablet = (scoreItemId: string, pointId: string, newVal: PointDecisionValue) => {
  const k = scoreKey(activeSupplier, scoreItemId);
  const cur = scores[k];
  const oldPointVal = cur?.points?.[pointId];
  // 检测是否为修改（已有值 + 值不同）
  const isModify = oldPointVal && (
    oldPointVal.checked !== newVal.checked ||
    oldPointVal.awardedScore !== newVal.awardedScore
  );
  if (isModify) {
    // 拦截 → 弹确认
    setPendingModify({ scoreItemId, pointId, pointName: /* lookup */, oldVal: oldPointVal, newVal });
    return; // 不写入 scores
  }
  // 新增 → 正常写入
  applyPointChange(scoreItemId, pointId, newVal);
};
```

> **注意**：checkbox 的 React 受控行为——如果父组件不更新 state，checkbox 视觉会自动回弹到旧值（因为 `value` prop 没变）。不需要手动回滚。

### 4.3 Undo Toast（所有设备）

修改生效后，父组件弹 toast：

```typescript
toast(`已将「${pointName}」${formatVal(oldVal)}→${formatVal(newVal)}`, {
  action: { label: '撤销', onClick: () => applyPointChange(scoreItemId, pointId, oldVal) },
  duration: 3000,
});
```

仅在修改时触发（新增不弹 toast）。桌面端同样有 undo toast，但不弹 ConfirmDialog。

## 5. 跨设备草稿实时同步

### 5.1 累积模型

```
平板 ──auto-save──→ server draft (tablet slot)
  │                        │
  ├─ WS DRAFT_SAVED ──────→ 桌面收到
  │                        ├─ GET /score-draft?device=desktop → merge
  │                        ├─ 新增项 → 静默 setScores
  │                        └─ 修改项 → draftConflicts state → 横幅

桌面 ──auto-save──→ server draft (desktop slot)
  │                        │
  ├─ WS DRAFT_SAVED ──────→ 平板收到
  │                        └─ 同上（device=tablet）
```

条款核对面板与桌面打分 tab 共享同一页面同一 `scores` 状态，无需 WS。

> **条款核对 tab 的 auto-save**：桌面端 auto-save effect 有 `step !== 'scoring'` 守卫（:367-368），只在打分 tab 才 2s 防抖自动保存。但条款核对 tab 通过 `saveDraftNow` 即时保存（不走防抖），也走 `POST /score-draft` 触发 WS。这是现有行为，不需要改。

### 5.2 接收端处理流程（代码审核修正：区分初始加载 vs WS 实时同步）

**初始加载**（页面首次打开 / `loadProject` 后）：
- 保留现有草稿恢复横幅（检测 localStorage / 服务端草稿 → 显示「恢复 / 丢弃」横幅）
- 这是专家恢复之前未完成工作的入口，不自动合并

**WS 实时同步**（`onDraftSaved` 收到对方设备草稿）：
1. `GET /score-draft?device=self` → 服务端返回 merge 后的 flat 草稿
2. 客户端比对本地 `scores` vs 远程草稿：
   - **新增项**（本地无、远程有）→ 立即 `setScores` 静默合并
   - **修改/删减项**（双方都有但值不同）→ 存入 `draftConflicts` state
3. 有冲突 → 顶部琥珀横幅
4. 无冲突 → 完全静默

### 5.3 顶部横幅

```
┌──────────────────────────────────────────────────────────┐
│ ⚠ 检测到 2 项评分变更（来自平板端）              [处理] │
└──────────────────────────────────────────────────────────┘
```

- 琥珀色背景 + 左侧竖线，贯穿评分区顶部
- 点击「处理」→ 打开裁决弹窗
- 仅在 WS 实时同步检测到冲突时出现，初始加载恢复不使用此横幅

### 5.4 冲突裁决弹窗

```
┌──────────────────────────────────────────────────────┐
│  同步草稿 — 来自平板端                          [×]  │
├──────────────────────────────────────────────────────┤
│  ✅ 新增（2 项） — 已自动合并                        │
│  ┌───────────────────────────────────────────────┐   │
│  │ 商务评分 · 付款条件响应     平板 5分           │   │
│  │ 商务评分 · 保险承诺         平板 5分           │   │
│  └───────────────────────────────────────────────┘   │
│                                                      │
│  ⚠ 变更（2 项） — 请确认                            │
│  ┌───────────────────────────────────────────────┐   │
│  │ 技术评分 · 钻孔结构及孔径保证                  │   │
│  │  ◉ 本设备（桌面）  3分   09:30                │   │
│  │  ○ 平板端          5分   09:25                │   │
│  ├───────────────────────────────────────────────┤   │
│  │ 技术评分 · 压水试验方案                        │   │
│  │  ◉ 本设备（桌面）  勾选   09:28                │   │
│  │  ○ 平板端          取消勾选 09:20             │   │
│  └───────────────────────────────────────────────┘   │
│                                                      │
│  [全部采用本设备]              [全部采用对方] [确认] │
└──────────────────────────────────────────────────────┘
```

- 变更项默认选中本设备版本（保留本地安全语义）
- 「全部采用本设备」/「全部采用对方」批量操作
- 关闭弹窗（× 或 backdrop）= 确认（保留 radio 当前选择）

### 5.5 冲突检测算法（代码审核修正：JSON.stringify 整体比较）

```typescript
const newItems: DraftEntry[] = [];
const conflicts: ConflictEntry[] = [];

for (const [key, remoteVal] of Object.entries(remoteDraft.scores)) {
  if (!(key in localScores)) {
    newItems.push({ key, val: remoteVal, source: 'remote' });
  } else {
    const localVal = localScores[key];
    // 整体比较：score + passed + reason + points 子对象
    // shallowEqual 不够——两个不同的 points 组合可能 rollup 出相同的 score
    if (JSON.stringify(localVal) !== JSON.stringify(remoteVal)) {
      conflicts.push({ key, localVal, remoteVal });
    }
  }
}
```

## 6. 平板操作栏调整

| 现状 | 改为 |
|------|------|
| 重置 + 暂存草稿 | **仅保留重置** |
| 「暂存草稿」按钮 | ❌ 删除 |
| 底部提示 | 「评分实时同步至桌面端 · 请在桌面端审阅并提交」 |

**保留的 UI**（代码审核修正）：
- 初始加载时的草稿恢复横幅（`draftAvailable` + 恢复/丢弃按钮）**保留**——专家打开平板时恢复之前的未完成工作
- WS 触发的草稿同步**不再走横幅**——改为自动合并（新增静默）+ 冲突弹窗（修改提醒）
- `saveDraft` / `draftSaving` 函数和状态**可删除**（仅被暂存按钮使用）

**重置防误同步**：重置时设 `skipAutoSaveRef = true`，跳过下一次 auto-save，避免空值覆盖服务端草稿。

## 7. 评分历史抽屉

### 7.1 入口

桌面打分 tab 右上角「备忘」按钮改为「评分历史」按钮（图标 `History` from lucide）。

### 7.2 后端端点

```
GET /expert/projects/:projectId/score-history?supplierId=X
```

遵循 ExpertController 现有鉴权模式：`@CurrentUser('sub')` + service 层 `bidExpert.findFirst({ userId, projectId })`，不需要额外 `@Roles`。

Service 方法：

```typescript
async getScoreHistory(userId: string, projectId: string, supplierId: string) {
  const expert = await this.prisma.bidExpert.findFirst({ where: { userId, projectId } });
  if (!expert) throw new ForbiddenException({ error: 'NOT_PROJECT_EXPERT' });

  const [records, history] = await Promise.all([
    // 当前值
    this.prisma.bidScoreRecord.findMany({
      where: { expertId: expert.id, supplierId },
      include: { scoreItem: { select: { id: true, name: true, category: true } } },
    }),
    // 历史快照
    this.prisma.bidScoreRecordHistory.findMany({
      where: { expertId: expert.id, supplierId },
      include: { scoreItem: { select: { id: true, name: true, category: true } } },
      orderBy: { createdAt: 'asc' },
    }),
  ]);

  // 按 scoreItemId 分组：每个评分项 = { 当前值 + [历史快照...] }
  // ...
  return grouped;
}
```

### 7.3 抽屉布局

```
┌──────────────────────────────────────────────────────┐
│  评分历史                                        [×]  │
├──────────────────────────────────────────────────────┤
│  供应商：[四川省第十二地质大队 ▼]                     │
│                                                      │
│  ── 资格性审查 ─────────────────────────────────────  │
│                                                      │
│  非联合体响应                                         │
│  ┌───────────────────────────────────────────────┐   │
│  │ ✓ 勾选   0分    创建   08-11 09:30            │   │
│  │ → 取消勾选 0分   修改   08-11 09:35           │   │
│  │ → 勾选   0分    修改   08-11 09:40  (当前)     │   │
│  └───────────────────────────────────────────────┘   │
│                                                      │
│  钻孔结构及孔径保证                                   │
│  ┌───────────────────────────────────────────────┐   │
│  │ ✓ 5分    创建   08-11 09:30  (当前)            │   │
│  └───────────────────────────────────────────────┘   │
│                                                      │
│  ── 商务评审 ───────────────────────────────────────  │
│  ...                                                 │
└──────────────────────────────────────────────────────┘
```

- 供应商下拉切换（默认当前 activeSupplier）
- 按评分类别分组
- 每个评分项一个卡片，时间线展示
- 当前版本绿色 ✓ 高亮，旧版本灰色 + 箭头 →
- 无历史的评分项显示「尚未评分」

### 7.4 数据说明

`BidScoreRecordHistory` 只在 `submitScores`（POST /scores）时写入（:1186）。草稿阶段修改不记录历史——只有正式提交（含重新提交覆盖）才留下审计轨迹。

## 8. 前端文件变更清单（代码审核修正）

| 文件 | 改动 |
|------|------|
| `app/(tablet)/tablet/evaluate/[id]/page.tsx` | 修改确认（父组件回滚模式）+ undo toast + 删除暂存按钮/saveDraft/draftSaving + 重置防误同步 + WS 草稿自动合并 + 冲突横幅 |
| `app/(app)/evaluate/[id]/page.tsx` | undo toast + WS 草稿自动合并 + 冲突横幅 + 冲突弹窗 + 备忘→评分历史按钮 + 评分历史抽屉 |
| `components/evaluate/sync-conflict-modal.tsx` | **新建**——冲突裁决弹窗组件 |
| `components/evaluate/score-history-drawer.tsx` | **新建**——评分历史抽屉组件 |
| `hooks/use-expert-websocket.ts` | 已有 `onDraftSaved` handler（无需改） |
| `lib/api.ts` | 新增 `getScoreHistory(projectId, supplierId)` |

> **PointChecklistScoring 不改**——修改确认逻辑在父组件 onChange 回调中处理，不需要新增 prop。

## 9. 后端文件变更清单

| 文件 | 改动 |
|------|------|
| `expert/expert.service.ts` | 新增 `getScoreHistory` 方法 |
| `expert/expert.controller.ts` | 新增 `GET /expert/projects/:projectId/score-history` 端点 |

## 10. 不做的事

- ❌ 桌面不弹修改确认（鼠标键盘操作精准）
- ❌ 新增操作不弹确认（0→N 是正常打分流程）
- ❌ 不做理由文本修改的确认（连续编辑打断感太强）
- ❌ 不做操作历史栈（undo 只回退一步）
- ❌ 不做 Prisma migration（无 schema 变更）
- ❌ 条款核对面板不需要 WS 同步（与桌面同页面共享 scores）
- ❌ PointChecklistScoring 不加新 prop（修改确认在父组件处理）
