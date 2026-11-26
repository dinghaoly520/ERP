import type { Prisma } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import type { StorageService } from '../storage/storage.service';
import {
  REVIEW_SOURCE_CATEGORY,
  REVIEW_SOURCE_PURGING_CATEGORY,
  isReviewObjectKey,
  isReviewSourceCategory,
} from './review-source-file.util';

/**
 * 审查源文件的清理（审计第 3 处跟进，2026-11-26）。
 *
 * 一份上传可以被多个审查任务共用（同一个 fileId 反复审查），所以删任务不等于删文件：
 * 只有「登记在册、且已经没有任何任务在用」的源文件才清。分两步，中间不拿着数据库事务去碰对象存储
 * （对象存储一慢，删任务的请求会把连接池的连接按事务超时一枚枚占住）：
 *  ① 锁内定案——锁住文件记录行，数一遍引用，没人用就把记录标成「待清」。执行审查建任务也锁这一行
 *     并在锁内复核类目（见 TenderReviewController.executeReview），所以标成待清之后不会再有任务引用到它；
 *  ② 删备份、删主对象，都删掉了才删文件记录。任何一步出错，记录原样留着——待清状态的记录不看上传时间，
 *     每日清理（ReviewSourceCleanupService）会接着清。对象在，账就在。
 * 只认登记过的审查源文件：存量任务的键是修复前写进去的，不能据它去删对象。
 */
export type ReviewSourcePurgeOutcome =
  /** 对象、备份与文件记录都清掉了 */
  | 'removed'
  /** 还有任务在用这份文件 */
  | 'in-use'
  /** 键不在审查命名空间内，或这个键名下没有审查源文件记录——存储不碰 */
  | 'unregistered'
  /** 出错了（数据库或对象存储）：没删完，等下次再清 */
  | 'kept';

/** 上传后一直没有审查任务在用的源文件，保留这么久之后由每日清理删掉（与 v3-staging 暂存清理同口径） */
export const REVIEW_SOURCE_TTL_MS = 24 * 3600 * 1000;

/** 对象存储说「这个键不存在」：对象已经不在了，对清理而言等于删掉了 */
function isMissingObjectError(err: unknown): boolean {
  return (err as { code?: unknown } | null)?.code === 'NoSuchKey';
}

/** 调用方负责在消息前面带上自己的上下文（比如任务 id），这里只接错误原文 */
export type ReviewSourcePurgeWarn = (what: string, err?: unknown) => void;

/**
 * 锁住一份上传的文件记录行，返回它的类目；行已不存在返回 null。
 * 「执行审查建任务」与「清理」都先过这里：两边对同一份文件排队，不会一个在删、一个在引用。
 * 必须在事务里调用——锁随事务结束才放开。
 */
export async function lockReviewSourceRow(tx: Prisma.TransactionClient, assetId: string): Promise<string | null> {
  const rows = await tx.$queryRaw<{ category: string }[]>`
    SELECT "category" FROM "FileAsset" WHERE "id" = ${assetId} FOR UPDATE`;
  return rows[0]?.category ?? null;
}

export async function purgeUnreferencedReviewSourceFile(
  prisma: PrismaService,
  storage: Pick<StorageService, 'delete'>,
  objectKey: string,
  warn: ReviewSourcePurgeWarn = () => undefined,
): Promise<ReviewSourcePurgeOutcome> {
  if (!isReviewObjectKey(objectKey)) {
    warn('文件键不在审查命名空间内，不清理存储');
    return 'unregistered';
  }

  let asset: { id: string; category: string } | null;
  try {
    asset = await prisma.fileAsset.findUnique({
      where: { key: objectKey },
      select: { id: true, category: true },
    });
  } catch (err) {
    warn('查不到文件记录，不清理存储', err);
    return 'kept';
  }
  if (!asset || !isReviewSourceCategory(asset.category)) {
    warn(asset ? '同键的文件记录不是审查源文件，不清理存储' : '文件没有审查源文件记录（存量对象），不清理存储');
    return 'unregistered';
  }
  const assetId = asset.id;

  // ① 锁内定案
  let countFailureLogged = false;
  let decided: 'purge' | 'in-use' | null;
  try {
    decided = await prisma.$transaction(async (tx) => {
      const locked = await lockReviewSourceRow(tx, assetId);
      // 等锁期间记录被删掉、或被改成了别的类目：不认了
      if (locked === null || !isReviewSourceCategory(locked)) return null;

      let stillUsed: number;
      try {
        stillUsed = await tx.reviewTask.count({ where: { objectKey } });
      } catch (err) {
        countFailureLogged = true;
        warn('统计引用失败，不清理存储', err);
        throw err;
      }
      if (stillUsed > 0) {
        // 不该发生——标成待清之后建不了新任务。真发生了就恢复成正常记录，宁可不删
        if (locked === REVIEW_SOURCE_PURGING_CATEGORY) {
          warn('待清的文件仍有任务在用，已恢复成正常记录');
          await tx.fileAsset.updateMany({
            where: { id: assetId, category: REVIEW_SOURCE_PURGING_CATEGORY },
            data: { category: REVIEW_SOURCE_CATEGORY },
          });
        }
        return 'in-use';
      }
      if (locked === REVIEW_SOURCE_CATEGORY) {
        await tx.fileAsset.updateMany({
          where: { id: assetId, category: REVIEW_SOURCE_CATEGORY },
          data: { category: REVIEW_SOURCE_PURGING_CATEGORY },
        });
      }
      return 'purge';
    });
  } catch (err) {
    if (!countFailureLogged) warn('清理前的核对没做成，不清理存储', err);
    return 'kept';
  }
  if (decided !== 'purge') return decided ?? 'unregistered';

  // ② 事务已提交（记录已是待清）：再清对象。先备份后主对象——备份删不掉时主对象还完好
  for (const object of [`${objectKey}.original`, objectKey]) {
    try {
      await storage.delete(object);
    } catch (err) {
      // 对象本来就不在：当作已删，接着清下一个（与 v3-staging 暂存清理同做法）
      if (isMissingObjectError(err)) continue;
      warn('对象没删掉，文件记录留在待清状态，等每日清理重试', err);
      return 'kept';
    }
  }
  try {
    await prisma.fileAsset.deleteMany({ where: { id: assetId, category: REVIEW_SOURCE_PURGING_CATEGORY } });
  } catch (err) {
    warn('审查源文件已删，但文件记录没删掉（留在待清状态，等每日清理重试）', err);
    return 'kept';
  }
  return 'removed';
}
