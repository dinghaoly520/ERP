import { Test, TestingModule } from '@nestjs/testing';
import { ExpertController } from './expert.controller';
import { ExpertService } from './expert.service';
import { ExpertMemoService } from './expert-memo.service';
import { ExpertAdminService } from './expert-admin.service';
import { PrismaService } from '../prisma/prisma.service';
import { BidGateway } from '../bid/bid.gateway';

describe('ExpertController', () => {
  let controller: ExpertController;
  let expertService: any;
  let prisma: any;

  beforeEach(async () => {
    expertService = {
      getTenderDocument: jest.fn(),
      downloadTenderDocument: jest.fn(),
      confirmAiConsent: jest.fn(),
    };
    prisma = {
      bidExpert: { findUnique: jest.fn(), update: jest.fn().mockResolvedValue({}) },
    };
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ExpertController],
      providers: [
        { provide: ExpertService, useValue: expertService },
        // ExpertController 构造器第 2 参（本 spec 不测管理端路径，空 mock 即可）
        { provide: ExpertAdminService, useValue: {} },
        // 构造器第 4/5 参（本 spec 不触达，空 mock 即可；N6 RSVP 用例另给 bidExpert mock）
        { provide: PrismaService, useValue: prisma },
        { provide: BidGateway, useValue: {} },
        {
          provide: ExpertMemoService,
          useValue: {
            getMemos: jest.fn(),
            createMemo: jest.fn(),
            updateMemo: jest.fn(),
            deleteMemo: jest.fn(),
            getInkUrl: jest.fn(),
          },
        },
      ],
    }).compile();
    controller = module.get<ExpertController>(ExpertController);
  });

  describe('getTenderDocument', () => {
    it('透传给 service', async () => {
      expertService.getTenderDocument.mockResolvedValue(null);
      await controller.getTenderDocument('user-1', 'proj-1');
      expect(expertService.getTenderDocument).toHaveBeenCalledWith('user-1', 'proj-1');
    });
  });

  describe('downloadTenderDocument', () => {
    it('设 inline Content-Disposition + Content-Type 并发送 PDF buffer', async () => {
      const buffer = Buffer.from('%PDF-1.4 fake');
      expertService.downloadTenderDocument.mockResolvedValue({
        buffer, fileName: '招标文件.pdf', mimeType: 'application/pdf',
      });
      const res = { setHeader: jest.fn(), send: jest.fn() } as any;

      await controller.downloadTenderDocument('user-1', 'proj-1', res);

      expect(expertService.downloadTenderDocument).toHaveBeenCalledWith('user-1', 'proj-1');
      expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'application/pdf');
      expect(res.setHeader).toHaveBeenCalledWith(
        'Content-Disposition',
        expect.stringContaining('inline'),
      );
      expect(res.send).toHaveBeenCalledWith(buffer);
    });
  });

  describe('confirmAiConsent', () => {
    it('透传给 service', async () => {
      expertService.confirmAiConsent.mockResolvedValue({ aiConsentConfirmed: true });
      await controller.confirmAiConsent('user-1', 'proj-1');
      expect(expertService.confirmAiConsent).toHaveBeenCalledWith('user-1', 'proj-1');
    });
  });

  describe('rsvpRespond — N6 RSVP 过期文案与实际 TTL 一致', () => {
    afterEach(() => {
      delete process.env.EXPERT_RSVP_TTL_HOURS;
    });

    it('N6：RSVP_EXPIRED 文案用环境变量小时数（默认 2 小时）', async () => {
      delete process.env.EXPERT_RSVP_TTL_HOURS;
      prisma.bidExpert.findUnique.mockResolvedValue({
        id: 'be-1', projectId: 'p1', rsvpToken: 't',
        rsvpExpiresAt: new Date(Date.now() - 1000), invitationStatus: 'pending',
      });
      await expect(controller.rsvpRespond('t', { status: 'confirmed' })).rejects.toMatchObject({
        response: { error: expect.stringContaining('2小时') },
      });
    });

    it('N6：EXPERT_RSVP_TTL_HOURS=6 时文案同步为 6小时（不再写死 15分钟）', async () => {
      process.env.EXPERT_RSVP_TTL_HOURS = '6';
      prisma.bidExpert.findUnique.mockResolvedValue({
        id: 'be-1', projectId: 'p1', rsvpToken: 't',
        rsvpExpiresAt: new Date(Date.now() - 1000), invitationStatus: 'pending',
      });
      await expect(controller.rsvpRespond('t', { status: 'confirmed' })).rejects.toMatchObject({
        response: { error: expect.stringContaining('6小时') },
      });
    });
  });
});
