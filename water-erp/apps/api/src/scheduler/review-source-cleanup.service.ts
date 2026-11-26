/* =================================================================
   review-source-cleanup.service — 审查源文件的每日清理（审计第 3 处跟进，2026-11-26）
   每日 03:50（与 03:30 的 v3-staging 暂存清理错开）清两类登记在册的审查源文件：
   ① 上传后满 24 小时、没有任何审查任务在用的——上传了没执行审查、或执行时被拒的；
   ② 待清状态的记录——删任务时清理没做完（对象存储出错）或进程中断留下的，不看上传时间。
   清理规则与删任务后的连带清理是同一份代码（tender-review/review-source-cleanup.ts）：
   锁内数引用、标待清，再删对象，都删掉了才删记录；待清的文件不会再被新任务引用。
   Review Focus：还有任务在用的、没满 24 小时的不删；一条出错不连累其它条。
   ================================================================= */
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import {
  REVIEW_SOURCE_TTL_MS,
  purgeUnreferencedReviewSourceFile,
  type ReviewSourcePurgeOutcome,
} from '../tender-review/review-source-cleanup';
import {
  REVIEW_SOURCE_CATEGORY,
  REVIEW_SOURCE_PURGING_CATEGORY,
  isReviewObjectKey,
} from '../tender-review/review-source-file.util';

const BATCH = 500;

@Injectable()
export class ReviewSourceCleanupService {
  private readonly logger = new Logger(ReviewSourceCleanupService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  @Cron('50 3 * * *')
  async cronCleanup(): Promise<void> {
    await this.cleanupOnce().catch((e) =>
      this.logger.error(`审查源文件清理失败: ${(e as Error).message}`),
    );
  }

  async cleanupOnce(now: Date = new Date()): Promise<{ removed: number; kept: number }> {
    const cutoff = new Date(now.getTime() - REVIEW_SOURCE_TTL_MS);
    // 引用集在应用层比（ReviewTask 与 FileAsset 之间没有外键，与 StagingCleanupService 同做法）；
    // 这里只为少列候选——要不要删以 purge 里锁内那一遍计数为准
    const referenced = new Set(
      (await this.prisma.reviewTask.findMany({ select: { objectKey: true }, distinct: ['objectKey'] })).map(
        (t) => t.objectKey,
      ),
    );
    const [stale, purging] = await Promise.all([
      this.prisma.fileAsset.findMany({
        where: { category: REVIEW_SOURCE_CATEGORY, createdAt: { lt: cutoff } },
        select: { id: true, key: true },
        orderBy: { createdAt: 'asc' },
        take: BATCH,
      }),
      this.prisma.fileAsset.findMany({
        where: { category: REVIEW_SOURCE_PURGING_CATEGORY },
        select: { id: true, key: true },
        take: BATCH,
      }),
    ]);
    const candidates = [...purging, ...stale.filter((a) => !referenced.has(a.key))];

    let removed = 0;
    let kept = 0;
    for (const asset of candidates) {
      let outcome: ReviewSourcePurgeOutcome;
      try {
        if (!isReviewObjectKey(asset.key)) {
          // 类目是审查源文件、键却不在审查命名空间：不是审查上传口登记的，不碰
          this.logger.warn(`审查源文件记录 ${asset.id} 的键不在审查命名空间内，每日清理不处理`);
          outcome = 'kept';
        } else {
          outcome = await purgeUnreferencedReviewSourceFile(this.prisma, this.storage, asset.key, (what, err) =>
            this.logger.warn(`每日清理 ${asset.key}：${what}${err === undefined ? '' : `（${String(err).slice(0, 200)}）`}`),
          );
        }
      } catch (err) {
        this.logger.error(`每日清理 ${asset.key} 时出错: ${String(err).slice(0, 200)}`);
        outcome = 'kept';
      }
      if (outcome === 'removed') removed++;
      else kept++;
    }
    if (candidates.length > 0) {
      this.logger.log(`审查源文件每日清理：候选 ${candidates.length}，删 ${removed}，留 ${kept}`);
    }
    return { removed, kept };
  }
}
