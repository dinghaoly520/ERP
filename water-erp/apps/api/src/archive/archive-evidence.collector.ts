// apps/api/src/archive/archive-evidence.collector.ts
/**
 * 开评标证据件单一取件源（2026-09-22 审查 P1-1）：
 * 四性检测（archive-check）/ ASIP 导出（archive-export）/ 范围勾稽（archive-scope）
 * 三处共用的 FileAsset 收集逻辑——此前检测清单（3 类）与导出清单（8 类）漂移，
 * 回流包/签字扫描/AI 报告等 5 类证据件零检测。改本文件 = 三端同步，禁止在别处另建清单。
 */
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/** 2026-09-18：归档取件类目——key 含项目 ID 的开评标留痕件按类目+key 前缀取；
 * key 不含项目 ID 的（uploads/{date}/{random}、reports/{taskId}/…）走引用 id 取件，不得混入此清单 */
export const ARCHIVE_PICKUP_CATEGORIES = [
  'bid_opening_handover', 'bid_sign_packet', 'bid_decrypted',
  'bid_evaluation_sign_handover', 'sign_packet_signature_page', 'expert_sign_scan',
  'opening_sign_page', 'opening_sign_scan', // 2026-09-18 补：P1-3①A 开标记录签字页/开标签字扫描（key=opening-sign-*/${projectId}.*）
] as const;

/** 取件分页大小（2026-09-20 审查修复：原 take:200 无截断检测会静默丢件） */
export const HANDOVER_PICKUP_PAGE_SIZE = 200;

/** 分页全取 FileAsset：orderBy id 保证翻页稳定，页不满即穷尽（防 take 截断产出缺件残包） */
export async function fetchAllPaged<TArgs extends { skip?: number; take?: number }, T>(
  finder: (args: TArgs) => Promise<T[]>,
  args: Omit<TArgs, 'skip' | 'take' | 'orderBy'>,
): Promise<T[]> {
  const out: T[] = [];
  let skip = 0;
  for (;;) {
    const page = await finder({ ...args, orderBy: { id: 'asc' }, skip, take: HANDOVER_PICKUP_PAGE_SIZE } as unknown as TArgs);
    out.push(...page);
    if (page.length < HANDOVER_PICKUP_PAGE_SIZE) break;
    skip += HANDOVER_PICKUP_PAGE_SIZE;
  }
  return out;
}

export interface EvidenceAssetRow {
  id: string;
  key: string;
  originalName: string | null;
  category: string | null;
  sha256: string | null;
}

/** 引用件来源行形状（与归档导出侧五源查询对齐） */
export interface EvidenceRefSources {
  memoInks: Array<{ inkFileId: string | null }>;
  experts: Array<{ signScanFileId: string | null; signInMeta: unknown }>;
  packet: { fileAssetId: string | null; signPageScanFileId: string | null; handoverFileAssetId: string | null } | null;
  clarifications: Array<{ fileAssetId: string | null; replyAttachmentIds: unknown }>;
  aiReport: { docxFileId: string | null; pdfFileId: string | null } | null;
}

/** 引用件 id 提取（纯函数）：笔迹图/签字扫描/签到照（藏 signInMeta）/签字包三资产/澄清附件/AI 报告 */
export function extractEvidenceRefIds(sources: EvidenceRefSources): Set<string> {
  const ids = new Set<string>();
  sources.memoInks.forEach(m => m.inkFileId && ids.add(m.inkFileId));
  sources.experts.forEach(e => {
    if (e.signScanFileId) ids.add(e.signScanFileId);
    const photoId = (e.signInMeta as { photoAssetId?: unknown } | null)?.photoAssetId; // 签到拍照留痕引用藏在 signInMeta 内
    if (typeof photoId === 'string') ids.add(photoId);
  });
  if (sources.packet) [sources.packet.fileAssetId, sources.packet.signPageScanFileId, sources.packet.handoverFileAssetId]
    .forEach((x: string | null) => x && ids.add(x));
  sources.clarifications.forEach(c => {
    if (c.fileAssetId) ids.add(c.fileAssetId);
    for (const a of ((c.replyAttachmentIds as Array<{ fileAssetId?: unknown }> | null) ?? [])) {
      if (a && typeof a.fileAssetId === 'string') ids.add(a.fileAssetId);
    }
  });
  if (sources.aiReport) [sources.aiReport.docxFileId, sources.aiReport.pdfFileId]
    .forEach((x: string | null) => x && ids.add(x));
  return ids;
}

export interface CollectedEvidence {
  assets: EvidenceAssetRow[];
  refIds: Set<string>;
  /** 引用悬空（FileAsset 无行）——检测端记 FAIL，导出端整体拒绝 */
  missingRefIds: string[];
}

/** 单个 BidProject 的全部归档证据件：精确 key 包 + 类目取件 + 引用 id 取件，去重合一 */
export async function collectBidEvidenceAssets(prisma: PrismaService, bpId: string): Promise<CollectedEvidence> {
  const [memoInks, experts, packet, clarifications, aiTask] = await Promise.all([
    prisma.expertMemo.findMany({ where: { projectId: bpId }, select: { inkFileId: true } }),
    prisma.bidExpert.findMany({ where: { projectId: bpId }, select: { signScanFileId: true, signInMeta: true } }),
    prisma.bidSignPacket.findUnique({ where: { projectId: bpId }, select: { fileAssetId: true, signPageScanFileId: true, handoverFileAssetId: true } }),
    prisma.bidClarification.findMany({ where: { projectId: bpId }, select: { fileAssetId: true, replyAttachmentIds: true } }),
    prisma.aiBidAnalysisTask.findUnique({ where: { projectId: bpId }, select: { report: { select: { docxFileId: true, pdfFileId: true } } } }),
  ]);
  const refIds = extractEvidenceRefIds({
    memoInks, experts, packet,
    clarifications, aiReport: aiTask?.report ?? null,
  });
  const assets = await fetchAllPaged(
    (a: Prisma.FileAssetFindManyArgs) => prisma.fileAsset.findMany(a),
    {
      where: {
        OR: [
          { key: `bid-evaluation-handover/${bpId}.json` },
          { key: { contains: bpId }, category: { in: [...ARCHIVE_PICKUP_CATEGORIES] } },
          { id: { in: [...refIds] } },
        ],
      },
      select: { id: true, key: true, originalName: true, category: true, sha256: true },
    },
  );
  const found = new Set(assets.map(a => a.id));
  return { assets, refIds, missingRefIds: [...refIds].filter(id => !found.has(id)) };
}
