import { Injectable, BadRequestException, Optional, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationService } from '../notification/notification.service';
import { BidGateway } from './bid.gateway';
import { CreateBidProjectDto } from './dto/create-bid-project.dto';
import { UpdateBidProjectDto } from './dto/update-bid-project.dto';
import { SubmitBidDto } from './dto/submit-bid.dto';
import { CreateScoreDto } from './dto/create-score.dto';
import { CreateClarificationDto } from './dto/create-clarification.dto';
import { StartOpeningDto } from './dto/start-opening.dto';
import { DecryptSupplierDto } from './dto/decrypt-supplier.dto';
import { assertBidStageTransition, type BidStage } from './bid-state';
import { computeArchiveChain } from './bid-archive.digest';
import { decryptBuffer, streamToBuffer, verifyIntegrity, classifyDecryptOutcome } from './bid-submission.crypto';
import { minioClient, MINIO_BUCKET } from '../upload/minio.client';

@Injectable()
export class BidService {
  constructor(
    private prisma: PrismaService,
    private notificationService: NotificationService,
    @Optional() private readonly gateway?: BidGateway,
  ) {}

  private readonly logger = new Logger(BidService.name);

  async getDashboardStats() {
    const [
      totalProjects,
      activeProjects,
      totalSuppliers,
      approvedSuppliers,
      totalExperts,
      totalAnnouncements,
      recentLogs,
    ] = await Promise.all([
      this.prisma.bidProject.count(),
      this.prisma.bidProject.count({ where: { stage: { in: ['OPENING', 'EVALUATING', 'SUBMIT'] } } }),
      this.prisma.supplier.count(),
      this.prisma.supplier.count({ where: { status: 'APPROVED' } }),
      this.prisma.bidExpert.groupBy({ by: ['expertName'], _count: true }),
      this.prisma.announcement.count({ where: { status: 'PUBLISHED' } }),
      this.prisma.bidSupervisionLog.findMany({
        orderBy: { time: 'desc' },
        take: 8,
      }),
    ]);

    const stageCounts = await this.prisma.bidProject.groupBy({
      by: ['stage'],
      _count: { stage: true },
    });

    const stageDistribution: Record<string, number> = {};
    stageCounts.forEach(s => { stageDistribution[s.stage] = s._count.stage; });

    return {
      totalProjects,
      activeProjects,
      totalSuppliers,
      approvedSuppliers,
      totalExperts: totalExperts.length,
      totalAnnouncements,
      stageDistribution,
      recentActivity: recentLogs,
    };
  }

