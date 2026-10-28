import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { ExpertAdminService, expertBreachEventsFromLogs } from './expert-admin.service';
import { ExpertExtractionService } from './expert-extraction.service';
import { PrismaService } from '../prisma/prisma.service';
import { ExpertExtractionAiService } from './expert-extraction-ai.service';
import { NotificationService } from '../notification/notification.service';
import { EmbeddingService } from '../local-ai/embedding.service';
import { LlmService } from '../local-ai/llm.service';
import { OcrService } from '../local-ai/ocr.service';
import { CompanyScopeService } from '../company/company-scope';
import { ExpertCrossConflictService } from './expert-cross-conflict.service';
import { sealPii } from '../common/crypto/sm-field-crypto';

describe('ExpertAdminService', () => {
  let service: ExpertAdminService;
  let prisma: any;
  let extractionAi: any;
  let notification: any;
  let companyScope: any;
  let llm: any;

  beforeEach(async () => {
    companyScope = {
      resolveScope: jest.fn().mockResolvedValue({ all: true }),
      filter: jest.fn().mockReturnValue({}),
      assertInScope: jest.fn(),
      stampFor: jest.fn().mockResolvedValue({}),
    };
    llm = { chat: jest.fn(), chatJson: jest.fn(), getModel: jest.fn().mockReturnValue(null) };
    prisma = {
      user: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
        count: jest.fn().mockResolvedValue(0),
        groupBy: jest.fn().mockResolvedValue([]),
      },
      bidExpert: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        upsert: jest.fn().mockResolvedValue({}),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      expertInvitationLog: { create: jest.fn().mockResolvedValue({}), findMany: jest.fn().mockResolvedValue([]) },
      bidProject: {
        findUnique: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
      },
      company: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
      },
      bidRound: {
        count: jest.fn().mockResolvedValue(0),
      },
      expertEvaluation: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        groupBy: jest.fn().mockResolvedValue([]),
      },
      expertProfile: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn(),
        count: jest.fn().mockResolvedValue(0),
        groupBy: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        upsert: jest.fn().mockResolvedValue({}),
      },
      bidSupervisionLog: {
        create: jest.fn().mockResolvedValue({}),
      },
      auditLog: {
        create: jest.fn().mockResolvedValue({}),
        count: jest.fn().mockResolvedValue(0),
      },
      // 同时支持数组式（Promise.all）与函数式（执行回调）事务，使事务内逻辑真实运行
      $transaction: jest.fn().mockImplementation(async (arg: any) =>
        typeof arg === 'function' ? arg(prisma) : Promise.all(arg),
      ),
    };
    extractionAi = {
      analyzeAndScore: jest.fn(),
      getMetrics: jest.fn().mockReturnValue({ llmCalls: 0, llmErrors: 0, fallbackCount: 0 }),
      recordFallback: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        { provide: CompanyScopeService, useValue: companyScope },
        ExpertAdminService,
        { provide: PrismaService, useValue: prisma },
        { provide: ExpertExtractionAiService, useValue: extractionAi },
        { provide: NotificationService, useValue: { create: jest.fn(), sendToRole: jest.fn(), sendToUser: jest.fn().mockResolvedValue({}) } },
        { provide: EmbeddingService, useValue: { embed: jest.fn().mockResolvedValue([]) } },
        { provide: LlmService, useValue: llm },
        { provide: OcrService, useValue: { isAvailable: jest.fn().mockResolvedValue(false), ocrImage: jest.fn() } },
        { provide: ExpertCrossConflictService, useValue: { checkCrossConflicts: jest.fn().mockResolvedValue([]) } },
        { provide: ExpertExtractionService, useValue: { extendedRuleScore: jest.fn() } },
      ],
    }).compile();

    service = module.get<ExpertAdminService>(ExpertAdminService);
    notification = module.get(NotificationService);
  });

  describe('listExperts', () => {
    it('应返回专家列表含评审统计', async () => {
      prisma.user.findMany.mockResolvedValue([
        { id: 'u1', displayName: '王建国', email: 'wang@test.com', department: { id: 'd1', name: '工程部' }, bidExperts: [{ id: 'e1', progress: 80, major: '水利工程', project: { name: '测试项目', stage: 'EVALUATING' } }] },
        { id: 'u2', displayName: '刘晓梅', email: 'liu@test.com', department: null, bidExperts: [] },
      ]);

      const result = await service.listExperts();
      expect(result.items).toHaveLength(2);
      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ role: 'bid_expert' }) }),
      );
    });

    it('应支持搜索（姓名/专业/单位/部门 OR 模糊）', async () => {
      prisma.user.findMany.mockResolvedValue([]);
      await service.listExperts('王');
      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: expect.arrayContaining([
              expect.objectContaining({ displayName: { contains: '王', mode: 'insensitive' } }),
            ]),
          }),
        }),
      );
    });

    it('只传专业不传公司时专业筛选不丢失（专业配额行人数按专业计数）', async () => {
      prisma.user.findMany.mockResolvedValue([]);
      prisma.user.count.mockResolvedValue(3);
      await service.listExperts(undefined, '地质');
      expect(prisma.user.count).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ expertProfile: { specialty: '地质' } }) }),
      );
    });

    it('专业与公司同时传入时两者都生效', async () => {
      prisma.user.findMany.mockResolvedValue([]);
      await service.listExperts(undefined, '地质', '设计院');
      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ expertProfile: { specialty: '地质', employer: '设计院' } }) }),
      );
    });
  });

  describe('listSpecialties（专业池口径）', () => {
    it('默认（无 scope）：按操作人公司隔离——where 挂公司过滤', async () => {
      companyScope.resolveScope.mockResolvedValue({ all: false, companyIds: ['co-me'] });
      companyScope.filter.mockReturnValue({ companyId: 'co-me' });
      prisma.expertProfile.findMany.mockResolvedValue([{ specialty: '水利工程' }]);
      await service.listSpecialties({ sub: 'u1', role: 'staff' } as any);
      expect(prisma.expertProfile.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { user: { isActive: true, role: 'bid_expert', companyId: 'co-me' } } }),
      );
    });

    it("scope='group'：全库去重专业、不挂公司过滤（与 AI 专业池/跨公司抽取同口径）", async () => {
      prisma.expertProfile.findMany.mockResolvedValue([{ specialty: '法律' }, { specialty: '水利工程' }]);
      const res = await service.listSpecialties({ sub: 'u1', role: 'staff' } as any, undefined, 'group');
      expect(companyScope.resolveScope).not.toHaveBeenCalled();
      expect(prisma.expertProfile.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { user: { isActive: true, role: 'bid_expert' } } }),
      );
      expect(res).toEqual(['法律', '水利工程']);
    });
  });

  describe('specialtyPoolCounts（全库各专业人数）', () => {
    it('一次 groupBy 返回 specialty/count（按人数降序），限定可抽取人口（2026-10-28 口径收口：ACTIVE+可用，与 getDemandRepDirectory 同口径）', async () => {
      prisma.expertProfile.groupBy.mockResolvedValue([
        { specialty: '水利工程', _count: { _all: 3 } },
        { specialty: '测绘工程', _count: { _all: 5 } },
        { specialty: '   ', _count: { _all: 1 } },
      ]);
      const res = await service.specialtyPoolCounts();
      expect(prisma.expertProfile.groupBy).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { entryStatus: 'ACTIVE', availability: '可用', user: { isActive: true, role: 'bid_expert' } },
        }),
      );
      expect(res).toEqual([
        { specialty: '测绘工程', count: 5 },
        { specialty: '水利工程', count: 3 },
      ]);
    });
  });

  describe('统计口径收口（2026-10-28：可用=可抽取人口、停用=退库、统计闸去重）', () => {
    const ACTOR = { sub: 'u-1', role: 'leader', username: 'S-01' } as any;

    it('getStatistics：availGroups 限库内 ACTIVE+账号在编；disabled=RETIRED 计数（entryStatus 为准）', async () => {
      prisma.user.count.mockResolvedValue(10);
      prisma.expertProfile.groupBy.mockImplementation(({ by }: any) =>
        by[0] === 'availability'
          ? Promise.resolve([{ availability: '可用', _count: 3 }, { availability: '占用', _count: 2 }])
          : Promise.resolve([]));
      prisma.expertProfile.count.mockResolvedValue(1);
      const res = await service.getStatistics(ACTOR);
      const availCall = prisma.expertProfile.groupBy.mock.calls.find((c: any[]) => c[0].by?.[0] === 'availability')![0];
      expect(availCall.where.entryStatus).toBe('ACTIVE');
      expect(availCall.where.user.isActive).toBe(true);
      expect(res.available).toBe(3);
      expect(res.occupied).toBe(2);
      expect(res.disabled).toBe(1);
      expect(prisma.expertProfile.count).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({ entryStatus: 'RETIRED' }),
      }));
    });

    it('getStatistics：评价统计按槽位去重（2026-10-21 统计闸裁定，此前本端点为唯一漏网）', async () => {
      prisma.user.count.mockResolvedValue(5);
      prisma.expertProfile.groupBy.mockResolvedValue([]);
      prisma.expertEvaluation.findMany.mockResolvedValue([
        { overallGrade: 'A', expertUserId: 'e1', evaluatorId: 'v1', projectId: 'p1', createdAt: new Date('2026-01-01'), updatedAt: new Date('2026-01-01'), expertUser: { displayName: '甲' } },
        { overallGrade: 'C', expertUserId: 'e1', evaluatorId: 'v1', projectId: 'p1', createdAt: new Date('2026-02-01'), updatedAt: new Date('2026-02-01'), expertUser: { displayName: '甲' } },
        { overallGrade: 'B', expertUserId: 'e2', evaluatorId: 'v1', projectId: null, createdAt: new Date('2026-03-01'), updatedAt: new Date('2026-03-01'), expertUser: { displayName: '乙' } },
      ]);
      const res = await service.getStatistics(ACTOR);
      expect(res.evaluationStats.total).toBe(2); // 同槽位两条只计最新一票
      expect(res.evaluationStats.levelCounts.A).toBe(0);
      expect(res.evaluationStats.levelCounts.C).toBe(1);
      expect(res.evaluationStats.levelCounts.B).toBe(1);
    });

    it('getLoadDistribution：活跃专家/分配均限库内 ACTIVE（PENDING/SUSPENDED 不入负荷分母）', async () => {
      prisma.user.count.mockResolvedValue(4);
      prisma.bidExpert.findMany.mockResolvedValue([]);
      const res = await service.getLoadDistribution(ACTOR);
      const countWhere = prisma.user.count.mock.calls[0][0].where;
      expect(countWhere.expertProfile).toEqual({ entryStatus: 'ACTIVE' });
      const assignWhere = prisma.bidExpert.findMany.mock.calls[0][0].where;
      expect(assignWhere.user.expertProfile).toEqual({ entryStatus: 'ACTIVE' });
      expect(res.totalActiveExperts).toBe(4);
      expect(res.loadDistribution['空闲']).toBe(4);
    });

    it('reviewRetirementCandidates：待审核(PENDING)专家不入退库候选扫描', async () => {
      prisma.user.findMany.mockResolvedValue([]);
      await service.reviewRetirementCandidates(ACTOR);
      const where = prisma.user.findMany.mock.calls[0][0].where;
      expect(where.expertProfile.entryStatus).toEqual({ in: ['ACTIVE', 'SUSPENDED'] });
    });
  });

  describe('analyzeProjectSpecialties（AI 配额行附挂持专业公司）', () => {
    it('每行 companyIds=持有该组专业的公司并集——跨公司配额直达可抽', async () => {
      prisma.bidProject.findUnique.mockResolvedValue({
        name: '人事档案数字化服务',
        procurementMethod: '竞价采购',
        scope: '档案数字化加工、扫描图像处理与数据挂接',
        projectManagementItem: null,
      });
      // 全库专业池（含归属公司）：换血后「信息技术/法律」等专业只在别家公司
      prisma.expertProfile.findMany.mockResolvedValue([
        { specialty: '信息技术应用与管理、保险', user: { companyId: 'co-jt' } },
        { specialty: '法律', user: { companyId: 'co-js' } },
        { specialty: '水利工程管理', user: { companyId: 'co-sjy' } },
      ]);
      llm.chat.mockResolvedValue(JSON.stringify({
        requiredSpecialties: [
          { specialty: '信息技术应用与管理、保险', specialties: ['信息技术应用与管理、保险'], count: 2, reason: '档案数字化需信息技术评审' },
          { specialty: '法律', specialties: ['法律'], count: 1, reason: '合同合规需法律评审' },
          { specialty: '量子力学', specialties: ['量子力学'], count: 1, reason: '库内无此专业应被丢弃' },
        ],
        totalExperts: 3,
        analysis: '档案数字化以信息技术为核心',
      }));
      const res = await service.analyzeProjectSpecialties('p1');
      expect(res.engine).toBe('ai');
      expect(res.requiredSpecialties.map(r => r.specialty)).toEqual(['信息技术应用与管理、保险', '法律']);
      expect(res.requiredSpecialties[0].companyIds).toEqual(['co-jt']);
      expect(res.requiredSpecialties[1].companyIds).toEqual(['co-js']);
    });
  });

  describe('getExpert', () => {
    it('应返回专家详情含统计', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'u1', displayName: '王建国', username: 'wangjg', role: 'bid_expert' });
      prisma.bidExpert.findMany.mockResolvedValue([
        { progress: 100, signedIn: true, project: { name: '项目A' }, scoreRecords: [] },
        { progress: 50, signedIn: false, project: { name: '项目B' }, scoreRecords: [] },
      ]);
      prisma.expertEvaluation.findMany.mockResolvedValue([]);

      const result = await service.getExpert('u1');
      expect(result.statistics.totalProjects).toBe(2);
      expect(result.statistics.completedProjects).toBe(1);
      expect(result.statistics.signedInProjects).toBe(1);
    });

    it('用户不存在应抛 NotFoundException', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(service.getExpert('nonexistent')).rejects.toThrow(NotFoundException);
    });
  });

  describe('listExpertProjects', () => {
    it('应返回专家参与的项目列表', async () => {
      prisma.bidExpert.findMany.mockResolvedValue([
        { id: 'e1', project: { id: 'p1', name: '项目A', stage: 'EVALUATING' } },
      ]);

      const result = await service.listExpertProjects('u1');
      expect(result).toHaveLength(1);
      expect(prisma.bidExpert.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: 'u1' } }),
      );
    });
  });

  describe('getRanking（排名 id 错位回归 · 按 A 级数降序）', () => {
    it('排序后 expertUserId 必须与对应行一致，不张冠李戴', async () => {
      prisma.expertEvaluation.findMany.mockResolvedValue([
        { expertUserId: 'userA', overallGrade: 'C', expertUser: { displayName: '专家甲', expertProfile: { specialty: '施工' } } },
        { expertUserId: 'userB', overallGrade: 'A', expertUser: { displayName: '专家乙', expertProfile: { specialty: '地质' } } },
      ]);
      const rows = await service.getRanking('all');
      expect(rows[0].rank).toBe(1);
      expect(rows[0].expertUserId).toBe('userB'); // A 级数多者居首且 id 对齐
      expect(rows[0].displayName).toBe('专家乙');
      expect(rows[0].aCount).toBe(1); // 行内等级统计与 id 同源，杜绝张冠李戴
      expect(rows[0].gradeCounts).toEqual({ A: 1, B: 0, C: 0, D: 0, E: 0 });
      expect(rows[1].expertUserId).toBe('userA');
      expect(rows[1].displayName).toBe('专家甲');
      expect(rows[1].aCount).toBe(0);
      expect(rows[1].gradeCounts).toEqual({ A: 0, B: 0, C: 1, D: 0, E: 0 });
    });

    it('完全并列应共享名次（竞赛排名 1,1）', async () => {
      prisma.expertEvaluation.findMany.mockResolvedValue([
        { expertUserId: 'uX', overallGrade: 'B', expertUser: { displayName: 'X', expertProfile: { specialty: '施工' } } },
        { expertUserId: 'uY', overallGrade: 'B', expertUser: { displayName: 'Y', expertProfile: { specialty: '地质' } } },
      ]);
      const rows = await service.getRanking('all');
      expect(rows[0].rank).toBe(1);
      expect(rows[1].rank).toBe(1);
      expect(rows[0].aCount).toBe(0); // 并列键 = aCount|evalCount，两者均为 0|1
      expect(rows[0].evalCount).toBe(1);
    });
  });

  describe('listPoolCompanies（配额公司下拉=库内可抽取口径，2026-10-20）', () => {
    it('仅返回库内可抽取专家≥1 的公司，资格口径与抽取池一致', async () => {
      (prisma.user.groupBy as jest.Mock).mockResolvedValue([
        { companyId: 'co-a' }, { companyId: 'co-b' }, { companyId: null },
      ]);
      (prisma.company.findMany as jest.Mock).mockResolvedValue([
        { id: 'co-a', name: '四川水发建设有限公司', shortName: '建设' },
        { id: 'co-b', name: '四川水发能源开发有限公司', shortName: '能源' },
      ]);
      const res = await service.listPoolCompanies();
      // 资格口径与 previewExtraction 候选池一致：在库 ACTIVE + 可用 + 账号激活 + 已归属公司
      expect(prisma.user.groupBy).toHaveBeenCalledWith(expect.objectContaining({
        by: ['companyId'],
        where: {
          role: 'bid_expert',
          isActive: true,
          companyId: { not: null },
          expertProfile: { availability: '可用', entryStatus: 'ACTIVE' },
        },
      }));
      // null 归属（未归属专家）不产生下拉项
      expect((prisma.company.findMany as jest.Mock).mock.calls[0][0].where).toEqual({ id: { in: ['co-a', 'co-b'] } });
      expect(res.map((c: any) => c.id)).toEqual(['co-a', 'co-b']);
    });

    it('库内无可抽取专家时不查公司表、返回空数组', async () => {
      (prisma.user.groupBy as jest.Mock).mockResolvedValue([{ companyId: null }]);
      const res = await service.listPoolCompanies();
      expect(res).toEqual([]);
      expect(prisma.company.findMany).not.toHaveBeenCalled();
    });
  });

  describe('setAvailability（越权防护回归）', () => {
    it('非专家角色应被拒绝（防止越权封号 admin/员工）', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'u9', role: 'admin' });
      await expect(service.setAvailability('u9', false)).rejects.toThrow(NotFoundException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
    it('专家角色正常启停（停用须真写 isActive=false 与 availability）', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'u1', role: 'bid_expert' });
      await expect(service.setAvailability('u1', false)).resolves.toEqual({ success: true });
      expect(prisma.$transaction).toHaveBeenCalled();
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'u1' }, data: { isActive: false } }),
      );
      expect(prisma.expertProfile.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: 'u1' }, data: { availability: '停用' } }),
      );
    });
  });

  describe('confirmRetire / updateProfile（越权防护回归）', () => {
    it('confirmRetire 拒绝非专家', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'u9', role: 'leader' });
      await expect(service.confirmRetire('u9', '测试')).rejects.toThrow(NotFoundException);
    });
    it('updateProfile 拒绝非专家', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'u9', role: 'staff' });
      await expect(service.updateProfile('u9', { displayName: 'x' })).rejects.toThrow(NotFoundException);
    });
    it('A-129：regionCode/expertLevel 随管理端编辑落 expertProfile（update 与 create 两分支都带）', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'u1', role: 'bid_expert' });
      await service.updateProfile('u1', { regionCode: '510000', expertLevel: 'B' });
      expect(prisma.expertProfile.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'u1' },
          update: expect.objectContaining({ regionCode: '510000', expertLevel: 'B' }),
          create: expect.objectContaining({ regionCode: '510000', expertLevel: 'B' }),
        }),
      );
    });
    it('A1：regionCode 传 null → update data 含 regionCode: null（清除）', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'u1', role: 'bid_expert' });
      await service.updateProfile('u1', { regionCode: null } as any);
      expect(prisma.expertProfile.upsert).toHaveBeenCalledWith(expect.objectContaining({
        update: expect.objectContaining({ regionCode: null }),
      }));
    });
    it('A1：regionCode 缺省（undefined）→ data 不含键（不动）', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'u1', role: 'bid_expert' });
      await service.updateProfile('u1', { title: '高工' } as any);
      const update = prisma.expertProfile.upsert.mock.calls[0][0].update;
      expect(update).not.toHaveProperty('regionCode');
    });
  });

  describe('createExpert（2026-10-15 录入收窄 admin：工作单位=公司选择器）', () => {
    const dto: any = {
      username: 'expert_new', displayName: '测试专家', password: '123456', specialty: '水利工程',
    };
    const createdExpert = {
      id: 'e1', username: dto.username, displayName: dto.displayName,
      expertProfile: { phone: null, idNumber: null, licenseNo: null, employer: '' },
    };

    it('companyId 给定 → User 归属与 ExpertProfile.employer 同用所选公司（防两列漂移）', async () => {
      prisma.user.findFirst.mockResolvedValue(null); // 账号查重
      prisma.user.findUnique.mockResolvedValue({ companyId: 'co-op', company: '操作人公司' }); // operatorCompanyOf
      prisma.company.findUnique.mockResolvedValue({ id: 'co-sel', name: '四川水发建设有限公司' });
      prisma.user.create.mockResolvedValue(createdExpert);

      await service.createExpert({ ...dto, companyId: 'co-sel' }, 'op-1');

      expect(prisma.user.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          companyId: 'co-sel',
          company: '四川水发建设有限公司',
          expertProfile: expect.objectContaining({ create: expect.objectContaining({ employer: '四川水发建设有限公司' }) }),
        }),
      }));
    });

    it('companyId 不存在 → 400 COMPANY_NOT_FOUND 且零写入', async () => {
      prisma.user.findFirst.mockResolvedValue(null);
      prisma.company.findUnique.mockResolvedValue(null);

      await expect(service.createExpert({ ...dto, companyId: 'co-x' }, 'op-1'))
        .rejects.toMatchObject({ response: { code: 'COMPANY_NOT_FOUND' } });
      expect(prisma.user.create).not.toHaveBeenCalled();
    });

    it('名称轨：单位名命中公司主数据 → 同源落归属（User.companyId 与 employer 同用该公司）', async () => {
      prisma.user.findFirst.mockResolvedValue(null);
      prisma.user.findUnique.mockResolvedValue({ companyId: 'co-op', company: '操作人公司' });
      prisma.company.findFirst.mockResolvedValue({ id: 'co-name', name: '四川水发建设有限公司' });
      prisma.user.create.mockResolvedValue(createdExpert);

      await service.createExpert({ ...dto, employer: '四川水发建设有限公司' }, 'op-1');

      expect(prisma.company.findFirst).toHaveBeenCalledWith(expect.objectContaining({
        where: { name: '四川水发建设有限公司' },
      }));
      expect(prisma.user.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          companyId: 'co-name',
          company: '四川水发建设有限公司',
          expertProfile: expect.objectContaining({ create: expect.objectContaining({ employer: '四川水发建设有限公司' }) }),
        }),
      }));
    });

    it('名称轨：单位名未命中（外部单位）→ 保留自由文本 + 回退操作人公司快照', async () => {
      prisma.user.findFirst.mockResolvedValue(null);
      prisma.user.findUnique.mockResolvedValue({ companyId: 'co-op', company: '操作人公司' });
      prisma.company.findFirst.mockResolvedValue(null);
      prisma.user.create.mockResolvedValue(createdExpert);

      await service.createExpert({ ...dto, employer: '自由文本单位' }, 'op-1');

      expect(prisma.company.findUnique).not.toHaveBeenCalled(); // id 轨未触发
      expect(prisma.user.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          companyId: 'co-op',
          company: '操作人公司',
          expertProfile: expect.objectContaining({ create: expect.objectContaining({ employer: '自由文本单位' }) }),
        }),
      }));
    });
  });

  describe('setLeader（P1-7 采购人代表禁任组长）', () => {
    it('采购人代表被拒绝担任组长', async () => {
      // I5：confirmed 前置闸通过，专测采购人代表禁任组长
      prisma.bidExpert.findUnique.mockResolvedValue({ projectId: 'p1', userId: 'u1', expertRole: '正选', invitationStatus: 'confirmed', isPurchaserRepresentative: true });
      await expect(service.setLeader('p1', 'u1')).rejects.toThrow('采购人代表不得担任评审组长');
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('I5（2026-09-24 全链审计）：pending/declined 正选不得任组长 → 400', async () => {
      prisma.bidExpert.findUnique.mockResolvedValue({ projectId: 'p1', userId: 'u1', expertRole: '正选', invitationStatus: 'declined', isPurchaserRepresentative: false });
      await expect(service.setLeader('p1', 'u1')).rejects.toThrow('仅已确认参加的正选专家可设为组长');
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('非代表的正选专家可正常设为组长', async () => {
      // I5：fixture 补 invitationStatus='confirmed'（仅已确认正选可任组长）
      prisma.bidExpert.findUnique.mockResolvedValue({ projectId: 'p1', userId: 'u1', expertRole: '正选', invitationStatus: 'confirmed', isPurchaserRepresentative: false });
      prisma.bidExpert.updateMany.mockResolvedValue({ count: 0 });
      prisma.bidExpert.update.mockResolvedValue({});
      const r = await service.setLeader('p1', 'u1');
      expect(r.success).toBe(true);
    });
  });

  describe('setCommitteeAssignment（A-132 评委分工）', () => {
    it('A-132：分工设置——合法两行 update + 监督日志；名册外 userId 400', async () => {
      prisma.bidExpert.findMany.mockResolvedValue([{ userId: 'u1', expertRole: '正选' }, { userId: 'u2', expertRole: '正选' }]);
      await service.setCommitteeAssignment('p1', { assignments: [
        { userId: 'u1', reviewGroup: '技术组', dutyRole: '主审' },
        { userId: 'u2', reviewGroup: '商务组', dutyRole: '复核' },
      ] } as any);
      expect(prisma.bidExpert.update).toHaveBeenCalledTimes(2);
      expect(prisma.bidExpert.update).toHaveBeenNthCalledWith(1, expect.objectContaining({
        where: { projectId_userId: { projectId: 'p1', userId: 'u1' } },
        data: { reviewGroup: '技术组', dutyRole: '主审' },
      }));
      expect(prisma.bidSupervisionLog.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ projectId: 'p1', action: '评委分工设置', riskFlag: '无' }),
      }));
      await expect(service.setCommitteeAssignment('p1', { assignments: [{ userId: 'uX', reviewGroup: '技术组' }] } as any))
        .rejects.toMatchObject({ response: { code: 'EXPERT_NOT_IN_COMMITTEE' } });
      expect(prisma.$transaction).toHaveBeenCalledTimes(1); // 名册外拒绝发生在事务前
    });

    it('A-132：非法枚举 400（reviewGroup 白名单；DTO IsIn 在管道层，service 层双保险）', async () => {
      prisma.bidExpert.findMany.mockResolvedValue([{ userId: 'u1', expertRole: '正选' }]);
      await expect(service.setCommitteeAssignment('p1', { assignments: [{ userId: 'u1', reviewGroup: 'A组' }] } as any))
        .rejects.toMatchObject({ response: { code: 'INVALID_COMMITTEE_VALUE' } });
      await expect(service.setCommitteeAssignment('p1', { assignments: [{ userId: 'u1', dutyRole: '组长' }] } as any))
        .rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('A-132：partial 更新——未提交的 dutyRole 不清空既有值', async () => {
      prisma.bidExpert.findMany.mockResolvedValue([{ userId: 'u1', expertRole: '正选' }]);
      await service.setCommitteeAssignment('p1', { assignments: [{ userId: 'u1', reviewGroup: '综合组' }] } as any);
      expect(prisma.bidExpert.update).toHaveBeenCalledWith(expect.objectContaining({
        where: { projectId_userId: { projectId: 'p1', userId: 'u1' } },
        data: { reviewGroup: '综合组', dutyRole: undefined },
      }));
    });
    it('A2：分工传 null → update data 含 reviewGroup: null；白名单守卫放行 null', async () => {
      prisma.bidExpert.findMany.mockResolvedValue([{ userId: 'u1', expertRole: '正选' }]);
      await service.setCommitteeAssignment('p1', { assignments: [{ userId: 'u1', reviewGroup: null }] } as any);
      expect(prisma.bidExpert.update).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ reviewGroup: null }),
      }));
    });
    it('A2：分工非法值仍 400（null 不在拒绝面）', async () => {
      prisma.bidExpert.findMany.mockResolvedValue([{ userId: 'u1', expertRole: '正选' }]);
      await expect(service.setCommitteeAssignment('p1', { assignments: [{ userId: 'u1', reviewGroup: 'A组' }] } as any))
        .rejects.toMatchObject({ response: { code: 'INVALID_COMMITTEE_VALUE' } });
    });
  });

  describe('createEvaluation（项目归属校验 + 去重防刷 + 综合等级计算）', () => {
    const evalDto = (over: any = {}) =>
      ({ expertUserId: 'u1', attendanceGrade: 'A', qualityGrade: 'A', disciplineGrade: 'A', ...over }) as any;

    it('projectId 指向不存在的项目应拒绝', async () => {
      prisma.user.findFirst.mockResolvedValue({ id: 'u1', role: 'bid_expert' });
      prisma.bidProject.findUnique.mockResolvedValue(null);
      await expect(service.createEvaluation('op1', evalDto({ projectId: 'ghost' }))).rejects.toBeInstanceOf(BadRequestException);
    });

    it('专家未参与该项目应拒绝评价', async () => {
      prisma.user.findFirst.mockResolvedValue({ id: 'u1', role: 'bid_expert' });
      prisma.bidProject.findUnique.mockResolvedValue({ id: 'p1' });
      prisma.bidExpert.findFirst.mockResolvedValue(null);
      await expect(service.createEvaluation('op1', evalDto({ projectId: 'p1' }))).rejects.toBeInstanceOf(BadRequestException);
    });

    it('综合等级：三维同等级直接映射（A/B/C/D/E → overallGrade 同级）', async () => {
      prisma.user.findFirst.mockResolvedValue({ id: 'u1', role: 'bid_expert' });
      prisma.expertEvaluation.findFirst.mockResolvedValue(null);
      prisma.expertEvaluation.create.mockImplementation(async ({ data }: any) => ({ ...data, evaluator: { id: 'op1', displayName: '评' } }));
      const mk = (g: string) => service.createEvaluation('op1', evalDto({ attendanceGrade: g, qualityGrade: g, disciplineGrade: g }));
      expect((await mk('A')).overallGrade).toBe('A');
      expect((await mk('B')).overallGrade).toBe('B');
      expect((await mk('C')).overallGrade).toBe('C');
      expect((await mk('D')).overallGrade).toBe('D');
      expect((await mk('E')).overallGrade).toBe('E');
    });

    it('综合等级：加权 quality×0.5 + discipline×0.3 + attendance×0.2（四舍五入映射回等级）', async () => {
      prisma.user.findFirst.mockResolvedValue({ id: 'u1', role: 'bid_expert' });
      prisma.expertEvaluation.findFirst.mockResolvedValue(null);
      prisma.expertEvaluation.create.mockImplementation(async ({ data }: any) => ({ ...data, evaluator: { id: 'op1', displayName: '评' } }));
      const mk = (q: string, d: string, a: string) =>
        service.createEvaluation('op1', evalDto({ qualityGrade: q, disciplineGrade: d, attendanceGrade: a }));
      // 5×0.5 + 4×0.3 + 3×0.2 = 4.3 → round 4 → B
      expect((await mk('A', 'B', 'C')).overallGrade).toBe('B');
      // 5×0.5 + 4×0.3 + 4×0.2 = 4.5 → round 5 → A（0.5 进位）
      expect((await mk('A', 'B', 'B')).overallGrade).toBe('A');
      // 4×0.5 + 3×0.3 + 2×0.2 = 3.3 → round 3 → C
      expect((await mk('B', 'C', 'D')).overallGrade).toBe('C');
      // 1×0.5 + 1×0.3 + 2×0.2 = 1.2 → round 1 → E
      expect((await mk('E', 'E', 'D')).overallGrade).toBe('E');
    });

    it('同一评价者对同一专家重复评价应更新而非新增（防刷 E 级）', async () => {
      prisma.user.findFirst.mockResolvedValue({ id: 'u1', role: 'bid_expert' });
      prisma.expertEvaluation.findMany.mockResolvedValue([{ id: 'ev1', expertUserId: 'u1', evaluatorId: 'staff1', projectId: null, createdAt: new Date(), updatedAt: new Date() }]);
      prisma.expertEvaluation.update.mockResolvedValue({ id: 'ev1', overallGrade: 'A' });
      await service.createEvaluation('op1', evalDto({ attendanceGrade: 'A', qualityGrade: 'A', disciplineGrade: 'A' }));
      expect(prisma.expertEvaluation.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'ev1' },
          // 三维等级与综合等级一并落库
          data: expect.objectContaining({
            attendanceGrade: 'A', qualityGrade: 'A', disciplineGrade: 'A', overallGrade: 'A',
          }),
        }),
      );
      expect(prisma.expertEvaluation.create).not.toHaveBeenCalled();
    });

    it('方案B②频次闸：7 天内他项目已评价且无事由 → 400 EVALUATION_TOO_FREQUENT', async () => {
      prisma.user.findFirst.mockResolvedValue({ id: 'u1', role: 'bid_expert' });
      prisma.bidProject.findUnique.mockResolvedValue({ id: 'p1' });
      prisma.bidExpert.findFirst.mockResolvedValue({ id: 'be1' });
      prisma.expertEvaluation.findMany.mockResolvedValue([
        { id: 'ev0', expertUserId: 'u1', evaluatorId: 'op1', projectId: 'p9', createdAt: new Date(), updatedAt: new Date() },
      ]);
      await expect(service.createEvaluation('op1', evalDto({ projectId: 'p1' })))
        .rejects.toMatchObject({ response: { code: 'EVALUATION_TOO_FREQUENT' } });
      expect(prisma.expertEvaluation.create).not.toHaveBeenCalled();
    });

    it('方案B②频次闸放行：填复评事由 → 新增流水并落 reviewReason', async () => {
      prisma.user.findFirst.mockResolvedValue({ id: 'u1', role: 'bid_expert' });
      prisma.bidProject.findUnique.mockResolvedValue({ id: 'p1' });
      prisma.bidExpert.findFirst.mockResolvedValue({ id: 'be1' });
      prisma.expertEvaluation.findMany.mockResolvedValue([
        { id: 'ev0', expertUserId: 'u1', evaluatorId: 'op1', projectId: 'p9', createdAt: new Date(), updatedAt: new Date() },
      ]);
      await service.createEvaluation('op1', evalDto({ projectId: 'p1', reviewReason: '季度复评' }));
      expect(prisma.expertEvaluation.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ projectId: 'p1', reviewReason: '季度复评' }) }),
      );
    });
  });

  describe('unconfirmReport（谈判采购报价轮冻结闸门）', () => {
    it('谈判采购且已有报价轮 → ROUNDS_STARTED_LOCKED，且不清理末签/不撤销确认', async () => {
      prisma.bidProject.findUnique.mockResolvedValue({ stage: 'EVALUATING', leaderCoSigned: true, procurementMethod: '谈判采购' });
      prisma.bidExpert.findFirst.mockResolvedValue({ id: 'e1', projectId: 'p1', expertName: '王工', reportConfirmed: true });
      prisma.bidRound.count.mockResolvedValue(1);

      await expect(service.unconfirmReport('p1', 'e1', '需改分', 'u1'))
        .rejects.toMatchObject({ response: { code: 'ROUNDS_STARTED_LOCKED' } });
      expect(prisma.bidProject.update).not.toHaveBeenCalled();
      expect(prisma.bidExpert.update).not.toHaveBeenCalled();
    });

    it('谈判采购无报价轮 → 正常撤销（清组长末签 + 取消确认 + 监督日志）', async () => {
      prisma.bidProject.findUnique.mockResolvedValue({ stage: 'EVALUATING', leaderCoSigned: true, procurementMethod: '谈判采购' });
      prisma.bidExpert.findFirst.mockResolvedValue({ id: 'e1', projectId: 'p1', expertName: '王工', reportConfirmed: true });
      prisma.bidRound.count.mockResolvedValue(0);

      const result = await service.unconfirmReport('p1', 'e1', '需改分', 'u1');

      expect(result).toEqual({ success: true });
      expect(prisma.bidProject.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'p1' },
          data: expect.objectContaining({ leaderCoSigned: false }),
        }),
      );
      expect(prisma.bidExpert.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'e1' },
          data: expect.objectContaining({ reportConfirmed: false }),
        }),
      );
      expect(prisma.bidSupervisionLog.create).toHaveBeenCalled();
    });

    it('竞价采购已有报价轮 → 闸门不生效，正常撤销', async () => {
      prisma.bidProject.findUnique.mockResolvedValue({ stage: 'EVALUATING', leaderCoSigned: false, procurementMethod: '竞价采购' });
      prisma.bidExpert.findFirst.mockResolvedValue({ id: 'e1', projectId: 'p1', expertName: '王工', reportConfirmed: true });
      prisma.bidRound.count.mockResolvedValue(1); // 应被忽略

      const result = await service.unconfirmReport('p1', 'e1', '需改分', 'u1');

      expect(result).toEqual({ success: true });
      expect(prisma.bidExpert.update).toHaveBeenCalled();
      expect(prisma.bidProject.update).not.toHaveBeenCalled(); // 未末签，无需清理
    });
  });

  describe('sendExtractionNotify — N6 补漏：追加链接文案与实际 TTL 一致', () => {
    afterEach(() => {
      delete process.env.EXPERT_RSVP_TTL_HOURS;
    });

    const setupNotify = () => {
      prisma.bidProject.findUnique.mockResolvedValue({ name: '测试项目', projectCode: 'BID-1' });
      prisma.user.findMany.mockResolvedValue([
        { id: 'u1', displayName: '专家A', expertProfile: { phone: '13800000000' } },
      ]);
      prisma.bidExpert.findFirst.mockResolvedValue({ id: 'be-1', rsvpToken: 'tok-1' });
    };

    it('无 {RSVP_LINK} 占位符时追加「确认链接（15分钟内有效）」（默认 TTL=0.25h，分钟感知标签不漏 "0.25"）', async () => {
      delete process.env.EXPERT_RSVP_TTL_HOURS;
      setupNotify();

      await service.sendExtractionNotify('p1', ['u1'], ['in_app'], '');

      expect(notification.sendToUser).toHaveBeenCalledTimes(1);
      const content = notification.sendToUser.mock.calls[0][2].content;
      expect(content).toContain('确认链接（15分钟内有效）');
      // 标签已按分钟归一，不得露出小时小数——只断言标签段等值：
      // 整段 not.toContain('0.25') 会被 URL host 子串撞车（CI 实录 10.1.0.25）
      const label = content.match(/确认链接（[^）]*内有效）/) ?? [];
      expect(label[0]).toBe('确认链接（15分钟内有效）');
      expect(content).not.toContain('2小时');
    });

    it('EXPERT_RSVP_TTL_HOURS=6 时追加文案同步为「6小时内有效」', async () => {
      process.env.EXPERT_RSVP_TTL_HOURS = '6';
      setupNotify();

      await service.sendExtractionNotify('p1', ['u1'], ['in_app'], '');

      const content = notification.sendToUser.mock.calls[0][2].content;
      expect(content).toContain('确认链接（6小时内有效）');
    });
  });

  describe('N6 收尾：rsvpTtlMs 真单源（非法 env 回退 15 分钟）', () => {
    // rsvpTtlMs 是类字段，实例化时取 env——须在编译模块前置 env（外层 beforeEach 已编译默认实例）
    const buildSvc = async () => {
      const mod = await Test.createTestingModule({
        providers: [
          ExpertAdminService,
          { provide: PrismaService, useValue: prisma },
          { provide: ExpertExtractionAiService, useValue: extractionAi },
          { provide: NotificationService, useValue: notification },
          { provide: EmbeddingService, useValue: { embed: jest.fn().mockResolvedValue([]) } },
          { provide: LlmService, useValue: { chat: jest.fn(), chatJson: jest.fn(), getModel: jest.fn().mockReturnValue(null) } },
          { provide: OcrService, useValue: { isAvailable: jest.fn().mockResolvedValue(false), ocrImage: jest.fn() } },
          { provide: ExpertCrossConflictService, useValue: { checkCrossConflicts: jest.fn().mockResolvedValue([]) } },
          { provide: ExpertExtractionService, useValue: { extendedRuleScore: jest.fn() } },
          { provide: CompanyScopeService, useValue: { resolveScope: jest.fn().mockResolvedValue({ all: true }), filter: jest.fn().mockReturnValue({}), assertInScope: jest.fn(), stampFor: jest.fn().mockResolvedValue({}) } },
        ],
      }).compile();
      return mod.get(ExpertAdminService);
    };

    afterEach(() => {
      delete process.env.EXPERT_RSVP_TTL_HOURS;
    });

    it.each(['abc', '0'])('EXPERT_RSVP_TTL_HOURS=%s → rsvpTtlMs 回退 15 分钟（900000ms）', async (v) => {
      process.env.EXPERT_RSVP_TTL_HOURS = v;
      const svc = await buildSvc();
      expect(svc['rsvpTtlMs']).toBe(15 * 60 * 1000);
    });

    it('EXPERT_RSVP_TTL_HOURS=6 → rsvpTtlMs=6 小时（与文案同源）', async () => {
      process.env.EXPERT_RSVP_TTL_HOURS = '6';
      const svc = await buildSvc();
      expect(svc['rsvpTtlMs']).toBe(6 * 60 * 60 * 1000);
    });
  });

  describe('N7 婉拒/过期递补统一', () => {
    it('admin declineInvitation 触发 autoPromoteCandidate 并回传 promoted', async () => {
      prisma.bidProject.findUnique.mockResolvedValue({ stage: 'OPENING' });
      prisma.bidExpert.findFirst.mockResolvedValue({ id: 'be-1', invitationStatus: 'pending', expertRole: '正选' });
      prisma.bidExpert.update.mockResolvedValue({});
      (service as any).autoPromoteCandidate = jest.fn().mockResolvedValue({ userId: 'u9', expertName: '候补A', major: '技术' });
      const res = await service.declineInvitation('p1', 'u1');
      expect((service as any).autoPromoteCandidate).toHaveBeenCalledWith('p1');
      expect(res.promoted).toMatchObject({ expertName: '候补A' });
    });

    it('D7：候补 declineInvitation 不递补——无正选空缺，promoted=null（防超编转正+徒耗候补席）', async () => {
      prisma.bidProject.findUnique.mockResolvedValue({ stage: 'OPENING' });
      prisma.bidExpert.findFirst.mockResolvedValue({ id: 'be-2', invitationStatus: 'pending', expertRole: '候补' });
      (service as any).autoPromoteCandidate = jest.fn().mockResolvedValue({ userId: 'u9', expertName: '候补A' });
      const res = await service.declineInvitation('p1', 'u1');
      expect((service as any).autoPromoteCandidate).not.toHaveBeenCalled();
      expect(res).toEqual({ success: true, status: 'declined', promoted: null });
    });

    it('declineInvitation 递补失败时静默——婉拒仍成功，promoted=null（与 RSVP 链接路径同款 catch）', async () => {
      prisma.bidProject.findUnique.mockResolvedValue({ stage: 'OPENING' });
      prisma.bidExpert.findFirst.mockResolvedValue({ id: 'be-1', invitationStatus: 'pending', expertRole: '正选' });
      (service as any).autoPromoteCandidate = jest.fn().mockRejectedValue(new Error('DB 抖动'));
      const res = await service.declineInvitation('p1', 'u1');
      expect(res).toEqual({ success: true, status: 'declined', promoted: null });
    });

    it('getProjectInvitations 过期清扫含正选时触发一次递补', async () => {
      prisma.bidProject.findUnique.mockResolvedValue({ stage: 'SUBMIT' }); // I2：maybeAutoPromote 读阶段
      prisma.bidExpert.findMany
        .mockResolvedValueOnce([{ id: 'be-1', expertRole: '正选' }])   // 过期查询
        .mockResolvedValue([]);                                        // 列表查询
      prisma.bidExpert.updateMany.mockResolvedValue({ count: 1 });
      (service as any).autoPromoteCandidate = jest.fn().mockResolvedValue(null);
      await service.getProjectInvitations('p1');
      expect((service as any).autoPromoteCandidate).toHaveBeenCalledWith('p1');
      expect((service as any).autoPromoteCandidate).toHaveBeenCalledTimes(1);
    });

    it('getProjectInvitations 手机号明文出口（2026-10-12 用户裁定：抽取通知场景不走掩码）', async () => {
      prisma.bidProject.findUnique.mockResolvedValue({ stage: 'SUBMIT' });
      const sealedPhone = sealPii('13812345678')!;
      prisma.bidExpert.findMany
        .mockResolvedValueOnce([]) // 过期查询：无过期
        .mockResolvedValue([
          {
            id: 'be-88112233', userId: 'u1', expertName: '张三', major: '水工结构',
            isLead: false, expertRole: '正选', invitationStatus: 'confirmed',
            reviewGroup: null, dutyRole: null, rsvpToken: null, rsvpRespondedAt: null, rsvpExpiresAt: null,
            user: { phone: null, expertProfile: { title: '高工', employer: '某设计院', phone: sealedPhone } },
          },
        ]);
      const res = await service.getProjectInvitations('p1');
      expect(res.experts[0].phone).toBe('13812345678'); // 落库密封 → 出口明文
    });

    it('过期行全是候补时不递补（避免误替换仍待命的正选）', async () => {
      prisma.bidProject.findUnique.mockResolvedValue({ stage: 'SUBMIT' });
      prisma.bidExpert.findMany
        .mockResolvedValueOnce([{ id: 'be-1', expertRole: '候补' }])   // 过期查询
        .mockResolvedValue([]);                                        // 列表查询
      prisma.bidExpert.updateMany.mockResolvedValue({ count: 1 });
      (service as any).autoPromoteCandidate = jest.fn().mockResolvedValue(null);
      await service.getProjectInvitations('p1');
      expect((service as any).autoPromoteCandidate).not.toHaveBeenCalled();
    });
  });

  describe('I2 — RSVP/过期/admin 婉拒路径阶段感知递补', () => {
    it('EVALUATING 中婉拒：declined 照写但递补抑制（改变委员会组成须走异议裁决/补选）', async () => {
      prisma.bidProject.findUnique.mockResolvedValue({ stage: 'EVALUATING' });
      prisma.bidExpert.findFirst.mockResolvedValue({ id: 'be-1', invitationStatus: 'pending', expertRole: '正选' });
      (service as any).autoPromoteCandidate = jest.fn().mockResolvedValue({ userId: 'u9' });
      const res = await service.declineInvitation('p1', 'u1');
      // 2026-10-21 留痕适配：婉拒改守卫式 updateMany（防并发双写轨迹）+ EXPERT 作答方 + 自答快照
      expect(prisma.bidExpert.updateMany).toHaveBeenCalledWith({
        where: { id: 'be-1', invitationStatus: 'pending' },
        data: expect.objectContaining({ invitationStatus: 'declined', invitationActorType: 'EXPERT', expertStatus: 'declined' }),
      });
      expect((service as any).autoPromoteCandidate).not.toHaveBeenCalled();
      expect(res).toEqual({ success: true, status: 'declined', promoted: null });
    });

    it('ARCHIVED 婉拒 → 409 PROJECT_CLOSED（终态拒绝操作，不写 declined）', async () => {
      prisma.bidProject.findUnique.mockResolvedValue({ stage: 'ARCHIVED' });
      prisma.bidExpert.findFirst.mockResolvedValue({ id: 'be-1', invitationStatus: 'pending', expertRole: '正选' });
      await expect(service.declineInvitation('p1', 'u1')).rejects.toMatchObject({ response: { code: 'PROJECT_CLOSED' } });
      expect(prisma.bidExpert.update).not.toHaveBeenCalled();
    });

    it('OPENING 婉拒 → 照常递补（既有行为保留）', async () => {
      prisma.bidProject.findUnique.mockResolvedValue({ stage: 'OPENING' });
      prisma.bidExpert.findFirst.mockResolvedValue({ id: 'be-1', invitationStatus: 'pending', expertRole: '正选' });
      (service as any).autoPromoteCandidate = jest.fn().mockResolvedValue({ userId: 'u9', expertName: '候补A' });
      const res = await service.declineInvitation('p1', 'u1');
      expect((service as any).autoPromoteCandidate).toHaveBeenCalledWith('p1');
      expect(res.promoted).toMatchObject({ expertName: '候补A' });
    });

    it('maybeAutoPromote：ABORTED → 409 PROJECT_CLOSED；项目不存在 → null 静默', async () => {
      prisma.bidProject.findUnique.mockResolvedValueOnce({ stage: 'ABORTED' }).mockResolvedValueOnce(null);
      await expect((service as any).maybeAutoPromote('p1')).rejects.toMatchObject({ response: { code: 'PROJECT_CLOSED' } });
      await expect((service as any).maybeAutoPromote('p1')).resolves.toBeNull();
    });
  });

  describe('fix-later② — autoPromoteCandidate 递补即确认 + 组长转移', () => {
    beforeEach(() => {
      // autoPromoteCandidate 读 bidScoreRecord（偏离度），主 beforeEach 未提供——本组补齐
      prisma.bidScoreRecord = { findMany: jest.fn().mockResolvedValue([]) };
      // 评分 mock 须返回数字（默认 undefined 会让排序比较 NaN）
      (service as any).extraction.extendedRuleScore.mockReturnValue(80);
      // I3（2026-09-24 全链审计）：tx 内 FOR UPDATE 行锁 + 锁内重断言（findUnique 默认放行形状：
      // e=未婉拒候补；个别用例覆写制造并发冲突）
      prisma.$queryRaw = jest.fn().mockResolvedValue([]);
      prisma.bidExpert.findUnique = jest.fn().mockResolvedValue({ expertRole: '候补', invitationStatus: 'pending' });
      // FE-3 后端（2026-09-24 全链审计）：递补也是委员会角色变更——广播 role_changed
      (service as any).gateway = { notifyExpertPresence: jest.fn() };
    });

    const mkCand = (id: string, name: string, opts: { inv?: string; rep?: boolean } = {}) => ({
      id, userId: `u-${id}`, expertName: name, major: '技术', expertRole: '候补',
      invitationStatus: opts.inv ?? 'pending', isPurchaserRepresentative: opts.rep ?? false,
      user: {
        isActive: true,
        expertProfile: { availability: '可用', entryStatus: 'ACTIVE', employer: null, specialty: '技术', title: '高级工程师', education: '本科' },
        _count: { bidExperts: 1 }, expertEvaluations: [], bidExperts: [],
      },
    });

    it('递补即确认：晋升写 invitationStatus=confirmed 并发站内通知（F4 同口径）', async () => {
      prisma.bidProject.findUnique.mockResolvedValue({ id: 'p1', name: '测试项目', suppliers: [] });
      // I3：首调=候补候选查询（Once）；后续调用=跨项目开窗检查（默认 []，无冲突窗口）
      prisma.bidExpert.findMany.mockResolvedValueOnce([mkCand('c1', '候补甲', { inv: 'pending' })]);
      prisma.bidExpert.findFirst.mockResolvedValue(null); // 无组长残留
      const res = await service.autoPromoteCandidate('p1');
      expect(res).toMatchObject({ expertName: '候补甲' });
      expect(prisma.bidExpert.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'c1' }, data: expect.objectContaining({ expertRole: '正选', invitationStatus: 'confirmed' }) }),
      );
      expect(notification.sendToUser).toHaveBeenCalledWith('u-c1', ['in_app'], expect.objectContaining({ type: 'EXPERT_AUTO_PROMOTED' }));
      // FE-3：递补成功广播 role_changed（:3005 已开面板刷新委员会名单）
      expect((service as any).gateway.notifyExpertPresence).toHaveBeenCalledWith('p1', expect.objectContaining({
        expertId: 'c1', expertName: '候补甲', milestone: 'role_changed',
      }));
    });

    it('组长婉拒：isLead 清残留并转移到递补者', async () => {
      prisma.bidProject.findUnique.mockResolvedValue({ id: 'p1', name: '测试项目', suppliers: [] });
      prisma.bidExpert.findMany.mockResolvedValueOnce([mkCand('c1', '候补甲', { inv: 'confirmed' })]);
      prisma.bidExpert.findFirst.mockResolvedValue({ id: 'lead-old' }); // 组长残留（已 declined）
      const res = await service.autoPromoteCandidate('p1');
      expect(prisma.bidExpert.update).toHaveBeenCalledWith({ where: { id: 'lead-old' }, data: { isLead: false } });
      expect(prisma.bidExpert.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'c1' }, data: expect.objectContaining({ expertRole: '正选', invitationStatus: 'confirmed', isLead: true }) }),
      );
      expect(res?.promotedAsLead).toBe(true);
    });

    it('组长婉拒且最优候选为采购人代表：改选次优非代表递补并任组长（P1-7）', async () => {
      prisma.bidProject.findUnique.mockResolvedValue({ id: 'p1', name: '测试项目', suppliers: [] });
      // 排序在前的代表（confirmed 优先）+ 次优非代表
      prisma.bidExpert.findMany.mockResolvedValueOnce([mkCand('rep', '代表乙', { inv: 'confirmed', rep: true }), mkCand('nrm', '候补丙', { inv: 'pending' })]);
      prisma.bidExpert.findFirst.mockResolvedValue({ id: 'lead-old' });
      const res = await service.autoPromoteCandidate('p1');
      expect(res).toMatchObject({ expertName: '候补丙', promotedAsLead: true });
      expect(prisma.bidExpert.update).not.toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'rep' } }));
    });

    it('组长婉拒且候选全为采购人代表：仍递补但组长留空（promotedAsLead=false，待 setLeader）', async () => {
      prisma.bidProject.findUnique.mockResolvedValue({ id: 'p1', name: '测试项目', suppliers: [] });
      prisma.bidExpert.findMany.mockResolvedValueOnce([mkCand('rep', '代表乙', { inv: 'confirmed', rep: true })]);
      prisma.bidExpert.findFirst.mockResolvedValue({ id: 'lead-old' });
      const res = await service.autoPromoteCandidate('p1');
      expect(res).toMatchObject({ expertName: '代表乙', promotedAsLead: false });
      expect(prisma.bidExpert.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'rep' }, data: expect.not.objectContaining({ isLead: true }) }),
      );
    });

    it('I3：零候补 + 组长残留 → 返回 null 但仍清 isLead 残留（早退不清残留=清扫脚本要修的病）', async () => {
      prisma.bidProject.findUnique.mockResolvedValue({ id: 'p1', name: '测试项目', suppliers: [] });
      prisma.bidExpert.findMany.mockResolvedValueOnce([]); // 候补候选查询：零候选
      prisma.bidExpert.findFirst.mockResolvedValue({ id: 'lead-old' });
      const res = await service.autoPromoteCandidate('p1');
      expect(res).toBeNull();
      expect(prisma.bidExpert.update).toHaveBeenCalledWith({ where: { id: 'lead-old' }, data: { isLead: false } });
    });

    it('I3：锁内重断言——并发已递补（锁内重读已是正选）→ 放弃且零递补写、零通知', async () => {
      prisma.bidProject.findUnique.mockResolvedValue({ id: 'p1', name: '测试项目', suppliers: [] });
      prisma.bidExpert.findMany.mockResolvedValueOnce([mkCand('c1', '候补甲', { inv: 'confirmed' })]);
      prisma.bidExpert.findFirst.mockResolvedValue(null);
      // 锁内重读：best 已被并发请求递补为正选
      prisma.bidExpert.findUnique.mockResolvedValue({ expertRole: '正选', invitationStatus: 'confirmed' });
      const res = await service.autoPromoteCandidate('p1');
      expect(res).toBeNull();
      expect(prisma.bidExpert.update).not.toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ expertRole: '正选' }) }),
      );
      expect(notification.sendToUser).not.toHaveBeenCalled();
    });

    it('I3：候补存在跨项目未闭合评标窗口 → 剔除后递补次优（与 signIn 硬闸/swap P2-4 同口径）', async () => {
      prisma.bidProject.findUnique.mockResolvedValue({ id: 'p1', name: '测试项目', suppliers: [] });
      // 候选查询 where 带 expertRole='候补'；开窗检查（findOpenEvaluationWindows）where 只带 userId——按此分流
      prisma.bidExpert.findMany.mockImplementation(async ({ where }: any = {}) =>
        where.expertRole
          ? [mkCand('c1', '候补甲', { inv: 'confirmed' }), mkCand('c2', '候补乙', { inv: 'pending' })]
          : where.userId === 'u-c1'
            ? [{ projectId: 'px', project: { id: 'px', projectCode: 'PCX', name: '他项目' } }]
            : [],
      );
      prisma.bidExpert.findFirst.mockResolvedValue(null);
      const res = await service.autoPromoteCandidate('p1');
      // c1（排序在前的 confirmed 候补）因开窗被剔除，次优 c2 递补
      expect(res).toMatchObject({ expertName: '候补乙' });
      expect(prisma.bidExpert.update).not.toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'c1' } }));
      expect(prisma.bidExpert.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'c2' }, data: expect.objectContaining({ expertRole: '正选' }) }),
      );
    });
  });
  describe('listSpecialties（2026-10-20 用户裁定：专家抽取不过滤，任何账号可选所有公司）', () => {
    it('显式 companyId（含逗号多选）→ 按所指公司并集取专业，任何角色放行（与抽取池 companyFilter 同口径）', async () => {
      prisma.company.findMany.mockResolvedValue([{ id: 'co-a' }, { id: 'co-b' }]);
      prisma.expertProfile.findMany.mockResolvedValue([{ specialty: '水利工程' }, { specialty: '造价咨询' }]);
      const res = await service.listSpecialties({ role: 'staff', sub: 'u1' } as any, 'co-a,co-b,co-x');
      // 无效 id（co-x）被公司主数据校验滤除
      expect(prisma.expertProfile.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({ user: expect.objectContaining({ companyId: { in: ['co-a', 'co-b'] } }) }),
      }));
      expect(res).toEqual(['水利工程', '造价咨询']);
    });

    it('未指定 companyId → 走登录人公司隔离（expertScopeFilter 路径，不做跨公司放行）', async () => {
      await service.listSpecialties({ role: 'staff', sub: 'u1' } as any);
      expect(prisma.company.findMany).not.toHaveBeenCalled();
      expect(prisma.expertProfile.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({ user: expect.objectContaining({ isActive: true, role: 'bid_expert' }) }),
      }));
    });
  });
});


