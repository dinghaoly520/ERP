import test from 'node:test';
import assert from 'node:assert/strict';
import { threeWayMerge } from '../draft-merge.ts';
import type { ScoreEntry } from '../draft-merge.ts';

/**
 * TAB-SYNC-01 §4.1 客户端半：草稿三方合并纯函数。
 * 条目统一经 e() 构造（固定字段顺序——JSON.stringify 深比较的稳定性由打点构造保证）。
 */
const e = (score: number, savedAt: number, reason = `理由${score}`): ScoreEntry => ({
  score,
  reason,
  savedAt,
});

test('① 仅远端改（本地==基线）→ 静默接受远端，next 与新 baseline 均为远端值', () => {
  const base = e(80, 1);
  const m = threeWayMerge({ price: { ...base } }, { price: { ...base } }, { price: e(90, 2) });
  assert.deepEqual(m.conflicts, []);
  assert.equal(m.next.price.score, 90);
  assert.equal(m.baseline.price.score, 90);
});

test('② 仅本地改（远端==基线）→ 保留本地，无冲突', () => {
  const base = e(80, 1);
  const m = threeWayMerge({ price: e(85, 2) }, { price: { ...base } }, { price: { ...base } });
  assert.deepEqual(m.conflicts, []);
  assert.equal(m.next.price.score, 85);
  // 新 baseline = 本次接受后快照：保留键取本地值
  assert.equal(m.baseline.price.score, 85);
});

test('②b 本地独有新键（远端缺键）→ 保留本地', () => {
  const m = threeWayMerge({ newItem: e(60, 2) }, {}, {});
  assert.deepEqual(m.conflicts, []);
  assert.equal(m.next.newItem.score, 60);
  assert.equal(m.baseline.newItem.score, 60);
});

test('③ 双端并发改同键不同值 → conflict 携带双侧原值，next 保留本地', () => {
  const m = threeWayMerge({ price: e(85, 2) }, { price: e(80, 1) }, { price: e(75, 3) });
  assert.equal(m.conflicts.length, 1);
  assert.equal(m.conflicts[0].key, 'price');
  assert.equal(m.conflicts[0].local.score, 85);
  assert.equal(m.conflicts[0].remote.score, 75);
  assert.equal(m.next.price.score, 85);
  // 冲突键未经裁决前，新 baseline 记本地值（本设备当前所信）
  assert.equal(m.baseline.price.score, 85);
});

test('③b 双端并发改成相同值（自回声形态，savedAt 各自打点）→ 不算冲突，保留本地并推进 baseline', () => {
  const m = threeWayMerge({ price: e(90, 5) }, { price: e(80, 1) }, { price: e(90, 9) });
  assert.deepEqual(m.conflicts, []);
  assert.equal(m.next.price.score, 90);
  assert.equal(m.baseline.price.score, 90);
});

test('本地仅重刷 savedAt（内容未变）不误判为已改 → 远端已改仍接受远端', () => {
  const base = e(80, 1);
  const restamped = { ...base, savedAt: 9 };
  const m = threeWayMerge({ price: restamped }, { price: base }, { price: e(90, 2) });
  assert.deepEqual(m.conflicts, []);
  assert.equal(m.next.price.score, 90);
});

