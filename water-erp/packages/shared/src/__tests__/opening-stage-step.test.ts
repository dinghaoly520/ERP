// packages/shared/src/__tests__/opening-stage-step.test.ts
// 开标步进条步序派生口径测试（#79）——本票病灶即「步进条与状态胶囊两套口径漂移」，
// 此处把 5 态→4 步映射与两条派生纪律（终局优先 / 暂停不挪步）锁死，防再度漂移。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveOpeningStageStep } from '../opening-session-status';

const T0 = new Date('2026-11-12T04:00:00Z').getTime();
const win = { decryptWindowStart: '2026-11-12T04:10:00Z', decryptWindowEnd: '2026-11-12T04:40:00Z' };

test('基础映射：待开标→0 / 开标中→1 / 窗口已关闭→2', () => {
  assert.equal(deriveOpeningStageStep('OPENING', win, T0), 0); // T0 < start
  assert.equal(deriveOpeningStageStep('OPENING', win, new Date('2026-11-12T04:20:00Z').getTime()), 1);
  assert.equal(deriveOpeningStageStep('OPENING', win, new Date('2026-11-12T04:50:00Z').getTime()), 2);
});

test('终局优先：handoverAt / 阶段离开开标 → 3（压过 pausedAt 与窗口位置）', () => {
  // 暂停未恢复即移交 / 启动评标 / 流标（后端终局写点不清 pausedAt——评审发现1）
  assert.equal(deriveOpeningStageStep('OPENING', { ...win, pausedAt: '2026-11-12T04:05:00Z', handoverAt: '2026-11-12T04:30:00Z' }, T0), 3);
  assert.equal(deriveOpeningStageStep('EVALUATING', { ...win, pausedAt: '2026-11-12T04:05:00Z' }, T0), 3);
  assert.equal(deriveOpeningStageStep('ABORTED', { ...win, pausedAt: '2026-11-12T04:05:00Z' }, T0), 3);
  assert.equal(deriveOpeningStageStep('ARCHIVED', win, T0), 3);
  // 终局同样压过「窗口已关闭」（旧实现 stage 判定亦终态优先）
  assert.equal(deriveOpeningStageStep('EVALUATING', win, new Date('2026-11-12T04:50:00Z').getTime()), 3);
});

test('暂停不挪步：pausedAt 不改变所在步位（「已暂停」交胶囊表达）', () => {
  // 待开标期暂停（pauseOpening 无窗口已开闸，此态可达）→ 保持 0，不得提前高亮「解密中」
  assert.equal(deriveOpeningStageStep('OPENING', { ...win, pausedAt: '2026-11-12T04:05:00Z' }, T0), 0);
  // 窗口进行中暂停 → 冻结在 1
  assert.equal(deriveOpeningStageStep('OPENING', { ...win, pausedAt: '2026-11-12T04:20:00Z' }, new Date('2026-11-12T04:25:00Z').getTime()), 1);
  // 窗口关闭后暂停 → 2
  assert.equal(deriveOpeningStageStep('OPENING', { ...win, pausedAt: '2026-11-12T04:45:00Z' }, new Date('2026-11-12T04:50:00Z').getTime()), 2);
});

test('无会话 → 0（步进条实际只在 session 存在时渲染，此处锁口径防消费面扩张）', () => {
  assert.equal(deriveOpeningStageStep('OPENING', null, T0), 0);
  assert.equal(deriveOpeningStageStep('OPENING', undefined, T0), 0);
});
