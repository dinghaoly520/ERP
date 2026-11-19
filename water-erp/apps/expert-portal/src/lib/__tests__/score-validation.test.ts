import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filterScorableItems, buildPendingScoreDraft, buildServerMentionedEntries, buildPostSubmitSlotPayload } from '../score-validation.ts';
import { threeWayMerge } from '../draft-merge.ts';

test('EXP-P0-01: 价格分公式激活时剔除 PRICE 项（不进校验/payload/进度分母）', () => {
  const items = [
    { id: 'a', category: 'TECHNICAL', maxScore: 30 },
    { id: 'b', category: 'PRICE', maxScore: 30 },
    { id: 'c', category: 'QUALIFICATION', maxScore: 10 },
  ];
  assert.deepEqual(
    filterScorableItems(items, true).map((i) => i.id),
    ['a', 'c'],
  );
});

test('EXP-P0-01: 公式未激活（专家手填模式）保留 PRICE 项', () => {
  const items = [
    { id: 'a', category: 'TECHNICAL', maxScore: 30 },
    { id: 'b', category: 'PRICE', maxScore: 30 },
  ];
  assert.deepEqual(
    filterScorableItems(items, false).map((i) => i.id),
    ['a', 'b'],
  );
});

test('EXP-P0-01: 无 PRICE 项时原样返回（含空数组）', () => {
  assert.equal(filterScorableItems([{ id: 'a', category: 'TECHNICAL', maxScore: 30 }], true).length, 1);
  assert.deepEqual(filterScorableItems([], true), []);
});

// ── TAB-SYNC-02 Task 1（⑤）：buildPendingScoreDraft——双页 buildPendingDraft/ buildPendingTabletDraft 收敛 ──

test('BPSD-① 与已提交记录等价（三字段+得分点）→ 不入草稿', () => {
  const myScores = [{ supplierId: 's1', scoreItemId: 'i1', score: 90, passed: true, reason: '好' }];
  const items = [{ id: 'i1', category: 'TECHNICAL' }];
  const scores = { 's1:i1': { score: 90, reason: '好', passed: true } };
  const pending = buildPendingScoreDraft(scores as any, myScores as any, items as any);
  assert.deepEqual(Object.keys(pending), []);
});

test('BPSD-② 与已提交记录不等价（改了分）→ 保留', () => {
  const myScores = [{ supplierId: 's1', scoreItemId: 'i1', score: 90, passed: true, reason: '好' }];
  const items = [{ id: 'i1', category: 'TECHNICAL' }];
  const scores = { 's1:i1': { score: 95, reason: '好', passed: true } };
  const pending = buildPendingScoreDraft(scores as any, myScores as any, items as any);
  assert.deepEqual(Object.keys(pending), ['s1:i1']);
});

test('BPSD-③ 无已提交记录 → 保留（未提交编辑是草稿本体）', () => {
  const pending = buildPendingScoreDraft({ 's1:i1': { score: 60, reason: '' } } as any, [], []);
  assert.deepEqual(Object.keys(pending), ['s1:i1']);
});

// ── T2/T3 审查 Important#1 回修：pointDecisions 提及键的基线条目必须纯服务端构造 ──

test('BSM-① 提及键有 committed 记录 → 三字段取记录值、points 服务端决策优先 + 未提及点补全默认（B5）', () => {
  const myScores = [{ supplierId: 's1', scoreItemId: 'i1', score: 90, passed: true, reason: '服务端理由' }];
  const items = [{ id: 'i1', category: 'TECHNICAL', points: [{ id: 'p1' }, { id: 'p2' }] }];
  const pds = [{ pointId: 'p1', supplierId: 's1', checked: true, awardedScore: 5, note: 'n1' }];
  const out = buildServerMentionedEntries(myScores as any, items as any, pds);
  // 纯服务端：三字段来自记录；points=p1 服务端决策（本地值零混入）+ p2 补全默认
  // （B5：buildFullPoints 全量点映射——多点数值项无提及 → 未勾 0 分，防 checklist 假冲突）
  assert.deepEqual(out['s1:i1'], {
    score: 90, reason: '服务端理由', passed: true,
    points: {
      p1: { checked: true, awardedScore: 5, note: 'n1' },
      p2: { checked: false, awardedScore: 0 },
    },
  });
});

