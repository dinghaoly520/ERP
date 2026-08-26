import { GB_ARCHIVE_CATEGORIES } from '@water-erp/shared';
import type { Prisma } from '@prisma/client';

type Tx = Prisma.TransactionClient | PrismaServiceLike;

interface PrismaServiceLike {
  projectManagementItem: any;
  announcement: any;
  bidDocument: any;
  supplierBidSubmission: any;
  awardLetterDelivery: any;
  contract: any;
  contractFulfillment: any;
  supplierObjection: any;
  bidArchiveItem: any;
}

export interface ArchiveTemplateRow {
  key: string;
  name: string;
  hint: string;
  satisfied: boolean;
  /** 满足来源说明（"已匹配归档项：开标记录表" / "系统数据：已签署合同 HT-…"） */
  detail?: string;
  /** 人工登记入口（manual 或 data 缺失时可用） */
  manual: boolean;
}

/**
 * D1（GB/T 43711 4.1.5.1）：项目档案对标标准 13 类的满足度。
 * 线上自动材料按数据存在性判定；manual 类与数据缺失类可经
 * POST /bid/projects/:id/archive-manual-item 人工登记（FileAsset 带 hash 入档）。
 */
export async function buildArchiveTemplate(
  db: Tx,
  project: { id: string; projectCode: string; projectManagementItemId: string | null },
): Promise<ArchiveTemplateRow[]> {
  const [
    pmi, notice, preWin, win, bidDoc, submissions, letters, contracts, acceptances, objections, items,
  ] = await Promise.all([
    project.projectManagementItemId
      ? db.projectManagementItem.findUnique({ where: { id: project.projectManagementItemId }, select: { projectCode: true } })
      : null,
    db.announcement.findFirst({ where: { relatedProjectCode: project.projectCode, type: 'BID_NOTICE' }, select: { id: true } }),
    db.announcement.findFirst({ where: { relatedProjectCode: project.projectCode, type: 'PRE_WIN_NOTICE' }, select: { id: true } }),
    db.announcement.findFirst({ where: { relatedProjectCode: project.projectCode, type: { in: ['WIN_NOTICE', 'PRE_WIN_NOTICE'] } }, select: { id: true } }),
    db.bidDocument.findFirst({ where: { bidProjectId: project.id }, select: { title: true } }),
    db.supplierBidSubmission.findMany({ where: { projectId: project.id }, select: { id: true }, take: 1 }),
    db.awardLetterDelivery.findMany({ where: { projectId: project.id }, select: { supplierName: true }, take: 1 }),
    db.contract.findMany({ where: { projectId: project.id, status: { in: ['signed', 'performing', 'accepted'] } }, select: { contractCode: true }, take: 1 }),
    db.contractFulfillment.findMany({ where: { type: 'acceptance', status: 'done', contract: { projectId: project.id } }, select: { id: true }, take: 1 }),
    db.supplierObjection.findMany({ where: { projectId: project.id }, select: { id: true }, take: 1 }),
    db.bidArchiveItem.findMany({ where: { projectId: project.id }, select: { name: true, gbCategory: true } }),
  ]);

  const itemNames = new Set(items.map(i => i.name));
  const gbMarked = new Set(items.map(i => i.gbCategory).filter(Boolean));

  const dataSatisfied: Record<string, { ok: boolean; detail?: string }> = {
    plan: { ok: !!pmi, detail: pmi ? `立项台账 ${pmi.projectCode}` : undefined },
    notice: { ok: !!notice, detail: notice ? '采购公告已发布' : undefined },
    prequal: { ok: gbMarked.has('prequal') },
    document: { ok: !!bidDoc, detail: bidDoc?.title },
    response: { ok: submissions.length > 0, detail: submissions.length > 0 ? '响应文件已递交' : undefined },
    opening: { ok: itemNames.has('开标记录表') },
    evaluation: { ok: itemNames.has('评标结果汇总') || itemNames.has('评标签字包') },
    pre_win: { ok: !!preWin || !!win, detail: preWin ? '预成交公示已生成' : win ? '存量公示/成交公告' : undefined },
    win: { ok: !!win, detail: win ? '成交公告已发布' : undefined },
    award_letter: { ok: letters.length > 0, detail: letters[0]?.supplierName },
    contract: { ok: contracts.length > 0, detail: contracts[0]?.contractCode },
    acceptance: { ok: acceptances.length > 0, detail: acceptances.length > 0 ? '验收节点已完成' : undefined },
    dispute: { ok: gbMarked.has('dispute') || objections.length > 0, detail: objections.length > 0 ? '异议工单记录' : undefined },
  };

  return GB_ARCHIVE_CATEGORIES.map(cat => {
    const d = dataSatisfied[cat.key] ?? { ok: false };
    return {
      key: cat.key,
      name: cat.name,
      hint: cat.hint,
      satisfied: !!d.ok,
      detail: d.detail,
      manual: cat.satisfy === 'manual' || !d.ok,
    };
  });
}
