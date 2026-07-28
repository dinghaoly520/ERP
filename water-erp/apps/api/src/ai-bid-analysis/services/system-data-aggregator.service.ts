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

    return {
      // 报价：开标唱标（权威）> 表单提交
      // 本服务仅由 ai-bid-analysis worker 在评标阶段（已开标解密后）调用 → post-decrypt，安全拆封。
      // bidPrice 入库已密封，openField 还原；旧明文行经 legacy 兼容。
      openingAmount: openingRecord?.amount ?? null,
      submissionPrice: submission?.bidPrice ? openField(submission.bidPrice, process.env.KMS_SECRET!) : null,
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
