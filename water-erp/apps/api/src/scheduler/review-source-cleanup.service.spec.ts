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
const KEY_I = (i: number) => `review/2026-11-24/${String(i).padStart(32, '0')}.docx`;
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
      // 实现服务端语义：where（类目 / key.startsWith / createdAt.lt）、orderBy.createdAt、take 都照做——
      // 「先限量后过滤」这类取数缺陷只有 take 说了算的假库才测得出来
      findMany: jest.fn().mockImplementation(
        async (args: {
          where: { category: string; key?: { startsWith: string }; createdAt?: { lt: Date } };
          orderBy?: { createdAt: 'asc' | 'desc' };
          take?: number;
        }) => {
          const { where, orderBy, take } = args;
          const rows = assets.filter(
            (a) =>
              a.category === where.category &&
              (!where.key || a.key.startsWith(where.key.startsWith)) &&
              (!where.createdAt || a.createdAt < where.createdAt.lt),
          );
          if (orderBy?.createdAt === 'asc') rows.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
          if (orderBy?.createdAt === 'desc') rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
          return take === undefined ? rows : rows.slice(0, take);
        },
      ),
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
    // 时间门槛是「严格早于 now − 24h」；候选只取审查命名空间下的键
    expect(prisma.fileAsset.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { category: REVIEW_SOURCE_CATEGORY, key: { startsWith: 'review/' }, createdAt: { lt: expect.any(Date) } },
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

  test('只取审查命名空间下的键：类目是审查源文件、键却不在命名空间的脏数据不列为候选', async () => {
    const prisma = mkPrisma({
      assets: [
        { id: 'fa-dirty', key: 'uploads/2026-11-25/x.pdf', category: REVIEW_SOURCE_CATEGORY, createdAt: OLD },
        { id: 'fa-orphan', key: KEY(1), category: REVIEW_SOURCE_CATEGORY, createdAt: OLD },
      ],
    });
    const service = mkService(prisma);
    const warn = jest.spyOn((service as any).logger, 'warn').mockImplementation(() => undefined);
    const r = await service.cleanupOnce();
    expect(purge.mock.calls.map((c) => c[2])).toEqual([KEY(1)]);
    expect(r).toEqual({ removed: 1, kept: 0 });
    expect(warn).not.toHaveBeenCalled();
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

  const MANY = (count: number, category: string, createdAt: Date) =>
    Array.from({ length: count }, (_, i) => ({ id: `fa-${category}-${i}`, key: KEY_I(i), category, createdAt }));

  test('被任务留住的源文件超过一批、且都比没人用的上传旧 → 没人用的上传照样清（不能先限量再过滤）', async () => {
    // 每个带文件的审查都留下一条被任务引用的记录，任务列表只回最近 50 条、更早的在界面上删不掉——
    // 留住的记录只增不减。若先取最老的 500 条再在应用层筛「没人用」，候选会恒为空，孤儿永远清不到
    const retained = MANY(600, REVIEW_SOURCE_CATEGORY, OLD);
    const orphan = { id: 'fa-orphan', key: KEY_I(999), category: REVIEW_SOURCE_CATEGORY, createdAt: new Date(OLD.getTime() + 60_000) };
    const prisma = mkPrisma({ assets: [...retained, orphan], referenced: retained.map((a) => a.key) });

    const r = await mkService(prisma).cleanupOnce();

    expect(purge.mock.calls.map((c) => c[2])).toEqual([orphan.key]);
    expect(r).toEqual({ removed: 1, kept: 0 });
  });

  test('没人用的上传一轮最多清 500 条：积压更多时留给下一天', async () => {
    const prisma = mkPrisma({ assets: MANY(600, REVIEW_SOURCE_CATEGORY, OLD) });

    const r = await mkService(prisma).cleanupOnce();

    expect(purge).toHaveBeenCalledTimes(500);
    expect(r).toEqual({ removed: 500, kept: 0 });
  });

  test('待清记录按上传时间从旧到新取，一轮最多 500 条', async () => {
    const purging = MANY(600, REVIEW_SOURCE_PURGING_CATEGORY, OLD);
    const prisma = mkPrisma({ assets: purging });

    await mkService(prisma).cleanupOnce();

    expect(purge).toHaveBeenCalledTimes(500);
    expect(purge.mock.calls[0][2]).toBe(purging[0].key);
    const purgingQuery = prisma.fileAsset.findMany.mock.calls.map((c) => c[0]).find((a) => a.where.category === REVIEW_SOURCE_PURGING_CATEGORY);
    expect(purgingQuery.orderBy).toEqual({ createdAt: 'asc' });
    expect(purgingQuery.take).toBe(500);
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
