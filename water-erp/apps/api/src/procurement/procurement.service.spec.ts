import { Test, TestingModule } from '@nestjs/testing';
import { ProcurementService } from './procurement.service';
import { PrismaService } from '../prisma/prisma.service';
import { GbCodeService } from '../common/gb-code.service';

describe('ProcurementService.createBid (G8)', () => {
  let service: ProcurementService;
  let prisma: any;
  let gbCode: { allocateProcureCode: jest.Mock };

  beforeEach(async () => {
    prisma = {
      procurementProject: { findUnique: jest.fn(), update: jest.fn() },
      bidProject: { create: jest.fn(), count: jest.fn().mockResolvedValue(0), findUnique: jest.fn().mockResolvedValue(null) },
      projectManagementItem: { count: jest.fn().mockResolvedValue(0) },
    };
    gbCode = { allocateProcureCode: jest.fn().mockResolvedValue({ gbProcureCode: '511510000261020001001', gbSectionCode: '511510000261020001001001' }) };
    const module: TestingModule = await Test.createTestingModule({
      providers: [ProcurementService, { provide: PrismaService, useValue: prisma }, { provide: GbCodeService, useValue: gbCode }],
    }).compile();
    service = module.get(ProcurementService);
  });

  it('未传时间时用默认值（截标 5 天，开标 7 天）', async () => {
    prisma.procurementProject.findUnique.mockResolvedValue({
      id: 'pp1', title: '采购', procurementMethod: '公开招标', status: 'APPROVED',
    });
    prisma.bidProject.create.mockImplementation(({ data }: any) => Promise.resolve({ id: 'bp1', ...data }));
    prisma.procurementProject.update.mockResolvedValue({});

    const { bidProject } = await service.createBid('pp1');

    expect(bidProject.deadline.getTime()).toBeLessThan(bidProject.openTime.getTime());
  });

  it('传入 deadline >= openTime 时拒绝', async () => {
    prisma.procurementProject.findUnique.mockResolvedValue({
      id: 'pp1', title: '采购', procurementMethod: '公开招标', status: 'APPROVED',
    });
    const openTime = new Date(Date.now() + 7 * 86400000).toISOString();
    const deadline = new Date(Date.now() + 9 * 86400000).toISOString(); // 晚于开标
    await expect(service.createBid('pp1', { openTime, deadline })).rejects.toMatchObject({
      response: { code: 'INVALID_BID_TIME' },
    });
  });

  it('传入合法时间时透传', async () => {
    prisma.procurementProject.findUnique.mockResolvedValue({
      id: 'pp1', title: '采购', procurementMethod: '公开招标', status: 'APPROVED',
    });
    prisma.bidProject.create.mockImplementation(({ data }: any) => Promise.resolve({ id: 'bp1', ...data }));
    prisma.procurementProject.update.mockResolvedValue({});
    const openTime = new Date(Date.now() + 10 * 86400000).toISOString();
    const deadline = new Date(Date.now() + 8 * 86400000).toISOString();

    const { bidProject } = await service.createBid('pp1', { openTime, deadline });

    expect(bidProject.openTime.toISOString()).toBe(openTime);
    expect(bidProject.deadline.toISOString()).toBe(deadline);
  });

  it('建项时分配国标采购编码（2026-10-20 缺码事故：全创建路径赋码）', async () => {
    prisma.procurementProject.findUnique.mockResolvedValue({
      id: 'pp1', title: '采购', procurementMethod: '公开招标', status: 'APPROVED',
    });
    prisma.bidProject.create.mockImplementation(({ data }: any) => Promise.resolve({ id: 'bp1', ...data }));
    prisma.procurementProject.update.mockResolvedValue({});

    await service.createBid('pp1');

    expect(gbCode.allocateProcureCode).toHaveBeenCalledWith(null); // legacy 采购项目无 PMI 宿主 → 自立基码
    expect(prisma.bidProject.create.mock.calls[0][0].data.gbProcureCode).toBe('511510000261020001001');
    expect(prisma.bidProject.create.mock.calls[0][0].data.gbSectionCode).toBe('511510000261020001001001');
  });
});
