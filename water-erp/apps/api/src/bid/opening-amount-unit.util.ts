import { BadRequestException } from '@nestjs/common';
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
 * ① 记录自带单位戳（BidOpeningRecord.amountUnit，写入时落）优先；
 * ② 无戳回退按投递轨道推导：dual-v2 → '万元'；旧轨/无投递 → null（裸数字按旧语义「元」、带单位文本原文直出）。
 */
export async function resolveOpeningAmountUnitMap(
  prisma: PrismaService,
  projectId: string,
): Promise<Map<string, string | null>> {
  const [bidSuppliers, subs, stampedRows] = await Promise.all([
    prisma.bidSupplier.findMany({
      where: { projectId },
      select: { id: true, supplierId: true },
    }),
    prisma.supplierBidSubmission.findMany({
      where: { projectId },
      select: { supplierId: true, envelopeVersion: true },
    }),
    prisma.bidOpeningRecord.findMany({
      where: { projectId },
      select: { bidSupplierId: true, amountUnit: true },
    }),
  ]);
  // 防御：jest mock 缺省（undefined）不炸——回退推导路径
  const suppliers = Array.isArray(bidSuppliers) ? bidSuppliers : [];
  const submissions = Array.isArray(subs) ? subs : [];
  const stamped = Array.isArray(stampedRows) ? stampedRows : [];
  const dualSet = new Set(
    submissions.filter((s) => s.envelopeVersion === 'dual-v2').map((s) => s.supplierId),
  );
  const stampedByBs = new Map(
    stamped
      .filter((r) => r.amountUnit && r.bidSupplierId)
      .map((r) => [r.bidSupplierId as string, r.amountUnit as string]),
  );
  return new Map(
    suppliers.map((b) => [
      b.id,
      stampedByBs.get(b.id) ?? (b.supplierId && dualSet.has(b.supplierId) ? DUAL_V2_AMOUNT_UNIT : null),
    ]),
  );
}

const BARE_NUM_RE = /^[\d,]+(?:\.\d+)?$/;

/**
 * dual-v2 唱标录入单位闸（2026-09-14）：密封价（万元裸数字）与录入值同为裸数字、且录入值呈
 * 密封价×10000 形态 → 硬拦 400 PRICE_UNIT_SUSPECT。交叉容差（resolveExpectedInYuan）
 * 本会把这种录入当「同一报价」静默放行，落库后读端按万元解读再差一万倍——单位错录不是
 * 「主持人掌握更准信息」的判断题（轨道口径已知），不给确认绕行通道。
 * 仅拦 ×10000（主持人把万元换算成元录入——唯一无歧义的真实错误方向）；
 * ÷10000 方向存在合法歧义（供应商把元打进万元表单、主持人按万元正确录入），不拦，交 P1-4 正常比对。
 * 带单位文本（「153.95万元」）自描述、不拦；不可解析/缺密封价不拦（与 P1-4 语义对齐）。
 */
export function assertNoCrossUnitEntry(sealed: string | null | undefined, entered: string | number): void {
  const s = sealed == null ? '' : String(sealed).trim();
  const e = entered == null ? '' : String(entered).trim();
  if (!s || !e) return;
  if (!BARE_NUM_RE.test(s) || !BARE_NUM_RE.test(e)) return;
  const sn = Number(s.replace(/,/g, ''));
  const en = Number(e.replace(/,/g, ''));
  if (!Number.isFinite(sn) || !Number.isFinite(en) || sn <= 0) return;
  const near = (a: number, b: number) => Math.abs(a - b) <= Math.max(a, b) * 0.005;
  if (en > sn * 100 && near(en, sn * 10000)) {
    throw new BadRequestException({
      error: `录入报价 ${e} 与密封报价 ${s}（万元口径）相差一万倍——本项目唱标请按「万元」录入（如 ${s}），勿自行换算为元`,
      code: 'PRICE_UNIT_SUSPECT',
    });
  }
}
