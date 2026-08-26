import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ensureArchiveScopeSeeded } from './archive-scope.seed';

export type ScopeRowStatus = 'MATCHED' | 'MISSING' | 'PENDING_GENERATED';

export interface ScopeMatchRow {
  scopeItemId: string;
  code: string;
  stage: string;
  materialName: string;
  sourceType: string;
  isRequired: boolean;
  status: ScopeRowStatus;
  /** 命中的系统附件（attachment 源 / manual 补传） */
  attachmentIds: string[];
  /** 命中的回流件（fileAsset 源） */
  fileAssetIds: string[];
  blocking: boolean; // 缺件是否阻断（仅 attachment 源必选项；外部件只提示）
}

/**
 * 归档范围勾稽（DA/T 103-2024 §6 + 附录 B + A.1a）：
 * 范围表 × 项目实际件（阶段附件 + 开评标回流件）→ 逐项 MATCHED/MISSING。
 * 兼职元数据 enricher（§7.2 附录 C M22/M28/M32/M33）：快照时自动补写 ArchiveMetadata。
 */
@Injectable()
export class ArchiveScopeService {
  private readonly logger = new Logger(ArchiveScopeService.name);
  private seeded = false;

  constructor(private readonly prisma: PrismaService) {}

  /** 回流件 category → 定位规则（FileAsset 无 projectId 直连，按 key 结构定位） */
  private static HANDOVER_KEY_PATTERNS: Record<string, (bpId: string) => object> = {
    bid_opening_handover: (bpId) => ({ key: { contains: bpId }, category: 'bid_opening_handover' }),
    bid_evaluation_handover: (bpId) => ({ key: `bid-evaluation-handover/${bpId}.json` }),
    bid_sign_packet: (bpId) => ({ key: { contains: bpId }, category: 'bid_sign_packet' }),
    bid_decrypted: (bpId) => ({ key: { contains: bpId }, category: 'bid_decrypted' }),
  };

  async ensureSeeded(): Promise<void> {
    if (this.seeded) return;
    await ensureArchiveScopeSeeded(this.prisma);
    this.seeded = true;
  }

  /** 阶段闸门（P1）：该阶段必选项（attachment 源）是否齐件。返回缺件清单（空=通过） */
  async checkStageGate(projectId: string, stageKey: string): Promise<string[]> {
    await this.ensureSeeded();
    const required = await this.prisma.archiveScopeItem.findMany({
      where: { sourceType: 'attachment', isRequired: true, stageKeys: { has: stageKey } },
      orderBy: { sortOrder: 'asc' },
    });
    if (required.length === 0) return [];
    const count = await this.prisma.attachment.count({
      where: { projectManagementItemId: projectId, projectManagementStage: { stageKey } },
    });
    if (count > 0) return [];
    return required.map((r) => `${r.code} ${r.materialName}`);
  }

