import { evaluateInvalidBid } from './evaluate-invalid-bid.helper';

describe('evaluateInvalidBid', () => {
  it('不通过票严格过半 → disqualified', async () => {
    const prisma: any = { bidScoreRecord: { findMany: jest.fn().mockResolvedValue([
      { passed: false }, { passed: false }, { passed: true },  // 2/3 不通过 → 过半
    ]) }};
    const r = await evaluateInvalidBid(prisma, 'p1', 'sup1', 'si1');
    expect(r).toEqual({ disqualified: true, failCount: 2, totalCount: 3 });
  });
  it('不过半 → 不废标', async () => {
    const prisma: any = { bidScoreRecord: { findMany: jest.fn().mockResolvedValue([
      { passed: false }, { passed: true }, { passed: true },  // 1/3 → 不过半
    ]) }};
    expect((await evaluateInvalidBid(prisma, 'p1', 'sup1', 'si1')).disqualified).toBe(false);
  });
  it('无 passed 的记录忽略', async () => {
    const prisma: any = { bidScoreRecord: { findMany: jest.fn().mockResolvedValue([
      { passed: null }, { passed: false }, { passed: true },  // 1/2 有效 → 不过半
    ]) }};
    const r = await evaluateInvalidBid(prisma, 'p1', 'sup1', 'si1');
    expect(r.totalCount).toBe(2);
  });
});
