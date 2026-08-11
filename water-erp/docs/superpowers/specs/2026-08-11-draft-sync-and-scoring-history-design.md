# 草稿实时同步 + 评分变更保护 + 评分历史 技术方案

> **日期**：2026-08-11
> **范围**：expert-portal 平板端 + 桌面端 + PointChecklistScoring 共享组件 + expert API
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

在 PointChecklistScoring 的 onChange 中检测"是否已有值"：

- **Checkbox**：`v.checked === true` 时取消勾选 → 弹确认
- **分数**：`v.awardedScore > 0` 时修改 → 弹确认
- **新增**（unchecked→checked, 0→N）：不弹确认

### 4.2 实现

PointChecklistScoring 新增 prop：

```typescript
/** 平板修改二次确认回调：返回 true=允许修改，false=取消 */
onBeforeModify?: (pointName: string, change: { type: 'uncheck' | 'score'; oldVal: string; newVal: string }) => boolean;
```

- 平板页传入 `onBeforeModify` 实现（弹 ConfirmDialog）
- 桌面页不传（默认放行）
- 条款核对面板不传（桌面设备）

### 4.3 Undo Toast（所有设备）

修改生效后，父组件 onChange handler 弹 toast：

```typescript
toast(`已将「${pointName}」${formatVal(oldVal)}→${formatVal(newVal)}`, {
  action: { label: '撤销', onClick: () => applyChange(scoreItemId, pointId, oldVal) },
  duration: 3000,
});
```

仅在 `isModification(oldVal, newVal)` 时触发（新增不弹 toast）。

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

### 5.2 接收端处理流程

1. WS `DRAFT_SAVED`（过滤自己 device）
2. `GET /score-draft?device=self` → 服务端返回 merge 后的 flat 草稿
3. 客户端比对本地 `scores` vs 远程草稿：
   - **新增项**（本地无、远程有）→ 立即 `setScores` 静默合并
   - **修改/删减项**（双方都有但值不同）→ 存入 `draftConflicts` state
4. 有冲突 → 顶部琥珀横幅
5. 无冲突 → 完全静默

### 5.3 顶部横幅

```
┌──────────────────────────────────────────────────────────┐
│ ⚠ 检测到 2 项评分变更（来自平板端）              [处理] │
└──────────────────────────────────────────────────────────┘
```

- 琥珀色背景 + 左侧竖线，贯穿评分区顶部
- 点击「处理」→ 打开裁决弹窗

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

### 5.5 冲突检测算法

```typescript
const newItems: DraftEntry[] = [];
const conflicts: ConflictEntry[] = [];

for (const [key, remoteVal] of Object.entries(remoteDraft.scores)) {
  if (!(key in localScores)) {
    newItems.push({ key, val: remoteVal, source: 'remote' });
  } else {
    const localVal = localScores[key];
    if (!shallowEqual(localVal, remoteVal)) {
      conflicts.push({ key, localVal, remoteVal });
    }
  }
}
```

`shallowEqual` 比较 `score`、`passed`、`reason` 三个字段（不比较 `points` 子对象——得分点级变更通过正常打分 UI 处理，不进冲突弹窗）。

## 6. 平板操作栏调整

| 现状 | 改为 |
|------|------|
| 重置 + 暂存草稿 | **仅保留重置** |
| 「暂存草稿」按钮 | ❌ 删除 |
| 底部提示 | 「评分实时同步至桌面端 · 请在桌面端审阅并提交」 |

**重置防误同步**：`skipAutoSaveRef = true` 跳过下一次 auto-save，避免空值覆盖服务端草稿。

## 7. 评分历史抽屉

### 7.1 入口

桌面打分 tab 右上角「备忘」按钮改为「评分历史」按钮（图标 `History` from lucide）。

### 7.2 后端端点

```
GET /expert/projects/:projectId/score-history?supplierId=X
```

返回当前专家对该供应商的全部 `BidScoreRecordHistory` + 当前 `BidScoreRecord`，关联 `BidScoreItem.name`。

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

`BidScoreRecordHistory` 只在 `submitScores`（POST /scores）时写入。草稿阶段修改不记录历史——只有正式提交（含重新提交覆盖）才留下审计轨迹。

## 8. 前端文件变更清单

| 文件 | 改动 |
|------|------|
| `components/evaluate/point-checklist-scoring.tsx` | 新增 `onBeforeModify` prop + 修改前检测逻辑 |
| `app/(tablet)/tablet/evaluate/[id]/page.tsx` | 传入 `onBeforeModify`（弹 ConfirmDialog）+ undo toast + 删除暂存按钮 + 重置防误同步 + WS 草稿自动合并 + 冲突横幅 |
| `app/(app)/evaluate/[id]/page.tsx` | undo toast + WS 草稿自动合并 + 冲突横幅 + 冲突弹窗 + 备忘→评分历史按钮改 + 评分历史抽屉 |
| `components/evaluate/sync-conflict-modal.tsx` | **新建**——冲突裁决弹窗组件 |
| `components/evaluate/score-history-drawer.tsx` | **新建**——评分历史抽屉组件 |
| `hooks/use-expert-websocket.ts` | 已有 `onDraftSaved` handler（无需改） |
| `lib/api.ts` | 新增 `getScoreHistory(projectId, supplierId)` |

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
- ❌ 不做得分点级冲突检测（粒度到 scoreItem 级）
- ❌ 不做 Prisma migration（无 schema 变更）
- ❌ 条款核对面板不需要 WS 同步（与桌面同页面共享 scores）
