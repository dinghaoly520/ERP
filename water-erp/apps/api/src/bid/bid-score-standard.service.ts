import { Injectable, Optional, BadRequestException, ForbiddenException, ConflictException } from '@nestjs/common';
import { Prisma, ScoreCategory } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ScoreStandardValidator } from './score-standard-validator.service';
import { getScoreTemplate } from './evaluation-method.config';
import { BidGateway } from './bid.gateway';
import { CreateScoreItemDto } from './dto/create-score-item.dto';
import { UpdateScoreItemDto } from './dto/update-score-item.dto';
import { CreateScorePointDto } from './dto/create-score-point.dto';
import { UpdateScorePointDto } from './dto/update-score-point.dto';
import { BatchCreateScorePointsDto } from './dto/batch-create-score-points.dto';
import { type BidStage } from './bid-state';

/**
 * 评分标准编制（评标办法）子服务 —— 从 bid.service 抽离（2026-08 审计 P1：拆上帝服务）。
 *
 * 职责：评分项/评分点 CRUD、批量建点、关联采购需求、应用/发布评分标准、评分模板管理。
 * 依赖：PrismaService（@Global）、ScoreStandardValidator、BidGateway（发布后 WS 广播，可选）。
 *
 * 说明：BidService 保留同名转发方法（委托到本服务），故 controller/其他 service 的调用
 * 点零改动。后续若彻底去除委托，把 controller 注入改为本服务即可。
 */
@Injectable()
export class BidScoreStandardService {
  constructor(
    private prisma: PrismaService,
    private readonly scoreStandardValidator: ScoreStandardValidator,
    @Optional() private readonly gateway?: BidGateway,
  ) {}

  /* ── 评分标准编制（评标办法）──
   * 评分项是评标段的前置条件：无评分项则专家无法打分、无法确认报告、无法生成结果。
   * 一旦项目进入评标（专家已开始打分）或归档，评分标准锁定，禁止增删改。 */

  private async logScoreStdOp(
    tx: Prisma.TransactionClient,
    projectId: string,
    projectName: string,
    actor: { userId: string; role: string },
    action: string,
    result: string,
  ) {
    await tx.bidSupervisionLog.create({
      data: {
        projectId, time: new Date(), role: '开标主持人',
        operatorId: actor.userId, operatorRole: actor.role,
        target: projectName, action, result, riskFlag: '无',
      },
    });
  }

  /** 评分标准仅在 DOWNLOAD/SUBMIT/OPENING 阶段且未发布时可编辑；已发布或进入评标/归档阶段锁定（409）。 */
  private assertScoreItemsEditable(stage: BidStage, publishedAt: Date | null) {
    if (publishedAt || stage === 'EVALUATING' || stage === 'ARCHIVED') {
      throw new ConflictException({
        error: '评分标准已发布或项目已进入评标/归档阶段,已锁定',
        code: 'SCORE_ITEMS_LOCKED',
      });
    }
  }

  /**
   * P1-17：事务内锁定项目行（SELECT ... FOR UPDATE）并复查评分标准可编辑性。
   * 与 startEvaluation（同样 FOR UPDATE 后置 EVALUATING）互斥，消除「事务外校验通过后阶段被并发流转」的 TOCTOU。
   */
  private async reassertScoreItemsEditableInTx(tx: Prisma.TransactionClient, projectId: string): Promise<void> {
    await tx.$queryRaw`SELECT id FROM "BidProject" WHERE id = ${projectId} FOR UPDATE`;
    const p = await tx.bidProject.findUnique({ where: { id: projectId }, select: { stage: true, scoreStandardPublishedAt: true } });
    if (!p) throw new BadRequestException({ error: '项目不存在', code: 'NOT_FOUND' });
    this.assertScoreItemsEditable(p.stage as BidStage, p.scoreStandardPublishedAt);
  }

  listScoreItems(projectId: string) {
    return this.prisma.bidScoreItem.findMany({
      where: { projectId },
      orderBy: [{ category: 'asc' }, { createdAt: 'asc' }],
      include: { points: { orderBy: [{ seq: 'asc' }, { createdAt: 'asc' }] } },
    });
  }