  /**
   * 全量勾稽快照：范围 35 项逐项比对 + 元数据自动捕获。
   * @param opts.enrichMeta true=顺带 upsert ArchiveMetadata（勾稽/导出场景）；纯查询传 false
   */
  async snapshot(pmiId: string, opts: { enrichMeta?: boolean } = {}): Promise<{
    rows: ScopeMatchRow[];
    matchedCount: number;
    requiredMissing: string[];
  }> {
    await this.ensureSeeded();
    const item = await this.prisma.projectManagementItem.findUnique({
      where: { id: pmiId },
      select: {
        id: true, title: true, projectCode: true,
        requesterName: true, requesterDepartment: true, awardedSupplier: true,
        stages: { orderBy: { stageOrder: 'asc' }, include: { attachments: true } },
        bidProjects: { select: { id: true } },
      },
    });
    if (!item) throw new Error('项目不存在');

    // 阶段键 → 附件集合
    const stageAttachments = new Map<string, typeof item.stages[number]['attachments']>();
    for (const st of item.stages) stageAttachments.set(st.stageKey, st.attachments);
    const stageKeySet = new Set(item.stages.map((st) => st.stageKey));

    // 回流件：该 PMI 关联的全部 BidProject → FileAsset（按 category 定位规则）
    const bpIds = item.bidProjects.map((bp) => bp.id);
    const handoverAssets = new Map<string, string[]>(); // category → fileAssetId[]
    if (bpIds.length > 0) {
      for (const bpId of bpIds) {
        for (const [category, pattern] of Object.entries(ArchiveScopeService.HANDOVER_KEY_PATTERNS)) {
          const where = pattern(bpId);
          const assets = await this.prisma.fileAsset.findMany({
            where: { ...where } as never,
            select: { id: true },
            take: 5,
          });
          if (assets.length > 0) {
            handoverAssets.set(category, [
              ...(handoverAssets.get(category) ?? []),
              ...assets.map((a) => a.id),
            ]);
          }
        }
      }
    }

    const scopeItems = await this.prisma.archiveScopeItem.findMany({ orderBy: { sortOrder: 'asc' } });
    const rows: ScopeMatchRow[] = [];

    for (const si of scopeItems) {
      let attachmentIds: string[] = [];
      let fileAssetIds: string[] = [];

      if (si.sourceType === 'attachment' || si.sourceType === 'manual') {
        // 仅按范围表指定阶段匹配；未指定阶段的 manual 项（异议/投诉等"其他"类）系统无从
        // 判定来源阶段，保持 MISSING 待人工在质检页补传确认，不借用其他阶段附件
        attachmentIds = si.stageKeys.flatMap((k) => (stageAttachments.get(k) ?? []).map((a) => a.id));
      } else if (si.sourceType === 'fileAsset') {
        fileAssetIds = si.fileCategories.flatMap((c) => handoverAssets.get(c) ?? []);
      }

      const matched = attachmentIds.length > 0 || fileAssetIds.length > 0;
      const status: ScopeRowStatus =
        matched ? 'MATCHED' : si.sourceType === 'generated' ? 'PENDING_GENERATED' : 'MISSING';

      // 阶段适配：范围项限定的阶段本项目不存在（如邀请采购无公告阶段）→ 不适用，不阻断
      const stageApplicable =
        si.stageKeys.length === 0 || si.stageKeys.some((k) => stageKeySet.has(k));
      rows.push({
        scopeItemId: si.id,
        code: si.code,
        stage: si.stage,
        materialName: si.materialName,
        sourceType: si.sourceType,
        isRequired: si.isRequired,
        status,
        attachmentIds,
        fileAssetIds,
        blocking: si.isRequired && si.sourceType === 'attachment' && !matched && stageApplicable,
      });

      // 元数据自动捕获（M22/M28/M32/M33）——仅对已命中件且尚无记录时 upsert
      if (opts.enrichMeta && matched) {
        await this.enrichMetadata(item, si, attachmentIds, fileAssetIds);
      }
    }

    return {
      rows,
      matchedCount: rows.filter((r) => r.status === 'MATCHED').length,
      requiredMissing: rows.filter((r) => r.blocking).map((r) => `${r.code} ${r.materialName}`),
    };
  }

  /** 自动捕获档案元数据（幂等：已有记录的附件跳过；缺项才补） */
  private async enrichMetadata(
    item: {
      id: string; title: string; projectCode: string | null;
      requesterName: string; requesterDepartment: string; awardedSupplier: string | null;
    },
    si: { id: string; materialName: string },
    attachmentIds: string[],
    fileAssetIds: string[],
  ): Promise<void> {
    const base = {
      title: `${item.title}·${si.materialName}`,
      responsibles: [item.requesterDepartment, item.requesterName].filter(Boolean),
      persons: item.awardedSupplier ? [item.awardedSupplier] : [],
      sourceModule: 'archive-enricher',
      autoCapturedAt: new Date(),
      scopeItemId: si.id,
    };
    try {
      for (const aid of attachmentIds) {
        const existing = await this.prisma.archiveMetadata.findUnique({ where: { attachmentId: aid } });
        if (!existing) {
          const att = await this.prisma.attachment.findUnique({ where: { id: aid }, select: { createdAt: true } });
          await this.prisma.archiveMetadata.create({
            data: { attachmentId: aid, ...base, formedAt: att?.createdAt ?? null },
          });
        }
      }
      for (const fid of fileAssetIds) {
        const existing = await this.prisma.archiveMetadata.findUnique({ where: { fileAssetId: fid } });
        if (!existing) {
          const fa = await this.prisma.fileAsset.findUnique({ where: { id: fid }, select: { createdAt: true } });
          await this.prisma.archiveMetadata.create({
            data: { fileAssetId: fid, ...base, formedAt: fa?.createdAt ?? null },
          });
        }
      }
    } catch (err) {
      // 元数据捕获失败不阻塞勾稽
      this.logger.warn(`归档元数据捕获失败 ${item.projectCode ?? item.id}: ${err}`);
    }
  }
}
