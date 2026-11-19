import 'reflect-metadata';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { AssignedHostGuard } from './assigned-host.guard';
import { BidController } from './bid.controller';

/**
 * 裁定2（2026-11-19 三门户审查，用户认可方案）：主持端点执行权分档口径清单化锁。
 *
 * - A 档（纯 :3007 现场动作，全库已核实无 :3005/:3004 前端调用者）→ 必须挂
 *   AssignedHostGuard（admin/被指派主持人放行，同公司未指派 403 NOT_ASSIGNED_HOST）。
 * - B 档（:3005/:3007 双端复用，挂闸会打断对方端正门流程）→ 明文豁免：
 *   - abortBidProject：开标前流标走 :3005 AbortDialog（staff/leader），评标中流标走 :3007——
 *     已有阶段语义分流 + 书面理由 + 审计兜底；
 *   - startOpening：:3005「按时开标」共用（结构性行为，见 c3af126b8 改造注记）；
 *   - openSubmission：开放投递为项目级编排动作，非主持现场执行权。
 *
 * 防漂移锁：新增主持类端点时在此登记分档——防「改造只覆盖旧面」复发
 * （c3af126b8 只转换了原 17+6 处 @Roles('bid_host','admin')，新增四角色端点从未进改造面）。
 */
describe('BidController — AssignedHostGuard 覆盖锁（裁定2 分档口径）', () => {
  const hasAssignedHostGuard = (fn: object): boolean => {
    const guards: unknown[] = Reflect.getMetadata(GUARDS_METADATA, fn) ?? [];
    return guards.some((g) => g === AssignedHostGuard || (g as { constructor?: unknown })?.constructor === AssignedHostGuard);
  };

  const method = (name: keyof BidController): object =>
    (BidController.prototype as unknown as Record<string, object>)[name as string];

  const TIER_A: (keyof BidController)[] = [
    'startEvaluation',        // 启动评标
    'completeOpening',        // 完成开标·资料移交
    'enterOpeningRecord',     // 唱标录入
    'resolveOpeningDispute',  // 开标异议处理
    'acceptSupplierDanger',   // 定性解密异常
    'generateEvaluationResults', // 生成评标结果
    'resolveExpertDispute',   // 专家异议裁决
    'createClarification',    // 发起澄清
    'replyClarification',     // 澄清答复/离线登记
    'createRound',            // 创建报价轮次
    'sealRound',              // 截止报价(密封)
    'publishRound',           // 公布报价(开标)
    'closeRound',             // 结束轮次
  ];

  const TIER_B: (keyof BidController)[] = ['abortBidProject', 'startOpening', 'openSubmission'];

  it.each(TIER_A)('A 档（纯 :3007 现场动作）%s → 已挂 AssignedHostGuard', (name) => {
    expect(hasAssignedHostGuard(method(name))).toBe(true);
  });

  it.each(TIER_B)('B 档（双端复用豁免）%s → 不挂闸（口径注释声明于本文件头）', (name) => {
    expect(hasAssignedHostGuard(method(name))).toBe(false);
  });

  it('A 档清单规模锚定（13 端点——缩容须同步修订裁定注记）', () => {
    expect(TIER_A).toHaveLength(13);
  });
});