  async createScoreItem(projectId: string, dto: CreateScoreItemDto, actor: { userId: string; role: string }) {
    const project = await this.prisma.bidProject.findUnique({
      where: { id: projectId },
      select: { stage: true, name: true, scoreStandardPublishedAt: true },
    });
    if (!project) throw new BadRequestException({ error: '项目不存在', code: 'NOT_FOUND' });
    this.assertScoreItemsEditable(project.stage, project.scoreStandardPublishedAt);
    this.scoreStandardValidator.assertPassFailMaxScore(dto.category, dto.maxScore);

    const result = `新增评分项「${dto.name}」（满分 ${dto.maxScore}）`;
    const created = await this.prisma.$transaction(async (tx) => {
      await this.reassertScoreItemsEditableInTx(tx, projectId); // P1-17：事务内复查
      const item = await tx.bidScoreItem.create({
        data: { projectId, category: dto.category, name: dto.name, maxScore: dto.maxScore },
      });
      await this.logScoreStdOp(tx, projectId, project.name, actor, '编制评分标准', result);
      return item;
    });

    this.gateway?.notifySupervisionLog(projectId, { role: '开标主持人', action: '编制评分标准', target: project.name, result, riskFlag: '无' });
    return created;
  }

  async updateScoreItem(projectId: string, itemId: string, dto: UpdateScoreItemDto, actor: { userId: string; role: string }) {
    const project = await this.prisma.bidProject.findUnique({
      where: { id: projectId },
      select: { stage: true, name: true, scoreStandardPublishedAt: true },
    });
    if (!project) throw new BadRequestException({ error: '项目不存在', code: 'NOT_FOUND' });
    this.assertScoreItemsEditable(project.stage, project.scoreStandardPublishedAt);

    const existing = await this.prisma.bidScoreItem.findFirst({ where: { id: itemId, projectId } });
    if (!existing) throw new BadRequestException({ error: '评分项不存在', code: 'NOT_FOUND' });

    // Task 3: 通过性审查类别(QUALIFICATION/RESPONSIVE) 满分必须为 0
    if (dto.category !== undefined || dto.maxScore !== undefined) {
      const nextCategory = dto.category ?? existing.category;
      const nextMaxScore = dto.maxScore ?? Number(existing.maxScore);
      this.scoreStandardValidator.assertPassFailMaxScore(nextCategory, nextMaxScore);
    }

    const diffs: string[] = [];
    if (dto.category !== undefined && dto.category !== existing.category) diffs.push(`category ${existing.category}→${dto.category}`);
    if (dto.name !== undefined && dto.name !== existing.name) diffs.push(`name ${existing.name}→${dto.name}`);
    if (dto.maxScore !== undefined && Number(dto.maxScore) !== Number(existing.maxScore)) diffs.push(`maxScore ${existing.maxScore}→${dto.maxScore}`);

    return this.prisma.$transaction(async (tx) => {
      await this.reassertScoreItemsEditableInTx(tx, projectId); // P1-17：事务内复查
      const updated = await tx.bidScoreItem.update({
        where: { id: itemId },
        data: {
          ...(dto.category !== undefined && { category: dto.category }),
          ...(dto.name !== undefined && { name: dto.name }),
          ...(dto.maxScore !== undefined && { maxScore: dto.maxScore }),
        },
      });
      // P0-A：（降）满分后复查 Σ得分点满分 ≤ 新满分，违反不变量则整体回滚
      const newMax = dto.maxScore !== undefined ? Number(dto.maxScore) : Number(existing.maxScore);
      await this.scoreStandardValidator.assertPointsSumWithinMax(tx, itemId, newMax, 0);
      if (diffs.length > 0) {
        await this.logScoreStdOp(tx, projectId, project.name, actor, '编制评分标准', `修改评分项「${existing.name}」:${diffs.join(', ')}`);
      }
      return updated;
    });
  }

