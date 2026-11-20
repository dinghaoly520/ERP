import { ConflictException } from '@nestjs/common';
import { assertArchiveScopeStage, assertBidStageTransition } from './bid-state';

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
});

describe('assertArchiveScopeStage — 归档 scope×stage 收口矩阵（P1-1，2026-11-20）', () => {
  /** 捕获断言：code 挂在 HttpException.response 上（toThrow(objectContaining) 顶层匹配不到） */
  const expectScopeRejection = (scope: 'opening' | 'full', stage: Parameters<typeof assertArchiveScopeStage>[1], code: string) => {
    let err: any;
    try { assertArchiveScopeStage(scope, stage); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(ConflictException);
    expect(err?.response?.code).toBe(code);
  };

  it('opening 合法域 {OPENING, ABORTED}（流标收尾特例经 opening 自然兼容）', () => {
    expect(() => assertArchiveScopeStage('opening', 'OPENING')).not.toThrow();
    expect(() => assertArchiveScopeStage('opening', 'ABORTED')).not.toThrow();
  });

  it('场景A：EVALUATING + opening 拒绝（评标中项目不得绕过签字/回流/结果三闸开标归档）', () => {
    expectScopeRejection('opening', 'EVALUATING', 'ARCHIVE_EVALUATING_NOT_OPENING');
  });

  it('场景B：ABORTED + full 拒绝（流标项目不得从已作废结果派生公示/定标）', () => {
    expectScopeRejection('full', 'ABORTED', 'ARCHIVE_ABORTED_NOT_FULL');
  });

  it('full 合法域仅 EVALUATING；前阶段沿用 ARCHIVE_NOT_EVALUATING / ARCHIVE_NOT_OPENED', () => {
    expect(() => assertArchiveScopeStage('full', 'EVALUATING')).not.toThrow();
    expectScopeRejection('full', 'OPENING', 'ARCHIVE_NOT_EVALUATING');
    expectScopeRejection('full', 'SUBMIT', 'ARCHIVE_NOT_EVALUATING');
    expectScopeRejection('opening', 'DOWNLOAD', 'ARCHIVE_NOT_OPENED');
    expectScopeRejection('opening', 'SUBMIT', 'ARCHIVE_NOT_OPENED');
  });

  it('ARCHIVED 幂等放行（外层早退之外，并发第二笔归档在事务内复查不误炸）', () => {
    expect(() => assertArchiveScopeStage('opening', 'ARCHIVED')).not.toThrow();
    expect(() => assertArchiveScopeStage('full', 'ARCHIVED')).not.toThrow();
  });
});
