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

  beforeEach(async () => {
    expertService = {
      getTenderDocument: jest.fn(),
      downloadTenderDocument: jest.fn(),
      confirmAiConsent: jest.fn(),
    };
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ExpertController],
      providers: [
        { provide: ExpertService, useValue: expertService },
        // ExpertController 构造器第 2 参（本 spec 不测管理端路径，空 mock 即可）
        { provide: ExpertAdminService, useValue: {} },
        // 构造器第 4/5 参（本 spec 不触达，空 mock 即可）
        { provide: PrismaService, useValue: {} },
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
});
