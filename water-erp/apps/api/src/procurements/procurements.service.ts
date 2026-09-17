import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TimelineService, type TimelineNode } from '../project-management/timeline.service';
import { ResultStatus, SourceType } from '@prisma/client';
import { CreateProcurementRoundDto } from './dto/create-procurement-round.dto';
import { UpdateProcurementRoundDto } from './dto/update-procurement-round.dto';
import { QueryProcurementsDto } from './dto/query-procurements.dto';
import type { AuthenticatedUser } from '../auth/auth.types';
import { createHash } from 'node:crypto';

@Injectable()
export class ProcurementsService {
  private readonly logger = new Logger(ProcurementsService.name);

  /** ERP Supplier 模型需要 user/enterpriseType 等必填字段 */
  private async makeSupplier(name: string) {
    const nn = this.normalizeName(name);
    const uid = createHash('sha256').update(`supplier_${nn}`).digest('hex').slice(0, 24);
    const [row] = await this.prisma.$queryRaw<Array<{ supplier_no: string }>>`
      SELECT 'SUP-' || lpad(nextval('supplier_no_seq')::text, 6, '0') AS supplier_no
    `;
    return {
      name,
      normalizedName: nn,
      supplierNo: row.supplier_no,
      enterpriseType: '有限责任公司',
      legalPerson: name,
      registeredAddress: '（待补充）',
      businessScope: '（待补充）',
      user: {
        create: {
          username: `supplier_auto_${uid}`,
          displayName: name,
          role: 'supplier',
        },
      },
    };
  }

  private readonly timeline: TimelineService;

  constructor(private readonly prisma: PrismaService) {
    this.timeline = new TimelineService(prisma);
  }

  /** PMI 采购日期（时间轴口径）：公告发布节点优先，无公告流程取供应商邀请节点；均无则 null。 */
  private async procurementDateOfPmi(pmiId: string): Promise<string | null> {
    const nodes: TimelineNode[] = await this.timeline
      .getTimeline(pmiId)
      .catch(() => [] as TimelineNode[]);
    const node = nodes.find((n) => n.key === 'bidNoticePublish' || n.key === 'supplierInvitation');
    return node?.time ? node.time.slice(0, 10) : null;
  }

