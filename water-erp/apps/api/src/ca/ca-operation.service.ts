/* =================================================================
   CaOperationService — CA 操作持久状态机
   PREPARED → VERIFYING → COMMITTED | FAILED / EXPIRED / CANCELLED
   登录场景 subjectId 初始 null → COMMITTED 时写入。
   ================================================================= */
import { PrismaService } from '../prisma/prisma.service';
import { ConflictException, Injectable, Inject } from '@nestjs/common';
import { CA_OP_STATUS } from './ca-operation';

@Injectable()
export class CaOperationService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async create(p: { subjectType: string; subjectId?: string; purpose: string; payloadHash: string; challengeId?: string }): Promise<string> {
    const op = await this.prisma.caOperation.create({
      data: {
        subjectType: p.subjectType,
        subjectId: p.subjectId ?? null,
        purpose: p.purpose,
        payloadHash: p.payloadHash,
        status: CA_OP_STATUS.PREPARED,
        challengeId: p.challengeId ?? null,
      },
    });
    return op.id;
  }

  async toVerifying(id: string): Promise<void> {
    await this.prisma.caOperation.update({
      where: { id }, data: { status: CA_OP_STATUS.VERIFYING },
    });
  }

  async toCommitted(id: string, result: Record<string, unknown>, subjectId?: string): Promise<void> {
    await this.prisma.caOperation.update({
      where: { id },
      data: {
        status: CA_OP_STATUS.COMMITTED,
        result: result as any,
        ...(subjectId !== undefined ? { subjectId } : {}),
      },
    });
  }

  /** Task3：冻结签名原文到 operation（PREPARED/VERIFYING 阶段可覆盖，COMMITTED 后不可变） */
  async attachPayload(id: string, canonical: string, sha256: string): Promise<void> {
    const op = await this.prisma.caOperation.findUnique({ where: { id } });
    if (!op || op.status === 'COMMITTED') {
      throw new ConflictException({ error: '操作不存在或已提交', code: 'OPERATION_STATE_INVALID' });
    }
    await this.prisma.caOperation.update({
      where: { id },
      data: { result: { canonical, canonicalSha256: sha256 } as any, status: 'PAYLOAD_READY' },
    });
  }

  async toFailed(id: string, reason: string): Promise<void> {
    await this.prisma.caOperation.update({
      where: { id },
      data: { status: CA_OP_STATUS.FAILED, result: { reason: reason as any } },
    });
  }

  async findById(id: string) {
    return this.prisma.caOperation.findUnique({ where: { id } });
  }

  /** 幂等查询：COMMITTED 重发返回既有结果 */
  async queryResult(id: string): Promise<{ status: string; result: unknown; subjectId: string | null } | null> {
    const op = await this.prisma.caOperation.findUnique({ where: { id } });
    if (!op) return null;
    return { status: op.status, result: op.result, subjectId: op.subjectId };
  }
}
