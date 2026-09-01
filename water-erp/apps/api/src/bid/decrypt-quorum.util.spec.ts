import { assertDecryptCheckInQuorum, getMinBiddersForMethod } from './decrypt-quorum.util';

describe('decrypt-quorum（A-109a）', () => {
  const prisma = (project: unknown, signedIn: number) => ({
    bidProject: { findUnique: jest.fn().mockResolvedValue(project) },
    bidSupplier: { count: jest.fn().mockResolvedValue(signedIn) },
  });
  const proj = { name: 'P', procurementMethod: '公开招标' };

  it('getMinBiddersForMethod：直接采购 1、其余 3', () => {
    expect(getMinBiddersForMethod('直接采购')).toBe(1);
    expect(getMinBiddersForMethod('公开招标')).toBe(3);
    expect(getMinBiddersForMethod(null)).toBe(3);
  });
  it('已签到 2 < 3 → 400 INSUFFICIENT_CHECKIN', async () => {
    await expect(assertDecryptCheckInQuorum(prisma(proj, 2) as any, 'p1'))
      .rejects.toMatchObject({ response: { code: 'INSUFFICIENT_CHECKIN' } });
  });
  it('已签到 3 → 放行', async () => {
    await expect(assertDecryptCheckInQuorum(prisma(proj, 3) as any, 'p1')).resolves.toBeUndefined();
  });
  it('直接采购 1 家已签到 → 放行', async () => {
    await expect(assertDecryptCheckInQuorum(prisma({ name: 'P', procurementMethod: '直接采购' }, 1) as any, 'p1')).resolves.toBeUndefined();
  });
  it('项目不存在 → NotFound', async () => {
    await expect(assertDecryptCheckInQuorum(prisma(null, 0) as any, 'p1')).rejects.toThrow();
  });
  it('计数条件含 submitStatus=已提交 + checkInAt 非空', async () => {
    const p: any = prisma(proj, 3);
    await assertDecryptCheckInQuorum(p, 'p1');
    expect(p.bidSupplier.count).toHaveBeenCalledWith({ where: { projectId: 'p1', submitStatus: '已提交', checkInAt: { not: null } } });
  });
});
