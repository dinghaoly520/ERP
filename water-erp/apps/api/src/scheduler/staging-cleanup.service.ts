/* =================================================================
   staging-cleanup.service — v3-staging 过期清理（阶段2.5 T7）
   每日 03:30：v3-staging/ 前缀 + createdAt<24h + 未被任何 SubmissionVersion
   信封引用（应用层引用集——Prisma JSON 数组 path 查询限制）→ MinIO remove +
   FileAsset 直删（运维级，绕过删除端点 bid_document 硬保护——设计而非漏洞）。
   Review Focus 3：被引用（已投递=证据件）/未过期不删。
   ================================================================= */
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { minioClient, MINIO_BUCKET } from '../upload/minio.client';

const STAGING_PREFIX = 'v3-staging/';
const STAGING_TTL_MS = 24 * 3600 * 1000;
const BATCH = 500;

@Injectable()
export class StagingCleanupService {
  private readonly logger = new Logger(StagingCleanupService.name);

  constructor(private readonly prisma: PrismaService) {}

  @Cron('30 3 * * *')
  async cronCleanup(): Promise<void> {
    await this.cleanupOnce().catch((e) => this.logger.error(`staging 清理失败: ${(e as Error).message}`));
  }

  async cleanupOnce(): Promise<{ removed: number; kept: number }> {
    const cutoff = new Date(Date.now() - STAGING_TTL_MS);
    const candidates = await this.prisma.fileAsset.findMany({
      where: { key: { startsWith: STAGING_PREFIX }, createdAt: { lt: cutoff } },
      select: { id: true, key: true },
      take: BATCH,
    });
    if (candidates.length === 0) return { removed: 0, kept: 0 };

    // 引用集：全部版本快照信封的 files[].assetId（应用层提取）
    const versions = await this.prisma.submissionVersion.findMany({ select: { envelope: true } });
    const referenced = new Set<string>();
    for (const v of versions) {
      const files = (v.envelope as { files?: Record<string, { assetId?: string }> } | null)?.files ?? {};
      for (const e of Object.values(files)) if (e?.assetId) referenced.add(e.assetId);
    }

    const perProject = new Map<string, { removed: number; kept: number }>();
    let removed = 0, kept = 0;
    const tally = (key: string, kind: 'removed' | 'kept') => {
      const pid = key.split('/')[1] ?? '_unknown_';
      const agg = perProject.get(pid) ?? { removed: 0, kept: 0 };
      agg[kind]++; perProject.set(pid, agg);
    };
    for (const c of candidates) {
      if (referenced.has(c.id)) { kept++; tally(c.key, 'kept'); continue; }
      try {
        await minioClient.removeObject(MINIO_BUCKET, c.key);
      } catch (err) {
        // 对象已缺失（NoSuchKey）——孤儿 DB 行仍收敛；其余存储错误跳过本轮该行
        if ((err as { code?: string }).code !== 'NoSuchKey') { kept++; tally(c.key, 'kept'); continue; }
      }
      await this.prisma.fileAsset.delete({ where: { id: c.id } }).catch(() => {});
      removed++; tally(c.key, 'removed');
    }
    // I-1（终审）：'__ops__' 假 projectId 撞 BidProject 外键必败——改按真实项目分组留痕
    // （key=v3-staging/{projectId}/{supplierId}/... 二段即项目）；单项目无候选时不记
    for (const [pid, agg] of perProject) {
      await this.prisma.bidSupervisionLog.create({
        data: {
          projectId: pid, time: new Date(), role: '系统', target: 'v3-staging 清理',
          action: '暂存密文过期清理', result: `删除 ${agg.removed}、保留 ${agg.kept}（引用/未过期保护）`,
          riskFlag: '无',
        },
      }).catch(() => {}); // FK 兜底：假项目段（非 cuid）仍可能拒——日志失败不阻断清理
    }
    this.logger.log(`v3-staging 清理：候选 ${candidates.length}，删 ${removed}，留 ${kept}`);
    return { removed, kept };
  }
}
