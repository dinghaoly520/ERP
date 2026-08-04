import { ConflictException } from '@nestjs/common';

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
