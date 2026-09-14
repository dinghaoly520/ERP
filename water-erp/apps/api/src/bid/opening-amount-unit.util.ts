import { PrismaService } from '../prisma/prisma.service';

/**
 * 唱标金额单位解析（2026-09-14，单一来源）。
 *
 * 数据现实：BidOpeningRecord.amount 是主持人自由文本——dual-v2（双信封新轨）投递报价
 * 以**万元**入库（投标表单口径，decryptedPrice 裸数字），旧轨以元/带单位自由文本入库。
 * 单位隐含在 SupplierBidSubmission.envelopeVersion 里，任何读取端若不解析就会把
 * 「153.95（万元）」当「153.95 元」渲染（2026-09-11 主持端实测、2026-09-14 供应商端复现）。
 *
 * 本文件是该事实的唯一换算入口：所有读取/换算 BidOpeningRecord.amount（或 dual-v2
 * decryptedPrice）的端点必须经 resolveOpeningAmountUnitMap 取单位标记，禁止各自内联推导。
 */

/** dual-v2 投递/唱标金额的入库单位（与投标表单「报价金额（万元）」口径一致） */
export const DUAL_V2_AMOUNT_UNIT = '万元';

/**
 * 证据/纸面渲染（2026-09-14）：dual-v2 万元裸数字补单位后缀直出（「153.95 万元」）；
 * 带单位文本（「1150万元」）与不可解析自由文本（「面议」）原文直出。
 * 签字包 PDF / 开标文件包 / 归档 CSV 等法定证据件一律经此渲染——纸面金额必须自含单位。
 */
export function formatAmountWithUnit(amount: string | null | undefined, unit: string | null | undefined): string {
  const s = amount == null ? '' : String(amount).trim();
  if (unit === DUAL_V2_AMOUNT_UNIT && /^[\d,]+(?:\.\d+)?$/.test(s)) return `${s} ${DUAL_V2_AMOUNT_UNIT}`;
  return s;
}

/**
 * 解析项目内各投标记录（BidSupplier.id）的唱标金额单位：
 * 投递为 dual-v2 → '万元'；旧轨/无投递 → null（裸数字按旧语义「元」、带单位文本原文直出）。
 */
export async function resolveOpeningAmountUnitMap(
  prisma: PrismaService,
  projectId: string,
): Promise<Map<string, string | null>> {
  const bidSuppliers = await prisma.bidSupplier.findMany({
    where: { projectId },
    select: { id: true, supplierId: true },
  });
  const supplierIds = bidSuppliers.map((b) => b.supplierId).filter((x): x is string => !!x);
  const subs = supplierIds.length > 0
    ? await prisma.supplierBidSubmission.findMany({
        where: { projectId, supplierId: { in: supplierIds } },
        select: { supplierId: true, envelopeVersion: true },
      })
    : [];
  const dualSet = new Set(subs.filter((s) => s.envelopeVersion === 'dual-v2').map((s) => s.supplierId));
  return new Map(bidSuppliers.map((b) => [b.id, b.supplierId && dualSet.has(b.supplierId) ? DUAL_V2_AMOUNT_UNIT : null]));
}
