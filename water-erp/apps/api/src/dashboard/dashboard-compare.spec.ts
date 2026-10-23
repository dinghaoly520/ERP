import { priorWindow } from './dashboard.service';

describe('priorWindow（等长前移）', () => {
  it('双边界区间前移一等长区间', () => {
    expect(priorWindow('2026-09-15', '2026-10-14')).toEqual({
      startDate: '2026-08-16', endDate: '2026-09-14',
    });
  });
  it('只有起始日（本月口径）→ 上月同日到起始前一日', () => {
    expect(priorWindow('2026-10-01', undefined)).toEqual({
      startDate: '2026-09-01', endDate: '2026-09-30',
    });
  });
  it('无起始日返回 null（"全部"区间无上期）', () => {
    expect(priorWindow(undefined, '2026-10-01')).toBeNull();
  });
});
