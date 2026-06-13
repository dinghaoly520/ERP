import { Test, TestingModule } from '@nestjs/testing';
import { SupplierPortalService } from './supplier-portal.service';
import { PrismaService } from '../prisma/prisma.service';

describe('SupplierPortalService', () => {
  let service: SupplierPortalService;
  let prisma: any;

  const mockSupplier = {
    id: 'supplier-1',
    userId: 'user-1',
    name: '四川川水建设工程有限公司',
    creditCode: '91510000MA62K5XX0X',
    enterpriseType: '国有企业',
    legalPerson: '张明',
    registeredAddress: '成都市高新区天府大道北段1700号',
    businessScope: '水利水电工程施工',
    status: 'APPROVED',
    classificationId: 'cls-1',
    contacts: [{ name: '张经理', phone: '13800138001', isPrimary: true }],
    qualifications: [
      { type: '营业执照', name: '企业法人营业执照', validTo: new Date('2030-12-31'), status: '有效' },
      { type: '资质证书', name: '水利水电一级', validTo: new Date('2028-06-30'), status: '有效' },
    ],
  };

  beforeEach(async () => {
    prisma = {
      supplier: { findUnique: jest.fn() },
      bidProject: { findUnique: jest.fn(), findMany: jest.fn() },
      supplierEvaluation: { count: jest.fn() },
      supplierBidSubmission: {
        count: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        create: jest.fn(),
      },
      bidSupplier: {
        findFirst: jest.fn(),
        update: jest.fn(),
        create: jest.fn(),
      },
      supplierChangeRecord: { count: jest.fn() },
      supplierQualification: { count: jest.fn() },
      notification: { count: jest.fn() },
      user: { findUnique: jest.fn() },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [SupplierPortalService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get<SupplierPortalService>(SupplierPortalService);
  });

  describe('getDashboardStats', () => {
    it('应返回供应商仪表盘统计（包含完整度评分）', async () => {
      prisma.supplier.findUnique.mockResolvedValue(mockSupplier);
      prisma.supplierEvaluation.count.mockResolvedValue(3);
      prisma.supplierBidSubmission.count.mockResolvedValue(2);
      prisma.supplierChangeRecord.count.mockResolvedValue(1);
      prisma.notification.count.mockResolvedValue(5);
      prisma.supplierQualification.count.mockResolvedValue(2);

      const result = await service.getDashboardStats('user-1');

      expect(result).toBeDefined();
      expect(result!.supplierStatus).toBe('APPROVED');
      expect(result!.evaluationCount).toBe(3);
      expect(result!.submissionCount).toBe(2);
      expect(result!.qualificationCount).toBe(2);
      expect(result!.pendingChanges).toBe(1);
      expect(result!.unreadNotifications).toBe(5);
      expect(result!.profileCompleteness).toBeDefined();
      expect(result!.profileCompleteness.score).toBeGreaterThanOrEqual(0);
      expect(result!.profileCompleteness.score).toBeLessThanOrEqual(100);
    });

    it('无供应商记录时应返回 null', async () => {
      prisma.supplier.findUnique.mockResolvedValue(null);

      const result = await service.getDashboardStats('nonexistent');

      expect(result).toBeNull();
    });

    it('资质齐全的供应商应有较高完整度', async () => {
      const fullSupplier = {
        ...mockSupplier,
        contacts: [
          { name: '张经理', phone: '13800138001', isPrimary: true },
          { name: '王芳', phone: '13800138002', isPrimary: false },
        ],
        qualifications: [
          { type: '营业执照', name: '企业法人营业执照', validTo: new Date('2030-12-31'), status: '有效' },
          { type: '资质证书', name: '水利水电一级', validTo: new Date('2028-06-30'), status: '有效' },
          { type: '安全生产许可证', name: '安全生产许可证', validTo: new Date('2027-03-14'), status: '有效' },
        ],
      };
      prisma.supplier.findUnique.mockResolvedValue(fullSupplier);
      prisma.supplierEvaluation.count.mockResolvedValue(0);
      prisma.supplierBidSubmission.count.mockResolvedValue(0);
      prisma.supplierChangeRecord.count.mockResolvedValue(0);
      prisma.notification.count.mockResolvedValue(0);

      const result = await service.getDashboardStats('user-1');

      expect(result!.profileCompleteness.score).toBeGreaterThanOrEqual(80);
    });

    it('缺少基本信息的供应商应有较低完整度并包含缺失项', async () => {
      const minimal = {
        id: 'supplier-2',
        userId: 'user-2',
        name: null,
        creditCode: null,
        enterpriseType: null,
        legalPerson: null,
        registeredAddress: null,
        businessScope: null,
        status: 'PENDING',
        classificationId: null,
        contacts: [],
        qualifications: [],
      };

      prisma.supplier.findUnique.mockResolvedValue(minimal);
      prisma.supplierEvaluation.count.mockResolvedValue(0);
      prisma.supplierBidSubmission.count.mockResolvedValue(0);
      prisma.supplierChangeRecord.count.mockResolvedValue(0);
      prisma.notification.count.mockResolvedValue(0);

      const result = await service.getDashboardStats('user-2');

      expect(result!.profileCompleteness.score).toBeLessThan(30);
      expect(result!.profileCompleteness.missing.length).toBeGreaterThan(5);
    });
  });

  describe('submitBid', () => {
    it('rejects submission when project is not in SUBMIT stage', async () => {
      prisma.supplier.findUnique.mockResolvedValue({ id: 'supplier-1', name: '测试供应商', status: 'APPROVED' });
      prisma.bidProject.findUnique.mockResolvedValue({
        id: 'project-1', stage: 'OPENING',
        deadline: new Date(Date.now() + 3600_000),
      });
      await expect(service.submitBid('supplier-1', 'project-1', { bidPrice: '100' }))
        .rejects.toMatchObject({ response: { code: 'PROJECT_NOT_SUBMITTING' } });
    });

    it('rejects submission after deadline', async () => {
      prisma.supplier.findUnique.mockResolvedValue({ id: 'supplier-1', name: '测试供应商', status: 'APPROVED' });
      prisma.bidProject.findUnique.mockResolvedValue({
        id: 'project-1', stage: 'SUBMIT',
        deadline: new Date(Date.now() - 3600_000),
      });
      await expect(service.submitBid('supplier-1', 'project-1', { bidPrice: '100' }))
        .rejects.toMatchObject({ response: { code: 'DEADLINE_PASSED' } });
    });

    it('rejects non-APPROVED supplier', async () => {
      prisma.supplier.findUnique.mockResolvedValue({ id: 'supplier-2', name: '待审供应商', status: 'PENDING' });
      prisma.bidProject.findUnique.mockResolvedValue({
        id: 'project-1', stage: 'SUBMIT',
        deadline: new Date(Date.now() + 3600_000),
      });
      await expect(service.submitBid('supplier-2', 'project-1', { bidPrice: '100' }))
        .rejects.toMatchObject({ response: { code: 'NOT_APPROVED' } });
    });

    it('allows valid submission', async () => {
      prisma.supplier.findUnique.mockResolvedValue({ id: 'supplier-1', name: '测试供应商', status: 'APPROVED' });
      prisma.bidProject.findUnique.mockResolvedValue({
        id: 'project-1', stage: 'SUBMIT',
        deadline: new Date(Date.now() + 3600_000),
      });
      prisma.supplierBidSubmission.findUnique.mockResolvedValue(null);
      prisma.supplierBidSubmission.create.mockResolvedValue({
        id: 'sub-1', supplierId: 'supplier-1', projectId: 'project-1', status: 'submitted',
      });
      prisma.bidSupplier.findFirst.mockResolvedValue(null);
      prisma.bidSupplier.create.mockResolvedValue({ id: 'bs-1', supplierId: 'supplier-1' });

      const result = await service.submitBid('supplier-1', 'project-1', { bidPrice: '100' });
      expect(result.status).toBe('submitted');
    });
  });

  describe('listBidProjects', () => {
    it('返回招标项目列表，仅公开字段 + 投标方数量', async () => {
      prisma.bidProject.findMany.mockResolvedValue([{ id: 'p1', name: '项目一', stage: 'SUBMIT' }]);

      const result = await service.listBidProjects();

      expect(result).toHaveLength(1);
      const select = prisma.bidProject.findMany.mock.calls[0][0].select;
      expect(select._count).toEqual({ select: { suppliers: true } });
      // 不得拉取其他投标方身份或评审内部数据
      for (const f of ['suppliers', 'openingRecords', 'openingSession', 'experts', 'scoreItems', 'supervisionLogs', 'archiveItems']) {
        expect(select[f]).toBeUndefined();
      }
    });
  });

  describe('getBidProject', () => {
    it('返回项目详情含澄清答疑，但不暴露投标方/开标记录/专家评分', async () => {
      prisma.bidProject.findUnique.mockResolvedValue({ id: 'p1', name: '项目一', clarifications: [] });

      const result = await service.getBidProject('p1');

      expect(result).not.toBeNull();
      expect(result!.id).toBe('p1');
      const select = prisma.bidProject.findUnique.mock.calls[0][0].select;
      expect(select.clarifications).toBeDefined();
      expect(select._count).toEqual({ select: { suppliers: true } });
      for (const f of ['suppliers', 'openingRecords', 'openingSession', 'experts', 'scoreItems', 'supervisionLogs', 'archiveItems']) {
        expect(select[f]).toBeUndefined();
      }
    });
  });
});