  /**
   * 国资监管九大领域业务数据指标库（采购领域）提取，2026-09-16。
   * 指标口径：采购项目基础信息 17 项 + 采购项目过程信息 1 项；采购供应商 7 项。
   * 系统无对应字段的指标留空（前端可人工补录）；采购组织结构树 4 项待确认写入逻辑。
   */
  async sasacExtract(companyWhere?: { companyId?: string | null }) {
    const roundWhere: Record<string, unknown> = {};
    if (companyWhere?.companyId !== undefined) roundWhere.companyId = companyWhere.companyId;

    const rounds = await this.prisma.procurementRound.findMany({
      where: roundWhere,
      include: { project: true, awardedSupplier: true, createdBy: { select: { username: true, displayName: true, company: true } } },
      orderBy: [{ procurementDate: 'asc' }, { createdAt: 'asc' }],
    });
    const STAGE: Record<string, string> = {
      PENDING: '评审中',
      AWARDED: '已成交',
      FAILED_REVIEW: '未成交（审查未通过）',
      FILE_REVISION_REQUIRED: '未成交（文件需修正）',
      INVALID_RESPONSE: '未成交（无效响应）',
      CANCELLED: '已取消',
    };
    const d = (x: Date | null | undefined) => (x ? x.toISOString().slice(0, 10) : '');
    const n = (x: unknown) => (x === null || x === undefined ? null : Number(x));

    // 采购单位代码：集团全级次企业名单（62 家，名称→18 位统一社会信用代码）——提取自企业层级结构梳理表
    const UNIT_CODES: Record<string, string> = {
      "四川省水利发展集团有限公司": "91510000MA68PD9A66",
      "四川水发勘测设计研究有限公司": "91510000MA6A4U7C3T",
      "四川省电力设计院有限公司": "91510000MA6BM3JH6G",
      "四川省电力设计院工程有限公司": "91510000201820830T",
      "四川省兴科电力建设工程监理有限公司": "915100007118827248",
      "四川大桥水电咨询监理有限责任公司": "915100007446793279",
      "四川兴水岩土工程有限责任公司": "91510000711892404W",
      "四川水发建设有限公司": "915100002068004920",
      "四川川江检测技术有限公司": "91512002786677370L",
      "四川水土建设开发有限责任公司": "91510000064473130D",
      "会理市蜀水水资源开发有限责任公司": "91513425MAENCW8C5D",
      "四川水发投资有限公司": "915100007118844989",
      "四川省水网信息科技有限责任公司": "91510100MA7EPKNE44",
      "四川水发兴川置业管理有限公司": "91510100MAE326NC7R",
      "成都市中栋置业有限公司": "91510115672153843Y",
      "都江堰圣源水业有限责任公司": "91510181202771380L",
      "四川省人民渠水利发电有限公司": "91510182686327349U",
      "都江堰市新源旅游开发有限责任公司": "91510181564476995E",
      "井研县兴业供水有限责任公司": "91511124684197448F",
      "四川省紫坪铺开发有限责任公司": "91510100720365227F",
      "四川汉南供水有限公司": "91510681756646530T",
      "成都金堰水业有限责任公司": "915101216909049701",
      "成都青白江水业股份有限公司": "91510100621883002B",
      "成都兴蓉沱源自来水有限责任公司": "9151012145080652XU",
      "成都双流西南航空港供水工程有限公司": "91510122755951322H",
      "成都航都自来水有限公司": "915101220928343783",
      "广安都江堰协兴自来水有限责任公司": "91511600759722818D",
      "德阳华源水务投资有限公司": "91510600592781778Y",
      "都江堰市都江圣源旅游有限公司": "91510181734794479M",
      "四川水网大岷管业有限公司": "91510184MAC91G5K17",
      "四川蜀水矿业有限公司": "91510106MACKRUE3XL",
      "雅安市蜀水建材有限公司": "91511825MAD4FC21X5",
      "雅安貊貊水资源开发有限公司": "91511822MAE07W913J",
      "中铁高新智能装备有限公司": "91510132MACW5PHD83",
      "四川水发能源开发有限公司": "91510100MACDUTK786",
      "四川华青水电开发有限公司": "9151000020182185XX",
      "西昌同心电力有限责任公司": "91513401MA62H6615G",
      "九龙县叁鑫水电开发有限公司": "915133246757807114",
      "昭觉县竹核水电开发有限责任公司": "91513431660293363H",
      "四川水利电力产业集团有限责任公司": "91510000201887744K",
      "四川昭觉水电产业有限责任公司": "91513431744690227Q",
      "万源市新红能源有限责任公司": "91511781MA64HLF66Q",
      "天全县双河水电有限责任公司": "915118257729766954",
      "沐川飞亚水电开发有限责任公司": "91511129680425829R",
      "南江县团结电力有限责任公司": "915119222105506843",
      "四川能投电力道孚有限责任公司": "915133267699575307",
      "四川省水电投资经营集团永安电力股份有限公司": "915100002055156815",
      "九龙县森源水电产业开发有限责任公司": "915133246841851566",
      "石棉县汇源电力有限责任公司": "91511824740011530X",
      "四川省亭子口灌区建设开发有限公司": "91511300MA69EX2Y36",
      "四川省向家坝灌区建设开发有限责任公司": "915115000788923877",
      "四川省引大济岷水资源开发有限公司": "91510100MABXDL2H78",
      "四川省坝导水利科技有限公司": "915100002018656176",
      "四川省东风建设工程有限公司": "91510000202249285L",
      "四川省人民渠建设有限责任公司": "9151070020541846XM",
      "四川省都江堰勘测设计院有限责任公司": "91510181740313248X",
      "四川兴蜀水利电力教育投资经营有限责任公司": "91510181660494763D",
      "四川水职院建设工程设计有限责任公司": "915101817160451081",
      "四川都成泽源工程勘察设计有限责任公司": "91510100690931506R",
      "四川水职院水力发电有限责任公司": "91510181202763700R",
      "四川锦蜀苑教育服务管理有限责任公司": "91510181562018624C",
      "都江堰市兴蜀承禹金属结构制造有限公司": "91510181MA61UKRB93",
    };
    const unitCodeOf = (name?: string | null): string => (name ? UNIT_CODES[name.trim()] ?? '' : '');

    // 已成交轮次的过程步骤：经 PMI 归档链（archivedProcurementRoundId）取阶段模板，全步骤带编号
    const stageSel = { stageName: true, stageOrder: true, completedAt: true, stageCode: true } as const;
    const stepsOf = (stages: Array<{ stageName: string; stageOrder: number; completedAt: Date | null; stageCode: string | null }>) =>
      stages.length > 0
        ? stages
            .map((s) => `${s.stageOrder}.${s.stageName}${s.stageCode ? `[${s.stageCode}]` : ''}${s.completedAt ? '' : '…'}`)
            .join(' ')
        : '';
    const stepsRaw = (stages: Array<{ stageName: string; stageOrder: number; completedAt: Date | null; stageCode: string | null }>) =>
      stages.map((s) => ({ order: s.stageOrder, name: s.stageName, code: s.stageCode ?? null, completed: s.completedAt !== null }));
    const pmiByRound = new Map(
      (
        await this.prisma.projectManagementItem.findMany({
          where: { archivedProcurementRoundId: { in: rounds.map((r) => r.id) } },
          include: { stages: { orderBy: { stageOrder: 'asc' }, select: stageSel } },
        })
      ).map((m) => [m.archivedProcurementRoundId as string, m]),
    );

    // 中标供应商代码解析索引：名称精确匹配优先，回退双向包含（库里全称 vs 记录简称）
    const supplierDir = await this.prisma.supplier.findMany({ select: { name: true, creditCode: true } });
    const exactCode = new Map(supplierDir.map((s) => [s.name.trim(), s.creditCode]));
    const codeByName = (nameRaw?: string | null): string => {
      const name = (nameRaw ?? '').trim();
      if (!name) return '';
      if (exactCode.has(name)) return exactCode.get(name)!;
      const hit = supplierDir.find((s) => s.name.includes(name) || name.includes(s.name));
      return hit?.creditCode ?? '';
    };

    const roundProjects = rounds.map((r) => ({
      id: r.id,
      name: r.project.name, // 采购项目名称
      purchaserName: r.createdBy?.company ?? r.companyName ?? '', // 采购单位名称 = 创建人所属单位
      purchaserCode: unitCodeOf(r.createdBy?.company ?? r.companyName), // 统一身份代码（企业名单）
      contact: r.createdBy?.displayName ?? r.createdBy?.username ?? '', // 采购联系人 = 项目创建人（用户名称）
      category: r.project.businessCategory ?? '', // 采购类别
      method: r.procurementMethod ?? '', // 采购方式
      publishForm: r.procurementMethod === '谈判采购' ? '供应商邀请' : '公告公示', // 发布形式：谈判采购=邀请，其余=公告
      budgetAmount: n(r.budgetAmount), // 采购预算金额（元）
      awardAmount: n(r.awardAmount), // 采购中标（成交）金额（元）
      procurementDate: d(r.procurementDate), // 采购日期（采购公告日期）
      awardDate: r.resultStatus === 'AWARDED' ? d(r.updatedAt) : '', // 中标日期（成交完成时点）
      centralized: '是', // 是否集中采购（集团统一招采平台，可改）
      salePeriodOk: '是', // 文件发售期是否满足要求
      salePeriodNote: '无', // 发售期不满足要求详情（默认无）
      publicityPeriodOk: '是', // 候选人公示期是否满足要求
      publicityPeriodNote: '无', // 公示期不满足要求详情（默认无）
      wonSupplierName: r.awardedSupplierName ?? r.awardedSupplier?.name ?? '', // 中标供应商名称
      wonSupplierCode: r.awardedSupplier?.creditCode ?? codeByName(r.awardedSupplierName), // 中标供应商代码：ID 关联优先，名称回查供应商库
      archived: r.resultStatus === 'AWARDED', // 分组依据（已归档/进行中）
      steps: stepsRaw(pmiByRound.get(r.id)?.stages ?? []), // 结构化步骤（前端逐个着色）
      stage: stepsOf(pmiByRound.get(r.id)?.stages ?? []) || STAGE[r.resultStatus] || '已成交', // 过程信息：全步骤带编号
    }));

    // ── 进行中项目：项目管理（PMI）未归档项——台账只落已完成轮次，进行中的在 PMI ──
    const pmiWhere: Record<string, unknown> = { status: 'ACTIVE', archivedAt: null };
    if (companyWhere?.companyId !== undefined) pmiWhere.companyId = companyWhere.companyId;
    const pmiStage: Record<string, string> = {
      PROCUREMENT_DEMAND: '采购需求',
      INITIATION: '采购立项',
      TENDER_DOCUMENT: '采购文件',
      SUPPLIER_INVITATION: '供应商邀请',
      PUBLIC_ANNOUNCEMENT: '采购公告公示',
      EXPERT_SELECTION: '专家抽取',
      BID_EVALUATION: '开标评标',
      AWARD_DECISION: '定标',
      CONTRACT: '合同',
    };
    const pmiItems = await this.prisma.projectManagementItem.findMany({
      where: pmiWhere,
      include: {
        createdBy: { select: { username: true, displayName: true, company: true } },
        stages: { orderBy: { stageOrder: 'asc' }, select: stageSel },
      },
      orderBy: { createdAt: 'asc' },
    });
    const ongoingProjects = await Promise.all(pmiItems.map(async (m) => ({
      id: `pmi-${m.id}`,
      name: m.title, // 采购项目名称
      purchaserName: m.createdBy?.company ?? m.companyName ?? '', // 采购单位名称 = 创建人所属单位
      purchaserCode: unitCodeOf(m.createdBy?.company ?? m.companyName), // 统一身份代码（企业名单）
      contact: m.createdBy?.displayName ?? m.createdBy?.username ?? m.requesterName ?? '', // 采购联系人 = 创建人
      category: m.procurementCategory ?? '', // 采购类别
      method: m.procurementMethod ?? '', // 采购方式
      publishForm: m.procurementMethod === '谈判采购' ? '供应商邀请' : '公告公示', // 发布形式：谈判采购=邀请，其余=公告
      budgetAmount: m.budgetAmount === null ? null : Number(m.budgetAmount),
      awardAmount: m.contractAmount === null || m.contractAmount === undefined ? null : Number(m.contractAmount),
      // 采购日期 = 时间轴第三节点：有公告流程→「采购公告发布」；谈判/直接采购→「供应商邀请」
      procurementDate: (await this.procurementDateOfPmi(m.id)) ?? d(m.initiationDate),
      awardDate: '', // 进行中：无中标日期
      centralized: (m.procurementOrganizationForm ?? '').includes('集中') ? '是' : '否', // 组织形式→是否集中采购
      salePeriodOk: '是',
      salePeriodNote: '无', // 发售期不满足要求详情（默认无）
      publicityPeriodOk: '是',
      publicityPeriodNote: '无', // 公示期不满足要求详情（默认无）
      wonSupplierName: m.awardedSupplier ?? '',
      wonSupplierCode: codeByName(m.awardedSupplier), // 中标供应商代码：名称回查供应商库
      archived: false,
      steps: stepsRaw(m.stages), // 结构化步骤（前端逐个着色）
      // 过程信息：全步骤带编号 + 阶段编码；未完成步骤加「…」标记
      stage: stepsOf(m.stages) || pmiStage[m.currentStage] || m.currentStage || '进行中',
    })));
    const projects = [...roundProjects, ...ongoingProjects];

    const suppliers = await this.prisma.supplier.findMany({
      orderBy: { createdAt: 'asc' },
      select: {
        id: true, name: true, creditCode: true, businessScope: true,
        registeredCapital: true, industry: true, isTemporary: true, status: true,
      },
    });
    const supplierRows = suppliers.map((s) => ({
      id: s.id,
      name: s.name, // 供应商名
      creditCode: s.creditCode, // 供应商统一信用代码
      mainBusiness: s.businessScope ?? '', // 主营业务
      foundingDate: '', // 成立日期（系统无对应字段，待补录）
      industry: s.industry ?? '', // 所属行业
      profile: '', // 企业简介（待补录）
      // 注册资金（万元，数值型 N16,4）：库存为杂文本（如「5,000万元人民币」），解析出纯数字
      registeredCapital: (() => {
        const m = (s.registeredCapital ?? '').replace(/,/g, '').match(/\d+(\.\d+)?/);
        return m ? Number(m[0]) : null;
      })(),
      isTemporary: s.isTemporary,
    }));

    return {
      projects,
      suppliers: supplierRows,
      // 采购组织结构树（4 项指标）：待确认写入逻辑，暂留空
      orgTree: {
        fields: ['单位统一社会信用代码', '采购单位ID', '上级单位ID', '所属集团ID'],
        items: [],
      },
    };
  }

