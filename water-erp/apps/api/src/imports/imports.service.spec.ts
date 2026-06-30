import { ImportsService } from './imports.service';

jest.mock('node:fs', () => ({
  existsSync: jest.fn(() => true),
}));

jest.mock('xlsx', () => ({
  readFile: jest.fn(() => ({
    SheetNames: ['Sheet1'],
    Sheets: { Sheet1: {} },
  })),
  utils: {
    sheet_to_json: jest.fn(() => [
      [
        '日期',
        '时间',
        '项目名称',
        '采购方式',
        '部门',
        '供应商',
        '预算',
        '控制价',
        '成交供应商',
        '结果',
      ],
      [
        '2026-04-01',
        null,
        '项目 A',
        '竞争性谈判',
        '采购中心',
        '供应商 A',
        '100000',
        '120000',
        null,
        '资格审查未通过',
      ],
      [
        '2026-04-02',
        null,
        '项目 B',
        '竞争性谈判',
        '采购中心',
        '供应商 B',
        '200000',
        '220000',
        '供应商 B',
        '180000',
      ],
      [
        '2026-04-03',
        null,
        '项目 C',
        '询价',
        '采购中心',
        '供应商 C',
        '300000',
        '320000',
        null,
        '',
      ],
    ]),
  },
}));

describe('ImportsService', () => {
  const makeService = () => {
    const tx = {
      roundParticipant: {
        deleteMany: jest.fn(),
        upsert: jest.fn().mockResolvedValue({ id: 'participant-1' }),
      },
      procurementRound: {
        deleteMany: jest.fn(),
        create: jest.fn().mockResolvedValue({ id: 'round-1' }),
      },
      importBatch: {
        deleteMany: jest.fn(),
        create: jest.fn().mockResolvedValue({ id: 'batch-1' }),
        update: jest.fn().mockResolvedValue({ id: 'batch-1' }),
      },
      project: {
        upsert: jest.fn().mockResolvedValue({ id: 'project-1', name: '项目' }),
      },
      department: {
        upsert: jest.fn().mockResolvedValue({ id: 'dept-1', name: '采购中心' }),
      },
      supplier: {
        upsert: jest
          .fn()
          .mockResolvedValue({ id: 'supplier-1', name: '供应商' }),
      },
    };

    const prisma = {
      $transaction: jest.fn(
        async (callback: (client: typeof tx) => Promise<void>) => callback(tx),
      ),
    };

    return { service: new ImportsService(prisma as never), tx };
  };

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  it('updates import batch warning count based on parsed rows missing procurement dates', async () => {
    const { service, tx } = makeService();

    await service.importWorkbookFromDefaultFile();

    expect(tx.importBatch.update).toHaveBeenCalledWith({
      where: { id: 'batch-1' },
      data: {
        successCount: 3,
        warningCount: 0,
        errorCount: 0,
      },
    });
  });
});
