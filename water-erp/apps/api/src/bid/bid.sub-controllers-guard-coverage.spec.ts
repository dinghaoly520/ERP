import 'reflect-metadata';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { AssignedHostGuard } from './assigned-host.guard';
import { BidCompanyScopeGuard } from './bid-company-scope.guard';
import { OpeningSignController } from './opening-sign.controller';
import { BidSignPacketController } from './bid-sign-packet.controller';
import { NonTenderDealController } from './non-tender-deal.controller';

/**
 * P1-2（2026-11-20 全链路审查）：独立子控制器守卫防漂移锁。
 *
 * 背景：BidCompanyScopeGuard/AssignedHostGuard 挂在 BidController 类级（或 BidController
 * 方法级），`@Controller('bid/...')` 前缀相同的**独立控制器**不在其覆盖面——
 * opening-sign.controller 曾仅类级 @Roles，跨公司 leader/staff 可重建开标文件包、
 * 改写法定证据件指纹（P1-2）；non-tender-deal 同族（P2-6）。
 * 既有锁 bid.controller.assigned-host-coverage.spec.ts 只枚举 BidController 方法，
 * 本锁把「同路由前缀的独立子控制器」纳入清单化管理——新增子控制器时在此登记。
 *
 * 豁免登记（挂 BidCompanyScopeGuard 反而错误/无意义的控制器）：
 * - admin-cert.controller：全局管理方加密证书单例（非项目数据，无 :id 项目参数）；
 * - bid-pairing.controller：专家平板配对域（bid_expert 角色 + PairingScopeGuard/pid 绑定，
 *   不属内部角色公司隔离域）；
 * - work-template.controller：`work-templates/:kind(/:id)` 的 :id 是**模板 id 非项目 id**
 *   ——BidCompanyScopeGuard 读 req.params.id 当项目 id 查库，挂上即误判，严禁。
 */
describe('独立子控制器 — 公司隔离 + 指派守卫覆盖锁（P1-2）', () => {
  const guardMeta = (target: object): unknown[] =>
    Reflect.getMetadata(GUARDS_METADATA, target) ?? [];

  const hasGuard = (target: object, guard: unknown): boolean =>
    guardMeta(target).some((g) => g === guard);

  it.each([
    ['OpeningSignController（P1-2 修复面）', OpeningSignController],
    ['BidSignPacketController（#115 既有口径，纳入锁固化）', BidSignPacketController],
    ['NonTenderDealController（P2-6 修复面）', NonTenderDealController],
  ])('%s → 类级挂 BidCompanyScopeGuard', (_name, ctrl) => {
    expect(hasGuard(ctrl, BidCompanyScopeGuard)).toBe(true);
  });

  it.each([
    ['generateSignPage（生成签字页 PDF）', OpeningSignController.prototype.generateSignPage],
    ['uploadSignScan（上传签字扫描件）', OpeningSignController.prototype.uploadSignScan],
    ['registerSign（登记闭环·重建开标文件包）', OpeningSignController.prototype.registerSign],
  ])('OpeningSignController.%s → 挂 AssignedHostGuard（纯 :3007 现场动作）', (_name, fn) => {
    expect(hasGuard(fn, AssignedHostGuard)).toBe(true);
  });

  it('OpeningSignController.getStatus（纯读）→ 不挂 AssignedHostGuard（对齐 BidSignPacketController.get 只吃类级公司隔离）', () => {
    expect(hasGuard(OpeningSignController.prototype.getStatus, AssignedHostGuard)).toBe(false);
  });

  it.each([
    ['generate（生成签字包）', BidSignPacketController.prototype.generate],
    ['uploadExpertScan（专家签字扫描件）', BidSignPacketController.prototype.uploadExpertScan],
    ['uploadSignaturePageScan（共签页扫描件）', BidSignPacketController.prototype.uploadSignaturePageScan],
    ['register（登记专家签字）', BidSignPacketController.prototype.register],
    ['unregister（撤销签字登记）', BidSignPacketController.prototype.unregister],
    ['generateHandover（生成评标回流包）', BidSignPacketController.prototype.generateHandover],
  ])('BidSignPacketController.%s → 挂 AssignedHostGuard（纯 :3007 现场动作）', (_name, fn) => {
    expect(hasGuard(fn, AssignedHostGuard)).toBe(true);
  });

  it('BidSignPacketController 纯读/admin 通道（get/evidence-zip/reopen）→ 不挂 AssignedHostGuard', () => {
    expect(hasGuard(BidSignPacketController.prototype.get, AssignedHostGuard)).toBe(false);
    expect(hasGuard(BidSignPacketController.prototype.downloadEvidenceZip, AssignedHostGuard)).toBe(false);
    expect(hasGuard(BidSignPacketController.prototype.reopen, AssignedHostGuard)).toBe(false); // admin-only 数据修正通道（@Roles('admin') 拦截，admin 本就豁免 AHG）
  });

  it('NonTenderDealController → 不挂 AssignedHostGuard（仅 :3005 管理侧调用，非主持现场执行权）', () => {
    expect(hasGuard(NonTenderDealController.prototype.register, AssignedHostGuard)).toBe(false);
    expect(hasGuard(NonTenderDealController.prototype.get, AssignedHostGuard)).toBe(false);
  });
});
