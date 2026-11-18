import { mergeDraftSlots, stampDraftEntries } from './score-draft-merge.util';

/**
 * TAB-SYNC-01 §4.1：草稿双槽合并改「逐键取最新 savedAt」（替代旧「本设备槽整槽优先」）。
 * 旧语义缺陷：本设备槽优先 × 自动保存从全量 state 回声 → 同键被双端各改一次后
 * 永久静默分叉、冲突弹窗条件（merged ≠ 本地）永不成立——详见 spec
 * docs/superpowers/specs/2026-11-12-tab-sync-01-tablet-pairing-design.md §4.1。
 */
describe('mergeDraftSlots — 逐键取最新 savedAt', () => {
  it('① 双槽同键不同值不同 savedAt → 取新者（tablet 较新，读端 desktop）', () => {
    const raw = {
      tablet: { savedAt: 2000, scores: { X: { score: 85, reason: 't', savedAt: 2000 } } },
      desktop: { savedAt: 1000, scores: { X: { score: 75, reason: 'd', savedAt: 1000 } } },
    };
    expect(mergeDraftSlots(raw, 'desktop')!.scores.X).toEqual({ score: 85, reason: 't', savedAt: 2000 });
  });

  it('① 双槽同键不同值不同 savedAt → 取新者（desktop 较新，读端 tablet）', () => {
    const raw = {
      tablet: { savedAt: 1000, scores: { X: { score: 85, reason: 't', savedAt: 1000 } } },
      desktop: { savedAt: 2000, scores: { X: { score: 75, reason: 'd', savedAt: 2000 } } },
    };
    expect(mergeDraftSlots(raw, 'tablet')!.scores.X).toEqual({ score: 75, reason: 'd', savedAt: 2000 });
  });

  it('② 回声无害：tablet 槽回声条目（savedAt 拷贝自原编辑时刻）vs desktop 更新条目 → 取 desktop', () => {
    // 推演（spec §4.1）：桌面改 X=75@1000 → 平板合并回声进 tablet 槽（保留原 savedAt=1000）
    // → 桌面再改 X=80@2000 → 平板拉取须见 80（旧「本设备槽优先」会恒返回回声 75）
    const raw = {
      tablet: { savedAt: 1500, scores: { X: { score: 75, reason: 'echo', savedAt: 1000 } } },
      desktop: { savedAt: 2000, scores: { X: { score: 80, reason: 'd2', savedAt: 2000 } } },
    };
    expect(mergeDraftSlots(raw, 'tablet')!.scores.X).toEqual({ score: 80, reason: 'd2', savedAt: 2000 });
  });

  it('③ 条目无 per-entry savedAt → 回退所属槽顶层 savedAt 参与逐键比较', () => {
    // tablet 条目无 savedAt → 有效时间戳 = 槽级 5000 > desktop 自带 4000 → tablet 胜出
    // （若回退为 0 则 desktop 4000 胜——本用例证明槽级回退真实参与跨槽比较）
    const raw = {
      tablet: { savedAt: 5000, scores: { X: { score: 80, reason: 't' } } },
      desktop: { savedAt: 3000, scores: { X: { score: 70, reason: 'd', savedAt: 4000 } } },
    };
    expect(mergeDraftSlots(raw, 'desktop')!.scores.X).toEqual({ score: 80, reason: 't' });
  });

  it('④ 旧扁平格式（raw.scores 直接存在、无 device 分槽）→ 原样返回', () => {
    const raw = { scores: { X: { score: 60, reason: 'legacy' } } };
    expect(mergeDraftSlots(raw, 'desktop')).toBe(raw);
    expect(mergeDraftSlots(raw)).toBe(raw);
  });

  it('⑤ 有效时间戳相等 → device 侧槽优先 tiebreak（device 缺省视 desktop 为本设备侧）', () => {
    const mk = () => ({
      tablet: { savedAt: 1000, scores: { X: { score: 85, reason: 't', savedAt: 1000 } } },
      desktop: { savedAt: 1000, scores: { X: { score: 75, reason: 'd', savedAt: 1000 } } },
    });
    expect(mergeDraftSlots(mk(), 'tablet')!.scores.X.reason).toBe('t');
    expect(mergeDraftSlots(mk(), 'desktop')!.scores.X.reason).toBe('d');
    expect(mergeDraftSlots(mk())!.scores.X.reason).toBe('d');
  });

  it('⑥ 顶层 savedAt = 两槽 max（与逐键取新者独立）', () => {
    const raw = {
      tablet: { savedAt: 2000, scores: { X: { score: 85, reason: 't', savedAt: 2000 } } },
      desktop: { savedAt: 5000, scores: { X: { score: 75, reason: 'd', savedAt: 1000 } } },
    };
    const merged = mergeDraftSlots(raw, 'tablet')!;
    expect(merged.savedAt).toBe(5000);
    expect(merged.scores.X.reason).toBe('t'); // 逐键仍按条目时间戳取新者（2000 > 1000）
  });

  it('⑦ 键仅存在于单侧槽 → 原样透传（合并为键并集）', () => {
    const raw = {
      tablet: { savedAt: 1000, scores: { A: { score: 1, reason: 't', savedAt: 1000 } } },
      desktop: { savedAt: 2000, scores: { B: { score: 2, reason: 'd', savedAt: 2000 } } },
    };
    const merged = mergeDraftSlots(raw, 'tablet')!;
    expect(merged.scores.A).toEqual({ score: 1, reason: 't', savedAt: 1000 });
    expect(merged.scores.B).toEqual({ score: 2, reason: 'd', savedAt: 2000 });
    expect(merged.savedAt).toBe(2000);
  });

  it('⑧ 无草稿（null/undefined/空对象）→ null（保持 getScoreDraft 旧契约）', () => {
    expect(mergeDraftSlots(null)).toBeNull();
    expect(mergeDraftSlots(undefined)).toBeNull();
    expect(mergeDraftSlots({})).toBeNull();
  });
});