/** proxyMarkInvitation（2026-10-21 代为变更设计适配专家域）：理由必填、同态幂等、
 *  自答快照不覆盖、确认→婉拒联动通知+递补、恢复闸门（评标中/席位占用/已签到）。 */
describe('ExpertAdminService.proxyMarkInvitation（专家邀请代回应/代变更）', () => {
  let service: ExpertAdminService;
  let prisma: any;
  let notification: any;

  beforeEach(async () => {
    const mod = await Test.createTestingModule({
      providers: [
        {
          provide: ExpertAdminService,
          useFactory: (p: any, n: any) => {
            const svc = Object.create(ExpertAdminService.prototype);
            (svc as any).prisma = p;
            (svc as any).notification = n;
            return svc;
          },
          inject: [PrismaService, NotificationService],
        },
        { provide: PrismaService, useValue: {
          user: { findUnique: jest.fn().mockResolvedValue({ displayName: '王工作' }) },
          bidExpert: {
            findFirst: jest.fn().mockResolvedValue({
              id: 'be1', userId: 'ex1', expertName: '杨睿', projectId: 'P1',
              expertRole: '正选', invitationStatus: 'confirmed', signedIn: false, isLead: false,
            }),
            update: jest.fn().mockResolvedValue({ id: 'be1' }),
            updateMany: jest.fn().mockResolvedValue({ count: 1 }),
          },
          bidProject: { findUnique: jest.fn().mockResolvedValue({ stage: 'OPENING', name: '某项目' }) },
          expertInvitationLog: {
            create: jest.fn().mockResolvedValue({}),
            findFirst: jest.fn().mockResolvedValue(null),
            // 连拒预警（2026-10-21）：默认空事件 → 连拒段 0 不触发
            findMany: jest.fn().mockResolvedValue([]),
          },
        } },
        { provide: NotificationService, useValue: { sendToUser: jest.fn().mockResolvedValue({}), sendToRole: jest.fn().mockResolvedValue({}) } },
      ],
    })
      // 绕过构造函数依赖（crossConflict/extractionAi/embedding/llm/ocr/extraction/companyScope/gateway）
      .useMocker((token) => (typeof token === 'function' ? {} as any : undefined))
      .compile();
    service = mod.get(ExpertAdminService);
    prisma = mod.get(PrismaService);
    notification = mod.get(NotificationService);
  });

  it('理由必填：少于 5 字 → 400 REASON_REQUIRED，不落任何写', async () => {
    await expect(service.proxyMarkInvitation({ projectId: 'P1', userId: 'ex1', status: 'declined', actorId: 'u1', reason: '太短' }))
      .rejects.toMatchObject({ response: { code: 'REASON_REQUIRED' } });
    expect(prisma.bidExpert.update).not.toHaveBeenCalled();
    expect(prisma.expertInvitationLog.create).not.toHaveBeenCalled();
  });

  it('同状态幂等：changed=false，不写轨迹不发通知', async () => {
    const r = await service.proxyMarkInvitation({ projectId: 'P1', userId: 'ex1', status: 'confirmed', actorId: 'u1', reason: '电话核实确认参加' });
    expect(r).toEqual({ success: true, status: 'confirmed', changed: false, promoted: null });
    expect(prisma.expertInvitationLog.create).not.toHaveBeenCalled();
    expect(notification.sendToUser).not.toHaveBeenCalled();
  });

  it('确认→婉拒：作答方三件套落列 + 轨迹 STAFF_MARKED + 通知本人 + 正选触发递补', async () => {
    const r = await service.proxyMarkInvitation({ projectId: 'P1', userId: 'ex1', status: 'declined', actorId: 'u1', reason: '电话核实健康原因请假' });
    expect(r.changed).toBe(true);
    expect(prisma.bidExpert.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'be1' },
        data: expect.objectContaining({
          invitationStatus: 'declined', invitationActorType: 'STAFF',
          invitationActorName: '王工作', invitationReason: '电话核实健康原因请假',
        }),
      }),
    );
    // 【不变量】自答快照键绝不出现（代变更不覆盖原回执）
    const updateData = prisma.bidExpert.update.mock.calls[0][0].data;
    expect(updateData).not.toHaveProperty('expertRespondedAt');
    expect(updateData).not.toHaveProperty('expertStatus');
    expect(prisma.expertInvitationLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'STAFF_MARKED', actorType: 'STAFF', actorName: '王工作',
          fromStatus: 'confirmed', toStatus: 'declined', reason: '电话核实健康原因请假',
        }),
      }),
    );
    expect(notification.sendToUser).toHaveBeenCalledWith(
      'ex1', ['in_app'],
      expect.objectContaining({ type: 'EXPERT_INVITATION_OVERRIDDEN' }),
    );
  });

  it('已签到专家不可代为婉拒（EXPERT_SIGNED_IN）', async () => {
    prisma.bidExpert.findFirst.mockResolvedValue({ id: 'be1', userId: 'ex1', expertRole: '正选', invitationStatus: 'confirmed', signedIn: true });
    await expect(service.proxyMarkInvitation({ projectId: 'P1', userId: 'ex1', status: 'declined', actorId: 'u1', reason: '试图婉拒已签到者' }))
      .rejects.toMatchObject({ response: { code: 'EXPERT_SIGNED_IN' } });
  });

  it('恢复闸门：评标中（EVALUATING）拒绝恢复（EVALUATING_LOCKED）', async () => {
    prisma.bidExpert.findFirst.mockResolvedValue({ id: 'be1', userId: 'ex1', expertRole: '正选', invitationStatus: 'declined', signedIn: false });
    prisma.bidProject.findUnique.mockResolvedValue({ stage: 'EVALUATING', name: '某项目' });
    await expect(service.proxyMarkInvitation({ projectId: 'P1', userId: 'ex1', status: 'confirmed', actorId: 'u1', reason: '评标中试图恢复成员' }))
      .rejects.toMatchObject({ response: { code: 'EVALUATING_LOCKED' } });
  });

  it('恢复闸门（时间序）：本行 declined 之后发生过 PROMOTED 递补 → SEAT_TAKEN', async () => {
    prisma.bidExpert.findFirst.mockResolvedValue({ id: 'be1', userId: 'ex1', expertRole: '正选', invitationStatus: 'declined', signedIn: false });
    prisma.bidProject.findUnique.mockResolvedValue({ stage: 'OPENING', name: '某项目' });
    prisma.expertInvitationLog.findFirst // 第一次调用：本行最近 declined 轨迹
      .mockResolvedValueOnce({ createdAt: new Date(Date.now() - 3600_000) })
      .mockResolvedValueOnce({ id: 'log-p' }); // declined 之后存在 PROMOTED → 席位已被占用
    await expect(service.proxyMarkInvitation({ projectId: 'P1', userId: 'ex1', status: 'confirmed', actorId: 'u1', reason: '席位已被占用试试' }))
      .rejects.toMatchObject({ response: { code: 'SEAT_TAKEN' } });
  });

  it('恢复闸门（深检修正）：多席位委员会——其他正选正常确认但本行 declined 后无递补 → 恢复放行', async () => {
    // 5 专家委员会场景：其余 4 位正选 confirmed 不构成占用（旧「存在其他已确认正选」口径会误杀）
    prisma.bidExpert.findFirst.mockResolvedValue({ id: 'be1', userId: 'ex1', expertRole: '正选', invitationStatus: 'declined', signedIn: false });
    prisma.bidProject.findUnique.mockResolvedValue({ stage: 'OPENING', name: '某项目' });
    prisma.expertInvitationLog.findFirst
      .mockResolvedValueOnce({ createdAt: new Date(Date.now() - 3600_000) }) // 本行 declined 轨迹
      .mockResolvedValueOnce(null); // 之后无 PROMOTED → 席位未被占用
    const r = await service.proxyMarkInvitation({ projectId: 'P1', userId: 'ex1', status: 'confirmed', actorId: 'u1', reason: '多席位场景恢复确认' });
    expect(r.changed).toBe(true);
  });
});

