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
  let expertAdminService: any;
  let prisma: any;

  beforeEach(async () => {
    expertService = {
      getTenderDocument: jest.fn(),
      downloadTenderDocument: jest.fn(),
      confirmAiConsent: jest.fn(),
    };
    expertAdminService = { autoPromoteCandidate: jest.fn().mockResolvedValue(null) };
    prisma = {
      bidExpert: { findUnique: jest.fn(), update: jest.fn().mockResolvedValue({}) },
    };
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ExpertController],
      providers: [
        { provide: ExpertService, useValue: expertService },
        // ExpertController 构造器第 2 参（N7 用例给 autoPromoteCandidate mock）
        { provide: ExpertAdminService, useValue: expertAdminService },
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

  describe('N7 补全：递补仅正选空缺触发 + verify 弃权路径递补（D7）', () => {
    const future = new Date(Date.now() + 60_000);
    const past = new Date(Date.now() - 60_000);
    const project = {
      name: '测试项目', projectCode: 'PC-1', procurementMethod: '公开招标', openTime: null,
      projectManagementItemId: null, scope: '', qualification: '', riskNote: '',
    };

    it('rsvpRespond：正选婉拒 → 递补一次并回传 promoted', async () => {
      prisma.bidExpert.findUnique.mockResolvedValue({
        id: 'be-1', projectId: 'p1', rsvpExpiresAt: future,
        invitationStatus: 'pending', expertRole: '正选',
      });
      const res = await controller.rsvpRespond('t', { status: 'declined' });
      expect(expertAdminService.autoPromoteCandidate).toHaveBeenCalledTimes(1);
      expect(expertAdminService.autoPromoteCandidate).toHaveBeenCalledWith('p1');
      expect(res.promoted).toBeNull();
      expect(res.success).toBe(true);
    });

    it('rsvpRespond：候补婉拒 → 不递补，promoted=null（候补婉拒不产生正选空缺）', async () => {
      prisma.bidExpert.findUnique.mockResolvedValue({
        id: 'be-2', projectId: 'p1', rsvpExpiresAt: future,
        invitationStatus: 'pending', expertRole: '候补',
      });
      const res = await controller.rsvpRespond('t', { status: 'declined' });
      expect(expertAdminService.autoPromoteCandidate).not.toHaveBeenCalled();
      expect(res.promoted).toBeNull();
    });

    it('rsvpVerify：过期+pending+正选 → 自动弃权并递补一次（原注释声称递补但从未调用）', async () => {
      prisma.bidExpert.findUnique.mockResolvedValue({
        id: 'be-1', projectId: 'p1', rsvpExpiresAt: past, invitationStatus: 'pending',
        expertRole: '正选', expertName: '甲', major: '水利', isLead: false, rsvpRespondedAt: null,
        project,
      });
      await controller.rsvpVerify('t');
      expect(prisma.bidExpert.update).toHaveBeenCalledWith(expect.objectContaining({
        where: { id: 'be-1' },
        data: expect.objectContaining({ invitationStatus: 'declined' }),
      }));
      expect(expertAdminService.autoPromoteCandidate).toHaveBeenCalledTimes(1);
      expect(expertAdminService.autoPromoteCandidate).toHaveBeenCalledWith('p1');
    });

    it('rsvpVerify：过期+pending+候补 → 自动弃权但不递补', async () => {
      prisma.bidExpert.findUnique.mockResolvedValue({
        id: 'be-2', projectId: 'p1', rsvpExpiresAt: past, invitationStatus: 'pending',
        expertRole: '候补', expertName: '乙', major: '地质', isLead: false, rsvpRespondedAt: null,
        project,
      });
      await controller.rsvpVerify('t');
      expect(prisma.bidExpert.update).toHaveBeenCalled();
      expect(expertAdminService.autoPromoteCandidate).not.toHaveBeenCalled();
    });
  });
});
