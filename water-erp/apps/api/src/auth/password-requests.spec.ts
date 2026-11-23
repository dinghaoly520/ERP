import { hashSync } from 'bcryptjs';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { RejectDto } from './password-requests.controller';
import { PasswordRequestsService } from './password-requests.service';

describe('password reset privacy and review contract', () => {

  it('submitChange 提交后通知 admin 审批（2026-10-22 提交通知补全）', async () => {
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({ passwordHash: hashSync('Old1234', 4), username: 'Swhi-CGZX-05', role: 'staff', companyId: 'co1' }),
        findMany: jest.fn().mockResolvedValue([{ id: 'adm1' }]),
      },
      passwordChangeRequest: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        create: jest.fn().mockResolvedValue({ id: 'pc-1', status: 'PENDING', requestedAt: new Date() }),
      },
      notification: { create: jest.fn().mockResolvedValue({}) },
    };
    const service = new PasswordRequestsService(prisma as any, { verifyRegistrationCode: jest.fn() } as any);

    await service.submitChange('u1', 'Old1234', 'New12345');

    // 通知 admin 全体、类型/深链直达账号管理·安全审批
    expect(prisma.notification.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ userId: 'adm1', type: 'PASSWORD_CHANGE_PENDING', link: '/admin/accounts' }),
    }));
  });

  it('submitChange 通知失败不阻断提交（申请已落库）', async () => {
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({ passwordHash: hashSync('Old1234', 4), username: 'Swhi-CGZX-05', role: 'staff', companyId: 'co1' }),
        findMany: jest.fn().mockRejectedValue(new Error('db down')),
      },
      passwordChangeRequest: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        create: jest.fn().mockResolvedValue({ id: 'pc-2', status: 'PENDING', requestedAt: new Date() }),
      },
      notification: { create: jest.fn() },
    };
    const service = new PasswordRequestsService(prisma as any, { verifyRegistrationCode: jest.fn() } as any);

    const r = await service.submitChange('u1', 'Old1234', 'New12345');
    expect(r).toHaveProperty('id', 'pc-2');
  });
  it('does not return matchedUserId to an anonymous reset applicant', async () => {
    const prisma = {
      user: { findFirst: jest.fn().mockResolvedValue({ id: 'secret-user-id' }) },
      passwordResetRequest: {
        create: jest.fn().mockResolvedValue({ id: 'request-1', status: 'PENDING', requestedAt: new Date() }),
      },
    };
    const verifyRegistrationCode = jest.fn().mockResolvedValue({ ok: true });
    const service = new PasswordRequestsService(
      prisma as any,
      { verifyRegistrationCode } as any,
    );

    const result = await service.submitReset('supplier', '申请人', '13800138000', '123456', 'Pass1234');

    expect(result).not.toHaveProperty('matchedUserId');
    expect(prisma.passwordResetRequest.create).toHaveBeenCalledWith(expect.objectContaining({
      select: { id: true, status: true, requestedAt: true },
    }));
    expect(verifyRegistrationCode).toHaveBeenCalledWith('13800138000', '123456');
  });

  it('stores requested new password hash when user exists', async () => {
    const createMock = jest.fn().mockResolvedValue({ id: 'request-2', status: 'PENDING', requestedAt: new Date() });
    const prisma = {
      user: { findFirst: jest.fn().mockResolvedValue({ id: 'secret-user-id' }) },
      passwordResetRequest: { create: createMock },
    };
    const verifyRegistrationCode = jest.fn().mockResolvedValue({ ok: true });
    const service = new PasswordRequestsService(
      prisma as any,
      { verifyRegistrationCode } as any,
    );

    await service.submitReset('supplier', '申请人', '13800138000', '123456', 'Pass1234');

    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          requestedPasswordHash: expect.stringMatching(/^\$2b\$/),
        }),
      }),
    );
    expect(verifyRegistrationCode).toHaveBeenCalledWith('13800138000', '123456');
  });

  it('rejects reset request when verification code is invalid', async () => {
    const prisma = {
      user: { findFirst: jest.fn() },
      passwordResetRequest: { create: jest.fn() },
    };
    const verifyRegistrationCode = jest.fn().mockRejectedValue(new Error('验证码错误'));
    const service = new PasswordRequestsService(
      prisma as any,
      { verifyRegistrationCode } as any,
    );

    await expect(
      service.submitReset('supplier', '申请人', '13800138000', '111111', 'Pass1234'),
    ).rejects.toThrow('验证码错误');
  });

  it('accepts an optional decisionNote field used by the admin portal', async () => {
    const emptyErrors = await validate(plainToInstance(RejectDto, {}));
    const noteErrors = await validate(plainToInstance(RejectDto, { decisionNote: '信息无法核验' }));
    expect(emptyErrors).toEqual([]);
    expect(noteErrors).toEqual([]);
    expect(plainToInstance(RejectDto, { decisionNote: '原因' }).decisionNote).toBe('原因');
  });

  // ── 改公司全链路联动（2026-11-06 用户裁定）：批准资料变更时 company 文本与 companyId 成对写入 ──

  const mkApprove = (opts: { payload: Record<string, string | null>; role: string }) => {
    const resolveCompanyRecord = jest.fn().mockResolvedValue({ id: 'co-swdg-jt', name: '四川省水利发展集团有限公司' });
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({ role: opts.role }),
        update: jest.fn().mockResolvedValue({ username: 'Swhi-CGZX-01' }),
      },
      profileChangeRequest: {
        findUnique: jest.fn().mockResolvedValue({ id: 'pr-1', userId: 'u1', status: 'PENDING', payload: opts.payload }),
        count: jest.fn().mockResolvedValue(1),
        update: jest.fn().mockResolvedValue({ id: 'pr-1', status: 'APPROVED', reviewedAt: new Date() }),
      },
      notification: { create: jest.fn().mockResolvedValue({}) },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    const svc = new PasswordRequestsService(prisma as any, {} as any, undefined, { resolveCompanyRecord } as any);
    return { svc, prisma, resolveCompanyRecord, approve: () => svc.approveProfileChange('pr-1', 'adm-1') };
  };

  it('内部账号批准改公司 → company 文本与 companyId 外键成对写入（归一化到主数据）', async () => {
    const { prisma, resolveCompanyRecord, approve } = mkApprove({
      payload: { company: '四川省水利发展集团' },
      role: 'leader',
    });

    await approve();

    expect(resolveCompanyRecord).toHaveBeenCalledWith('四川省水利发展集团');
    const data = prisma.user.update.mock.calls[0][0].data;
    expect(data.company).toBe('四川省水利发展集团有限公司');
    expect(data.companyId).toBe('co-swdg-jt');
  });

  it('内部账号批准清除公司 → company 与 companyId 成对置空', async () => {
    const { prisma, approve } = mkApprove({ payload: { company: null }, role: 'staff' });

    await approve();

    const data = prisma.user.update.mock.calls[0][0].data;
    expect(data.company).toBeNull();
    expect(data.companyId).toBeNull();
  });

  it('供应商账号批准改公司 → 仅写展示名，不联动 companyId（公司身份归 SupplierCompanyLink 管辖）', async () => {
    const { prisma, approve } = mkApprove({
      payload: { company: '四川省水利发展集团有限公司' },
      role: 'supplier',
    });

    await approve();

    const data = prisma.user.update.mock.calls[0][0].data;
    expect(data.company).toBe('四川省水利发展集团有限公司');
    expect(data).not.toHaveProperty('companyId');
  });

  it('不含 company 字段的资料变更 → 不触碰公司归属', async () => {
    const { prisma, approve } = mkApprove({ payload: { officeLocation: 'A栋' }, role: 'staff' });

    await approve();

    const data = prisma.user.update.mock.calls[0][0].data;
    expect(data).not.toHaveProperty('company');
    expect(data).not.toHaveProperty('companyId');
  });
});

