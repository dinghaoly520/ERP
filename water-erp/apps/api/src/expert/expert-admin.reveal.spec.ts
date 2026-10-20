import { Test } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ExpertAdminService } from './expert-admin.service';
import { PrismaService } from '../prisma/prisma.service';
import { ExpertCrossConflictService } from './expert-cross-conflict.service';
import { ExpertExtractionAiService } from './expert-extraction-ai.service';
import { NotificationService } from '../notification/notification.service';
import { EmbeddingService } from '../local-ai/embedding.service';
import { LlmService } from '../local-ai/llm.service';
import { OcrService } from '../local-ai/ocr.service';
import { ExpertExtractionService } from './expert-extraction.service';
import { CompanyScopeService } from '../company/company-scope';
import { sealPii } from '../common/crypto/sm-field-crypto';

describe('ExpertAdminService.revealExpertField（明文揭示 + 审计）', () => {
  let service: ExpertAdminService;
  let prisma: any;

  beforeAll(() => { process.env.FIELD_ENC_SECRET = 'reveal-spec-field-enc-secret'; });
  afterAll(() => { delete process.env.FIELD_ENC_SECRET; });

  beforeEach(async () => {
    prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'u1', role: 'bid_expert', companyId: 'co-1',
          phone: sealPii('13900000000'),
          expertProfile: { phone: sealPii('13812345678'), idNumber: sealPii('51102319900101123X'), licenseNo: sealPii('川A123456789') },
        }),
      },
      sensitiveAccessLog: { create: jest.fn().mockResolvedValue({}) },
    };
    const module = await Test.createTestingModule({
      providers: [
        ExpertAdminService,
        { provide: PrismaService, useValue: prisma },
        { provide: ExpertCrossConflictService, useValue: {} },
        { provide: ExpertExtractionAiService, useValue: {} },
        { provide: NotificationService, useValue: {} },
        { provide: EmbeddingService, useValue: {} },
        { provide: LlmService, useValue: {} },
        { provide: OcrService, useValue: {} },
        { provide: ExpertExtractionService, useValue: {} },
        { provide: CompanyScopeService, useValue: { resolveScope: jest.fn().mockResolvedValue({ all: true }), assertInScope: jest.fn() } },
      ],
    }).compile();
    service = module.get(ExpertAdminService);
  });

  const actor = { sub: 'staff-1', role: 'staff', displayName: '审批员甲' };

  it('揭示身份证号：返回明文并写 SensitiveAccessLog', async () => {
    const result = await service.revealExpertField('u1', 'idNumber', actor as any, '10.0.0.1');
    expect(result).toEqual({ field: 'idNumber', value: '51102319900101123X' });
    expect(prisma.sensitiveAccessLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          actorUserId: 'staff-1', actorName: '审批员甲',
          entity: 'ExpertProfile', targetId: 'u1', field: 'idNumber', ip: '10.0.0.1',
        }),
      }),
    );
  });

  it('手机号回退链：ExpertProfile.phone 优先，缺省回退 User.phone', async () => {
    const result = await service.revealExpertField('u1', 'phone', actor as any);
    expect(result.value).toBe('13812345678');
    prisma.user.findUnique.mockResolvedValue({
      id: 'u1', role: 'bid_expert', companyId: 'co-1',
      phone: sealPii('13900000000'), expertProfile: { phone: null, idNumber: null, licenseNo: null },
    });
    const fallback = await service.revealExpertField('u1', 'phone', actor as any);
    expect(fallback.value).toBe('13900000000');
  });

  it('揭示账号邮箱（User.email 密文列）', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'u1', role: 'bid_expert', companyId: 'co-1', email: sealPii('liu@example.com'),
      expertProfile: { phone: null, idNumber: null, licenseNo: null },
    });
    const result = await service.revealExpertField('u1', 'email', actor as any);
    expect(result.value).toBe('liu@example.com');
  });

  it('不可揭示字段 → 400 FIELD_NOT_REVEALABLE（不写审计）', async () => {
    await expect(service.revealExpertField('u1', 'passwordHash', actor as any)).rejects.toMatchObject({
      response: { code: 'FIELD_NOT_REVEALABLE' },
    });
    expect(prisma.sensitiveAccessLog.create).not.toHaveBeenCalled();
  });

  it('专家不存在 → 404', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    await expect(service.revealExpertField('nope', 'idNumber', actor as any)).rejects.toThrow(NotFoundException);
  });
});
