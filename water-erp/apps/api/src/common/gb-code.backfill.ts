import { GbCodeService } from './gb-code.service';

/** 回填行记录（scripts 复核清单 CSV 用） */
export interface GbBackfillRow {
  scope: 'PMI' | 'BidProject';
  name: string;
  bizCode: string;
  gbCode: string;
  note: string;
}

/**
 * 存量国标编码回填（对接专项 Phase 1 T2；2026-10-19 收口为 seed 尾部自动步骤）。
 *
 * 真因：种子 JSON 直载绕过 API 创建路径的 GbCodeService 分配 → 每次重灌库后
 * PMI/BidProject 编码归零，发布赋码闸（announcement.assertGbCodeIfLinked）会把
 * 关联项目的公告发布全部拦下（GB_CODE_REQUIRED，2026-10-19 实录 28/28 全空）。
 *
 * 幂等：已有码跳过（where: 码 IS NULL）。内部链接口径：
 *   PMI 18 位基码 ← BidProject 21 位采购编码（有宿主复用其基码，无宿主自立）
 * seed 尾部（execute=true 恒写）与 scripts/backfill-gb-codes.ts（dry-run 默认）共用本函数。
 */
export async function backfillGbCodes(
  prisma: any,
  gb: GbCodeService,
  options: { execute?: boolean } = {},
): Promise<GbBackfillRow[]> {
  const { execute = true } = options;
  const rows: GbBackfillRow[] = [];

  // 1) PMI 18 位项目编码
  const pmis = await prisma.projectManagementItem.findMany({
    where: { gbProjectCode: null },
    select: { id: true, title: true },
    orderBy: { createdAt: 'asc' },
  });
  for (const pmi of pmis) {
    const code = await gb.allocateProjectCode();
    rows.push({ scope: 'PMI', name: pmi.title, bizCode: pmi.id, gbCode: code, note: '18 位项目编码（自分配基码）' });
    if (execute) await prisma.projectManagementItem.update({ where: { id: pmi.id }, data: { gbProjectCode: code } });
  }

  // 2) BidProject 21 位采购编码（有 PMI 宿主复用其 18 位；无宿主自立）
  const bids = await prisma.bidProject.findMany({
    where: { gbProcureCode: null },
    select: { id: true, name: true, projectCode: true, projectManagementItemId: true },
    orderBy: { createdAt: 'asc' },
  });
  for (const bp of bids) {
    const host = bp.projectManagementItemId
      ? await prisma.projectManagementItem.findUnique({ where: { id: bp.projectManagementItemId }, select: { gbProjectCode: true } })
      : null;
    const { gbProcureCode, gbSectionCode } = await gb.allocateProcureCode(host?.gbProjectCode ?? null);
    rows.push({
      scope: 'BidProject', name: bp.name, bizCode: bp.projectCode, gbCode: gbProcureCode,
      note: `21 位采购编码（${host?.gbProjectCode ? 'PMI 宿主基码' : '自立基码'}）/ 标段码 ${gbSectionCode}`,
    });
    if (execute) await prisma.bidProject.update({ where: { id: bp.id }, data: { gbProcureCode, gbSectionCode } });
  }
  return rows;
}
