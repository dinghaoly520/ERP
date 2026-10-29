import { AlertsService } from './alerts.service';

describe('AlertsService', () => {
  let service: AlertsService;
  const prisma = {
    supplierQualification: { count: jest.fn(), findMany: jest.fn() },
    bidExpert: { findMany: jest.fn(), count: jest.fn() },
    expertEvaluation: { findMany: jest.fn() },
  };
  const companyScope = {
    resolveScope: jest.fn().mockResolvedValue({ all: false, companyIds: ['co-1'] }),
  };
  const ACTOR_STAFF = { sub: 'u-1', role: 'staff', username: 'S-01' } as any;

  beforeEach(() => {
    prisma.supplierQualification.count.mockReset().mockResolvedValue(0);
    prisma.supplierQualification.findMany.mockReset().mockResolvedValue([]);
    prisma.bidExpert.findMany.mockReset().mockResolvedValue([]);
    prisma.bidExpert.count.mockReset().mockResolvedValue(0);
    prisma.expertEvaluation.findMany.mockReset().mockResolvedValue([]);
    service = new AlertsService(prisma as any, companyScope as any);
  });

  describe('overview', () => {
    it('返回临期资质数 + 过载专家数（>3 未归档项目）', async () => {
      prisma.supplierQualification.count.mockResolvedValue(3);
      // e1 有 4 个未归档分配（>3 → 过载），e2 有 2 个（不过载），e3 有 5 个（过载）
      prisma.bidExpert.findMany.mockResolvedValue([
        ...Array(4).fill({ userId: 'e1' }),
        ...Array(2).fill({ userId: 'e2' }),
        ...Array(5).fill({ userId: 'e3' }),
      ]);
      const res = await service.overview();
      expect(res.expiringQualifications).toBe(3);
      expect(res.overloadedExperts).toBe(2); // e1 + e3
    });

    it('无过载时返回 0', async () => {
      prisma.supplierQualification.count.mockResolvedValue(0);
      prisma.bidExpert.findMany.mockResolvedValue([{ userId: 'e1' }, { userId: 'e1' }]);
      const res = await service.overview();
      expect(res.overloadedExperts).toBe(0);
    });

    it('口径收口（2026-10-28）：临期资质=库内四态+公司视野，过载专家限在编评标专家+按归属公司过滤', async () => {
      await service.overview(ACTOR_STAFF);
      // 临期资质：与供应商总览 getStats/资质预警同口径（库内四态 + link 视野）
      const qualWhere = prisma.supplierQualification.count.mock.calls[0][0].where;
      expect(qualWhere.supplier.status).toEqual({ in: ['APPROVED', 'DISABLED', 'BLACKLIST'] });
      expect(qualWhere.supplier.companyLinks).toEqual({ some: { companyId: { in: ['co-1'] }, status: 'APPROVED' } });
      // 过载专家：限在编评标专家（role+isActive），专家库已公司隔离（User.companyId）不跨视野计数
      const expertWhere = prisma.bidExpert.findMany.mock.calls[0][0].where;
      expect(expertWhere.user).toEqual({ role: 'bid_expert', isActive: true, companyId: { in: ['co-1'] } });
    });

    it('无 actor（内部调用）：人口口径同样生效，公司过滤不注入', async () => {
      await service.overview();
      const qualWhere = prisma.supplierQualification.count.mock.calls[0][0].where;
      expect(qualWhere.supplier.status).toEqual({ in: ['APPROVED', 'DISABLED', 'BLACKLIST'] });
      expect(qualWhere.supplier.companyLinks).toBeUndefined();
      const expertWhere = prisma.bidExpert.findMany.mock.calls[0][0].where;
      expect(expertWhere.user).toEqual({ role: 'bid_expert', isActive: true });
    });
  });

  describe('supplierAlerts', () => {
    it('返回该供应商 90 天内临期资质（含已过期），附 daysLeft', async () => {
      prisma.supplierQualification.findMany.mockResolvedValue([
        { id: 'q1', name: '营业执照', type: 'BUSINESS_LICENSE', validTo: new Date(Date.now() + 10 * 86400000) },
        { id: 'q2', name: '安全生产许可证', type: 'SAFETY', validTo: new Date(Date.now() + 200 * 86400000) }, // 超过 90 天，应被过滤
      ]);
      const res = await service.supplierAlerts('s1');
      expect(res.expiringQualifications).toHaveLength(1);
      expect(res.expiringQualifications[0].name).toBe('营业执照');
      expect(res.expiringQualifications[0].daysLeft).toBeLessThanOrEqual(90);
    });
  });

  describe('expertAlerts', () => {
    it('连续 2 次 E 级 → consecutiveE=true', async () => {
      prisma.bidExpert.count.mockResolvedValue(1);
      prisma.expertEvaluation.findMany.mockResolvedValue([
        { overallGrade: 'E' }, { overallGrade: 'E' },
      ]);
      const res = await service.expertAlerts('e1');
      expect(res.consecutiveE).toBe(true);
      expect(res.overloaded).toBe(false);
    });

    it('参与 >3 未归档项目 → overloaded=true', async () => {
      prisma.bidExpert.count.mockResolvedValue(4);
      prisma.expertEvaluation.findMany.mockResolvedValue([{ overallGrade: 'A' }]);
      const res = await service.expertAlerts('e1');
      expect(res.overloaded).toBe(true);
      expect(res.consecutiveE).toBe(false);
    });
  });
});