  async deleteScoreItem(projectId: string, itemId: string, actor: { userId: string; role: string }) {
    const project = await this.prisma.bidProject.findUnique({
      where: { id: projectId },
      select: { stage: true, name: true, scoreStandardPublishedAt: true },
    });
    if (!project) throw new BadRequestException({ error: '项目不存在', code: 'NOT_FOUND' });
    this.assertScoreItemsEditable(project.stage, project.scoreStandardPublishedAt);

    const existing = await this.prisma.bidScoreItem.findFirst({ where: { id: itemId, projectId } });
    if (!existing) throw new BadRequestException({ error: '评分项不存在', code: 'NOT_FOUND' });

    const result = `删除评分项「${existing.name}」`;
    await this.prisma.$transaction(async (tx) => {
      await this.reassertScoreItemsEditableInTx(tx, projectId); // P1-17：事务内复查
      await this.logScoreStdOp(tx, projectId, project.name, actor, '编制评分标准', result);
      await tx.bidScoreItem.delete({ where: { id: itemId } });
    });

    this.gateway?.notifySupervisionLog(projectId, { role: '开标主持人', action: '编制评分标准', target: project.name, result, riskFlag: '无' });
    return { deleted: true };
  }

  // ── 得分点（checklist 子项）CRUD ──

  private async assertScoreItemInProject(projectId: string, itemId: string) {
    const item = await this.prisma.bidScoreItem.findFirst({
      where: { id: itemId, projectId },
      include: { project: { select: { stage: true, scoreStandardPublishedAt: true } } },
    });
    if (!item) {
      throw new BadRequestException({ error: '评分项不存在', code: 'NOT_FOUND' });
    }
    this.assertScoreItemsEditable(item.project.stage as BidStage, item.project.scoreStandardPublishedAt);
    return item;
  }

  listScorePoints(projectId: string, itemId: string) {
    return this.prisma.bidScorePoint.findMany({
      where: { scoreItemId: itemId, scoreItem: { projectId } },
      orderBy: [{ seq: 'asc' }, { createdAt: 'asc' }],
    });
  }

  async createScorePoint(projectId: string, itemId: string, dto: CreateScorePointDto) {
    const item = await this.assertScoreItemInProject(projectId, itemId);
    return this.prisma.$transaction(async (tx) => {
      await this.reassertScoreItemsEditableInTx(tx, projectId); // P1-17：事务内复查
      await this.scoreStandardValidator.assertPointsSumWithinMax(tx, itemId, Number(item.maxScore), Number(dto.fullScore));
      return tx.bidScorePoint.create({
        data: {
          scoreItemId: itemId,
          name: dto.name,
          fullScore: dto.fullScore,
          seq: dto.seq ?? 0,
          evidenceHint: dto.evidenceHint ?? null,
          objective: dto.objective ?? true,
          ...(dto.linkedRequirementIds !== undefined && { linkedRequirementIds: dto.linkedRequirementIds }),
        },
      });
    });
  }

  async updateScorePoint(projectId: string, itemId: string, pointId: string, dto: UpdateScorePointDto) {
    const item = await this.assertScoreItemInProject(projectId, itemId);
    const existing = await this.prisma.bidScorePoint.findFirst({ where: { id: pointId, scoreItemId: itemId } });
    if (!existing) {
      throw new BadRequestException({ error: '得分点不存在', code: 'NOT_FOUND' });
    }
    const delta = dto.fullScore !== undefined ? Number(dto.fullScore) - Number(existing.fullScore) : 0;
    return this.prisma.$transaction(async (tx) => {
      await this.reassertScoreItemsEditableInTx(tx, projectId); // P1-17：事务内复查
      if (delta !== 0) {
        await this.scoreStandardValidator.assertPointsSumWithinMax(tx, itemId, Number(item.maxScore), delta);
      }
      return tx.bidScorePoint.update({
        where: { id: pointId },
        data: {
          ...(dto.name !== undefined && { name: dto.name }),
          ...(dto.fullScore !== undefined && { fullScore: dto.fullScore }),
          ...(dto.seq !== undefined && { seq: dto.seq }),
          ...(dto.evidenceHint !== undefined && { evidenceHint: dto.evidenceHint }),
          ...(dto.objective !== undefined && { objective: dto.objective }),
          ...(dto.linkedRequirementIds !== undefined && { linkedRequirementIds: dto.linkedRequirementIds }),
        },
      });
    });
  }

  async deleteScorePoint(projectId: string, itemId: string, pointId: string) {
    await this.assertScoreItemInProject(projectId, itemId);
    const existing = await this.prisma.bidScorePoint.findFirst({ where: { id: pointId, scoreItemId: itemId } });
    if (!existing) {
      throw new BadRequestException({ error: '得分点不存在', code: 'NOT_FOUND' });
    }
    return this.prisma.$transaction(async (tx) => {
      await this.reassertScoreItemsEditableInTx(tx, projectId); // P1-17：事务内复查
      return tx.bidScorePoint.delete({ where: { id: pointId } });
    });
  }

