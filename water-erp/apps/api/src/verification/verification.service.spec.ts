import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { VerificationService } from '../../src/verification/verification.service';
import { PrismaService } from '../../src/prisma/prisma.service';

describe('VerificationService', () => {
  let service: VerificationService;
  let redisMock: any;
  let prismaMock: any;

  const OLD_DEBUG = process.env.SMS_DEBUG_BYPASS;

  beforeEach(async () => {
    // Disable debug bypass so unit tests exercise real code paths
    delete process.env.SMS_DEBUG_BYPASS;

    redisMock = {
      get: jest.fn(),
      set: jest.fn(),
      del: jest.fn(),
      incr: jest.fn(),
      expire: jest.fn(),
      ttl: jest.fn(),
    };

    prismaMock = {
      bidExpert: {
        findFirst: jest.fn(),
        update: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VerificationService,
        { provide: 'REDIS_CLIENT', useValue: redisMock },
        { provide: PrismaService, useValue: prismaMock },
      ],
    }).compile();

    service = module.get<VerificationService>(VerificationService);
  });

  afterEach(() => {
    // Restore debug bypass
    if (OLD_DEBUG !== undefined) {
      process.env.SMS_DEBUG_BYPASS = OLD_DEBUG;
    }
  });

  describe('verifyCode', () => {
    it('should throw CODE_EXPIRED when no code in Redis', async () => {
      redisMock.get.mockResolvedValue(null);

      await expect(
        service.verifyCode('expert_sign_in', 'user1', 'proj1', '123456'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw CODE_INVALID when code does not match', async () => {
      redisMock.get.mockResolvedValue(JSON.stringify({ code: '999999', phone: '138****5678', attempts: 0 }));
      redisMock.ttl.mockResolvedValue(300);
      redisMock.set.mockResolvedValue('OK');

      await expect(
        service.verifyCode('expert_sign_in', 'user1', 'proj1', '123456'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should return ok when code matches', async () => {
      redisMock.get.mockResolvedValue(JSON.stringify({ code: '123456', phone: '13800000001', attempts: 0 }));
      redisMock.del.mockResolvedValue(1);
      prismaMock.bidExpert.findFirst.mockResolvedValue({ id: 'expert1' });
      prismaMock.bidExpert.update.mockResolvedValue({});

      const result = await service.verifyCode('expert_sign_in', 'user1', 'proj1', '123456');
      expect(result.ok).toBe(true);
    });

    it('should throw ATTEMPTS_EXCEEDED after 5 failed attempts', async () => {
      redisMock.get.mockResolvedValue(JSON.stringify({ code: '999999', phone: '13800000001', attempts: 5 }));

      await expect(
        service.verifyCode('expert_sign_in', 'user1', 'proj1', '123456'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('sendCode', () => {
    it('should throw when cooldown is active', async () => {
      redisMock.incr.mockResolvedValue(1);
      redisMock.expire.mockResolvedValue(1);
      redisMock.get.mockResolvedValue('1');  // cooldown active
      redisMock.ttl.mockResolvedValue(45);

      await expect(
        service.sendCode('expert_sign_in', 'user1', 'proj1', '127.0.0.1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should succeed when expert has phone', async () => {
      redisMock.incr.mockResolvedValue(1);
      redisMock.expire.mockResolvedValue(1);
      redisMock.get.mockResolvedValue(null);  // no cooldown
      redisMock.set.mockResolvedValue('OK');
      prismaMock.bidExpert.findFirst.mockResolvedValue({
        user: { expertProfile: { phone: '13800000001' } },
      });

      const result = await service.sendCode('expert_sign_in', 'user1', 'proj1', '127.0.0.1');
      expect(result.maskedPhone).toBe('138****0001');
    });
  });
});
