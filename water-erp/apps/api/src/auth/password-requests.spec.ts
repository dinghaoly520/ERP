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
});
