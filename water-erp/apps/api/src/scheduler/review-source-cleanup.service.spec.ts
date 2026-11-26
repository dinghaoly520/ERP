/**
 * 审查源文件每日清理的单测（审计第 3 处跟进）。
 * 清理规则本体在 tender-review/review-source-cleanup.ts（有自己的单测）；这里只看每日任务挑了谁、怎么计数、出错怎么办。
 */
jest.mock('../tender-review/review-source-cleanup', () => ({
  ...jest.requireActual('../tender-review/review-source-cleanup'),
  purgeUnreferencedReviewSourceFile: jest.fn(),
}));

import { REVIEW_SOURCE_CATEGORY, REVIEW_SOURCE_PURGING_CATEGORY } from '../tender-review/review-source-file.util';
import { REVIEW_SOURCE_TTL_MS, purgeUnreferencedReviewSourceFile } from '../tender-review/review-source-cleanup';
import { ReviewSourceCleanupService } from './review-source-cleanup.service';

const purge = purgeUnreferencedReviewSourceFile as jest.Mock;
const KEY = (n: number) => `review/2026-11-25/${String(n).repeat(32)}.docx`;
const OLD = new Date(Date.now() - 25 * 3600 * 1000);
const FRESH = new Date(Date.now() - 3600 * 1000);

type Asset = { id: string; key: string; category: string; createdAt: Date };

const mkPrisma = (over: { assets?: Asset[]; referenced?: string[] } = {}) => {
  const assets = over.assets ?? [
    { id: 'fa-orphan', key: KEY(1), category: REVIEW_SOURCE_CATEGORY, createdAt: OLD }, // 满 24h、没人用 → 清
    { id: 'fa-fresh', key: KEY(2), category: REVIEW_SOURCE_CATEGORY, createdAt: FRESH }, // 没满 24h → 留
    { id: 'fa-purging', key: KEY(3), category: REVIEW_SOURCE_PURGING_CATEGORY, createdAt: FRESH }, // 上次没清完 → 接着清
  ];
  return {
    reviewTask: {
      findMany: jest.fn().mockResolvedValue((over.referenced ?? []).map((objectKey) => ({ objectKey }))),
    },
    fileAsset: {
      // 实现服务端 where 语义：按类目取，带 createdAt.lt 的再按时间筛
      findMany: jest.fn().mockImplementation(async ({ where }: { where: { category: string; createdAt?: { lt: Date } } }) =>
        assets.filter((a) => a.category === where.category && (!where.createdAt || a.createdAt < where.createdAt.lt))),
    },
  };
};
const mkService = (prisma: any) => new ReviewSourceCleanupService(prisma, { delete: jest.fn() } as any);

describe('ReviewSourceCleanupService — 审查源文件每日清理', () => {
  beforeEach(() => {
    purge.mockReset();
    purge.mockResolvedValue('removed');
  });

  test('保留期 24 小时（与 v3-staging 暂存清理同口径）', () => {
    expect(REVIEW_SOURCE_TTL_MS).toBe(24 * 3600 * 1000);
  });

  test('满 24 小时、没有任何任务在用的上传 → 清；没满 24 小时的 → 不动', async () => {
    const prisma = mkPrisma({
      assets: [
        { id: 'fa-orphan', key: KEY(1), category: REVIEW_SOURCE_CATEGORY, createdAt: OLD },
        { id: 'fa-fresh', key: KEY(2), category: REVIEW_SOURCE_CATEGORY, createdAt: FRESH },
      ],
    });
    const service = mkService(prisma);
    const r = await service.cleanupOnce();
    expect(r).toEqual({ removed: 1, kept: 0 });
    expect(purge).toHaveBeenCalledTimes(1);
    expect(purge.mock.calls[0][0]).toBe(prisma);
    expect(purge.mock.calls[0][2]).toBe(KEY(1));
    // 时间门槛是「严格早于 now − 24h」
    expect(prisma.fileAsset.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { category: REVIEW_SOURCE_CATEGORY, createdAt: { lt: expect.any(Date) } },
    }));
  });

  test('待清状态的记录（上次清理没做完）不看上传时间，接着清', async () => {
    const prisma = mkPrisma({ assets: [{ id: 'fa-purging', key: KEY(3), category: REVIEW_SOURCE_PURGING_CATEGORY, createdAt: FRESH }] });
    const r = await mkService(prisma).cleanupOnce();
    expect(r).toEqual({ removed: 1, kept: 0 });
    expect(purge.mock.calls.map((c) => c[2])).toEqual([KEY(3)]);
    // 取待清记录时不带时间条件（带时间条件的是另一条「满 24 小时」的查询）
    const purgingQuery = prisma.fileAsset.findMany.mock.calls.map((c) => c[0].where).find((w) => w.category === REVIEW_SOURCE_PURGING_CATEGORY);
    expect(purgingQuery).not.toHaveProperty('createdAt');
  });

  test('还有任务在用的上传，满了 24 小时也不列为候选', async () => {
    const prisma = mkPrisma({
      assets: [{ id: 'fa-orphan', key: KEY(1), category: REVIEW_SOURCE_CATEGORY, createdAt: OLD }],
      referenced: [KEY(1)],
    });
    const r = await mkService(prisma).cleanupOnce();
    expect(purge).not.toHaveBeenCalled();
    expect(r).toEqual({ removed: 0, kept: 0 });
  });

  test('一条清不掉不影响其它条：计数里算「留」，不抛', async () => {
    purge.mockImplementation(async (_prisma: unknown, _storage: unknown, key: string) => {
      if (key === KEY(3)) throw new Error('unexpected');
      return key === KEY(1) ? 'in-use' : 'removed';
    });
    const service = mkService(mkPrisma());
    const error = jest.spyOn((service as any).logger, 'error').mockImplementation(() => undefined);
    await expect(service.cleanupOnce()).resolves.toEqual({ removed: 0, kept: 2 });
    expect(error).toHaveBeenCalledTimes(1);
  });

  test('一轮最多各取 500 条（满批的下一天接着清）', async () => {
    const prisma = mkPrisma();
    await mkService(prisma).cleanupOnce();
    for (const call of prisma.fileAsset.findMany.mock.calls) expect(call[0].take).toBe(500);
  });

  test('定时入口：清理出错只记错误日志，不抛', async () => {
    const prisma = mkPrisma();
    prisma.reviewTask.findMany.mockRejectedValue(new Error('db down'));
    const service = mkService(prisma);
    const error = jest.spyOn((service as any).logger, 'error').mockImplementation(() => undefined);
    await expect(service.cronCleanup()).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledTimes(1);
    expect(purge).not.toHaveBeenCalled();
  });
});