  /** 批量导入得分点（管理员审核 AI 建议后）。复用 assertScoreItemInProject 做归属 + 阶段锁校验。 */
  async batchCreateScorePoints(projectId: string, itemId: string, dto: BatchCreateScorePointsDto) {
    const item = await this.assertScoreItemInProject(projectId, itemId);
    const delta = dto.points.reduce((s, p) => s + Number(p.fullScore), 0);
    return this.prisma.$transaction(async (tx) => {
      await this.reassertScoreItemsEditableInTx(tx, projectId); // P1-17：事务内复查
      await this.scoreStandardValidator.assertPointsSumWithinMax(tx, itemId, Number(item.maxScore), delta);
      return tx.bidScorePoint.createMany({
        data: dto.points.map((p) => ({
          scoreItemId: itemId,
          name: p.name,
          fullScore: p.fullScore,
          evidenceHint: p.evidenceHint ?? null,
          evidenceSection: p.evidenceSection ?? null,
          confidence: p.confidence ?? null,
          objective: p.objective ?? true,
          ...(p.linkedRequirementIds !== undefined && { linkedRequirementIds: p.linkedRequirementIds }),
        })),
      });
    });
  }

  /**
   * 得分点↔招标条款映射（独立于发布锁）。
   * 仅 linkedRequirementIds 指引元数据，不参与评分计算；管理端即便评分标准已发布、
   * 专家已开始打分，仍可维护映射。
   */
  async updateLinkedRequirements(projectId: string, itemId: string, pointId: string, linkedRequirementIds: string[]) {
    const point = await this.prisma.bidScorePoint.findFirst({
      where: { id: pointId, scoreItem: { id: itemId, projectId } },
    });
    if (!point) throw new BadRequestException({ error: '得分点不存在', code: 'NOT_FOUND' });
    return this.prisma.bidScorePoint.update({
      where: { id: pointId },
      data: { linkedRequirementIds },
    });
  }

  /**
   * Phase 1：列出本项目招标条款（来源 AiBidAnalysisTask.requirements，与条款响应核对同源）。
   * 返回扁平化 [{requirementId, category, tenderContent, isStarred}] 供管理端映射多选。
   */
  async getTenderRequirements(projectId: string) {
    const task = await this.prisma.aiBidAnalysisTask.findUnique({
      where: { projectId },
      select: { requirements: true },
    });
    const req = (task?.requirements ?? null) as
      | {
          qualificationRequirements?: Array<{ id: string; content: string }>;
          technicalRequirements?: Array<{ id: string; content: string; isStarred?: boolean }>;
          commercialRequirements?: Array<{ id: string; content: string }>;
        }
      | null;
    if (!req) return [];
    const out: Array<{ requirementId: string; category: 'qualification' | 'technical' | 'commercial'; tenderContent: string; isStarred: boolean }> = [];
    const seen = new Set<string>();
    for (const r of req.qualificationRequirements ?? []) {
      if (r.id && !seen.has(r.id)) { seen.add(r.id); out.push({ requirementId: r.id, category: 'qualification', tenderContent: r.content ?? '', isStarred: false }); }
    }
    for (const r of req.technicalRequirements ?? []) {
      if (r.id && !seen.has(r.id)) { seen.add(r.id); out.push({ requirementId: r.id, category: 'technical', tenderContent: r.content ?? '', isStarred: !!r.isStarred }); }
    }
    for (const r of req.commercialRequirements ?? []) {
      if (r.id && !seen.has(r.id)) { seen.add(r.id); out.push({ requirementId: r.id, category: 'commercial', tenderContent: r.content ?? '', isStarred: false }); }
    }
    return out;
  }

