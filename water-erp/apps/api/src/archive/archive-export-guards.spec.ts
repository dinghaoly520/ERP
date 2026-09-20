import { assertNoMissingRefs, uniqueEntryName, fetchAllPaged } from './archive-export.service';

/**
 * 2026-09-20 审查修复三守卫：
 * ① 引用件缺行对账（FileAsset 行缺失 → 整体拒绝，防静默缺件残包）
 * ② ZIP 同目录同名消歧（JSZip file() 覆盖语义 → 序号消歧，manifest 与卷内容一一对应）
 * ③ take:200 截断守卫（分页全取，orderBy id 稳定翻页）
 */

describe('uniqueEntryName（ZIP 同名消歧）', () => {
  it('不撞名 → 原样返回并登记', () => {
    const used = new Set<string>();
    expect(uniqueEntryName('expert_sign_scan', '签字.jpg', used)).toBe('expert_sign_scan/签字.jpg');
    expect(used.has('expert_sign_scan/签字.jpg')).toBe(true);
  });

  it('撞名 → 扩展名前加 _2；再撞 → _3', () => {
    const used = new Set<string>(['expert_sign_scan/签字.jpg', 'expert_sign_scan/签字_2.jpg']);
    expect(uniqueEntryName('expert_sign_scan', '签字.jpg', used)).toBe('expert_sign_scan/签字_3.jpg');
  });

  it('无扩展名 → 名_2', () => {
    const used = new Set<string>(['expert_memo_ink/批注']);
    expect(uniqueEntryName('expert_memo_ink', '批注', used)).toBe('expert_memo_ink/批注_2');
  });
});

describe('assertNoMissingRefs（引用件缺行对账）', () => {
  it('全部命中 → 不抛', () => {
    expect(() => assertNoMissingRefs(new Set(['fa1', 'fa2']), new Set(['fa1', 'fa2', 'fa3']))).not.toThrow();
  });

  it('有缺行 → 抛 ARCHIVE_HANDOVER_FETCH_FAILED（整体拒绝口径）', () => {
    try {
      assertNoMissingRefs(new Set(['fa1', 'fa2', 'fa3']), new Set(['fa1']));
      fail('应抛异常');
    } catch (e: any) {
      expect(e?.response?.code).toBe('ARCHIVE_HANDOVER_FETCH_FAILED');
      expect(e?.response?.error).toContain('缺失 2 件');
      expect(e?.response?.error).toContain('fa2');
    }
  });
});

describe('fetchAllPaged（take 截断守卫）', () => {
  const finder = (pages: unknown[][]) =>
    jest.fn(async ({ skip }: { skip: number; orderBy?: unknown; take?: number; where?: unknown; select?: unknown }) =>
      pages[Math.floor(skip / 200)] ?? []);

  it('多页 → 分页全取（skip 0/200…）', async () => {
    const full = Array.from({ length: 250 }, (_, i) => ({ id: `a${i}` }));
    const f = finder([full.slice(0, 200), full.slice(200)]);
    const out = await fetchAllPaged(f as any, { where: {}, select: { id: true } });
    expect(out).toHaveLength(250);
    expect(f).toHaveBeenCalledTimes(2);
    expect(f.mock.calls[0][0].skip).toBe(0);
    expect(f.mock.calls[1][0].skip).toBe(200);
    expect(f.mock.calls[0][0].orderBy).toEqual({ id: 'asc' }); // 稳定翻页
  });

  it('单页不满 → 一次调用即止', async () => {
    const f = finder([Array.from({ length: 30 }, (_, i) => ({ id: `a${i}` }))]);
    const out = await fetchAllPaged(f as any, { where: {}, select: { id: true } });
    expect(out).toHaveLength(30);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('恰好整页 → 再取一次空页确认穷尽', async () => {
    const full = Array.from({ length: 200 }, (_, i) => ({ id: `a${i}` }));
    const f = finder([full]);
    const out = await fetchAllPaged(f as any, { where: {}, select: { id: true } });
    expect(out).toHaveLength(200);
    expect(f).toHaveBeenCalledTimes(2);
  });
});
