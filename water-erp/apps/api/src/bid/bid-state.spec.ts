import { ConflictException } from '@nestjs/common';
import { assertBidStageTransition, stageAtLeast } from './bid-state';

describe('assertBidStageTransition — 单向棘轮语义', () => {
  it('同阶段幂等放行', () => {
    expect(() => assertBidStageTransition('OPENING', 'OPENING')).not.toThrow();
    expect(() => assertBidStageTransition('ARCHIVED', 'ARCHIVED')).not.toThrow();
  });

  it('允许前进（含跳步 DOWNLOAD→OPENING、OPENING→ARCHIVED）', () => {
    expect(() => assertBidStageTransition('DOWNLOAD', 'SUBMIT')).not.toThrow();
    expect(() => assertBidStageTransition('DOWNLOAD', 'OPENING')).not.toThrow();
    expect(() => assertBidStageTransition('SUBMIT', 'OPENING')).not.toThrow();
    expect(() => assertBidStageTransition('OPENING', 'EVALUATING')).not.toThrow();
    expect(() => assertBidStageTransition('OPENING', 'ARCHIVED')).not.toThrow();
    expect(() => assertBidStageTransition('EVALUATING', 'ARCHIVED')).not.toThrow();
    expect(() => assertBidStageTransition('EVALUATING', 'ABORTED')).not.toThrow();
  });

  it('拒绝回退（409 ConflictException）', () => {
    expect(() => assertBidStageTransition('SUBMIT', 'DOWNLOAD')).toThrow(ConflictException);
    expect(() => assertBidStageTransition('EVALUATING', 'OPENING')).toThrow(ConflictException);
  });

  it('ABORTED→ARCHIVED 流标收尾合法（既有特例）', () => {
    expect(() => assertBidStageTransition('ABORTED', 'ARCHIVED')).not.toThrow();
  });

  it('P0-1：ARCHIVED→ABORTED 拒绝（ABORTED 序号排在 ARCHIVED 之后，不得被当作"前进"放行）', () => {
    expect(() => assertBidStageTransition('ARCHIVED', 'ABORTED')).toThrow(ConflictException);
  });

  it('P0-1：离开 ARCHIVED 的任何流转一律拒绝（不可逆终态）', () => {
    expect(() => assertBidStageTransition('ARCHIVED', 'EVALUATING')).toThrow(ConflictException);
    expect(() => assertBidStageTransition('ARCHIVED', 'OPENING')).toThrow(ConflictException);
    expect(() => assertBidStageTransition('ARCHIVED', 'DOWNLOAD')).toThrow(ConflictException);
  });

  it('stageAtLeast 维持既有序（ABORTED 视为已达 EVALUATING——archiveAll 下限守卫依赖）', () => {
    expect(stageAtLeast('ABORTED', 'EVALUATING')).toBe(true);
    expect(stageAtLeast('ARCHIVED', 'EVALUATING')).toBe(true);
    expect(stageAtLeast('OPENING', 'EVALUATING')).toBe(false);
  });
});
