/* =================================================================
   CaEvidenceService — 验签证据不可变记录（CaVerificationRecord）
   ================================================================= */
import { PrismaService } from '../prisma/prisma.service';
import { createHash } from 'crypto';
import type { VerificationOutcome } from './ca-verification.service';

export class CaEvidenceService {
  constructor(private readonly prisma: PrismaService) {}

  async record(input: {
    requestId: string;
    purpose: string;
    p7B64: string;
    toSign: string;
    outcome: VerificationOutcome;
    actorUserId?: string;
    subjectId?: string;
    bindingId?: string;
    protocolVersion?: string;
  }): Promise<string> {
    const p7Sha256 = createHash('sha256').update(input.p7B64, 'utf8').digest('hex');
    const toSignSha256 = createHash('sha256').update(input.toSign, 'utf8').digest('hex');
    const row = await this.prisma.caVerificationRecord.create({
      data: {
        requestId: input.requestId,
        provider: 'scca',
        protocolVersion: input.protocolVersion ?? 'signgw-v1',
        purpose: input.purpose,
        actorUserId: input.actorUserId ?? null,
        subjectId: input.subjectId ?? null,
        bindingId: input.bindingId ?? null,
        certFingerprint: input.outcome.signerSerialHex ?? '',
        toSignSha256,
        p7Sha256,
        result: input.outcome.ok ? 'ok' : (input.outcome.code ?? 'unknown'),
        statusCoverage: input.outcome.statusCoverage,
        checkedAt: new Date(),
      },
    });
    return row.id;
  }
}
