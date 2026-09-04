import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { RejectDto } from './password-requests.controller';
import { PasswordRequestsService } from './password-requests.service';

describe('password reset privacy and review contract', () => {
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
