import { Injectable, BadRequestException, Logger, NotFoundException, Optional } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateAnnouncementDto, UpdateAnnouncementDto } from './dto/create-announcement.dto';
import { AnnouncementAiService } from './announcement-ai.service';
import { BidService } from '../bid/bid.service';
import { ProjectManagementService } from '../project-management/project-management.service';
import { BidDocumentService } from './bid-document.service';
import { minioClient, MINIO_BUCKET } from '../upload/minio.client';

@Injectable()
export class AnnouncementService {
  private readonly logger = new Logger(AnnouncementService.name);

  constructor(
    private prisma: PrismaService,
    private announcementAi: AnnouncementAiService,
    @Optional() private bidService?: BidService,
    @Optional() private projectManagementService?: ProjectManagementService,
    @Optional() private bidDocumentService?: BidDocumentService,
  ) {}

  /** 公告类型→中文名称（AI 摘要 prompt 期望中文类型名） */
  private static readonly TYPE_LABELS: Record<string, string> = {
    BID_NOTICE: '采购公告', WIN_NOTICE: '中标公告', POLICY: '政策法规', PLATFORM: '平台通知',
  };

  async create(
    dto: CreateAnnouncementDto,
    authorId?: string,
    companyStamp: { companyId?: string; companyName?: string } = {},
  ) {
    const aiSummary = dto.aiSummary ?? await this.announcementAi.summarize({
      title: dto.title,
      type: AnnouncementService.TYPE_LABELS[dto.type] ?? dto.type,
      content: dto.content,
    });

    const status = (dto.status as any) ?? 'DRAFT';

    const result = await this.prisma.announcement.create({
      data: {
        title: dto.title,
        content: dto.content,
        // 公司归属（写时快照）：管理端按公司隔离，公开端不受限
        companyId: companyStamp.companyId ?? null,
        companyName: companyStamp.companyName ?? null,
        aiSummary,
        type: dto.type as any,
        summary: dto.summary,
        publishDate: dto.publishDate ? new Date(dto.publishDate) : new Date(),
        isTop: dto.isTop ?? false,
        relatedProjectCode: dto.relatedProjectCode,
        authorId,
        status,
        ...(dto.metadata !== undefined && { metadata: dto.metadata as any }),
      },
      include: { attachments: { include: { fileAsset: { select: { id: true, originalName: true, size: true, mimeType: true } } } } },
    });

    // P1: create 端点也触发联动（status=PUBLISHED + BID_NOTICE）
    const isBidNoticePublish = dto.type === 'BID_NOTICE' && status === 'PUBLISHED';
    if (isBidNoticePublish) {
      // P1b（2026-08-17）：「引用采购文件」发布时自动生成加密 BidDocument。
      // 前端把 PMI 阶段采购文件的 MinIO objectKey 放进 metadata.selectedTenderObjectKey，
      // 此前无人消费导致招标文件断链（供应商下载/专家获取/AI 提取得分点全挂）。
      // 先建文档再 syncBidProject——后者会在建项/关联项时回填 bidDocument.bidProjectId。
      const meta = (result.metadata as Record<string, any>) || {};
      const sourceKey: string | undefined = meta.selectedTenderObjectKey;
      if (sourceKey && this.bidDocumentService) {
        try {
          await this.bidDocumentService.attachFromObject(result.id, {
            objectKey: sourceKey,
            fileName: meta.selectedTenderFileName,
            mimeType: meta.selectedTenderMimeType,
            title: meta.selectedTenderFileName,
            uploaderId: authorId ?? null,
          });
        } catch (e) {
          // 招标文件生成失败不阻塞公告发布（前端可事后在详情页手动补传）
          this.logger.warn(
            `公告 ${result.id} 引用采购文件生成招标文件失败: ${(e as Error).message}`,
          );
        }
      }
      await this.syncBidProject(result.id, {
        id: result.id, title: result.title, publishDate: result.publishDate,
        metadata: result.metadata, relatedProjectCode: result.relatedProjectCode, authorId: result.authorId,
        companyId: result.companyId, companyName: result.companyName,
      });
    }
    // 发布即通知（所有类型，不仅 BID_NOTICE）：按可见范围向供应商发站内信
    if (status === 'PUBLISHED') {
      const meta = (result.metadata as Record<string, any>) || {};
      void this.notifySuppliersOnPublish(result.id, result.title, { ...meta, __type: result.type }).catch(e =>
        this.logger.warn(`公告发布通知发送失败 (create): ${(e as Error).message}`),
      );
    }
    if (isBidNoticePublish) return this.get(result.id);

    return result;
  }

