import { BadRequestException, ConflictException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

export type BidStage = 'DOWNLOAD' | 'SUBMIT' | 'OPENING' | 'EVALUATING' | 'ARCHIVED' | 'ABORTED';

const STAGE_ORDER: Record<BidStage, number> = {
  DOWNLOAD: 0,
  SUBMIT: 1,
  OPENING: 2,
  EVALUATING: 3,
  ARCHIVED: 4,
  ABORTED: 5,
};

/**
 * 校验招标阶段流转是否合法（单向棘轮语义）。
 *
 * 2026-07 重构：原相邻白名单状态机弱化为**单向进度标记**——
 * - 同阶段 (from === to) 幂等放行
 * - 只许前进，允许跳步（DOWNLOAD→OPENING、OPENING→ARCHIVED 均合法）
 * - 回退或离开 ARCHIVED 抛 409 ConflictException（ARCHIVED 作 from 时天然终态）
 *
 * 阶段推进由 :3005 采购管理工作台统一驱动；实质准入闸门下沉到各端点
 * 业务前置（投递=OPENING 前+截止前+公告已发布；解密=OPENING+解密窗口内）。
 */
export function assertBidStageTransition(from: BidStage, to: BidStage): void {
  if (from === to) return;
  // 流标后归档是合法终局操作（AbortDialog: abort → archive）
  if (from === 'ABORTED' && to === 'ARCHIVED') return;
  if (STAGE_ORDER[to] < STAGE_ORDER[from]) {
    throw new ConflictException(`非法招标阶段流转：${from} -> ${to}（只允许前进，ARCHIVED 为终态）`);
  }
}

/** 判断 stage 是否已达到 min（含）之后——棘轮语义的阶段下限比较，供端点业务前置使用（如归档守卫）。 */
export function stageAtLeast(stage: BidStage, min: BidStage): boolean {
  return STAGE_ORDER[stage] >= STAGE_ORDER[min];
}

/**
 * 事务内行锁 + 阶段复查（自 bid.service.ts 抽取共享）。
 * FOR UPDATE 锁 BidProject 行，防并发流转偷跑；assertBidStageTransition 保证单向棘轮。
 */
export async function lockAndReassertStage(
  tx: Prisma.TransactionClient,
  id: string,
  target: BidStage,
): Promise<{ stage: BidStage; name: string }> {
  await tx.$queryRaw`SELECT id FROM "BidProject" WHERE id = ${id} FOR UPDATE`;
  const fresh = await tx.bidProject.findUnique({ where: { id }, select: { stage: true, name: true } });
  if (!fresh) throw new BadRequestException({ error: '项目不存在', code: 'NOT_FOUND' });
  assertBidStageTransition(fresh.stage, target);
  return fresh;
}

/** 归档签字闸门的包形状（只取闸门所需两列，避免与 BidSignPacket 全模型耦合） */
export interface SignGatePacketLike {
  closedAt: Date | null;
  handoverFileAssetId: string | null;
}

/**
 * 完整归档签字闸门（spec §7）：
 * 完整归档 = 签字包已生成 + 全员正选签字闭环 + 评标回流包已生成；
 * 开标归档（流标/废标）不受签字闸门约束。
 * 未签专家名单嵌入 error 文案——HttpExceptionFilter 固定 5 键、不透传 detail。
 */
export function assertSignGateClosed(
  scope: 'opening' | 'full',
  packet: SignGatePacketLike | null,
  pendingExpertNames: string[],
): void {
  if (scope !== 'full') return; // 开标归档（流标/废标）不受签字闸门约束
  if (!packet) throw new ConflictException({ error: '评标签字包未生成，无法执行完整归档。请在 :3007 生成签字包并完成专家签字登记。', code: 'SIGN_PACKET_NOT_GENERATED' });
  if (!packet.closedAt) {
    // HttpExceptionFilter 固定 5 键、丢 detail——名单嵌入 error 文案（与 OPENING_RECORDS_MISSING 同约定）
    throw new ConflictException({
      error: `专家签字未闭环，无法执行完整归档${pendingExpertNames.length ? `（未签：${pendingExpertNames.join('、')}）` : ''}`,
      code: 'SIGN_NOT_CLOSED',
    });
  }
  if (!packet.handoverFileAssetId) throw new ConflictException({ error: '评标回流包未生成，无法执行完整归档。请在 :3007 生成评标回流包。', code: 'HANDOVER_NOT_GENERATED' });
}