test('BSM-② 提及键无 committed 记录 → 三字段取零值兜底、points 服务端（防本地未推送值经 cur 混入基线）', () => {
  const items = [{ id: 'i1', category: 'TECHNICAL', points: [{ id: 'p1' }] }];
  const pds = [{ pointId: 'p1', supplierId: 's9', checked: false, awardedScore: 0 }];
  const out = buildServerMentionedEntries([], items as any, pds);
  assert.deepEqual(out['s9:i1'], {
    score: 0, reason: '',
    points: { p1: { checked: false, awardedScore: 0 } },
  });
});

test('BSM-③ pointId 不属于任何评分项 → 跳过（不造悬空键）；空决策 → 空对象', () => {
  const items = [{ id: 'i1', category: 'TECHNICAL', points: [{ id: 'p1' }] }];
  const out = buildServerMentionedEntries([], items as any, [{ pointId: 'ghost', supplierId: 's1', checked: true, awardedScore: 1 }]);
  assert.deepEqual(Object.keys(out), []);
  assert.deepEqual(buildServerMentionedEntries([], items as any, []), {});
});

test('B5 补全后基线与本地 checklist 全量同构：对端编辑同键不再误判双端分歧（假冲突率收口）', () => {
  const myScores = [{ supplierId: 's1', scoreItemId: 'i1', score: 90, passed: true, reason: 'r' }];
  const items = [{ id: 'i1', category: 'TECHNICAL', points: [{ id: 'p1', fullScore: 5 }, { id: 'p2', fullScore: 8 }] }];
  const pds = [{ pointId: 'p1', supplierId: 's1', checked: true, awardedScore: 5 }];
  const base = buildServerMentionedEntries(myScores as any, items as any, pds);
  // 本地 checklist 全量映射：p1 同值 + p2 未勾（= B5 补全默认）——本地相对服务端真相**未编辑**
  const local = {
    's1:i1': {
      score: 90, reason: 'r', passed: true,
      points: { p1: { checked: true, awardedScore: 5 }, p2: { checked: false, awardedScore: 0 } },
    },
  };
  // 对端（远端草稿）编辑了 p2：本地未变 → 应静默接受远端；B5 前基线仅含 p1，
  // 本地会被误判「已改」+ 远端≠基线 → 假冲突弹窗
  const remote = {
    's1:i1': {
      score: 90, reason: 'r', passed: true,
      points: { p1: { checked: true, awardedScore: 5 }, p2: { checked: true, awardedScore: 8 } },
    },
  };
  const r = threeWayMerge(local as any, base, remote as any);
  assert.equal(r.conflicts.length, 0);
  assert.deepEqual(r.next['s1:i1']!.points!.p2, { checked: true, awardedScore: 8 });
});

test('B6⑤ buildPostSubmitSlotPayload：本供应商键清除、他供应商未提交分保留、等价已提交条目不入（组合）', () => {
  const myScores = [{ supplierId: 's1', scoreItemId: 'i1', score: 90, passed: true, reason: 'r' }];
  const items = [{ id: 'i1', category: 'TECHNICAL' }, { id: 'i2', category: 'TECHNICAL' }];
  const scores = {
    's1:i1': { score: 90, reason: 'r', passed: true }, // 与已提交等价 → pending 阶段即被驱逐
    's1:i2': { score: 80, reason: '本供应商未提交' },   // 本供应商键 → 前缀清除（已提交整组出槽）
    's2:i1': { score: 70, reason: '他供应商未提交分' }, // 他供应商 → 保留
  };
  const out = buildPostSubmitSlotPayload(scores as any, 's1', myScores as any, items as any);
  assert.deepEqual(Object.keys(out), ['s2:i1']);
});
