import { priorWindow } from './dashboard.service';

describe('priorWindow（紧邻等长前移）', () => {
  it('双边界区间前移一等长区间', () => {
    expect(priorWindow('2026-09-15', '2026-10-14')).toEqual({
      startDate: '2026-08-16', endDate: '2026-09-14',
    });
  });
  it('只有起始日（本月口径）→ 起始前等长 L 天，L=起始..今天（R2-1）', () => {
    // 今天=2026-10-27，L=27：上期=Sep 4..Sep 30（旧实现为上月整月 Sep 1-30，违反等长）
    expect(priorWindow('2026-10-01', undefined, new Date('2026-10-27T15:00:00+08:00'))).toEqual({
      startDate: '2026-09-04', endDate: '2026-09-30',
    });
  });
  it('月内起始（自定义单边）同样紧邻等长', () => {
    // L=18（Oct10..Oct27 含头尾）：上期=[Oct9-17天, Oct9] = Sep22..Oct9
    expect(priorWindow('2026-10-10', undefined, new Date('2026-10-27T08:00:00+08:00'))).toEqual({
      startDate: '2026-09-22', endDate: '2026-10-09',
    });
  });
  it('起始日在未来 → 无上期', () => {
    expect(priorWindow('2026-11-01', undefined, new Date('2026-10-27T08:00:00+08:00'))).toBeNull();
  });
  it('无起始日返回 null（"全部"区间无上期）', () => {
    expect(priorWindow(undefined, '2026-10-01')).toBeNull();
  });
});