  listProjects() {
    return this.prisma.bidProject.findMany({
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { suppliers: true } } },
    });
  }

  getProject(id: string) {
    return this.prisma.bidProject.findUnique({
      where: { id },
      include: {
        suppliers: true,
        openingSession: true,
        openingRecords: true,
        experts: { include: { scoreRecords: true } },
        scoreItems: true,
        clarifications: true,
        supervisionLogs: { orderBy: { time: 'desc' } },
        archiveItems: true,
      },
    });
  }

  /** 项目工作台：聚合项目 + 供应商(含投标提交) + 专家组 + 统计，供采购管理端判断开标准备 */
  async getWorkspace(id: string) {
    const project = await this.prisma.bidProject.findUnique({
      where: { id },
      select: { id: true, name: true, projectCode: true, procurementMethod: true, stage: true, openTime: true, deadline: true },
    });
    if (!project) throw new BadRequestException({ error: '项目不存在', code: 'NOT_FOUND' });

    const [suppliers, experts, submissions] = await Promise.all([
      this.prisma.bidSupplier.findMany({
        where: { projectId: id },
        include: { supplier: { select: { id: true, name: true, classification: { select: { name: true } } } } },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.bidExpert.findMany({
        where: { projectId: id },
        select: { id: true, expertName: true, major: true, signedIn: true, avoidanceConfirmed: true, progress: true },
      }),
      this.prisma.supplierBidSubmission.findMany({
        where: { projectId: id },
        select: { supplierId: true, status: true, submittedAt: true, bidPrice: true, deliveryPeriod: true },
      }),
    ]);
    const subMap = new Map(submissions.map(s => [s.supplierId, s]));

    const supplierRows = suppliers.map(s => {
      const submission = s.supplierId ? (subMap.get(s.supplierId) ?? null) : null;
      // 单一事实来源：有 SupplierBidSubmission 以其 status 为准；否则回退到 BidSupplier.submitStatus
      const submitted = submission?.status === 'submitted' || (!submission && s.submitStatus === '已提交');
      const withdrawn = submission?.status === 'withdrawn';
      return {
        id: s.id,
        supplierId: s.supplierId,
        supplierName: s.supplierName,
        classification: s.supplier?.classification?.name,
        downloadStatus: s.downloadStatus,
        submitStatus: s.submitStatus,
        decryptStatus: s.decryptStatus,
        submission,
        submitted,
        withdrawn,
      };
    });

    return {
      project,
      suppliers: supplierRows,
      experts,
      stats: {
        supplierTotal: suppliers.length,
        submitted: supplierRows.filter(s => s.submitted).length,
        withdrawn: supplierRows.filter(s => s.withdrawn).length,
        expertCount: experts.length,
        expertSignedIn: experts.filter(e => e.signedIn).length,
      },
    };
  }

  async createProject(dto: CreateBidProjectDto) {
    const project = await this.prisma.bidProject.create({
      data: {
        name: dto.name,
        projectCode: `BID-${Date.now()}`,
        procurementMethod: dto.procurementMethod,
        openTime: new Date(dto.openTime),
        deadline: new Date(dto.deadline),
        riskNote: dto.riskNote,
      },
    });

    await this.notificationService.sendToRole('bid_host', {
      type: 'BID_PUBLISHED',
      title: `新招标项目：${project.name}`,
      content: `项目编号 ${project.projectCode} 已创建，采购方式：${project.procurementMethod}。`,
      link: `/bid?id=${project.id}`,
    });

    return project;
  }

  async updateProject(id: string, dto: UpdateBidProjectDto) {
    if (dto.stage) {
      const project = await this.prisma.bidProject.findUnique({
        where: { id },
        select: { stage: true },
      });
      if (!project) throw new BadRequestException({ error: '项目不存在', code: 'NOT_FOUND' });
      assertBidStageTransition(project.stage, dto.stage as BidStage);
    }

    return this.prisma.bidProject.update({
      where: { id },
      data: {
        ...(dto.stage && { stage: dto.stage as any }),
        ...(dto.riskNote !== undefined && { riskNote: dto.riskNote }),
      },
    });
  }

  listSuppliers(projectId: string) {
    return this.prisma.bidSupplier.findMany({ where: { projectId } });
  }

  async submitBid(projectId: string, dto: SubmitBidDto) {
    // 1. 项目存在且在投标阶段
    const project = await this.prisma.bidProject.findUnique({
      where: { id: projectId },
      select: { stage: true, deadline: true },
    });
    if (!project) throw new BadRequestException({ error: '项目不存在', code: 'NOT_FOUND' });
    if (project.stage !== 'DOWNLOAD' && project.stage !== 'SUBMIT') {
      throw new BadRequestException({ error: '项目不在投标阶段', code: 'PROJECT_NOT_ACCEPTING' });
    }

    // 2. 截止时间校验
    if (project.deadline.getTime() < Date.now()) {
      throw new BadRequestException({ error: '投标截止时间已过', code: 'DEADLINE_PASSED' });
    }

    // 3. 供应商不能重复投标
    const existing = await this.prisma.bidSupplier.findFirst({
      where: { projectId, supplierName: dto.supplierName },
    });
    if (existing && existing.submitStatus === '已提交') {
      throw new BadRequestException({ error: '该供应商已提交投标', code: 'ALREADY_SUBMITTED' });
    }

    const receiptNo = `TB-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${String(Math.floor(Math.random() * 999)).padStart(3, '0')}`;
    return this.prisma.bidSupplier.create({
      data: {
        projectId,
        supplierName: dto.supplierName,
        downloadStatus: '已下载',
        submitStatus: '已提交',
        encryptStatus: '密文已校验',
        receiptNo,
        decryptStatus: 'PENDING',
        confirmStatus: 'PENDING',
      },
    });
  }

  startOpening(projectId: string, dto?: StartOpeningDto) {
    return this.startOpeningInternal(projectId, dto);
  }

  async openSubmission(id: string) {
    const project = await this.prisma.bidProject.findUnique({
      where: { id },
      select: { stage: true, name: true },
    });
    if (!project) throw new BadRequestException({ error: '项目不存在', code: 'NOT_FOUND' });
    assertBidStageTransition(project.stage, 'SUBMIT');

    const updated = await this.prisma.bidProject.update({
      where: { id },
      data: { stage: 'SUBMIT' },
    });

    await this.prisma.bidSupervisionLog.create({
      data: { projectId: id, time: new Date(), role: '系统', target: project.name, action: '开放投递 (DOWNLOAD→SUBMIT)', result: '阶段变更成功', riskFlag: '无' },
    });

    return updated;
  }

  private async startOpeningInternal(id: string, dto?: StartOpeningDto) {
    const project = await this.prisma.bidProject.findUnique({
      where: { id },
      select: { stage: true, name: true },
    });
    if (!project) throw new BadRequestException({ error: '项目不存在', code: 'NOT_FOUND' });
    assertBidStageTransition(project.stage, 'OPENING');

    // Create opening session only when all session fields are provided
    if (dto?.host && dto?.supervisor && dto?.decryptWindowStart && dto?.decryptWindowEnd) {
      await this.prisma.bidOpeningSession.create({
        data: {
          projectId: id,
          host: dto.host,
          supervisor: dto.supervisor,
          decryptWindowStart: new Date(dto.decryptWindowStart),
          decryptWindowEnd: new Date(dto.decryptWindowEnd),
          status: '待开标',
        },
      });
    }

    const updated = await this.prisma.bidProject.update({
      where: { id },
      data: { stage: 'OPENING' },
    });

    this.gateway?.notifyStageChange(id, 'OPENING');

    await this.prisma.bidSupervisionLog.create({
      data: { projectId: id, time: new Date(), role: dto?.host || '系统', target: project.name, action: '启动开标 (SUBMIT→OPENING)', result: '阶段变更成功', riskFlag: '无' },
    });

    return updated;
  }

  async startEvaluation(id: string) {
    const project = await this.prisma.bidProject.findUnique({
      where: { id },
      select: { stage: true, name: true },
    });
    if (!project) throw new BadRequestException({ error: '项目不存在', code: 'NOT_FOUND' });
    assertBidStageTransition(project.stage, 'EVALUATING');

    const updated = await this.prisma.bidProject.update({
      where: { id },
      data: { stage: 'EVALUATING' },
    });

    this.gateway?.notifyStageChange(id, 'EVALUATING');

    await this.prisma.bidSupervisionLog.create({
      data: { projectId: id, time: new Date(), role: '系统', target: project.name, action: '启动评标 (OPENING→EVALUATING)', result: '阶段变更成功', riskFlag: '无' },
    });

    return updated;
  }

  async decryptSupplier(projectId: string, supplierId: string, dto?: DecryptSupplierDto) {
    return this.prisma.$transaction(async (tx) => {
      const bidSupplier = await tx.bidSupplier.findFirst({
        where: { projectId, id: supplierId },
      });
      if (!bidSupplier) throw new BadRequestException({ error: '供应商投标记录不存在', code: 'NOT_FOUND' });

      // Phase 1: 开始解密
      await tx.bidSupplier.update({
        where: { id: supplierId },
        data: { decryptStatus: 'RUNNING' },
      });

      // 查找该供应商的提交记录（含加密封存密钥与文件引用）
      const submission = bidSupplier.supplierId
        ? await this.prisma.supplierBidSubmission.findUnique({
            where: { supplierId_projectId: { supplierId: bidSupplier.supplierId, projectId } },
          })
        : null;

      // 真实解密 + 完整性校验（如有文件引用）：读取 MinIO 文件，重算 SHA-256 与 FileAsset.sha256 比对；
      // 若存在 sealedKey 则先做真实 AES-256-GCM 解密。DANGER 由真实校验失败触发，不再依赖 simulateDanger。
      let decryptOk: boolean | null = null;
      let integrityOk: boolean | null = null;
      let errorMsg = '';

      const fileRefs: Array<{ assetId?: string | null; sealedKey?: string | null }> = submission
        ? [
            { assetId: submission.technicalFileAssetId, sealedKey: submission.technicalSealedKey },
            { assetId: submission.businessFileAssetId, sealedKey: submission.businessSealedKey },
            { assetId: submission.coverLetterAssetId, sealedKey: submission.coverLetterSealedKey },
          ]
        : [];

      for (const ref of fileRefs) {
        if (!ref.assetId) continue;
        const asset = await this.prisma.fileAsset.findUnique({ where: { id: ref.assetId } });
        if (!asset) { errorMsg = `投标文件记录缺失: ${ref.assetId}`; break; }
        try {
          const objStream = await minioClient.getObject(MINIO_BUCKET, asset.key);
          const buffer = await streamToBuffer(objStream);
          // Layer B：有 sealedKey 时执行真实 AES 解密
          if (ref.sealedKey) {
            decryptBuffer(buffer, ref.sealedKey);
            decryptOk = true;
          }
          // Layer A：完整性校验（解密后的明文 vs 存储 sha256）
          const integrity = verifyIntegrity(buffer, asset.sha256);
          if (integrity === false) { integrityOk = false; errorMsg = '标书文件完整性校验失败：SHA-256 不匹配（疑似篡改或损坏）'; break; }
          if (integrity === true) integrityOk = true;
        } catch (e) {
          decryptOk = ref.sealedKey ? false : null;
          errorMsg = `标书文件解密失败：${(e as Error).message}`;
          break;
        }
      }

      const hasSealedKey = !!submission && !!(submission.technicalSealedKey || submission.businessSealedKey || submission.coverLetterSealedKey);
      const outcome = dto?.simulateDanger === true
        ? 'DANGER' as const  // 保留显式模拟开关用于演练（覆盖真实结果）
        : (errorMsg && integrityOk !== true && decryptOk !== true
            ? 'DANGER' as const
            : classifyDecryptOutcome({ hasSealedKey, decryptOk, integrityOk }));

      if (outcome === 'DANGER') {
        const reason = errorMsg || '标书文件校验失败：签名不匹配或文件损坏';
        await tx.bidSupplier.update({ where: { id: supplierId }, data: { decryptStatus: 'DANGER', decryptError: reason } });
        this.gateway?.notifyDecryptStatus(projectId, { supplierId, decryptStatus: 'DANGER', supplierName: bidSupplier.supplierName });
        await tx.bidSupervisionLog.create({
          data: { projectId, time: new Date(), role: '系统', target: bidSupplier.supplierName, action: '标书解密', result: `解密异常：${reason}`, riskFlag: '高风险' },
        });
        return tx.bidSupplier.findUnique({ where: { id: supplierId } });
      }

      // 解密成功
      await tx.bidSupplier.update({ where: { id: supplierId }, data: { decryptStatus: 'SUCCESS' } });
      this.gateway?.notifyDecryptStatus(projectId, { supplierId, decryptStatus: 'SUCCESS', supplierName: bidSupplier.supplierName });

      // 创建开标记录（仅当开标记录字段全部提供时）——等待供应商确认，不自动 CONFIRMED
      if (dto?.amount && dto?.period && dto?.qualityTarget && dto?.bondStatus) {
        await tx.bidOpeningRecord.create({
          data: {
            projectId,
            supplierName: bidSupplier.supplierName,
            amount: dto.amount,
            period: dto.period,
            qualityTarget: dto.qualityTarget,
            bondStatus: dto.bondStatus,
            decryptResult: '解密成功',
            confirmStatus: '待供应商确认',
            bidSupplierId: supplierId,
          },
        });
      }

      const confirmed = await tx.bidSupplier.update({
        where: { id: supplierId },
        data: { confirmStatus: 'PENDING' },
      });
      const legacyNote = hasSealedKey ? '' : '（legacy 记录：未加密封存，仅完成完整性校验）';
      await tx.bidSupervisionLog.create({
        data: { projectId, time: new Date(), role: '系统', target: bidSupplier.supplierName, action: '标书解密', result: `解密成功，等待供应商确认唱标信息${legacyNote}`, riskFlag: '无' },
      });

      return confirmed;
    });
  }

  listOpeningRecords(projectId: string) {
    return this.prisma.bidOpeningRecord.findMany({ where: { projectId } });
  }

  async resolveOpeningDispute(projectId: string, recordId: string, dto: { result: string; confirm: boolean }) {
    const record = await this.prisma.bidOpeningRecord.findFirst({ where: { id: recordId, projectId } });
    if (!record) throw new BadRequestException({ error: '开标记录不存在', code: 'NOT_FOUND' });

    const now = new Date();
    const confirmStatus = dto.confirm ? '异议已处理-确认' : '异议已处理-退回';
    await this.prisma.bidOpeningRecord.update({
      where: { id: recordId },
      data: { confirmStatus, handleResult: dto.result, handledAt: now },
    });
    if (record.bidSupplierId) {
      await this.prisma.bidSupplier.update({
        where: { id: record.bidSupplierId },
        data: { confirmStatus: dto.confirm ? 'CONFIRMED' : 'EXCEPTION' },
      });
    }
    await this.prisma.bidSupervisionLog.create({
      data: {
        projectId, time: now, role: '开标主持人', target: record.supplierName,
        action: '处理开标异议', result: dto.result, riskFlag: '中风险',
      },
    });
    return this.prisma.bidOpeningRecord.findUnique({ where: { id: recordId } });
  }

  listExperts(projectId: string) {
    return this.prisma.bidExpert.findMany({ where: { projectId }, include: { scoreRecords: true } });
  }

  listEvaluationResults(projectId: string) {
    return this.prisma.bidEvaluationResult.findMany({ where: { projectId }, orderBy: { rank: 'asc' } });
  }

  async generateEvaluationResults(projectId: string) {
    const project = await this.prisma.bidProject.findUnique({
      where: { id: projectId },
      include: { experts: true, suppliers: true },
    });
    if (!project) throw new BadRequestException({ error: '项目不存在', code: 'NOT_FOUND' });
    if (project.stage !== 'EVALUATING') {
      throw new BadRequestException({ error: '项目不在评标阶段', code: 'PROJECT_NOT_EVALUATING' });
    }
    if (project.experts.some(e => !e.reportConfirmed)) {
      throw new BadRequestException({ error: '仍有专家未确认评审报告', code: 'EXPERT_REPORTS_NOT_CONFIRMED' });
    }

    const activeSuppliers = project.suppliers.filter(
      s => s.decryptStatus === 'SUCCESS' && s.submitStatus !== '已撤回' && s.confirmStatus === 'CONFIRMED',
    );

    const ranked = [];
    for (const supplier of activeSuppliers) {
      const records = await this.prisma.bidScoreRecord.findMany({
        where: { supplierId: supplier.id, expert: { projectId } },
      });
      const totalScore = records.reduce((sum, r) => sum + Number(r.score), 0);
      const averageScore = project.experts.length > 0 ? totalScore / project.experts.length : 0;
      ranked.push({
        supplierId: supplier.id,
        supplierName: supplier.supplierName,
        totalScore,
        averageScore,
      });
    }
    ranked.sort((a, b) => b.averageScore - a.averageScore);

    await this.prisma.bidEvaluationResult.deleteMany({ where: { projectId } });
    if (ranked.length > 0) {
      await this.prisma.bidEvaluationResult.createMany({
        data: ranked.map((r, index) => ({
          projectId,
          supplierId: r.supplierId,
          supplierName: r.supplierName,
          totalScore: r.totalScore,
          averageScore: r.averageScore,
          rank: index + 1,
          recommended: index === 0,
        })),
      });
    }

    await this.prisma.bidSupervisionLog.create({
      data: {
        projectId, time: new Date(), role: '系统', target: project.name,
        action: '生成评标结果', result: `生成${ranked.length}家供应商排名`, riskFlag: '无',
      },
    });

    return this.listEvaluationResults(projectId);
  }

  async submitScore(projectId: string, dto: CreateScoreDto) {
    // 校验 expert 属于该项目
    const expert = await this.prisma.bidExpert.findFirst({
      where: { id: dto.expertId, projectId },
    });
    if (!expert) {
      throw new BadRequestException({ error: '该专家不属于此项目', code: 'EXPERT_NOT_IN_PROJECT' });
    }

    // 校验 scoreItem 属于该项目
    const scoreItem = await this.prisma.bidScoreItem.findFirst({
      where: { id: dto.scoreItemId, projectId },
    });
    if (!scoreItem) {
      throw new BadRequestException({ error: '评分项不属于此项目', code: 'SCORE_ITEM_NOT_IN_PROJECT' });
    }

    // 利用唯一约束 upsert：存在则更新，不存在则创建
    const record = await this.prisma.bidScoreRecord.upsert({
      where: {
        expertId_scoreItemId_supplierId: {
          expertId: dto.expertId,
          scoreItemId: dto.scoreItemId,
          supplierId: dto.supplierId,
        },
      },
      update: { score: dto.score, reason: dto.reason },
      create: {
        expertId: dto.expertId,
        scoreItemId: dto.scoreItemId,
        supplierId: dto.supplierId,
        score: dto.score,
        reason: dto.reason,
      },
    });
    this.gateway?.notifyScoreUpdate(projectId, {
      expertId: dto.expertId,
      supplierId: dto.supplierId,
      scoreItemId: dto.scoreItemId,
      score: Number(dto.score),
    });
    return record;
  }

  listScores(projectId: string) {
    return this.prisma.bidScoreRecord.findMany({
      where: { expert: { projectId } },
      include: { expert: true, scoreItem: true },
    });
  }

  listClarifications(projectId: string) {
    return this.prisma.bidClarification.findMany({ where: { projectId } });
  }

  createClarification(projectId: string, dto: CreateClarificationDto) {
    return this.prisma.bidClarification.create({
      data: { projectId, question: dto.question, issuer: dto.issuer, supplierName: dto.supplierName },
    }).then((created) => {
      this.gateway?.notifyClarification(projectId, {
        id: created.id,
        question: dto.question,
        issuer: dto.issuer,
        supplierName: dto.supplierName,
        status: '待回复',
      });
      return created;
    });
  }

  listSupervisionLogs(projectId: string) {
    return this.prisma.bidSupervisionLog.findMany({ where: { projectId }, orderBy: { time: 'desc' } });
  }

  listArchives(projectId: string) {
    return this.prisma.bidArchiveItem.findMany({ where: { projectId } });
  }

  /** 一键归档前自动补齐标准归档材料清单（幂等：已存在则跳过） */
  private async ensureArchiveItems(projectId: string) {
    const standards = [
      { name: '招标项目基础信息', ownerRole: '系统' },
      { name: '投标供应商名单', ownerRole: '开标主持人' },
      { name: '开标记录表', ownerRole: '开标主持人' },
      { name: '供应商确认/异议记录', ownerRole: '供应商' },
      { name: '专家评分明细', ownerRole: '评审专家' },
      { name: '评标结果汇总', ownerRole: '评审委员会' },
      { name: '监督日志', ownerRole: '监督人' },
    ];
    for (const item of standards) {
      const exists = await this.prisma.bidArchiveItem.findFirst({ where: { projectId, name: item.name } });
      if (!exists) {
        await this.prisma.bidArchiveItem.create({
          data: { projectId, name: item.name, ownerRole: item.ownerRole, status: 'PENDING_CONFIRM' },
        });
      }
    }
  }

  async archiveAll(id: string) {
    const project = await this.prisma.bidProject.findUnique({
      where: { id },
      select: { id: true, projectCode: true, stage: true, name: true },
    });
    if (!project) throw new BadRequestException({ error: '项目不存在', code: 'NOT_FOUND' });
    assertBidStageTransition(project.stage, 'ARCHIVED');

    // 自动补齐标准归档材料，避免“无可归档项”阻塞
    await this.ensureArchiveItems(id);

    const archiveItems = await this.prisma.bidArchiveItem.findMany({
      where: { projectId: id, status: { not: 'ARCHIVED' } },
    });

    if (archiveItems.length === 0) {
      throw new BadRequestException({ error: '没有可归档的项目', code: 'NO_ITEMS_TO_ARCHIVE' });
    }

    const now = new Date();
    // P0-4: 逐项 SHA-256 哈希链 — 每个归档项拥有独立哈希，链式防篡改。
    const chain = computeArchiveChain(
      { id: project.id, projectCode: project.projectCode, name: project.name, stage: 'ARCHIVED' },
      archiveItems,
    );

    // 事务：逐项归档更新（各自哈希）+ 项目状态变更 + 监督日志 原子执行
    const itemUpdates = archiveItems.map(item =>
      this.prisma.bidArchiveItem.update({
        where: { id: item.id },
        data: { status: 'ARCHIVED', hashDigest: chain.get(item.id)!, archivedAt: now },
      }),
    );
    await this.prisma.$transaction([
      ...itemUpdates,
      this.prisma.bidProject.update({
        where: { id },
        data: { stage: 'ARCHIVED' },
      }),
      this.prisma.bidSupervisionLog.create({
        data: { projectId: id, time: new Date(), role: '系统', target: project.name, action: '一键归档', result: `归档 ${archiveItems.length} 项`, riskFlag: '无' },
      }),
    ]);

    return this.prisma.bidProject.findUnique({
      where: { id },
      include: { archiveItems: true },
    });
  }
}
