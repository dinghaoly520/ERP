import { ImportsService } from './imports.service';
import { BadRequestException } from '@nestjs/common';

jest.mock('node:fs', () => ({
  existsSync: jest.fn(() => true),
}));

// Header names must match what parseNewFormatRows reads in imports.service.ts
const HEADER_ROW = [
  '开标日期',
  '开标时间',
  '项目名称',
  '采购类别',
  '需求部门',
  '拟邀请的供应商',
  '预算价（元）',
  '控制价（元）',
  '中标商',
  '最终价（元）',
];

const DATA_ROWS = [
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
];

// Source calls sheet_to_json with different option shapes:
//   - header detection: { header: 1, range: 0 } → returns [HEADER_ROW]
//   - old-format parse: { header: 1 } → returns [HEADER_ROW, ...DATA_ROWS]
//   - new-format parse: no header:1 → returns Record<string, unknown>[]
jest.mock('xlsx', () => ({
  readFile: jest.fn(() => ({
    SheetNames: ['Sheet1'],
    Sheets: { Sheet1: {} },
  })),
  utils: {
    sheet_to_json: jest.fn((_sheet: unknown, options?: Record<string, unknown>) => {
      const isArrayMode = options?.header === 1;
      const isHeaderOnly = options?.range === 0;

      if (isArrayMode && isHeaderOnly) {
        return [HEADER_ROW];
      }
      if (isArrayMode) {
        return [HEADER_ROW, ...DATA_ROWS];
      }
      // JSON-style: map each data row to an object keyed by header names
      return DATA_ROWS.map((row) => {
        const obj: Record<string, unknown> = {};
        HEADER_ROW.forEach((key, index) => {
          obj[key] = row[index];
        });
        return obj;
      });
    }),
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

  it('importWorkbookFromPath 拒绝 ../ 路径穿越且不读文件', async () => {
    const { service } = makeService();
    await expect(service.importWorkbookFromPath('../../etc/passwd'))
      .rejects.toThrow(BadRequestException);
    const XLSX = (await import('xlsx')) as any;
    expect(XLSX.readFile).not.toHaveBeenCalled();
  });

  it('importWorkbookFromPath 拒绝绝对路径（读取任意服务器文件）', async () => {
    const { service } = makeService();
    await expect(service.importWorkbookFromPath('/etc/shadow'))
      .rejects.toThrow(BadRequestException);
  });

  it('importWorkbookFromPath 允许导入目录内的相对路径', async () => {
    const { service, tx } = makeService();
    await service.importWorkbookFromPath('采购汇总表.xlsx');
    expect(tx.importBatch.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'batch-1' } }),
    );
  });
});