describe('submitReset 资格闸（2026-11-23 用户裁定：仅已入库供应商或内部账号可申请）', () => {
  const mkSvc = (findFirst: jest.Mock) => {
    const prisma = {
      user: { findFirst, findMany: jest.fn().mockResolvedValue([]) },
      supplier: { findUnique: jest.fn().mockResolvedValue(null) },
      passwordResetRequest: { create: jest.fn().mockResolvedValue({ id: 'pr-1', status: 'PENDING', requestedAt: new Date() }) },
      notification: { create: jest.fn() },
    };
    const verifyRegistrationCode = jest.fn().mockResolvedValue({ ok: true });
    const service = new PasswordRequestsService(prisma as any, { verifyRegistrationCode } as any);
    return { prisma, verifyRegistrationCode, service };
  };
  const CALL = ['91510100MA6CPPPP00', '张三', '13800138000', '123456', 'Pass1234'] as const;

  it('已入库供应商（APPROVED）→ 照旧受理：落库且 matchedUserId 写入', async () => {
    const { prisma, service } = mkSvc(jest.fn().mockResolvedValue({ id: 'sup-1', role: 'supplier', supplier: { status: 'APPROVED' } }));
    await service.submitReset(...CALL);
    expect(prisma.passwordResetRequest.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ matchedUserId: 'sup-1' }),
    }));
  });

  it('审核中/退回/驳回/停用/黑名单供应商 → 统一 400 RESET_NOT_ELIGIBLE，零落库零通知', async () => {
    for (const status of ['PENDING', 'RETURNED', 'REJECTED', 'DISABLED', 'BLACKLIST']) {
      const { prisma, service } = mkSvc(jest.fn().mockResolvedValue({ id: 'sup-x', role: 'supplier', supplier: { status } }));
      await expect(service.submitReset(...CALL)).rejects.toMatchObject({
        response: { code: 'RESET_NOT_ELIGIBLE', error: expect.stringContaining('已入库') },
      });
      expect(prisma.passwordResetRequest.create).not.toHaveBeenCalled();
      expect(prisma.notification.create).not.toHaveBeenCalled();
    }
  });

  it('供应商角色但无 Supplier 行（数据残缺）→ 从严拒绝', async () => {
    const { prisma, service } = mkSvc(jest.fn().mockResolvedValue({ id: 'sup-bare', role: 'supplier', supplier: null }));
    await expect(service.submitReset(...CALL)).rejects.toMatchObject({ response: { code: 'RESET_NOT_ELIGIBLE' } });
    expect(prisma.passwordResetRequest.create).not.toHaveBeenCalled();
  });

  it('账号不存在/未激活（findFirst → null）→ 拒绝且不产生垃圾申请', async () => {
    const { prisma, service } = mkSvc(jest.fn().mockResolvedValue(null));
    await expect(service.submitReset('不存在的账号', '张三', '13800138000', '123456', 'Pass1234')).rejects.toMatchObject({ response: { code: 'RESET_NOT_ELIGIBLE' } });
    expect(prisma.passwordResetRequest.create).not.toHaveBeenCalled();
    expect(prisma.user.findMany).not.toHaveBeenCalled(); // 未走到 admin 通知兜底
  });

  it('内部账号（非供应商角色）→ 照旧受理', async () => {
    const { prisma, service } = mkSvc(jest.fn().mockResolvedValue({ id: 'staff-1', role: 'staff' }));
    await service.submitReset('Swhi-CGZX-05', '张三', '13800138000', '123456', 'Pass1234');
    expect(prisma.passwordResetRequest.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ matchedUserId: 'staff-1' }),
    }));
  });

  it('拒绝前验证码已核验（短信成本门槛在最前）', async () => {
    const { verifyRegistrationCode, service } = mkSvc(jest.fn().mockResolvedValue(null));
    await expect(service.submitReset(...CALL)).rejects.toMatchObject({ response: { code: 'RESET_NOT_ELIGIBLE' } });
    expect(verifyRegistrationCode).toHaveBeenCalledWith('13800138000', '123456');
  });
});