  /** 应用标准评分模板（幂等：按 name 去重，已存在的项不重复创建）。立即解除新建项目的评标死锁。 */
  async applyScoreItemTemplate(projectId: string, actor: { userId: string; role: string }) {
    const project = await this.prisma.bidProject.findUnique({
      where: { id: projectId },
      select: { stage: true, name: true, scoreStandardPublishedAt: true, evaluationMethod: true },
    });
    if (!project) throw new BadRequestException({ error: '项目不存在', code: 'NOT_FOUND' });
    this.assertScoreItemsEditable(project.stage, project.scoreStandardPublishedAt);

    // P2: 按评标办法选择模板(默认综合评估法)
    const evalMethod = (project.evaluationMethod as any) || 'comprehensive';
    const templateRaw = getScoreTemplate(evalMethod);
    const TEMPLATE: Array<{ category: ScoreCategory; name: string; maxScore: number }> = templateRaw.map(t => ({
      category: t.category as ScoreCategory,
      name: t.name,
      maxScore: t.maxScore,
    }));

    const existing = await this.prisma.bidScoreItem.findMany({ where: { projectId }, select: { name: true } });
    const existingNames = new Set(existing.map(e => e.name));
    const toCreate = TEMPLATE.filter(t => !existingNames.has(t.name));

    if (toCreate.length > 0) {
      const result = `应用标准模板，新增 ${toCreate.length} 项`;
      await this.prisma.$transaction(async (tx) => {
        await this.reassertScoreItemsEditableInTx(tx, projectId); // P1-17：事务内复查
        await tx.bidScoreItem.createMany({
          data: toCreate.map(t => ({ projectId, category: t.category, name: t.name, maxScore: t.maxScore })),
        });
        await this.logScoreStdOp(tx, projectId, project.name, actor, '编制评分标准', result);
      });
      this.gateway?.notifySupervisionLog(projectId, { role: '开标主持人', action: '编制评分标准', target: project.name, result, riskFlag: '无' });
    }
    return this.listScoreItems(projectId);
  }

  /** 发布评分标准:校验完整性 → 置 publishedAt → 此后写操作锁定。 */
  async publishScoreStandard(projectId: string, actor: { userId: string; role: string; username: string }) {
    const project = await this.prisma.bidProject.findUnique({
      where: { id: projectId },
      select: { stage: true, scoreStandardPublishedAt: true, name: true },
    });
    if (!project) throw new BadRequestException({ error: '项目不存在', code: 'NOT_FOUND' });
    if (project.scoreStandardPublishedAt) {
      throw new ConflictException({ error: '评分标准已发布,不可重复发布', code: 'SCORE_STANDARD_ALREADY_PUBLISHED' });
    }
    await this.scoreStandardValidator.assertScoreStandardComplete(projectId);

    const updated = await this.prisma.$transaction(async (tx) => {
      // P2：行锁 + 事务内复查 publishedAt，消除并发双发布竞态
      await tx.$queryRaw`SELECT id FROM "BidProject" WHERE id = ${projectId} FOR UPDATE`;
      const locked = await tx.bidProject.findUnique({ where: { id: projectId }, select: { scoreStandardPublishedAt: true } });
      if (locked?.scoreStandardPublishedAt) {
        throw new ConflictException({ error: '评分标准已发布,不可重复发布', code: 'SCORE_STANDARD_ALREADY_PUBLISHED' });
      }
      const result = await tx.bidProject.update({
        where: { id: projectId },
        data: { scoreStandardPublishedAt: new Date() },
      });
      await this.logScoreStdOp(tx, projectId, project.name, actor, '编制评分标准', '发布评分标准');
      return result;
    });
    this.gateway?.notifySupervisionLog(projectId, { role: '开标主持人', action: '编制评分标准', target: project.name, result: '发布评分标准', riskFlag: '无' });
    return updated;
  }

  /* ── 评分模板（用户保存的整套评分标准，跨项目复用）── */

  async saveScoreTemplate(projectId: string, name: string, userId?: string, username?: string) {
    const items = await this.prisma.bidScoreItem.findMany({
      where: { projectId },
      include: { points: { orderBy: [{ seq: 'asc' }, { createdAt: 'asc' }] } },
      orderBy: { createdAt: 'asc' },
    });
    if (items.length === 0) {
      throw new BadRequestException({ error: '当前项目尚无评分项，无法保存为模板', code: 'EMPTY' });
    }
    const payload = {
      items: items.map((it) => ({
        category: it.category,
        name: it.name,
        maxScore: Number(it.maxScore),
        points: it.points.map((p) => ({
          name: p.name,
          fullScore: Number(p.fullScore),
          evidenceHint: p.evidenceHint,
          objective: p.objective,
        })),
      })),
    };
    return this.prisma.scoreTemplate.create({
       
      data: { name, payload: payload as any, createdById: userId ?? null, createdByName: username ?? null },
    });
  }