test('④ §12.2 序列：平板 85 → 桌面 75 → 平板 90，双端各自视角终态 90 全程零冲突', () => {
  // 公共起点：双端已同步在 80（local==baseline==remote）
  const S0 = e(80, 1);
  let tabletLocal: Record<string, ScoreEntry> = { price: { ...S0 } };
  let tabletBaseline: Record<string, ScoreEntry> = { price: { ...S0 } };
  let desktopLocal: Record<string, ScoreEntry> = { price: { ...S0 } };
  let desktopBaseline: Record<string, ScoreEntry> = { price: { ...S0 } };
  let m = threeWayMerge(tabletLocal, tabletBaseline, tabletLocal); // 占位初始化，下面逐步覆盖

  // 1) 平板改成 85（编辑打点 t=2，推到服务端平板槽）
  tabletLocal = { price: e(85, 2) };

  // 2) 桌面 pull：远端=服务端逐键最新 savedAt=85；桌面本地==baseline(80) → 接受
  m = threeWayMerge(desktopLocal, desktopBaseline, { price: e(85, 2) });
  assert.deepEqual(m.conflicts, []);
  assert.equal(m.next.price.score, 85);
  desktopLocal = m.next;
  desktopBaseline = m.baseline;

  // 3) 平板回声 pull：拉回自己刚推的 85 —— local(85)≠baseline(80) 但 remote==local → 同值不冲突，baseline 推进到 85
  m = threeWayMerge(tabletLocal, tabletBaseline, { price: e(85, 2) });
  assert.deepEqual(m.conflicts, []);
  assert.equal(m.next.price.score, 85);
  tabletLocal = m.next;
  tabletBaseline = m.baseline;
  assert.equal(tabletBaseline.price.score, 85);

  // 4) 桌面改成 75（t=3，推到桌面槽；服务端逐键合并取新者=75）
  desktopLocal = { price: e(75, 3) };

  // 4b) 桌面回声 pull（接线契约：推完后 pull 一次把基线推进到自己的编辑——
  //     否则平板后来的 90 会误判为与桌面 stale 基线 85 的并发冲突）
  m = threeWayMerge(desktopLocal, desktopBaseline, { price: e(75, 3) });
  assert.deepEqual(m.conflicts, []);
  assert.equal(m.next.price.score, 75);
  desktopLocal = m.next;
  desktopBaseline = m.baseline;
  assert.equal(desktopBaseline.price.score, 75);

  // 5) 平板 pull 远端 75：平板 local==baseline(85) → 接受 75
  m = threeWayMerge(tabletLocal, tabletBaseline, { price: e(75, 3) });
  assert.deepEqual(m.conflicts, []);
  assert.equal(m.next.price.score, 75);
  tabletLocal = m.next;
  tabletBaseline = m.baseline;

  // 6) 平板改成 90（t=4，推到平板槽；服务端逐键合并取新者=90）
  tabletLocal = { price: e(90, 4) };

  // 7) 桌面 pull 远端 90：桌面 local==baseline(75) → 接受 90
  m = threeWayMerge(desktopLocal, desktopBaseline, { price: e(90, 4) });
  assert.deepEqual(m.conflicts, []);
  assert.equal(m.next.price.score, 90);
  desktopLocal = m.next;
  desktopBaseline = m.baseline;

  // 8) 平板回声 pull：local(90)≠baseline(75) 但 remote==local → 同值不冲突
  m = threeWayMerge(tabletLocal, tabletBaseline, { price: e(90, 4) });
  assert.deepEqual(m.conflicts, []);
  assert.equal(m.next.price.score, 90);
  tabletLocal = m.next;
  tabletBaseline = m.baseline;

  // 终态：双端各自视角均为 90，全程零冲突
  assert.equal(tabletLocal.price.score, 90);
  assert.equal(desktopLocal.price.score, 90);
});

test('⑤ 键集不对称：local 独有保留 / remote 独有接受 / 仅 baseline 残留键剔除（含新 baseline）', () => {
  const m = threeWayMerge({ onlyLocal: e(1, 1) }, { deadKey: e(0, 0) }, { onlyRemote: e(2, 1) });
  assert.deepEqual(Object.keys(m.next).sort(), ['onlyLocal', 'onlyRemote']);
  assert.equal(m.next.onlyLocal.score, 1);
  assert.equal(m.next.onlyRemote.score, 2);
  assert.deepEqual(m.conflicts, []);
  // 死键同步从新 last-synced 基线剔除
  assert.deepEqual(Object.keys(m.baseline).sort(), ['onlyLocal', 'onlyRemote']);
});

test('远端缺键但 baseline/本地仍带同值 → 保守保留本地（不传播删除）', () => {
  const base = e(5, 1);
  const m = threeWayMerge({ price: { ...base } }, { price: { ...base } }, {});
  assert.deepEqual(m.conflicts, []);
  assert.equal(m.next.price.score, 5);
});

test('points 嵌套差异参与变更判定（score/reason 相同仍视为已改）', () => {
  const base: ScoreEntry = {
    score: 10,
    reason: 'ok',
    points: { a: { checked: false, awardedScore: 0 } },
  };
  const localEntry: ScoreEntry = {
    score: 10,
    reason: 'ok',
    points: { a: { checked: true, awardedScore: 4 } },
  };
  const remoteEntry: ScoreEntry = { score: 10, reason: '远端改理由', points: base.points };
  const m = threeWayMerge({ tech: localEntry }, { tech: base }, { tech: remoteEntry });
  // 双端都偏离 baseline（本地仅 points 不同）→ 冲突，next 保留本地
  assert.equal(m.conflicts.length, 1);
  assert.equal(m.next.tech.points?.a.awardedScore, 4);
});

test('可选字段显式 undefined 与缺省视为相等（不误判为本地已改）', () => {
  const base: ScoreEntry = { score: 10, reason: 'ok' };
  const localEntry: ScoreEntry = { score: 10, reason: 'ok', passed: undefined };
  const m = threeWayMerge({ price: localEntry }, { price: base }, { price: e(20, 2) });
  // JSON 序列化丢弃 undefined → local==baseline → 接受远端
  assert.deepEqual(m.conflicts, []);
  assert.equal(m.next.price.score, 20);
});

test('纯度：next 与 baseline 互不共享条目引用，改动 next 不影响 baseline 与入参', () => {
  const local = { price: e(1, 1) };
  const base = { price: e(1, 1) };
  const remote = { price: e(2, 2) };
  const m = threeWayMerge(local, base, remote);
  assert.notEqual(m.next.price, m.baseline.price);
  m.next.price.score = 999;
  assert.equal(m.baseline.price.score, 2);
  assert.equal(remote.price.score, 2);
  assert.equal(local.price.score, 1);
});