// ── TAB-SYNC-02 ④：stampDraftEntries——服务端逐键打点（慢钟设备不再单向失步）──

describe('stampDraftEntries（TAB-SYNC-02 ④）', () => {
  const existing = {
    scores: {
      's1:i1': { score: 80, reason: 'r', savedAt: 100 },
      's1:i2': { score: 70, reason: 'r2', savedAt: 110 },
    },
    savedAt: 110,
  };

  it('内容变更键 → 打服务器钟 now', () => {
    const out = stampDraftEntries({ 's1:i1': { score: 90, reason: 'r' } }, existing, 5000);
    expect(out['s1:i1'].savedAt).toBe(5000);
  });

  it('内容未变键 → 保留原 savedAt（回声无害：重发不算编辑）', () => {
    const out = stampDraftEntries({ 's1:i1': { score: 80, reason: 'r' } }, existing, 5000);
    expect(out['s1:i1'].savedAt).toBe(100);
  });

  it('内容比较剥 savedAt——客户端重发旧时戳但内容相同 → 仍保留服务端原时戳', () => {
    const out = stampDraftEntries({ 's1:i1': { score: 80, reason: 'r', savedAt: 999 } }, existing, 5000);
    expect(out['s1:i1'].savedAt).toBe(100);
  });

  it('新键（本槽无此键）→ 打 now；旧槽时戳不迁移', () => {
    const out = stampDraftEntries({ 's2:i9': { score: 10, reason: '' } }, existing, 5000);
    expect(out['s2:i9'].savedAt).toBe(5000);
  });

  it('空入参 → 空对象（空清载荷调用方不经过本函数，此处仅容错）', () => {
    expect(stampDraftEntries({}, existing, 5000)).toEqual({});
  });

  it('existingSlot 为旧扁平/畸形形状 → 全部键视为新键打 now（fail-open 到打点）', () => {
    const out = stampDraftEntries({ 's1:i1': { score: 80, reason: 'r' } }, { weird: true }, 5000);
    expect(out['s1:i1'].savedAt).toBe(5000);
  });
});

// ── T4 审查 Critical 回修：jsonb 键序归一化 × stringify 比较误判（回声必须无害）──

describe('stampDraftEntries 键序无关性（T4 审查 Critical）', () => {
  it('存储侧为 jsonb 归一键序（passed 提前于 reason）、内容等价 → 保留原 savedAt（不误重打）', () => {
    const existing = {
      scores: {
        // PG jsonb 键序：score(5) < passed(6) < reason(6) < savedAt(7)
        's1:i1': { score: 80, passed: true, reason: 'r', savedAt: 100 },
      },
      savedAt: 100,
    };
    // 客户端构造序：score, reason, passed
    const out = stampDraftEntries({ 's1:i1': { score: 80, reason: 'r', passed: true } }, existing, 5000);
    expect(out['s1:i1'].savedAt).toBe(100);
  });

  it('points 点键序不同（p2/p1 互倒）内容等价 → 保留原 savedAt', () => {
    const mk = (order: 'asc' | 'desc') => ({
      score: 90,
      reason: 'r',
      points: order === 'asc'
        ? { p1: { checked: true, awardedScore: 5, note: 'n' }, p2: { checked: false, awardedScore: 0 } }
        : { p2: { checked: false, awardedScore: 0 }, p1: { checked: true, awardedScore: 5, note: 'n' } },
    });
    const existing = { scores: { 's1:i2': { ...mk('asc'), savedAt: 120 } }, savedAt: 120 };
    const out = stampDraftEntries({ 's1:i2': mk('desc') }, existing, 5000);
    expect(out['s1:i2'].savedAt).toBe(120);
  });
});
