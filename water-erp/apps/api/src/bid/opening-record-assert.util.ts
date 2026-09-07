import { ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { openField } from '../common/crypto/field-crypto';
import { isPeriodMismatch, isPriceMismatch, resolveExpectedInYuan } from './opening-compare.util';

/**
 * 唱标录入校验（F1c 抽取）——自 bid.service.ts 私有方法提为纯函数（仅 this.prisma → 首参 prisma，其余逐字）。
 * F1c（开标记录域 enterOpeningRecord）/ F1d（解密域 decryptSupplier）两域共用，勿在单侧内联复制。
 */

/**
 * P1-4：唱标金额与供应商密封报价（supplierBidSubmission.bidPrice，v1: 密封可逆）比对。
 * 不一致且未显式确认 → 409 PRICE_MISMATCH（附 expected/entered 供前端弹确认）；
 * 密封价缺失/旧明文/不可解析 → 不校验（向后兼容）。返回不一致说明供监督日志拼接（一致时 null）。
 */
export async function assertPriceMatchesSealed(
  prisma: PrismaService,
  projectId: string,
  bidSupplierId: string,
  amount: string | number,
  confirmed?: boolean,
): Promise<string | null> {
  const bs = await prisma.bidSupplier.findUnique({ where: { id: bidSupplierId }, select: { supplierId: true } });
  if (!bs?.supplierId) return null;
  const sub = await prisma.supplierBidSubmission.findUnique({
    where: { supplierId_projectId: { supplierId: bs.supplierId, projectId } },
    select: { bidPrice: true, envelopeVersion: true, decryptedPrice: true },
  });
  // P1-4（dual-v2 新轨，Task 13）：期望值取 decryptedPrice——供应商解密上传时经 fieldsCommit
  // 承诺验证落库的报价（新轨投递 bidPrice 列恒 null，读旧列会跳过校验成漏洞）；
  // 旧轨读 openField(sealed bidPrice)。decryptedPrice 缺失（供应商未完成解密上传）→
  // 不校验（与密封价缺失同语义，唱标节奏与「未解密不可唱标」一致）。
  const sealed = sub
    ? (sub.envelopeVersion === 'dual-v2'
        ? (sub.decryptedPrice ?? null)
        : (sub.bidPrice ? openField(sub.bidPrice, process.env.KMS_SECRET!) : null))
    : null;
  if (sealed == null) return null;
  // P1-13 归一 + 容差比对统一走 opening-compare.util（供应商端回显同源）
  const expectedInYuan = resolveExpectedInYuan(sealed, amount);
  if (isPriceMismatch(expectedInYuan, amount)) {
    if (!confirmed) {
      throw new ConflictException({
        error: `录入报价 ${Number(String(amount).replace(/,/g, ''))} 与投标文件密封报价 ${expectedInYuan} 不一致；如确认以录入值为准，请勾选「确认按录入值唱标」后重试`,
        code: 'PRICE_MISMATCH',
        expected: expectedInYuan,
        entered: Number(String(amount).replace(/,/g, '')),
      });
    }
    return `（与密封报价 ${expectedInYuan} 不一致，主持人确认按录入值唱标）`;
  }
  return null;
}

/**
 * 工期一致性校验（P1-4 同构，2026-08-17）：唱标录入工期与投递提交工期（deliveryPeriod 明文）
 * 去空白后精确比对，不一致且未显式确认 → 409 PERIOD_MISMATCH（附 expected/entered 供前端弹确认）；
 * 投递无工期（legacy）→ 不校验。返回不一致说明供监督日志拼接（一致时 null）。
 */
export async function assertPeriodMatchesSubmitted(
  prisma: PrismaService,
  projectId: string,
  bidSupplierId: string,
  period: string,
  confirmed?: boolean,
): Promise<string | null> {
  const bs = await prisma.bidSupplier.findUnique({ where: { id: bidSupplierId }, select: { supplierId: true } });
  if (!bs?.supplierId) return null;
  const sub = await prisma.supplierBidSubmission.findUnique({
    where: { supplierId_projectId: { supplierId: bs.supplierId, projectId } },
    select: { deliveryPeriod: true },
  });
  if (!sub?.deliveryPeriod || !isPeriodMismatch(sub.deliveryPeriod, period)) return null;
  if (!confirmed) {
    throw new ConflictException({
      error: `录入工期 ${period} 与投标文件投递工期 ${sub.deliveryPeriod} 不一致；如确认以录入值为准，请勾选「确认按录入值唱标」后重试`,
      code: 'PERIOD_MISMATCH',
      expected: sub.deliveryPeriod,
      entered: period,
    });
  }
  return `（与投递工期 ${sub.deliveryPeriod} 不一致，主持人确认按录入值唱标）`;
}