  /** 按公司名查找供应商，不存在则创建（normalizedName 已非唯一，不能用 upsert where normalizedName） */
  private async findOrCreateSupplierByName(name: string) {
    const normalizedName = this.normalizeName(name);
    const existing = await this.prisma.supplier.findFirst({ where: { normalizedName }, select: { id: true } });
    if (existing) return existing;
    return this.prisma.supplier.create({ data: await this.makeSupplier(name) });
  }

  private checkOwnership(
    round: { companyId?: string | null },
    user: AuthenticatedUser,
    companyFilter: { companyId?: string },
  ) {
    // 公司隔离（2026-08-20）：admin 视野（filter 为空对象）放行；其余仅限本公司数据
    if (companyFilter.companyId && round.companyId !== companyFilter.companyId) {
      throw new ForbiddenException({ error: '该采购记录不属于本公司，无权访问', code: 'COMPANY_SCOPE_FORBIDDEN' });
    }
  }

  async findAll(
    query: QueryProcurementsDto,
    user: AuthenticatedUser,
    companyFilter: { companyId?: string } = {},
  ) {
    const {
      page,
      pageSize,
      startDate,
      endDate,
      procurementMethod,
      departmentId,
      resultStatus,
      searchKeyword,
      sortBy,
      sortOrder,
      recycleStatus,
    } = query;

    const where: any = {};

    if (recycleStatus === 'RECYCLED') {
      where.isRecycled = true;
    } else if (recycleStatus !== 'ALL') {
      where.isRecycled = false;
    }

    if (startDate || endDate) {
      where.procurementDate = {};
      if (startDate) where.procurementDate.gte = new Date(startDate);
      if (endDate) where.procurementDate.lte = new Date(endDate);
    }

    if (procurementMethod) {
      where.procurementMethod = procurementMethod;
    }

    if (departmentId) {
      where.departmentId = departmentId;
    }

    if (resultStatus) {
      where.resultStatus = resultStatus;
    }

    // 公司隔离（2026-08-20）：按公司划归取代原个人/全局分野——非 admin 只见本公司
    Object.assign(where, companyFilter);

    if (searchKeyword) {
      where.OR = [
        { project: { name: { contains: searchKeyword, mode: 'insensitive' } } },
        {
          awardedSupplier: {
            name: { contains: searchKeyword, mode: 'insensitive' },
          },
        },
        { supplierText: { contains: searchKeyword, mode: 'insensitive' } },
      ];
    }

    const orderBy: any = {};
    orderBy[sortBy ?? 'procurementDate'] = sortOrder ?? 'desc';

    const [total, data] = await Promise.all([
      this.prisma.procurementRound.count({ where }),
      this.prisma.procurementRound.findMany({
        where,
        orderBy,
        skip: (page! - 1) * pageSize!,
        take: pageSize!,
        include: {
          project: true,
          department: true,
          awardedSupplier: true,
          createdBy: true,
          participants: {
            include: { supplier: true },
            orderBy: { sequenceNo: 'asc' },
          },
        },
      }),
    ]);

    // For PROJECT_MANAGEMENT source type, find the original project management item
    const projectManagementRounds = data.filter(
      (round) => round.sourceType === SourceType.PROJECT_MANAGEMENT,
    );

    const pmInfoMap: Record<string, any> = {};
    if (projectManagementRounds.length > 0) {
      const roundIds = projectManagementRounds.map((r) => r.id);
      const pmItems = await this.prisma.projectManagementItem.findMany({
        where: {
          archivedProcurementRoundId: { in: roundIds },
        },
        select: {
          id: true,
          archivedProcurementRoundId: true,
          initiationDate: true,
          evaluationMethod: true,
          biddingUnits: true,
          awardedSupplier: true,
          contractAmount: true,
          contractNumber: true,
          demandContractNumber: true,
          archivedAt: true,
          procurementOrganizationForm: true,
        },
      });
      for (const item of pmItems) {
        if (item.archivedProcurementRoundId) {
          pmInfoMap[item.archivedProcurementRoundId] = item;
        }
      }
    }

    return {
      data: data.map((round) =>
        this.formatRound(round, pmInfoMap[round.id]),
      ),
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize!),
      },
    };
  }

  async findOne(id: string, user: AuthenticatedUser, companyFilter: { companyId?: string } = {}) {
    const round = await this.prisma.procurementRound.findUnique({
      where: { id },
      include: {
        project: true,
        department: true,
        awardedSupplier: true,
        participants: {
          include: { supplier: true },
          orderBy: { sequenceNo: 'asc' },
        },
      },
    });

    if (!round) {
      throw new NotFoundException(`Procurement round ${id} not found`);
    }

    this.checkOwnership(round, user, companyFilter);

    return this.formatRound(round);
  }

  async create(
    dto: CreateProcurementRoundDto,
    userId?: string,
    companyStamp: { companyId?: string; companyName?: string } = {},
  ) {
    // Handle department
    let departmentId: string | null = null;
    if (dto.departmentId) {
      departmentId = dto.departmentId;
    } else if (dto.departmentName) {
      const dept = await this.prisma.department.upsert({
        where: { name: dto.departmentName },
        update: {},
        create: { name: dto.departmentName },
      });
      departmentId = dept.id;
    }

    // Handle project
    const projectCode =
      dto.projectCode || this.generateProjectCode(dto.projectName);
    const project = await this.prisma.project.upsert({
      where: { projectCode },
      update: {
        name: dto.projectName,
        requestingDepartmentId: departmentId,
      },
      create: {
        projectCode,
        name: dto.projectName,
        requestingDepartmentId: departmentId,
      },
    });

    // Handle awarded supplier
    let awardedSupplierId: string | null = null;
    if (dto.awardedSupplierId) {
      awardedSupplierId = dto.awardedSupplierId;
    } else if (dto.awardedSupplierName) {
      const supplier = await this.findOrCreateSupplierByName(dto.awardedSupplierName);
      awardedSupplierId = supplier.id;
    }

    // Get next round number for this project, with retry on concurrent race
    let round: any;
    for (let attempt = 0; attempt < 3; attempt++) {
      const roundNo = await this.getNextRoundNo(project.id);
      try {
        round = await this.prisma.procurementRound.create({
          data: {
            projectId: project.id,
            roundNo,
            procurementDate: dto.procurementDate
              ? new Date(dto.procurementDate)
              : null,
            procurementMethod: dto.procurementMethod,
            departmentId,
            budgetAmount: dto.budgetAmount,
            controlAmount: dto.controlAmount,
            awardedSupplierId,
            awardAmount: dto.awardAmount,
            resultStatus: dto.resultStatus || ResultStatus.PENDING,
            resultText: dto.resultText,
            sourceType: SourceType.MANUAL,
            createdById: userId,
            // 公司归属（写时快照）：隔离与统计的依据
            companyId: companyStamp.companyId ?? null,
            companyName: companyStamp.companyName ?? null,
          },
        });
        break;
      } catch (err: any) {
        if (err?.code === 'P2002' && attempt < 2) {
          this.logger.warn(
            `RoundNo race for project ${project.id}, retrying (attempt ${attempt + 1})`,
          );
          continue;
        }
        throw err;
      }
    }
    if (!round) {
      throw new ConflictException('创建采购轮次失败，请重试。');
    }

    // Handle participants
    const supplierIds = dto.supplierIds || [];
    const supplierNames = dto.supplierNames || [];

    for (let i = 0; i < supplierIds.length; i++) {
      await this.prisma.roundParticipant.create({
        data: {
          procurementRoundId: round.id,
          supplierId: supplierIds[i],
          sequenceNo: i + 1,
        },
      });
    }

    for (const [i, name] of supplierNames.entries()) {
      if (!supplierIds[i]) {
        const supplier = await this.findOrCreateSupplierByName(name);
        await this.prisma.roundParticipant.create({
          data: {
            procurementRoundId: round.id,
            supplierId: supplier.id,
            sequenceNo: supplierIds.length + i + 1,
          },
        });
      }
    }

    return this.findOne(round.id, { sub: userId!, username: '', role: 'admin' } as AuthenticatedUser);
  }

  async update(id: string, dto: UpdateProcurementRoundDto, user: AuthenticatedUser, companyFilter: { companyId?: string } = {}) {
    const existing = await this.prisma.procurementRound.findUnique({
      where: { id },
    });

    if (!existing) {
      throw new NotFoundException(`Procurement round ${id} not found`);
    }

    this.checkOwnership(existing, user, companyFilter);

    // Handle department update
    let departmentId: string | null = existing.departmentId;
    if (dto.departmentId) {
      departmentId = dto.departmentId;
    } else if (dto.departmentName) {
      const dept = await this.prisma.department.upsert({
        where: { name: dto.departmentName },
        update: {},
        create: { name: dto.departmentName },
      });
      departmentId = dept.id;
    }

    // Handle awarded supplier update
    let awardedSupplierId: string | null = existing.awardedSupplierId;
    if (dto.awardedSupplierId) {
      awardedSupplierId = dto.awardedSupplierId;
    } else if (dto.awardedSupplierName) {
      const supplier = await this.findOrCreateSupplierByName(dto.awardedSupplierName);
      awardedSupplierId = supplier.id;
    }

    const result = await this.prisma.procurementRound.updateMany({
      where: {
        id,
        updatedAt: existing.updatedAt,
      },
      data: {
        procurementDate: dto.procurementDate
          ? new Date(dto.procurementDate)
          : existing.procurementDate,
        procurementMethod: dto.procurementMethod || existing.procurementMethod,
        departmentId,
        budgetAmount: dto.budgetAmount ?? existing.budgetAmount,
        controlAmount: dto.controlAmount ?? existing.controlAmount,
        awardedSupplierId,
        awardAmount: dto.awardAmount ?? existing.awardAmount,
        resultStatus: dto.resultStatus || existing.resultStatus,
        resultText: dto.resultText || existing.resultText,
        updatedById: user.sub,
      },
    });

    if (result.count === 0) {
      throw new ConflictException('数据已被他人修改，请刷新后重试。');
    }

    return this.findOne(id, user);
  }

  async moveToRecycleBin(id: string, user: AuthenticatedUser, companyFilter: { companyId?: string } = {}) {
    const existing = await this.prisma.procurementRound.findUnique({
      where: { id },
    });

    if (!existing) {
      throw new NotFoundException(`Procurement round ${id} not found`);
    }

    this.checkOwnership(existing, user, companyFilter);

    return this.prisma.procurementRound.update({
      where: { id },
      data: { isRecycled: true },
    });
  }

  async restoreFromRecycleBin(id: string, user: AuthenticatedUser, companyFilter: { companyId?: string } = {}) {
    const existing = await this.prisma.procurementRound.findUnique({
      where: { id },
    });

    if (!existing) {
      throw new NotFoundException(`Procurement round ${id} not found`);
    }

    this.checkOwnership(existing, user, companyFilter);

    return this.prisma.procurementRound.update({
      where: { id },
      data: { isRecycled: false },
    });
  }

  async remove(id: string, user: AuthenticatedUser, companyFilter: { companyId?: string } = {}) {
    const existing = await this.prisma.procurementRound.findUnique({
      where: { id },
    });

    if (!existing) {
      throw new NotFoundException(`Procurement round ${id} not found`);
    }

    this.checkOwnership(existing, user, companyFilter);

    await this.prisma.$transaction(async (tx) => {
      await tx.roundParticipant.deleteMany({
        where: { procurementRoundId: id },
      });
      await tx.procurementRound.delete({
        where: { id },
      });
    });

    return { deleted: true, id };
  }

  async getStats(
    startDate?: string,
    endDate?: string,
    user?: AuthenticatedUser,
    companyFilter: { companyId?: string } = {},
  ) {
    const where: any = {};

    if (startDate || endDate) {
      where.procurementDate = {};
      if (startDate) where.procurementDate.gte = new Date(startDate);
      if (endDate) where.procurementDate.lte = new Date(endDate);
    }

    // 公司隔离（2026-08-20）：统计聚合在隔离后的数据集上计算
    Object.assign(where, companyFilter);

    const [
      totalCount,
      awardedCount,
      pendingCount,
      abnormalCount,
      budgetSum,
      awardSum,
    ] = await Promise.all([
      this.prisma.procurementRound.count({ where }),
      this.prisma.procurementRound.count({
        where: { ...where, resultStatus: ResultStatus.AWARDED },
      }),
      this.prisma.procurementRound.count({
        where: { ...where, resultStatus: ResultStatus.PENDING },
      }),
      this.prisma.procurementRound.count({
        where: {
          ...where,
          resultStatus: {
            in: [
              ResultStatus.FAILED_REVIEW,
              ResultStatus.FILE_REVISION_REQUIRED,
              ResultStatus.INVALID_RESPONSE,
              ResultStatus.CANCELLED,
            ],
          },
        },
      }),
      this.prisma.procurementRound.aggregate({
        where: { ...where, budgetAmount: { not: null } },
        _sum: { budgetAmount: true },
      }),
      this.prisma.procurementRound.aggregate({
        where: { ...where, awardAmount: { not: null } },
        _sum: { awardAmount: true },
      }),
    ]);

    const totalBudget = Number(budgetSum._sum.budgetAmount || 0);
    const totalAward = Number(awardSum._sum.awardAmount || 0);
    const totalSavings = totalBudget - totalAward;

    return {
      totalCount,
      awardedCount,
      pendingCount,
      abnormalCount,
      totalBudget,
      totalBudgetLabel: this.formatWan(totalBudget),
      totalAward,
      totalAwardLabel: this.formatWan(totalAward),
      totalSavings: totalSavings > 0 ? totalSavings : 0,
      totalSavingsLabel: totalSavings > 0 ? this.formatWan(totalSavings) : '0',
    };
  }

  async getProcurementMethods() {
    const methods = await this.prisma.procurementRound.findMany({
      select: { procurementMethod: true },
      distinct: ['procurementMethod'],
    });
    return methods.map((m) => m.procurementMethod).filter(Boolean);
  }

  private formatRound(round: any, pmInfo?: any) {
    return {
      id: round.id,
      projectId: round.projectId,
      projectName: round.project?.name || '',
      projectCode: round.project?.projectCode || '',
      roundNo: round.roundNo,
      procurementDate:
        round.procurementDate?.toISOString().split('T')[0] || null,
      procurementMethod: round.procurementMethod,
      departmentId: round.departmentId,
      departmentName: round.department?.name || '',
      supplierNames:
        round.participants?.map((p: any) => p.supplier?.name).filter(Boolean) ||
        [],
      budgetAmount: round.budgetAmount,
      controlAmount: round.controlAmount,
      awardedSupplierId: round.awardedSupplierId,
      awardedSupplierName: round.awardedSupplier?.name || null,
      awardAmount: round.awardAmount,
      resultStatus: round.resultStatus,
      resultStatusLabel: this.getResultStatusLabel(round.resultStatus),
      resultText: round.resultText,
      sourceType: round.sourceType || 'MANUAL',
      projectManagementId: pmInfo?.id || null,
      createdById: round.createdById || null,
      createdByName: round.createdBy?.displayName || null,
      createdAt: round.createdAt.toISOString(),
      updatedAt: round.updatedAt.toISOString(),
      isRecycled: Boolean(round.isRecycled),
      // Project management extracted info
      initiationDate: pmInfo?.initiationDate?.toISOString().split('T')[0] || null,
      evaluationMethod: pmInfo?.evaluationMethod || null,
      biddingUnits: pmInfo?.biddingUnits || null,
      pmAwardedSupplier: pmInfo?.awardedSupplier || null,
      contractAmount: pmInfo?.contractAmount || null,
      contractNumber: pmInfo?.contractNumber || pmInfo?.demandContractNumber || null,
      archivedAt: pmInfo?.archivedAt?.toISOString().split('T')[0] || null,
      procurementOrganizationForm: pmInfo?.procurementOrganizationForm || null,
    };
  }

  private getResultStatusLabel(status: ResultStatus): string {
    const labels: Record<ResultStatus, string> = {
      AWARDED: '已成交',
      FAILED_REVIEW: '资格审查未通过',
      FILE_REVISION_REQUIRED: '采购文件需修改',
      INVALID_RESPONSE: '未按要求响应',
      PENDING: '待处理',
      CANCELLED: '已取消',
    };
    return labels[status] || status;
  }

  private formatWan(value: number): string {
    if (value >= 10000) {
      return `${(value / 10000).toFixed(2)}万`;
    }
    return `${value.toFixed(2)}元`;
  }

  private generateProjectCode(name: string): string {
    return `MANUAL-${createHash('sha1').update(name).digest('hex').slice(0, 12)}`;
  }

  /**
   * Get the next round number for a project.
   * Uses findFirst + orderBy (instead of count) so deleted rounds don't cause collisions.
   * The caller MUST retry on P2002 to handle concurrent inserts on the same project.
   */
  private async getNextRoundNo(projectId: string): Promise<number> {
    const max = await this.prisma.procurementRound.findFirst({
      where: { projectId },
      orderBy: { roundNo: 'desc' },
      select: { roundNo: true },
    });
    return (max?.roundNo ?? 0) + 1;
  }

  private normalizeName(name: string): string {
    return name.replace(/\s+/g, '').trim();
  }
}