/** maybeAlertExpertDeclineStreak（2026-10-21 邀请信用预警）：与供应商同构——恰跨过
 *  阈值（=3）发 leader+staff 一次；代婉拒路径接线后由 proxyMarkInvitation 触发。 */
describe('ExpertAdminService.maybeAlertExpertDeclineStreak（专家连拒预警）', () => {
  let service: ExpertAdminService;
  let prisma: any;
  let notification: any;

  beforeEach(async () => {
    const mod = await Test.createTestingModule({
      providers: [
        {
          provide: ExpertAdminService,
          useFactory: (p: any, n: any) => {
            const svc = Object.create(ExpertAdminService.prototype);
            (svc as any).prisma = p;
            (svc as any).notification = n;
            return svc;
          },
          inject: [PrismaService, NotificationService],
        },
        { provide: PrismaService, useValue: {
          expertInvitationLog: { findMany: jest.fn().mockResolvedValue([]) },
        } },
        { provide: NotificationService, useValue: { sendToRole: jest.fn().mockResolvedValue({}) } },
      ],
    }).compile();
    service = mod.get(ExpertAdminService);
    prisma = mod.get(PrismaService);
    notification = mod.get(NotificationService);
  });

  const ev = (toStatus: string) => ({ toStatus });

  it('连拒恰达 3 次 → leader+staff 各一条 EXPERT_DECLINE_STREAK', async () => {
    prisma.expertInvitationLog.findMany.mockResolvedValue([ev('declined'), ev('declined'), ev('declined')]);
    const streak = await service.maybeAlertExpertDeclineStreak('ex1', '杨睿');
    expect(streak).toBe(3);
    expect(notification.sendToRole).toHaveBeenCalledTimes(2);
    expect(notification.sendToRole).toHaveBeenCalledWith('leader', expect.objectContaining({ type: 'EXPERT_DECLINE_STREAK' }));
  });

  it('连拒 4 次（更早已跨阈值）→ 不重复打扰', async () => {
    prisma.expertInvitationLog.findMany.mockResolvedValue([ev('declined'), ev('declined'), ev('declined'), ev('declined')]);
    const streak = await service.maybeAlertExpertDeclineStreak('ex1', '杨睿');
    expect(streak).toBe(4);
    expect(notification.sendToRole).not.toHaveBeenCalled();
  });

  it('代婉拒接线：proxyMark declined 且连拒达 3 → 预警随主流程触发', async () => {
    (service as any).assertInvitationActionable = jest.fn().mockResolvedValue(undefined);
    (service as any).maybeAutoPromote = jest.fn().mockResolvedValue(null);
    (service as any).prisma = {
      user: { findUnique: jest.fn().mockResolvedValue({ displayName: '王工作' }) },
      bidExpert: { findFirst: jest.fn().mockResolvedValue({ id: 'be1', userId: 'ex1', expertName: '杨睿', projectId: 'P1', expertRole: '候补', invitationStatus: 'pending', signedIn: false }), update: jest.fn().mockResolvedValue({ id: 'be1' }) },
      bidProject: { findUnique: jest.fn().mockResolvedValue({ stage: 'OPENING', name: '某项目' }) },
      expertInvitationLog: {
        create: jest.fn().mockResolvedValue({}),
        findFirst: jest.fn().mockResolvedValue(null),
        // 已连拒 2 次 + 本次（mock create 不落库，读侧模拟含本次共 3 条）
        findMany: jest.fn().mockResolvedValue([ev('declined'), ev('declined'), ev('declined')]),
      },
    };
    (service as any).notification = { sendToUser: jest.fn(), sendToRole: jest.fn().mockResolvedValue({}) };
    const r = await service.proxyMarkInvitation({ projectId: 'P1', userId: 'ex1', status: 'declined', actorId: 'u1', reason: '电话核实档期冲突婉拒' });
    expect(r.changed).toBe(true);
    expect((service as any).notification.sendToRole).toHaveBeenCalledWith('leader', expect.objectContaining({ type: 'EXPERT_DECLINE_STREAK' }));
  });
});

