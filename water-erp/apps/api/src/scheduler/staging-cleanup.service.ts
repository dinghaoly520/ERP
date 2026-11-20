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

    // 引用集：全部版本快照信封的 files[].assetId（应用层提取）
    // + N13-B（2026-11-20b 复核轮）：CaOperation 冻结载荷（submit/reupload 的 PAYLOAD_READY
    // 含信封 assetId）——供应商冻结签名后拖过 24h，暂存被删会让 commit 拒 FILE_NOT_OWNED
    // 须整流程重跑（500MB 重加密）。宁可不删不可漏保护：解析失败跳过该行。
    const versions = await this.prisma.submissionVersion.findMany({ select: { envelope: true } });
    const referenced = new Set<string>();
    for (const v of versions) {
      const files = (v.envelope as { files?: Record<string, { assetId?: string }> } | null)?.files ?? {};
      for (const e of Object.values(files)) if (e?.assetId) referenced.add(e.assetId);
    }
    const frozenOps = await this.prisma.caOperation.findMany({
      where: { purpose: { in: ['submit', 'reupload'] }, status: 'PAYLOAD_READY' },
      select: { result: true },
    }).catch(() => [] as Array<{ result: unknown }>);
    for (const op of frozenOps) {
      // C1（2026-11-20b code-review 终审）：信封以 JSON 字符串存于 result.canonical
      //（ca-operation.service:42 attachPayload；消费侧 supplier-portal:2919 JSON.parse 同源），
      // 原读 result.files 恒 undefined=保护死代码。防御：非对象/解析失败/无 files 跳过。
      const canonical = (op.result as { canonical?: unknown } | null)?.canonical;
      if (typeof canonical !== 'string') continue;
      let files: Record<string, { assetId?: string }> | undefined;
      try {
        files = (JSON.parse(canonical) as { files?: Record<string, { assetId?: string }> }).files;
      } catch { continue; }
      if (!files) continue;
      for (const e of Object.values(files)) if (e?.assetId) referenced.add(e.assetId);
    }

    const perProject = new Map<string, { removed: number; kept: number }>();
    let removed = 0, kept = 0;
    const tally = (key: string, kind: 'removed' | 'kept') => {
      const pid = key.split('/')[1] ?? '_unknown_';
      const agg = perProject.get(pid) ?? { removed: 0, kept: 0 };
      agg[kind]++; perProject.set(pid, agg);
    };
    // N10（2026-11-20b 复核轮）：分批循环清空——原单轮 take 500 上限可被 10/min 暂存速率
    // 超越（14400/日 ≫ 500/日），未投递残留日净增长。满批即续批直至无候选。
    // F1（2026-11-20b 终审）：无进展守卫——满批但本批零删除（全被引用/全存储错误）时，
    // 下轮必重查同批（kept 行不删库行），无守卫则死循环（被引用行随 dual-v3 投递量单调
    // 增长，≥500 后 03:30 cron 永久空转）。
    for (;;) {
      const candidates = await this.prisma.fileAsset.findMany({
        where: { key: { startsWith: STAGING_PREFIX }, createdAt: { lt: cutoff } },
        select: { id: true, key: true },
        take: BATCH,
      });
      if (candidates.length === 0) break;
      let removedThisBatch = 0;
      for (const c of candidates) {
        if (referenced.has(c.id)) { kept++; tally(c.key, 'kept'); continue; }
        try {
          await minioClient.removeObject(MINIO_BUCKET, c.key);
        } catch (err) {
          // 对象已缺失（NoSuchKey）——孤儿 DB 行仍收敛；其余存储错误跳过本轮该行
          if ((err as { code?: string }).code !== 'NoSuchKey') { kept++; tally(c.key, 'kept'); continue; }
        }
        await this.prisma.fileAsset.delete({ where: { id: c.id } }).catch(() => {});
        removed++; removedThisBatch++; tally(c.key, 'removed');
      }
      if (candidates.length < BATCH) break;
      if (removedThisBatch === 0) break; // F1：满批零删除=无进展，停（下轮 cron 再试）
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
    this.logger.log(`v3-staging 清理：候选 ${removed + kept}，删 ${removed}，留 ${kept}`);
    return { removed, kept };
  }
}