  async listScoreTemplates(userId?: string) {
    return this.prisma.scoreTemplate.findMany({
      where: userId ? { OR: [{ createdById: userId }, { createdById: null }] } : {},
      orderBy: { createdAt: 'desc' },
      select: { id: true, name: true, createdById: true, createdByName: true, createdAt: true },
    });
  }

  async applyScoreTemplateById(projectId: string, templateId: string, actor: { userId: string; role: string }) {
    const project = await this.prisma.bidProject.findUnique({
      where: { id: projectId },
      select: { stage: true, scoreStandardPublishedAt: true, name: true },
    });
    if (!project) throw new BadRequestException({ error: '项目不存在', code: 'NOT_FOUND' });
    this.assertScoreItemsEditable(project.stage, project.scoreStandardPublishedAt);

    const tpl = await this.prisma.scoreTemplate.findUnique({ where: { id: templateId } });
    if (!tpl) throw new BadRequestException({ error: '模板不存在', code: 'NOT_FOUND' });

    const payload = tpl.payload as {
      items: Array<{
        category: ScoreCategory;
        name: string;
        maxScore: number;
        points?: Array<{ name: string; fullScore: number; evidenceHint?: string | null; objective?: boolean }>;
      }>;
    };
    // B1: 通过性类别 maxScore 必须为 0
    for (const it of payload.items) {
      this.scoreStandardValidator.assertPassFailMaxScore(it.category, it.maxScore);
    }

    const created = await this.prisma.$transaction(async (tx) => {
      await this.reassertScoreItemsEditableInTx(tx, projectId); // P1-17：事务内复查
      const existing = await tx.bidScoreItem.findMany({ where: { projectId }, select: { name: true } });
      const existingNames = new Set(existing.map((e) => e.name));
      const toCreate = payload.items.filter((it) => !existingNames.has(it.name));

      for (const it of toCreate) {
        const item = await tx.bidScoreItem.create({
          data: { projectId, category: it.category, name: it.name, maxScore: it.maxScore },
        });
        if (it.points && it.points.length > 0) {
          await tx.bidScorePoint.createMany({
            data: it.points.map((p) => ({
              scoreItemId: item.id,
              name: p.name,
              fullScore: p.fullScore,
              evidenceHint: p.evidenceHint ?? null,
              objective: p.objective ?? true,
            })),
          });
        }
        // P0-A：模板得分点 ΣfullScore 不得超过该项满分（不变量），违反则整体回滚
        await this.scoreStandardValidator.assertPointsSumWithinMax(tx, item.id, Number(it.maxScore), 0);
      }

      if (toCreate.length > 0) {
        await this.logScoreStdOp(tx, projectId, project.name, actor, '编制评分标准', `应用模板「${tpl.name}」新增 ${toCreate.length} 项`);
      }
      return toCreate.length;
    });

    this.gateway?.notifySupervisionLog(projectId, { role: '开标主持人', action: '编制评分标准', target: project.name, result: `应用模板「${tpl.name}」`, riskFlag: '无' });
    return this.listScoreItems(projectId);
  }

  async deleteScoreTemplate(templateId: string, userId?: string, role?: string) {
    const tpl = await this.prisma.scoreTemplate.findUnique({
      where: { id: templateId },
      select: { id: true, createdById: true },
    });
    if (!tpl) throw new BadRequestException({ error: '模板不存在', code: 'NOT_FOUND' });
    // P2：公共模板（createdById=null）仅管理员可删；私有模板仅创建者或管理员可删
    const isAdmin = role === 'admin' || role === 'bid_host';
    if (tpl.createdById === null) {
      if (!isAdmin) throw new ForbiddenException({ error: '公共模板仅管理员可删除', code: 'FORBIDDEN' });
    } else if (tpl.createdById !== userId && !isAdmin) {
      throw new ForbiddenException({ error: '只能删除自己保存的模板', code: 'FORBIDDEN' });
    }
    await this.prisma.scoreTemplate.delete({ where: { id: templateId } });
    return { deleted: true };
  }
}
