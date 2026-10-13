/* =================================================================
   CaEligibilityService — 绑定资格门禁（阶段1 Task8）
   前置功能闸（CA_BINDING_ENABLED + 试点白名单）+ 业务资格 + 在途门禁
   ================================================================= */
import { Injectable, ConflictException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { loadCaConfig } from './ca.module';

export interface EligibilityResult {
  eligible: boolean;
  reason?: string;
  code?: string;
  affectedItems?: Array<{ projectId: string; submissionId?: string; action: string; reason: string }>;
}

@Injectable()
export class CaEligibilityService {
  constructor(private readonly prisma: PrismaService) {}

  /** 绑定/换绑/解绑共用——按主体历史扫描在途业务 */
  async assertBindEligible(supplierId: string, userId: string): Promise<void> {
    // ── 功能闸 ──
    const cfg = loadCaConfig();
    if (!cfg.CA_BINDING_ENABLED) {
      throw new ForbiddenException({ error: 'CA 绑定功能未开放', code: 'CA_BINDING_DISABLED' });
    }
    if (cfg.CA_PILOT_SUBJECT_IDS.length > 0 && !cfg.CA_PILOT_SUBJECT_IDS.includes(supplierId)) {
      throw new ForbiddenException({ error: '试点阶段仅白名单供应商可用', code: 'CA_PILOT_ONLY' });
    }

    // ── 业务资格 ──
    const supplier = await this.prisma.supplier.findUnique({
      where: { id: supplierId },
      include: { user: { select: { isActive: true, isFrozen: true } } },
    });
    if (!supplier) throw new ForbiddenException({ error: '供应商不存在', code: 'SUPPLIER_NOT_FOUND' });
    if (!supplier.user?.isActive) throw new ForbiddenException({ error: '账号未激活', code: 'ACCOUNT_PENDING' });
    if (supplier.user?.isFrozen) throw new ForbiddenException({ error: '账号已被冻结', code: 'ACCOUNT_FROZEN' });
    if (supplier.status !== 'APPROVED') throw new ForbiddenException({ error: '供应商未审核通过', code: 'ACCOUNT_PENDING' });
    if (supplier.isTemporary && supplier.temporaryExpiresAt && supplier.temporaryExpiresAt < new Date()) {
      throw new ForbiddenException({ error: '临时供应商有效期已过', code: 'TEMPORARY_EXPIRED' });
    }

    // ── 在途门禁（解绑共用）：raw SQL 扫描（Json 字段/新列不走 typed where）──
    const affectedItems: EligibilityResult['affectedItems'] = [];
    // ① 待签回执（SupplierBidSubmission.receiptSignature Json 空）
    const pendingReceipts = await this.prisma.$queryRaw<Array<{ id: string; projectId: string }>>`
      SELECT "id", "projectId" FROM "SupplierBidSubmission"
      WHERE "supplierId" = ${supplierId} AND "status" = 'submitted'
        AND "receiptSignature" IS NULL
      LIMIT 20`;
    for (const r of pendingReceipts) {
      affectedItems.push({ projectId: r.projectId, submissionId: r.id, action: 'receipt', reason: '回执未签署' });
    }
    // ② 开标确认未闭环（BidOpeningRecord.confirmSignature 空，经 BidSupplier 关联到供应商）
    const pendingConfirms = await this.prisma.$queryRaw<Array<{ id: string; projectId: string }>>`
      SELECT b."projectId", b."bidSupplierId" as id FROM "BidOpeningRecord" b
      JOIN "BidSupplier" bs ON bs.id = b."bidSupplierId"
      WHERE bs."supplierId" = ${supplierId} AND b."confirmSignature" IS NULL
      LIMIT 20`;
    for (const r of pendingConfirms) {
      affectedItems.push({ projectId: r.projectId, submissionId: r.id, action: 'opening-confirm', reason: '开标确认未完成' });
    }

    if (affectedItems.length > 0) {
      throw new ConflictException({
        error: `存在在途业务（${affectedItems.length} 项待办），须先完成后再切换证书`,
        code: 'CERT_DEPENDENCIES_PENDING',
        // details 白名单：HttpExceptionFilter 需扩展（Task 8 内）
      });
    }
  }
}
