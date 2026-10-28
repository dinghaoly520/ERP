import { CatalogService } from './catalog.service';

/** stats() 口径（2026-10-28 收口）：KPI 卡「待复核」只数单状态——
 *  原把价格波动/即将过期混入同一计数（43），与同屏 tab 列表（status='待复核'，共 14）矛盾。 */
describe('CatalogService.stats 口径', () => {
  it('review 只数「待复核」单状态，与 tab 列表同过滤', async () => {
    const wheres: any[] = [];
    const prisma: any = {
      catalogItem: {
        count: jest.fn((arg: any) => { wheres.push(arg?.where); return Promise.resolve(1); }),
      },
      supplierCatalogApplication: { count: jest.fn().mockResolvedValue(0) },
    };
    const svc = new CatalogService(prisma as any, {} as any, {} as any, {} as any, {} as any);
    const res = await svc.stats();
    expect(res.review).toBe(1);
    // 单状态精确匹配存在，三状态混计调用不存在
    expect(wheres).toContainEqual({ status: '待复核' });
    expect(wheres.filter(w => Array.isArray(w?.status?.in) && w.status.in.includes('待复核'))).toEqual([]);
  });
});
