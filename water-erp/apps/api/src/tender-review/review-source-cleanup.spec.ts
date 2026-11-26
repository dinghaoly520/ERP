import {
  REVIEW_SOURCE_CATEGORY,
  REVIEW_SOURCE_PURGING_CATEGORY,
} from './review-source-file.util';
import { purgeUnreferencedReviewSourceFile } from './review-source-cleanup';

type Row = { id: string; key: string; category: string };

const KEY = 'review/2026-11-26/0123456789abcdef0123456789abcdef.docx';
const REGISTERED: Row = { id: 'fa-1', key: KEY, category: REVIEW_SOURCE_CATEGORY };

/** 内存里的最小库：只实现清理用到的几个查询，语义与真库一致（带条件的更新/删除、行锁回类目或空） */
function makeDeps(rows: Row[] = [REGISTERED], taskKeys: string[] = []) {
  const db = { rows, taskKeys };
  const matches = (row: Row, where: Record<string, unknown>) =>
    Object.entries(where).every(([field, value]) => (row as Record<string, unknown>)[field] === value);
  const updateMany = jest.fn(async ({ where, data }: { where: Record<string, unknown>; data: Partial<Row> }) => {
    let count = 0;
    db.rows = db.rows.map((row) => {
      if (!matches(row, where)) return row;
      count++;
      return { ...row, ...data };
    });
    return { count };
  });
  const deleteMany = jest.fn(async ({ where }: { where: Record<string, unknown> }) => {
    const before = db.rows.length;
    db.rows = db.rows.filter((row) => !matches(row, where));
    return { count: before - db.rows.length };
  });
  const tx = {
    // SELECT "category" FROM "FileAsset" WHERE "id" = $1 FOR UPDATE：行在就回类目，不在回空
    $queryRaw: jest.fn(async (_strings: TemplateStringsArray, id: string) => {
      const row = db.rows.find((r) => r.id === id);
      return row ? [{ category: row.category }] : [];
    }),
    fileAsset: { updateMany, deleteMany },
    reviewTask: {
      count: jest.fn(async ({ where }: { where: { objectKey: string } }) =>
        db.taskKeys.filter((k) => k === where.objectKey).length,
      ),
    },
  };
  const prisma = {
    $transaction: jest.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
    fileAsset: {
      findUnique: jest.fn(async ({ where }: { where: { key?: string; id?: string } }) =>
        db.rows.find((r) => r.key === where.key || r.id === where.id) ?? null,
      ),
      deleteMany,
    },
  };
  const storage = { delete: jest.fn(async (_key: string): Promise<void> => undefined) };
  return { prisma, storage, tx, db };
}

