import { Test, TestingModule } from '@nestjs/testing';
import { ExpertController } from './expert.controller';
import { ExpertService } from './expert.service';

describe('ExpertController', () => {
  let controller: ExpertController;
  let expertService: any;

  beforeEach(async () => {
    expertService = {
      getTenderDocument: jest.fn(),
      downloadTenderDocument: jest.fn(),
    };
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ExpertController],
      providers: [{ provide: ExpertService, useValue: expertService }],
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
});