  async list(
    params: { type?: string; status?: string; search?: string; page?: number; pageSize?: number },
    companyFilter: { companyId?: string } = {},
  ) {
    const page = params.page ?? 1;
    const pageSize = params.pageSize ?? 20;
    const skip = (page - 1) * pageSize;

    // 公司隔离（2026-08-20）：非 admin 只见本公司公告；admin 可切公司/全部
    const where: any = { ...companyFilter };
    if (params.type) where.type = params.type;
    if (params.status) where.status = params.status;
    if (params.search) {
      where.OR = [
        { title: { contains: params.search, mode: 'insensitive' } },
        { content: { contains: params.search, mode: 'insensitive' } },
      ];
    }

    const [total, items] = await Promise.all([
      this.prisma.announcement.count({ where }),
      this.prisma.announcement.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: [{ isTop: 'desc' }, { publishDate: 'desc' }, { createdAt: 'desc' }],
        include: {
          attachments: { include: { fileAsset: { select: { id: true, originalName: true, size: true, mimeType: true } } } },
          bidDocument: { select: { id: true, title: true, accessScope: true, requirePayment: true, price: true, downloadCount: true } },
        },
      }),
    ]);

    return { total, page, pageSize, items };
  }

  /** Public listing — only published items；公开端不含招标文件（首页不泄露）；RESTRICTED 可见范围不流转到首页 */
  async publicList(params: { type?: string; search?: string; page?: number; pageSize?: number }) {
    // 契约（2026-08-20 拍板）：公开门户（:3002）与供应商门户（:3004）**全量展示所有公司公告**——
    // 复用 list() 但不传 companyFilter（默认空 = 无公司过滤）。切勿在此注入公司隔离。
    const res = await this.list({ ...params, status: 'PUBLISHED' });
    return { ...res, items: res.items
      .filter((a: any) => a.metadata?.visibility !== 'RESTRICTED')
      .map((a: any) => this.stripForPublic(a)) };
  }

  async get(id: string) {
    const announcement = await this.prisma.announcement.findUnique({
      where: { id },
      include: {
        attachments: { include: { fileAsset: { select: { id: true, originalName: true, size: true, mimeType: true } } } },
        bidDocument: { select: { id: true, title: true, accessScope: true, requirePayment: true, price: true, downloadCount: true, fileAsset: { select: { originalName: true, size: true } } } },
      },
    });
    if (!announcement) throw new BadRequestException({ error: '公告不存在', code: 'NOT_FOUND' });
    return announcement;
  }

  async getPublic(id: string) {
    const announcement = await this.get(id);
    if (announcement.status !== 'PUBLISHED') {
      throw new BadRequestException({ error: '公告未发布', code: 'NOT_PUBLISHED' });
    }
    await this.prisma.announcement.update({
      where: { id },
      data: { viewCount: { increment: 1 } },
    });
    // 公开端剔除招标文件，仅保留普通附件
    return this.stripForPublic(announcement);
  }

  /** 移除招标文件信息（首页/公开端不暴露） */
  private stripForPublic(a: any) {
    const { bidDocument, ...rest } = a;
    return rest;
  }

  async update(id: string, dto: UpdateAnnouncementDto) {
    const announcement = await this.prisma.announcement.findUnique({ where: { id } });
    if (!announcement) throw new BadRequestException({ error: '公告不存在', code: 'NOT_FOUND' });

    const title = dto.title ?? announcement.title;
    const type = dto.type ?? announcement.type;
    const content = dto.content ?? announcement.content;
    const shouldRegenerateSummary = dto.aiSummary === undefined && (
      dto.title !== undefined || dto.content !== undefined || dto.type !== undefined
    );
    const aiSummary = dto.aiSummary ?? (shouldRegenerateSummary
      ? await this.announcementAi.summarize({ title, type: AnnouncementService.TYPE_LABELS[type] ?? type, content })
      : undefined);

    const targetStatus = dto.status ?? announcement.status;
    const isPublishTransition =
      announcement.status !== 'PUBLISHED' &&
      targetStatus === 'PUBLISHED';
    const isBidNoticePublish =
      isPublishTransition &&
      (dto.type ?? announcement.type) === 'BID_NOTICE';

    let result;
    try {
      result = await this.prisma.announcement.update({
        where: {
          id,
          ...(isPublishTransition ? { status: { not: 'PUBLISHED' } } : {}),
        },
        data: {
        ...(dto.title !== undefined && { title: dto.title }),
        ...(dto.content !== undefined && { content: dto.content }),
        ...(dto.type !== undefined && { type: dto.type as any }),
        ...(dto.summary !== undefined && { summary: dto.summary }),
        ...(aiSummary !== undefined && { aiSummary }),
        ...(dto.status !== undefined && { status: dto.status as any }),
        ...(dto.publishDate !== undefined && { publishDate: new Date(dto.publishDate) }),
        ...(dto.isTop !== undefined && { isTop: dto.isTop }),
        ...(dto.relatedProjectCode !== undefined && { relatedProjectCode: dto.relatedProjectCode }),
        ...(dto.metadata !== undefined && { metadata: dto.metadata as any }),
      },
    });
    } catch (e: any) {
      if (
        isPublishTransition &&
        e?.code === 'P2025' // Prisma "record not found" — status already changed by concurrent request
      ) {
        // Re-fetch and return the already-published version (another request won the race)
        result = await this.prisma.announcement.findUnique({ where: { id } });
        this.logger.warn(
          `公告发布竞争：公告已由其他请求发布，跳过联动 (announcementId=${id})`,
        );
      } else {
        throw e;
      }
    }

    if (!result) {
      throw new BadRequestException({ error: '公告不存在或已删除', code: 'NOT_FOUND' });
    }

    // A1: WIN_NOTICE 发布时自动设置公示期（3 个日历日，Wave 1 简化）
    if (result.type === 'WIN_NOTICE' && targetStatus === 'PUBLISHED' && !result.publicityEnd) {
      const end = new Date(result.publishDate || new Date());
      end.setDate(end.getDate() + 3);
      await this.prisma.announcement.update({ where: { id: result.id }, data: { publicityEnd: end } });
      result.publicityEnd = end;
    }

    // ── 联动：BID_NOTICE 首次发布 → 创建 BidProject ──
    if (isBidNoticePublish) {
      // P1b（与 create 路径一致）：「引用采购文件」发布时自动生成加密 BidDocument。
      // 定时发布（草稿→发布）走本 update 路径，此前缺失导致招标文件断链。attachFromObject 幂等（已存在则跳过）。
      const meta = (result.metadata as Record<string, any>) || {};
      const sourceKey: string | undefined = meta.selectedTenderObjectKey;
      if (sourceKey && this.bidDocumentService) {
        try {
          await this.bidDocumentService.attachFromObject(id, {
            objectKey: sourceKey,
            fileName: meta.selectedTenderFileName,
            mimeType: meta.selectedTenderMimeType,
            title: meta.selectedTenderFileName,
            uploaderId: result.authorId ?? null,
          });
        } catch (e) {
          this.logger.warn(
            `公告 ${id} 引用采购文件生成招标文件失败 (update): ${(e as Error).message}`,
          );
        }
      }
      await this.syncBidProject(id, { id: result.id, title: result.title, publishDate: result.publishDate, metadata: result.metadata, relatedProjectCode: result.relatedProjectCode, authorId: result.authorId, companyId: result.companyId, companyName: result.companyName });
    }
    // 发布即通知（所有类型）：按可见范围向供应商发站内信
    if (isPublishTransition) {
      const meta = (result.metadata as Record<string, any>) || {};
      void this.notifySuppliersOnPublish(result.id, result.title, { ...meta, __type: result.type }).catch(e =>
        this.logger.warn(`公告发布通知发送失败 (update): ${(e as Error).message}`),
      );
    }
    if (isBidNoticePublish) return this.get(id);

    return result;
  }

  /** 按公告可见范围向供应商用户发送站内通知（发布时调用）。
   *  PUBLIC/未设置 → 全部已启用供应商；RESTRICTED → restrictedSupplierIds 对应用户。 */
  async notifySuppliersOnPublish(annId: string, title: string, meta: Record<string, any>) {
    // notifyOnPublish 显式关闭则不发
    if (meta.notifyOnPublish === false) return;

    let userIds: string[];
    const visibility = meta.visibility || 'PUBLIC';
    if (
      visibility === 'RESTRICTED' &&
      Array.isArray(meta.restrictedSupplierIds) &&
      meta.restrictedSupplierIds.length > 0
    ) {
      const suppliers = await this.prisma.supplier.findMany({
        where: { id: { in: meta.restrictedSupplierIds }, status: 'APPROVED' },
        select: { userId: true },
      });
      userIds = suppliers.map(s => s.userId);
    } else {
      const users = await this.prisma.user.findMany({
        where: { role: 'supplier', isActive: true },
        select: { id: true },
      });
      userIds = users.map(u => u.id);
    }

    const typeLabel: Record<string, string> = { BID_NOTICE: '采购公告', WIN_NOTICE: '中标公告', POLICY: '政策法规', PLATFORM: '平台通知' };
    const label = typeLabel[meta.__type] || '公告';
    let sent = 0;
    for (const userId of userIds) {
      try {
        await this.prisma.notification.create({
          data: {
            userId,
            type: 'ANNOUNCEMENT_PUBLISHED',
            title: `新${label}：${title}`,
            content: `${label}「${title}」已发布，请前往供应商门户查看详情。`,
            link: `/announcements/${annId}`,
          },
        });
        sent++;
      } catch (e) {
        this.logger.warn(`公告通知创建失败 userId=${userId}: ${(e as Error).message}`);
      }
    }
    this.logger.log(`公告通知已发送: ${title}, 收件人 ${sent}/${userIds.length} 人`);
  }

  /** 联动：BID_NOTICE 发布时自动创建/同步 BidProject，幂等安全 */
  private async syncBidProject(annId: string, announcement: { id: string; title: string; publishDate: Date | null; metadata?: any; relatedProjectCode?: string | null; authorId?: string | null; companyId?: string | null; companyName?: string | null }) {
    if (!this.bidService) return;
    try {
      const meta = AnnouncementService.validateMetadata(announcement.metadata);
      const existingProject = announcement.relatedProjectCode
        ? await this.prisma.bidProject.findUnique({
            where: { projectCode: announcement.relatedProjectCode },
          })
        : null;

      if (existingProject) {
        await this.bidService.syncFromAnnouncement(existingProject.id, { title: announcement.title }, meta);
        this.logger.log(`公告已关联项目 ${existingProject.projectCode}，同步更新字段`);
        // 流标公告：发布后自动将 BidProject 置为 ABORTED
        if (meta.category === 'failed_bid') {
          await this.bidService.abortBidProject(existingProject.id);
          this.logger.log(`流标公告已发布，项目 ${existingProject.projectCode} 已标记为 ABORTED`);
        }
        // P1b：既有项目分支同样回填招标文件关联（此前只在新项目分支做）
        const bidDoc = await this.prisma.bidDocument.findUnique({ where: { announcementId: annId } });
        if (bidDoc && !bidDoc.bidProjectId) {
          await this.prisma.bidDocument.update({
            where: { announcementId: annId },
            data: { bidProjectId: existingProject.id },
          });
        }
      } else {
        const annCompany = { companyId: announcement.companyId ?? undefined, companyName: announcement.companyName ?? undefined };
        const project = await this.bidService.createFromAnnouncement(
          { id: announcement.id, title: announcement.title, publishDate: announcement.publishDate }, meta,
          annCompany,
        );
        await this.prisma.announcement.update({ where: { id: annId }, data: { relatedProjectCode: project.projectCode } });
        const bidDoc = await this.prisma.bidDocument.findUnique({ where: { announcementId: annId } });
        if (bidDoc) {
          await this.prisma.bidDocument.update({ where: { announcementId: annId }, data: { bidProjectId: project.id } });
        }
        // N16 方案 A（2026-08-17）：公告直建项目补最小 PMI 并回填关联（新建部分原子）——
        // :3005 开标确认面板（评分标准/主持人/按时开标/归档/公示）以 PMI 为宿主，此前此类项目无宿主
        if (this.projectManagementService) {
          const pmi = await this.prisma.$transaction(async (tx) => {
            const created = await this.projectManagementService!.createItemFromAnnouncement(
              { companyId: announcement.companyId, companyName: announcement.companyName },
              tx, {
              title: announcement.title,
              procurementMethod: meta.method || '公开招标',
              budget: meta.budget != null ? Number(meta.budget) : null,
              authorId: announcement.authorId ?? null,
            });
            await tx.bidProject.update({
              where: { id: project.id },
              data: {
                projectManagementItemId: created.id,
                riskNote: `${project.riskNote || ''}；PMI ${created.projectCode}`,
              },
            });
            return created;
          });
          this.logger.log(`公告直建补 PMI ${pmi.projectCode} → BidProject ${project.projectCode}`);
        }
        this.logger.log(`公告首次发布，自动创建项目 ${project.projectCode}`);
      }
    } catch (e) {
      this.logger.error(`公告发布联动创建项目失败 (announcementId=${annId}): ${(e as Error).message}`, (e as Error).stack);
    }
  }

  async remove(id: string) {
    const announcement = await this.prisma.announcement.findUnique({
      where: { id },
      select: { type: true, relatedProjectCode: true, status: true },
    });

    // 公告不存在（可能已被删除/重复删除）→ 抛清晰 404，避免事务内 delete 报晦涩的 P2025
    if (!announcement) {
      throw new NotFoundException({ error: '公告不存在或已被删除', code: 'NOT_FOUND' });
    }

    const relatedProjectCode =
      announcement.type === 'BID_NOTICE' &&
      announcement.status === 'PUBLISHED'
        ? announcement.relatedProjectCode
        : null;

    const project = relatedProjectCode
      ? await this.prisma.bidProject.findUnique({
          where: { projectCode: relatedProjectCode },
          select: { id: true, projectCode: true, stage: true, riskNote: true },
        })
      : null;

    let sealedPathsToClean: string[] = [];

    try {
      await this.prisma.$transaction(async (tx) => {
        // Cleanup linked project before delete — reset to DOWNLOAD if progressed
        if (project) {
          const stageReset = project.stage !== 'DOWNLOAD' && project.stage !== 'ARCHIVED';
          await tx.bidProject.update({
            where: { projectCode: relatedProjectCode! },
            data: {
              stage: stageReset ? 'DOWNLOAD' : undefined,
              riskNote: (project.riskNote || '') + '（来源公告已删除）',
            },
          });
          if (stageReset) {
            await tx.bidSupervisionLog.create({
              data: {
                projectId: project.id,
                time: new Date(),
                role: '系统',
                target: relatedProjectCode!,
                action: '公告删除导致项目阶段重置',
                result: `阶段从 ${project.stage} 重置为 DOWNLOAD（来源公告已删除）`,
                riskFlag: '高',
              },
            });
            // H3: 级联失效下游开标/评标产物——否则陈旧数据被棘轮跳步当作合法准入凭证
            // （可直接用上一轮的解密成功供应商/已确认报告"启动评标/生成结果"；重投新标书因 SUCCESS 保护永不开封）。
            // 复位供应商与专家、删除开标会话/唱标/评分记录/评标结果/废标，关闭所有流转闸门。
            // 注：评分标准结构（BidScoreItem/BidScorePoint）保留以便重招复用；闸门已由复位关闭。
            await tx.bidOpeningSession.deleteMany({ where: { projectId: project.id } });
            await tx.bidOpeningRecord.deleteMany({ where: { projectId: project.id } });
            await tx.bidScoreRecord.deleteMany({ where: { supplier: { projectId: project.id } } });
            await tx.bidEvaluationResult.deleteMany({ where: { projectId: project.id } });
            await tx.bidInvalidBid.deleteMany({ where: { projectId: project.id } });
            await tx.bidSupplier.updateMany({
              where: { projectId: project.id },
              data: { decryptStatus: 'PENDING', confirmStatus: 'PENDING', bidValidity: null },
            });
            await tx.bidExpert.updateMany({
              where: { projectId: project.id },
              data: { reportConfirmed: false, reportConfirmedAt: null },
            });
          }
          await tx.bidDocument.updateMany({
            where: { announcementId: id },
            data: { bidProjectId: null },
          });

          // 收集密封文件路径（供事务后异步清理 MinIO 孤儿对象）
          if (stageReset) {
            const submissions = await tx.supplierBidSubmission.findMany({
              where: { projectId: project.id },
              select: { technicalFileAssetId: true, businessFileAssetId: true, coverLetterAssetId: true },
            });
            const assetIds = new Set<string>();
            for (const s of submissions) {
              if (s.technicalFileAssetId) assetIds.add(s.technicalFileAssetId);
              if (s.businessFileAssetId) assetIds.add(s.businessFileAssetId);
              if (s.coverLetterAssetId) assetIds.add(s.coverLetterAssetId);
            }
            if (assetIds.size > 0) {
              const fileAssets = await tx.fileAsset.findMany({
                where: { id: { in: [...assetIds] } },
                select: { sealedPath: true },
              });
              sealedPathsToClean = fileAssets.map(f => f.sealedPath).filter(Boolean) as string[];
            }
          }
        }

        await tx.announcement.delete({ where: { id } });
      });
    } catch (e) {
      this.logger.error(
        `公告删除事务失败 (announcementId=${id}): ${(e as Error).message}`,
      );
      throw e; // re-throw so caller knows delete failed
    }

    // 事务成功后异步清理 MinIO 密封文件（best-effort，不阻塞）
    if (sealedPathsToClean.length > 0) {
      for (const path of [...new Set(sealedPathsToClean)]) {
        try { await minioClient.removeObject(MINIO_BUCKET, path); } catch (_) { /* best-effort */ }
      }
      this.logger.log(`公告删除清理 MinIO 密封文件 ${sealedPathsToClean.length} 个 (project=${relatedProjectCode})`);
    }

    if (project) {
      this.logger.log(
        `公告删除，解除项目 ${relatedProjectCode} 关联`,
      );
    }

    // 返回 JSON 响应体，避免前端解析空响应报 "Unexpected end of JSON input"
    return { deleted: true };
  }

  async getStats(companyFilter: { companyId?: string } = {}) {
    // 公司隔离：统计聚合在隔离后的数据集上计算
    const where = { ...companyFilter };
    const [total, published, bidNotice, winNotice, policy] = await Promise.all([
      this.prisma.announcement.count({ where }),
      this.prisma.announcement.count({ where: { ...where, status: 'PUBLISHED' } }),
      this.prisma.announcement.count({ where: { ...where, type: 'BID_NOTICE', status: 'PUBLISHED' } }),
      this.prisma.announcement.count({ where: { ...where, type: 'WIN_NOTICE', status: 'PUBLISHED' } }),
      this.prisma.announcement.count({ where: { ...where, type: 'POLICY', status: 'PUBLISHED' } }),
    ]);
    return { total, published, bidNotice, winNotice, policy };
  }

  /** 运行时校验公告 metadata 字段类型，防止 typo 导致静默数据丢失 */
  private static METADATA_SCHEMA: Record<string, { type: string }> = {
    method: { type: 'string' },
    budget: { type: 'number' },
    scope: { type: 'string' },
    qualification: { type: 'string' },
    contact: { type: 'string' },
    openTime: { type: 'string' },
    deadline: { type: 'string' },
  };

  private static validateMetadata(raw: any): Record<string, any> {
    if (typeof raw !== 'object' || raw === null) return {};
    const validated: Record<string, any> = {};
    for (const [key, spec] of Object.entries(AnnouncementService.METADATA_SCHEMA)) {
      if (raw[key] !== undefined) {
        validated[key] = spec.type === 'number' && typeof raw[key] === 'string'
          ? Number(raw[key])
          : raw[key];
      }
    }
    return validated;
  }

  /** 招标公示的投标情况：以公告为起点，合并 BidDocumentAccess（下载侧）+ BidProject（供应侧）数据 */
  async getParticipants(id: string) {
    const ann = await this.prisma.announcement.findUnique({
      where: { id },
      select: { id: true, type: true, title: true, relatedProjectCode: true },
    });
    if (!ann) throw new BadRequestException({ error: '公告不存在', code: 'NOT_FOUND' });

    type ProjectInfo = { name: string; projectCode: string; stage: string; deadline: Date | null };
    type SupplierRow = {
      supplierName: string;
      tags: string[];
      lastDownloadAt: Date | null;
      downloadCount: number;
      submitted: boolean;
      withdrawn: boolean;
      submittedAt: Date | null;
    };

    // ── 1. 解析关联项目（三级回退）──
    let project: ProjectInfo & { id: string } | null = null;

    if (ann.relatedProjectCode) {
      let bp = await this.prisma.bidProject.findUnique({
        where: { projectCode: ann.relatedProjectCode },
        select: { id: true, name: true, projectCode: true, stage: true, deadline: true },
      });
      if (!bp) {
        const proc = await this.prisma.procurementProject.findUnique({
          where: { projectCode: ann.relatedProjectCode },
          select: { bidProjectId: true },
        });
        if (proc?.bidProjectId) {
          bp = await this.prisma.bidProject.findUnique({
            where: { id: proc.bidProjectId },
            select: { id: true, name: true, projectCode: true, stage: true, deadline: true },
          });
        }
      }
      if (!bp) {
        const pmi = await this.prisma.projectManagementItem.findFirst({
          where: { projectCode: ann.relatedProjectCode },
          select: { id: true, title: true, projectCode: true, currentStage: true, bidOpeningTime: true },
        });
        if (pmi) {
          bp = await this.prisma.bidProject.findFirst({
            where: { name: pmi.title },
            select: { id: true, name: true, projectCode: true, stage: true, deadline: true },
            orderBy: { createdAt: 'desc' },
          });
          if (!bp) {
            project = {
              id: pmi.id,
              name: pmi.title,
              projectCode: pmi.projectCode ?? ann.relatedProjectCode,
              stage: pmi.currentStage ?? '',
              deadline: pmi.bidOpeningTime ? new Date(pmi.bidOpeningTime as unknown as string) : null,
            };
          }
        }
      }
      if (bp && !project) project = bp;
    }

    const projectId = project?.id;

    // ── 2. 查询：招标文件 + 下载记录 + 项目供应商 + 投标提交 ──
    const bidDoc = await this.prisma.bidDocument.findUnique({
      where: { announcementId: ann.id },
      select: { id: true },
    });

    const downloaders = bidDoc
      ? await this.prisma.bidDocumentAccess.findMany({
          where: { documentId: bidDoc.id },
          include: { supplier: { select: { name: true, tags: true } } },
          orderBy: { lastDownloadAt: { sort: 'desc', nulls: 'last' } },
        })
      : [];

    let bidSuppliers: { supplierId: string | null; supplierName: string; lastDownloadAt: Date | null; submitStatus: string; supplier: { name: string; tags: string[] } | null }[] = [];
    let submissions: { supplierId: string; status: string; submittedAt: Date | null }[] = [];

    if (projectId) {
      [bidSuppliers, submissions] = await Promise.all([
        this.prisma.bidSupplier.findMany({
          where: { projectId },
          include: { supplier: { select: { name: true, tags: true } } },
          orderBy: { createdAt: 'asc' },
        }),
        this.prisma.supplierBidSubmission.findMany({
          where: { projectId },
          select: { supplierId: true, status: true, submittedAt: true },
        }),
      ]);
    }

    // ── 3. 合并去重：下载者 ∪ 项目供应商 ──
    const subMap = new Map(submissions.map(s => [s.supplierId, s]));
    const rowMap = new Map<string, SupplierRow>();

    for (const d of downloaders) {
      const sid = d.supplierId;
      const bs = bidSuppliers.find(b => b.supplierId === sid);
      const sub = sid ? subMap.get(sid) : undefined;
      rowMap.set(sid, {
        supplierName: d.supplier.name,
        tags: d.supplier.tags ?? [],
        lastDownloadAt: d.lastDownloadAt,
        downloadCount: d.downloadCount,
        submitted: sub?.status === 'submitted' || (bs?.submitStatus === '已提交') || false,
        withdrawn: sub?.status === 'withdrawn' || false,
        submittedAt: sub?.submittedAt ?? null,
      });
    }

    for (const bs of bidSuppliers) {
      const sid = bs.supplierId;
      if (sid && rowMap.has(sid)) continue;
      if (!sid) {
        const existing = [...rowMap.values()].find(r => r.supplierName === bs.supplierName);
        if (existing) continue;
      }
      const sub = sid ? subMap.get(sid) : undefined;
      rowMap.set(sid ?? bs.supplierName, {
        supplierName: bs.supplierName,
        tags: bs.supplier?.tags ?? [],
        lastDownloadAt: bs.lastDownloadAt ?? null,
        downloadCount: 0,
        submitted: sub?.status === 'submitted' || (!sub && bs.submitStatus === '已提交') || false,
        withdrawn: sub?.status === 'withdrawn' || false,
        submittedAt: sub?.submittedAt ?? null,
      });
    }

    const rows = [...rowMap.values()];

    // ── 4. 返回 ──
    const displayProject: ProjectInfo = project ?? {
      name: ann.title,
      projectCode: ann.relatedProjectCode ?? '',
      stage: '',
      deadline: null,
    };

    return {
      project: displayProject,
      suppliers: rows,
      stats: { total: rows.length, submitted: rows.filter(r => r.submitted).length },
      hasBidDocument: !!bidDoc,
    };
  }
}