/** expertBreachEventsFromLogs（2026-10-21 深检修正·毁约归因纯函数）：
 *  系统转正（PROMOTED/SWAP_IN）后的代婉拒不计毁约——专家未亲口答应；
 *  本人/代回应确认过的才计；同一行混合历史按笔归因。 */
describe('expertBreachEventsFromLogs（毁约归因）', () => {
  const t0 = new Date('2026-10-21T08:00:00Z');
  const ev = (o: Partial<Parameters<typeof expertBreachEventsFromLogs>[0][number]> & { bidExpertId: string }) =>
    ({ action: 'STAFF_MARKED', fromStatus: null, toStatus: null, reason: null, actorName: null, createdAt: t0, ...o } as any);
  const names = new Map([['be1', '本人确认项目'], ['be2', '递补转正项目'], ['be3', '混合历史项目']]);

  it('本人确认（RESPONDED confirmed）后被代婉拒 → 计毁约', () => {
    const out = expertBreachEventsFromLogs([
      ev({ bidExpertId: 'be1', action: 'RESPONDED', toStatus: 'confirmed' }),
      ev({ bidExpertId: 'be1', fromStatus: 'confirmed', toStatus: 'declined', reason: '档期冲突' }),
    ], names);
    expect(out).toHaveLength(1);
    expect(out[0].projectName).toBe('本人确认项目');
  });

  it('递补转正（PROMOTED）后被代婉拒 → 不计毁约（专家未亲口答应）', () => {
    const out = expertBreachEventsFromLogs([
      ev({ bidExpertId: 'be2', action: 'PROMOTED', toStatus: 'confirmed' }),
      ev({ bidExpertId: 'be2', fromStatus: 'confirmed', toStatus: 'declined', reason: '复核冲突' }),
    ], names);
    expect(out).toHaveLength(0);
  });

  it('同一行混合历史按笔归因：本人确认毁约后经系统转正又被代婉拒 → 仅前者计', () => {
    const out = expertBreachEventsFromLogs([
      ev({ bidExpertId: 'be3', action: 'RESPONDED', toStatus: 'confirmed' }),
      ev({ bidExpertId: 'be3', fromStatus: 'confirmed', toStatus: 'declined', reason: '第一次毁约' }),
      ev({ bidExpertId: 'be3', action: 'PROMOTED', toStatus: 'confirmed' }),
      ev({ bidExpertId: 'be3', fromStatus: 'confirmed', toStatus: 'declined', reason: '系统转正后婉拒' }),
    ], names);
    expect(out).toHaveLength(1);
    expect(out[0].reason).toBe('第一次毁约');
  });
});
