// apps/api/src/ai-bid-analysis/services/system-data-aggregator.service.ts
// 系统结构化数据聚合（方案 2.2 数据优先级 + 第七章 ConcordanceVerifier 数据源）
// 从 ERP 多表聚合权威源：BidOpeningRecord(唱标) > SupplierBidSubmission(表单) > 标书 OCR
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { openField } from '../../common/crypto/field-crypto';
import type { SystemData } from '../types';

@Injectable()
export class SystemDataAggregatorService {
  constructor(private prisma: PrismaService) {}

  /** 聚合某投标单位（BidSupplier）的系统结构化数据 */
  async aggregate(bidSupplierId: string): Promise<SystemData> {
    const bs = await this.prisma.bidSupplier.findUnique({
      where: { id: bidSupplierId },
      include: {
        supplier: { include: { qualifications: true, contacts: true } },
      },
    });
    if (!bs) {
      throw new NotFoundException(`BidSupplier ${bidSupplierId} not found`);
    }

    // 开标唱标记录（权威：报价/工期）—— bidSupplierId 可空，按它匹配
    const openingRecord = await this.prisma.bidOpeningRecord.findFirst({
      where: { bidSupplierId },
    });

    // 供应商提交记录（备选：表单报价/工期）—— supplierId 可空时跳过
    const submission = bs.supplierId
      ? await this.prisma.supplierBidSubmission.findUnique({
          where: {
            supplierId_projectId: {
              supplierId: bs.supplierId,
              projectId: bs.projectId,
            },
          },
        })
      : null;

    const supplier = bs.supplier;

    // 双信封新轨（dual-v2）报价/唱标金额以「万元」为单位入库；旧轨以「元」入库。
    // ConcordanceVerifier.normalizePriceYuan 对裸数字一律 ÷10000 按元处理——
    // dual-v2 的万元数值会被误除一万倍（148.65 → 0.014865 万元），报价一致性恒判冲突、
    // PRICE 项被方案 7.3 置 0（2026-09-10 实测 3 家 AI 投标分析全部 0 分）。带「万元」后缀走原值分支。
    const isDualV2 = submission?.envelopeVersion === 'dual-v2';
    const fmtAmount = (v: string | number | null | undefined): string | null =>
      v == null ? null : (isDualV2 ? `${v}万元` : String(v));

    return {
      // 报价：开标唱标（权威）> 表单提交
      // 本服务仅由 ai-bid-analysis worker 在评标阶段（已开标解密后）调用 → post-decrypt，安全拆封。
      // bidPrice 入库已密封，openField 还原；旧明文行经 legacy 兼容。
      openingAmount: fmtAmount(openingRecord?.amount ?? null),
      submissionPrice: submission?.bidPrice ? fmtAmount(openField(submission.bidPrice, process.env.KMS_SECRET!)) : null,
      // 工期：开标唱标 > 表单提交
      openingPeriod: openingRecord?.period ?? null,
      submissionPeriod: submission?.deliveryPeriod ?? null,
      // 企业主体（已审批）
      legalPerson: supplier?.legalPerson ?? null,
      creditCode: supplier?.creditCode ?? null,
      // 资质（已审核证书，name 含等级，ConcordanceVerifier 正则解析）
      qualifications: supplier?.qualifications ?? [],
      // 联系方式（注册核验，email 可空）
      contacts: supplier?.contacts ?? [],
    };
  }
}
