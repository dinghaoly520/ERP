import { mergeDraftSlots } from './score-draft-merge.util';

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
