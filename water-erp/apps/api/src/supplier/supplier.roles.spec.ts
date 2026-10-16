import { Reflector } from '@nestjs/core';
import { SupplierController } from './supplier.controller';
import { ROLES_KEY } from '../common/decorators/roles.decorator';

/**
 * 注册审批 + 邀请码权限矩阵（2026-09-24 用户裁定；2026-10-16 改定）：
 * 注册审批 approve/reject/return 三角色（2026-09-26，公司域校验在 service）；
 * reactivate 仍仅 admin；邀请码管理（生成/列表/作废）2026-10-16 起放开 leader（staff 仍不放行）。
 * 用 Reflector 直读 @Roles 元数据做守卫契约测试——RolesGuard 本身已有
 * roles.guard.spec.ts 覆盖，此处只锁「哪些端点允许哪些角色」。
 */
describe('SupplierController — 注册审批/邀请码权限矩阵', () => {
  const reflector = new Reflector();
  const roles = (method: keyof SupplierController) =>
    reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      SupplierController.prototype[method] as never,
      SupplierController,
    ]);

  // 2026-09-26 改定：供应商审批=归属公司管理账号（controller 放开三角色，service 层校验公司域）
  it.each([
    'approve',           // POST :id/approve 审核通过
    'reject',            // POST :id/reject 审核不通过
    'return',            // POST :id/return 退回补正
  ] as (keyof SupplierController)[])('%s → admin/leader/staff（公司域校验在 service）', (method) => {
    expect(roles(method)).toEqual(['admin', 'leader', 'staff']);
  });

  it.each([
    'createInvitation',  // POST invitations 生成邀请码
    'listInvitations',   // GET invitations 邀请码列表
    'revokeInvitation',  // POST invitations/:id/revoke 作废邀请码
  ] as (keyof SupplierController)[])('%s → admin/leader（2026-10-16 放开 leader，staff 仍不放行）', (method) => {
    expect(roles(method)).toEqual(['admin', 'leader']);
  });

  it.each([
    'reactivate',        // POST :id/reactivate 复活被拒申请（REJECTED→PENDING，注册审批链路特殊操作）
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