describe('purgeUnreferencedReviewSourceFile — 审查源文件的清理（审计第 3 处跟进）', () => {
  it('没有任务在用的登记文件：标记待清 → 删备份与主对象 → 删文件记录', async () => {
    const { prisma, storage, tx, db } = makeDeps();
    const warn = jest.fn();

    await expect(purgeUnreferencedReviewSourceFile(prisma as any, storage as any, KEY, warn)).resolves.toBe('removed');

    expect(storage.delete.mock.calls.map((c) => c[0])).toEqual([`${KEY}.original`, KEY]);
    expect(db.rows).toEqual([]);
    // 先标记、后删对象：标记那一刻起新任务就引用不到这份文件了
    expect(tx.fileAsset.updateMany).toHaveBeenCalledWith({
      where: { id: 'fa-1', category: REVIEW_SOURCE_CATEGORY },
      data: { category: REVIEW_SOURCE_PURGING_CATEGORY },
    });
    expect(tx.fileAsset.updateMany.mock.invocationCallOrder[0]).toBeLessThan(storage.delete.mock.invocationCallOrder[0]);
    // 锁行、数引用、标记在同一个事务里；数引用在锁之后
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(tx.reviewTask.count.mock.invocationCallOrder[0]);
    expect(tx.reviewTask.count).toHaveBeenCalledWith({ where: { objectKey: KEY } });
    expect(prisma.fileAsset.deleteMany).toHaveBeenCalledWith({ where: { id: 'fa-1', category: REVIEW_SOURCE_PURGING_CATEGORY } });
    expect(warn).not.toHaveBeenCalled();
  });

  it.each(['.original', ''])('对象本来就不在（%s 删除报 NoSuchKey）→ 当作已删，接着清剩下的', async (suffix) => {
    const { prisma, storage, db } = makeDeps();
    const warn = jest.fn();
    storage.delete.mockImplementation(async (key: string) => {
      if (key === `${KEY}${suffix}`) throw Object.assign(new Error('The specified key does not exist.'), { code: 'NoSuchKey' });
    });

    await expect(purgeUnreferencedReviewSourceFile(prisma as any, storage as any, KEY, warn)).resolves.toBe('removed');

    expect(storage.delete.mock.calls.map((c) => c[0])).toEqual([`${KEY}.original`, KEY]);
    expect(db.rows).toEqual([]);
    expect(warn).not.toHaveBeenCalled();
  });

  it('存储报的是别的错（比如没权限）→ 不算删掉：后面的对象不再删，文件记录留在待清状态', async () => {
    const { prisma, storage, db } = makeDeps();
    const warn = jest.fn();
    storage.delete.mockImplementation(async (key: string) => {
      if (key === `${KEY}.original`) throw Object.assign(new Error('Access Denied'), { code: 'AccessDenied' });
    });

    await expect(purgeUnreferencedReviewSourceFile(prisma as any, storage as any, KEY, warn)).resolves.toBe('kept');

    expect(storage.delete.mock.calls.map((c) => c[0])).toEqual([`${KEY}.original`]);
    expect(db.rows).toEqual([{ ...REGISTERED, category: REVIEW_SOURCE_PURGING_CATEGORY }]);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('对象删除在事务提交之后才做——事务里不碰对象存储', async () => {
    const { prisma, storage } = makeDeps();
    let inside = 0;
    prisma.$transaction.mockImplementation(async (fn: any) => {
      inside++;
      const out = await fn(makeDeps().tx);
      inside--;
      return out;
    });
    storage.delete.mockImplementation(async () => {
      expect(inside).toBe(0);
    });

    await purgeUnreferencedReviewSourceFile(prisma as any, storage as any, KEY);
    expect(storage.delete).toHaveBeenCalledTimes(2);
  });

  it('同一份文件还有任务在用 → in-use：不碰存储、不改记录', async () => {
    const { prisma, storage, tx, db } = makeDeps([REGISTERED], [KEY]);
    const warn = jest.fn();

    await expect(purgeUnreferencedReviewSourceFile(prisma as any, storage as any, KEY, warn)).resolves.toBe('in-use');

    expect(storage.delete).not.toHaveBeenCalled();
    expect(tx.fileAsset.updateMany).not.toHaveBeenCalled();
    expect(prisma.fileAsset.deleteMany).not.toHaveBeenCalled();
    expect(db.rows).toEqual([REGISTERED]);
    expect(warn).not.toHaveBeenCalled();
  });

  it('任务键不在审查命名空间内 → unregistered：不查库、不碰存储', async () => {
    const { prisma, storage } = makeDeps();
    const warn = jest.fn();

    await expect(purgeUnreferencedReviewSourceFile(prisma as any, storage as any, '../.env', warn)).resolves.toBe('unregistered');

    expect(prisma.fileAsset.findUnique).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(storage.delete).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['没有文件记录（存量对象）', []],
    ['同键的文件记录是别的类目', [{ id: 'fa-9', key: KEY, category: 'bid_document' }]],
  ])('%s → unregistered：存储一律不碰', async (_label, rows) => {
    const { prisma, storage } = makeDeps(rows);
    const warn = jest.fn();

    await expect(purgeUnreferencedReviewSourceFile(prisma as any, storage as any, KEY, warn)).resolves.toBe('unregistered');

    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(storage.delete).not.toHaveBeenCalled();
    expect(prisma.fileAsset.deleteMany).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('文件记录已是待清状态（上次清理没做完）→ 不再标记，接着删对象与记录', async () => {
    const purging: Row = { ...REGISTERED, category: REVIEW_SOURCE_PURGING_CATEGORY };
    const { prisma, storage, tx, db } = makeDeps([purging]);

    await expect(purgeUnreferencedReviewSourceFile(prisma as any, storage as any, KEY)).resolves.toBe('removed');

    expect(tx.fileAsset.updateMany).not.toHaveBeenCalled();
    expect(storage.delete).toHaveBeenCalledTimes(2);
    expect(db.rows).toEqual([]);
  });

  it('备份删不掉 → kept：主对象不再删，文件记录留在待清状态（每日清理会接着清）', async () => {
    const { prisma, storage, db } = makeDeps();
    storage.delete.mockRejectedValueOnce(new Error('minio down'));
    const warn = jest.fn();

    await expect(purgeUnreferencedReviewSourceFile(prisma as any, storage as any, KEY, warn)).resolves.toBe('kept');

    expect(storage.delete).toHaveBeenCalledTimes(1);
    expect(prisma.fileAsset.deleteMany).not.toHaveBeenCalled();
    expect(db.rows).toEqual([{ ...REGISTERED, category: REVIEW_SOURCE_PURGING_CATEGORY }]);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('主对象删不掉 → kept：文件记录留在待清状态', async () => {
    const { prisma, storage, db } = makeDeps();
    storage.delete.mockImplementation((k: string) => (k.endsWith('.original') ? Promise.resolve() : Promise.reject(new Error('minio down'))));
    const warn = jest.fn();

    await expect(purgeUnreferencedReviewSourceFile(prisma as any, storage as any, KEY, warn)).resolves.toBe('kept');

    expect(prisma.fileAsset.deleteMany).not.toHaveBeenCalled();
    expect(db.rows[0].category).toBe(REVIEW_SOURCE_PURGING_CATEGORY);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('对象都删了、文件记录没删掉 → kept（记录留在待清状态）', async () => {
    const { prisma, db } = makeDeps();
    prisma.fileAsset.deleteMany.mockRejectedValueOnce(new Error('db down'));
    const warn = jest.fn();

    await expect(purgeUnreferencedReviewSourceFile(prisma as any, { delete: jest.fn().mockResolvedValue(undefined) } as any, KEY, warn)).resolves.toBe('kept');

    expect(warn).toHaveBeenCalledTimes(1);
    expect(db.rows[0].category).toBe(REVIEW_SOURCE_PURGING_CATEGORY);
  });

  it('数引用时数据库出错 → kept：事务里什么都没改，不碰对象存储', async () => {
    const { prisma, storage, tx, db } = makeDeps();
    tx.reviewTask.count.mockRejectedValueOnce(new Error('db down'));
    const warn = jest.fn();

    await expect(purgeUnreferencedReviewSourceFile(prisma as any, storage as any, KEY, warn)).resolves.toBe('kept');

    expect(tx.fileAsset.updateMany).not.toHaveBeenCalled();
    expect(storage.delete).not.toHaveBeenCalled();
    expect(db.rows).toEqual([REGISTERED]);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('等锁期间文件记录被别处清掉了 → unregistered：不碰对象存储', async () => {
    const { prisma, storage, tx } = makeDeps();
    tx.$queryRaw.mockResolvedValueOnce([]);
    const warn = jest.fn();

    await expect(purgeUnreferencedReviewSourceFile(prisma as any, storage as any, KEY, warn)).resolves.toBe('unregistered');

    expect(tx.reviewTask.count).not.toHaveBeenCalled();
    expect(storage.delete).not.toHaveBeenCalled();
  });

  it('等锁期间记录已不是审查源文件（被改成别的类目）→ unregistered：不碰对象存储', async () => {
    const { prisma, storage, tx } = makeDeps();
    tx.$queryRaw.mockResolvedValueOnce([{ category: 'bid_document' }]);
    const warn = jest.fn();

    await expect(purgeUnreferencedReviewSourceFile(prisma as any, storage as any, KEY, warn)).resolves.toBe('unregistered');

    expect(storage.delete).not.toHaveBeenCalled();
  });

  // 不该发生（标成待清之后建不了新任务）——真发生了就恢复成正常记录，宁可不删
  it('待清状态的文件居然还有任务在用 → 恢复成正常记录、不碰对象存储', async () => {
    const purging: Row = { ...REGISTERED, category: REVIEW_SOURCE_PURGING_CATEGORY };
    const { prisma, storage, tx, db } = makeDeps([purging], [KEY]);
    const warn = jest.fn();

    await expect(purgeUnreferencedReviewSourceFile(prisma as any, storage as any, KEY, warn)).resolves.toBe('in-use');

    expect(tx.fileAsset.updateMany).toHaveBeenCalledWith({
      where: { id: 'fa-1', category: REVIEW_SOURCE_PURGING_CATEGORY },
      data: { category: REVIEW_SOURCE_CATEGORY },
    });
    expect(storage.delete).not.toHaveBeenCalled();
    expect(prisma.fileAsset.deleteMany).not.toHaveBeenCalled();
    expect(db.rows).toEqual([REGISTERED]);
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
