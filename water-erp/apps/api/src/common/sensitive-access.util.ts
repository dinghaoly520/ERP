import { Logger } from '@nestjs/common';

/* =================================================================
   敏感字段明文揭示审计（等保三级+密评：解密访问留痕）

   与 OperationLog（全量操作日志）分层：本表只记「人看了谁的明文 PII」，
   低频高敏，供密评答辩与事后追溯。写入失败不阻断揭示主流程（warn 可观测）。
   ================================================================= */

const logger = new Logger('SensitiveAccess');

export interface RevealActor {
  sub: string;
  displayName?: string;
}

/** 记一条明文揭示审计（SensitiveAccessLog，append-only） */
export async function logSensitiveAccess(
  prisma: { sensitiveAccessLog: { create: (args: unknown) => Promise<unknown> } },
  actor: RevealActor | undefined,
  entity: string,
  targetId: string,
  field: string,
  ip?: string,
): Promise<void> {
  if (!actor?.sub) return; // 无操作人（系统动作）不记
  try {
    await prisma.sensitiveAccessLog.create({
      data: {
        actorUserId: actor.sub,
        actorName: actor.displayName ?? null,
        entity,
        targetId,
        field,
        ip: ip ?? null,
      },
    });
  } catch (err) {
    logger.warn(`揭示审计写入失败 [${entity}/${field}] target=${targetId}: ${(err as Error)?.message ?? err}`);
  }
}
