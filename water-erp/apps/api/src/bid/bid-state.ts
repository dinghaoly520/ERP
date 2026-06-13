import { ConflictException } from '@nestjs/common';

export type BidStage = 'DOWNLOAD' | 'SUBMIT' | 'OPENING' | 'EVALUATING' | 'ARCHIVED';

const ALLOWED_TRANSITIONS: Record<BidStage, BidStage[]> = {
  DOWNLOAD:    ['SUBMIT'],
  SUBMIT:      ['OPENING'],
  OPENING:     ['EVALUATING'],
  EVALUATING:  ['ARCHIVED'],
  ARCHIVED:    [],
};

/**
 * 校验招标阶段流转是否合法。
 * - 同阶段 (from === to) 幂等放行，不抛异常
 * - 非法流转抛 409 ConflictException
 */
export function assertBidStageTransition(from: BidStage, to: BidStage): void {
  if (from === to) return;
  const allowed = ALLOWED_TRANSITIONS[from] ?? [];
  if (!allowed.includes(to)) {
    throw new ConflictException(`非法招标阶段流转：${from} -> ${to}`);
  }
}

/** 获取当前阶段允许的下一阶段列表（前端可用来展示允许动作） */
export function getNextStages(current: BidStage): BidStage[] {
  return ALLOWED_TRANSITIONS[current] ?? [];
}
