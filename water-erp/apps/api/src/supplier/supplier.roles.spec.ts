import { Reflector } from '@nestjs/core';
import { SupplierController } from './supplier.controller';
import { ROLES_KEY } from '../common/decorators/roles.decorator';

/**
 * 注册审批 + 邀请码权限矩阵（2026-09-24 用户裁定）：
 * 新供应商注册审批（approve/reject/return/reactivate）与邀请码管理
 * （生成/列表/作废）仅管理权限账号（admin）可操作；leader/staff 不再放行。
 * 用 Reflector 直读 @Roles 元数据做守卫契约测试——RolesGuard 本身已有
 * roles.guard.spec.ts 覆盖，此处只锁「哪些端点允许哪些角色」。
 */
describe('SupplierController — 注册审批/邀请码仅 admin', () => {
  const reflector = new Reflector();
  const roles = (method: keyof SupplierController) =>
    reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      SupplierController.prototype[method] as never,
      SupplierController,
    ]);

  it.each([
    'approve',           // POST :id/approve 审核通过
    'reject',            // POST :id/reject 审核不通过
    'return',            // POST :id/return 退回补正
    'reactivate',        // POST :id/reactivate 复活被拒申请（REJECTED→PENDING）
    'createInvitation',  // POST invitations 生成邀请码
    'listInvitations',   // GET invitations 邀请码列表
    'revokeInvitation',  // POST invitations/:id/revoke 作废邀请码
  ] as (keyof SupplierController)[])('%s → 仅 admin', (method) => {
    expect(roles(method)).toEqual(['admin']);
  });

  // 锚点：以下端点不在本次收紧范围，防止误伤扩散
  it('锚点：供应商列表仍 admin/leader/staff/supplier（supplier 归属收敛在 service）', () => {
    expect(roles('list')).toEqual(['admin', 'leader', 'staff', 'supplier']);
  });
  it('锚点：资料变更审批仍 admin/leader/staff（变更审批 ≠ 注册审批）', () => {
    expect(roles('approveChange')).toEqual(['admin', 'leader', 'staff']);
    expect(roles('rejectChange')).toEqual(['admin', 'leader', 'staff']);
  });
});
