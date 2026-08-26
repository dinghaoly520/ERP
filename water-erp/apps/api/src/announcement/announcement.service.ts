import { Injectable, BadRequestException, ConflictException, Logger, NotFoundException, Optional } from '@nestjs/common';
import { assertBidNoticeTiming } from '../bid/bid-timing-rules';
import { parseFlexibleDate } from '../common/parse-date.util';
import { PrismaService } from '../prisma/prisma.service';
import { CreateAnnouncementDto, UpdateAnnouncementDto } from './dto/create-announcement.dto';
import { AnnouncementAiService } from './announcement-ai.service';
import { BidService } from '../bid/bid.service';
import { ProjectManagementService } from '../project-management/project-management.service';
import { BidDocumentService } from './bid-document.service';
import { ANNOUNCEMENT_TYPE_LABELS, ANNOUNCEMENT_TYPE_DATA_CLASS, PUBLIC_VISIBLE_CLASSES } from '@water-erp/shared';
import { checkBidNoticeElements, type ChecklistWarning } from './bid-notice-checklist';

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

  /** 公告类型→中文名称（AI 摘要 prompt 期望中文类型名；两段式公示语义收口 shared） */
  private static readonly TYPE_LABELS: Record<string, string> = { ...ANNOUNCEMENT_TYPE_LABELS };

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

    // A2（表 B.1）：公告按类型落默认公开范围（可由 dto.metadata.dataClass 覆盖）
    const dataClass = ((dto.metadata as any)?.dataClass as string) ?? ANNOUNCEMENT_TYPE_DATA_CLASS[dto.type] ?? 'public_voluntary';

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
        dataClass,
        dataDomain: 'trade',
        ...(dto.metadata !== undefined && { metadata: dto.metadata as any }),
      },
      include: { attachments: { include: { fileAsset: { select: { id: true, originalName: true, size: true, mimeType: true } } } } },
    });

    // C1（7.5.2）：直接以 PUBLISHED 创建的预成交公示/成交公告同样设置公示期（登记制路径，
    // publishDate 可回填线下实际发布日 → 公示期随之起算）
    if ((dto.type === 'PRE_WIN_NOTICE' || dto.type === 'WIN_NOTICE') && status === 'PUBLISHED' && !result.publicityEnd) {
      const end = new Date(result.publishDate || new Date());
      end.setDate(end.getDate() + 3);
      await this.prisma.announcement.update({ where: { id: result.id }, data: { publicityEnd: end } });
      result.publicityEnd = end;
    }

    // P1: create 端点也触发联动（status=PUBLISHED + BID_NOTICE）
    const isBidNoticePublish = dto.type === 'BID_NOTICE' && status === 'PUBLISHED';
    if (isBidNoticePublish) {
      await this.assertBidNoticeTimingGuard(dto); // W2：B-004/B-009（依法必招强制，违者 400 阻断发布）
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
      try {
        await this.syncBidProject(result.id, {
          id: result.id, title: result.title, publishDate: result.publishDate,
          metadata: result.metadata, relatedProjectCode: result.relatedProjectCode, authorId: result.authorId,
          companyId: result.companyId, companyName: result.companyName,
        });
      } catch (e) {
        // backlog §2.1：公告直建项目失败此前仅 error log——发布人不知情、公告却已发布。
        // 发布仍成功（不回滚），但响应带警示供 :3005 展示。
        this.logger.error(`公告发布联动创建项目失败 (announcementId=${result.id}): ${(e as Error).message}`);
        (result as any).projectSyncWarning = `公告已发布，但联动创建招标项目失败（${(e as Error).message}）——请检查元数据时间并重试或联系管理员`;
      }
    }
    // 发布即通知（所有类型，不仅 BID_NOTICE）：按可见范围向供应商发站内信
    if (status === 'PUBLISHED') {
      const meta = (result.metadata as Record<string, any>) || {};
      void this.notifySuppliersOnPublish(result.id, result.title, { ...meta, __type: result.type }).catch(e =>
        this.logger.warn(`公告发布通知发送失败 (create): ${(e as Error).message}`),
      );
    }
    // C5（7.2.6）：补遗公告发布 → 补遗计数 + 已获取文件供应商定向通知（不阻塞发布）
    if (dto.type === 'ADDENDUM' && status === 'PUBLISHED') {
      const advice = this.addendumDeadlineAdvice((dto.metadata as Record<string, any>)?.newDeadline);
      void this.syncAddendum(result.id).catch(e => this.logger.warn(`补遗联动失败: ${(e as Error).message}`));
      if (advice) Object.assign(result, { deadlineAdvice: advice });
    }
    // A3（GB/T 43711 7.2.2.5）：发布采购公告时做要素完整性检查——警告不阻断，
    // 前端读到 checklistWarnings 后弹确认，放行理由由操作历史（PUBLISH changedFields）留痕。
    const checklistWarnings: ChecklistWarning[] =
      status === 'PUBLISHED' && dto.type === 'BID_NOTICE'
        ? checkBidNoticeElements({ title: dto.title, content: dto.content, metadata: dto.metadata, relatedProjectCode: dto.relatedProjectCode })
        : [];

    if (isBidNoticePublish) {
      const detail = await this.get(result.id);
      return Object.assign(detail, { checklistWarnings });
    }

    return Object.assign(result, { checklistWarnings });
  }

  async list(
    params: { type?: string; status?: string; search?: string; page?: number; pageSize?: number },
    companyFilter: { companyId?: string } = {},
    opts: { publicVisibilityOnly?: boolean } = {},
  ) {
    const page = params.page ?? 1;
    const pageSize = params.pageSize ?? 20;
    const skip = (page - 1) * pageSize;

    // 公司隔离（2026-08-20）：非 admin 只见本公司公告；admin 可切公司/全部
    const where: any = { ...companyFilter };
    // A2（表 B.1）：公开门户仅出 应公开/宜公开（存量 null 按"已发布即可见"放行）。
    // 用 AND 组合——search 分支会覆写 where.OR，不能挂 OR 上
    if (opts.publicVisibilityOnly) {
      where.AND = [...(where.AND ?? []), { OR: [{ dataClass: { in: [...PUBLIC_VISIBLE_CLASSES] } }, { dataClass: null }] }];
    }
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
    // A2（表 B.1）：查询层过滤公开级别（total 与 items 同口径）
    const res = await this.list({ ...params, status: 'PUBLISHED' }, {}, { publicVisibilityOnly: true });
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

    // W2（B-004/B-009）：发布转换预检（依法必招强制；update 路径用库中字段+dto 覆盖取数）
    if (isBidNoticePublish) {
      await this.assertBidNoticeTimingGuard({
        metadata: dto.metadata ?? announcement.metadata,
        relatedProjectCode: dto.relatedProjectCode ?? announcement.relatedProjectCode,
        publishDate: dto.publishDate ?? announcement.publishDate ?? new Date(),
      });
    }

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

    // A1→C1（GB/T 43711 7.5.2）：预成交公示发布时自动设置公示期（3 个日历日）；
    // WIN_NOTICE 保留同逻辑以兼容存量"中标公示"与手动直发成交公告的路径
    if ((result.type === 'PRE_WIN_NOTICE' || result.type === 'WIN_NOTICE') && targetStatus === 'PUBLISHED' && !result.publicityEnd) {
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
      try {
        await this.syncBidProject(id, { id: result.id, title: result.title, publishDate: result.publishDate, metadata: result.metadata, relatedProjectCode: result.relatedProjectCode, authorId: result.authorId, companyId: result.companyId, companyName: result.companyName });
      } catch (e) {
        // backlog §2.1：与 create 路径同款——发布成功但响应带 projectSyncWarning
        this.logger.error(`公告发布联动创建项目失败 (announcementId=${id}): ${(e as Error).message}`);
        (result as any).projectSyncWarning = `公告已发布，但联动创建招标项目失败（${(e as Error).message}）——请检查元数据时间并重试或联系管理员`;
      }
    }
    // 发布即通知（所有类型）：按可见范围向供应商发站内信
    if (isPublishTransition) {
      const meta = (result.metadata as Record<string, any>) || {};
      void this.notifySuppliersOnPublish(result.id, result.title, { ...meta, __type: result.type }).catch(e =>
        this.logger.warn(`公告发布通知发送失败 (update): ${(e as Error).message}`),
      );
    }
    // C5（7.2.6）：update 路径发布补遗公告同样联动
    if (result.type === 'ADDENDUM' && isPublishTransition) {
      const effectiveMeta = (dto.metadata ?? announcement.metadata) as Record<string, any> | null;
      const advice = this.addendumDeadlineAdvice(effectiveMeta?.newDeadline);
      void this.syncAddendum(result.id).catch(e => this.logger.warn(`补遗联动失败 (update): ${(e as Error).message}`));
      if (advice) Object.assign(result, { deadlineAdvice: advice });
    }
    // A3：update 路径发布采购公告同样做要素检查（用合并后的生效值）
    const checklistWarnings: ChecklistWarning[] = isBidNoticePublish
      ? checkBidNoticeElements({
          title,
          content,
          metadata: (dto.metadata ?? announcement.metadata) as Record<string, any> | null,
          relatedProjectCode: dto.relatedProjectCode ?? announcement.relatedProjectCode,
        })
      : [];

    if (isBidNoticePublish) {
      const detail = await this.get(id);
      return Object.assign(detail, { checklistWarnings });
    }

    return Object.assign(result, { checklistWarnings });
  }

  /**
   * A3（GB/T 43711 7.2.2.5）：采购公告要素预检（dry-run）。
   * 前端在提交发布前调用，弹窗展示缺失要素，确认后照常提交。
   */
  previewBidNoticeChecklist(dto: Pick<CreateAnnouncementDto, 'title' | 'content' | 'metadata' | 'relatedProjectCode'>) {
    return { warnings: checkBidNoticeElements(dto) };
  }

  /**
   * C5（GB/T 43711 7.2.6）：补遗公告发布联动——
   * ① 项目采购文件 addendumNo +1（供应商侧显示"补遗 N 次"，提示重新下载）；
   * ② 已下载/受邀供应商批量站内信（澄清修改应告知潜在供应商）；
   * ③ 若填写了调整后截止时间且距发布不足 ADDENDUM_MIN_LEAD_DAYS（默认 3 日），
   *    在响应中给出 deadlineAdvice 提示（不自动改项目时间——调整走项目编辑，避免误伤开标联动）。
   */
  private async syncAddendum(announcementId: string) {
    const ann = await this.prisma.announcement.findUnique({
      where: { id: announcementId },
      select: { id: true, title: true, relatedProjectCode: true, metadata: true },
    });
    if (!ann) return;
    const meta = (ann.metadata as Record<string, any>) ?? {};
    const code = ann.relatedProjectCode || meta.projectCode;
    if (!code) return;

    const project = await this.prisma.bidProject.findUnique({
      where: { projectCode: code },
      select: { id: true, deadline: true },
    });
    if (!project) return;

    // ① 采购文件补遗计数（OPEN 文档可能无 bidProjectId，用 announcement 链路兜底找）
    const bidDoc = (await this.prisma.bidDocument.findFirst({ where: { bidProjectId: project.id } }))
      ?? (await this.prisma.bidDocument.findFirst({
        where: { announcement: { relatedProjectCode: code, type: 'BID_NOTICE' } },
      }));
    if (bidDoc) {
      await this.prisma.bidDocument.update({
        where: { id: bidDoc.id },
        data: { addendumNo: { increment: 1 } },
      }).catch(e => this.logger.warn(`补遗计数更新失败 bidDoc=${bidDoc.id}: ${(e as Error).message}`));
    }

    // ② 通知已下载过文件或受邀的供应商（去重）
    const [accesses, invited] = await Promise.all([
      bidDoc
        ? this.prisma.bidDocumentAccess.findMany({ where: { documentId: bidDoc.id }, select: { supplierId: true } })
        : Promise.resolve([] as { supplierId: string }[]),
      this.prisma.bidSupplier.findMany({ where: { projectId: project.id }, select: { supplierId: true } }),
    ]);
    const supplierIds = [...new Set(
      [...accesses.map(a => a.supplierId), ...invited.map(b => b.supplierId)].filter((id): id is string => !!id),
    )];
    if (supplierIds.length === 0) return;
    const suppliers = await this.prisma.supplier.findMany({
      where: { id: { in: supplierIds } },
      select: { userId: true },
    });
    let sent = 0;
    for (const s of suppliers) {
      if (!s.userId) continue;
      try {
        await this.prisma.notification.create({
          data: {
            userId: s.userId,
            type: 'ANNOUNCEMENT_PUBLISHED',
            title: `补遗公告：${ann.title}`,
            content: `您参与的采购项目发布补遗/澄清公告，请及时查看并按新要求准备响应文件。`,
            link: `/announcements/${ann.id}`,
          },
        });
        sent++;
      } catch { /* 单个失败不阻塞 */ }
    }
    this.logger.log(`补遗公告通知已发送: ${ann.title}, 收件 ${sent}/${suppliers.length} 家供应商`);
  }

  /** C5：补遗截止时间充分性提示（7.2.6.2 保证供应商有足够时间编制） */
  addendumDeadlineAdvice(newDeadline?: string) {
    if (!newDeadline) return null;
    const minDays = Number(process.env.ADDENDUM_MIN_LEAD_DAYS ?? 3);
    const target = new Date(newDeadline);
    if (Number.isNaN(target.getTime())) return null;
    const leadMs = target.getTime() - Date.now();
    if (leadMs < minDays * 86400000) {
      return `调整后的截止时间距补遗发布不足 ${minDays} 日，GB/T 43711 7.2.6.2 要求保证供应商有足够时间编制响应文件，请确认时限合理（或说明紧急理由）`;
    }
    return null;
  }

  /**
   * C1（GB/T 43711 7.5.2.5）：预成交公示期满且无异议 → 发布成交公告。
   * 从 PRE_WIN_NOTICE 派生 WIN_NOTICE（直接落 PUBLISHED），幂等：已存在成交公告则原样返回。
   */
  async confirmWinnerNotice(
    id: string,
    operator: { operatorId?: string; operatorName?: string; ipAddress?: string; userAgent?: string } = {},
  ) {
    const pre = await this.prisma.announcement.findUnique({ where: { id } });
    if (!pre || pre.type !== 'PRE_WIN_NOTICE') {
      throw new BadRequestException({ error: '公告不存在或不是预成交公示', code: 'NOT_PRE_WIN_NOTICE' });
    }
    if (pre.status !== 'PUBLISHED') {
      throw new BadRequestException({ error: '预成交公示尚未发布', code: 'NOT_PUBLISHED' });
    }
    if (!pre.publicityEnd || new Date() < new Date(pre.publicityEnd)) {
      throw new BadRequestException({ error: '公示期未满，暂不能发布成交公告', code: 'PUBLICITY_NOT_ENDED' });
    }

    // 幂等：同项目已存在成交公告则不重复生成
    const codes = pre.relatedProjectCode ? [pre.relatedProjectCode] : [];
    const existing = codes.length
      ? await this.prisma.announcement.findFirst({ where: { relatedProjectCode: { in: codes }, type: 'WIN_NOTICE' } })
      : null;
    if (existing) return { winnerNotice: existing, created: false };

    const meta = { ...((pre.metadata as Record<string, any>) ?? {}), derivedFromAnnouncementId: pre.id };
    const title = pre.title.replace(/^预成交公示[:：]?/, '成交公告：');
    const content = `预成交公示期满且无异议，预成交供应商即为成交供应商，现予公告。\n\n${pre.content}`;

    const winnerNotice = await this.prisma.announcement.create({
      data: {
        title,
        content,
        type: 'WIN_NOTICE',
        status: 'PUBLISHED',
        publishDate: new Date(),
        relatedProjectCode: pre.relatedProjectCode,
        authorId: pre.authorId,
        companyId: pre.companyId,
        companyName: pre.companyName,
        metadata: meta,
      },
    });

    // 派生关系双向留痕：公示公告记 UPDATE（changedFields 指向成交公告），成交公告记 CREATE
    await this.prisma.announcementHistory.createMany({
      data: [
        {
          announcementId: pre.id, action: 'UPDATE', title: pre.title, type: pre.type,
          status: pre.status, changedFields: ['confirmWinnerNotice', `derived:${winnerNotice.id}`],
          operatorId: operator.operatorId ?? null, operatorName: operator.operatorName ?? null,
          ipAddress: operator.ipAddress ?? null, userAgent: operator.userAgent ?? null,
        },
        {
          announcementId: winnerNotice.id, action: 'CREATE', title: winnerNotice.title, type: winnerNotice.type,
          status: winnerNotice.status, changedFields: [`derivedFrom:${pre.id}`],
          operatorId: operator.operatorId ?? null, operatorName: operator.operatorName ?? null,
          ipAddress: operator.ipAddress ?? null, userAgent: operator.userAgent ?? null,
        },
      ],
    }).catch(e => this.logger.warn(`成交公告派生留痕写入失败（不阻塞）: ${(e as Error).message}`));

    // 发布即通知供应商（成交公告对供应商可见）
    void this.notifySuppliersOnPublish(winnerNotice.id, winnerNotice.title, { ...meta, __type: 'WIN_NOTICE' })
      .catch(e => this.logger.warn(`成交公告通知发送失败: ${(e as Error).message}`));

    this.logger.log(`预成交公示 ${pre.id} 已确认，生成成交公告 ${winnerNotice.id}`);
    return { winnerNotice, created: true };
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

    const typeLabel: Record<string, string> = { ...ANNOUNCEMENT_TYPE_LABELS };
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

  /** W2（B-004/B-009）采购公告发布时间规则预检：依法必招强制、非依法必招偏离留痕。 */
  private async assertBidNoticeTimingGuard(dto: { metadata?: any; relatedProjectCode?: string | null; publishDate?: any }) {
    const meta = AnnouncementService.validateMetadata(dto.metadata);
    const existing = dto.relatedProjectCode
      ? await this.prisma.bidProject.findUnique({ where: { projectCode: dto.relatedProjectCode } })
      : null;
    const saleStart = dto.publishDate ? new Date(dto.publishDate) : new Date();
    const openTime = existing?.openTime ?? parseFlexibleDate(meta.openTime) ?? null;
    const saleEnd = existing?.downloadDeadline
      ?? parseFlexibleDate(meta.downloadDeadline)
      ?? existing?.deadline
      ?? parseFlexibleDate(meta.deadline)
      ?? null;
    const legalMandatory = existing?.legalMandatory ?? false;
    const r = assertBidNoticeTiming({ saleStart, openTime, saleEnd, legalMandatory });
    if (r.deviated) {
      // 非依法必招项目偏离放行——监督日志留痕（延续 24h 规则先例）
      await this.prisma.bidSupervisionLog.create({
        data: {
          projectId: existing?.id ?? 'announcement-only',
          time: new Date(), role: '系统', target: dto.relatedProjectCode ?? '(直建)',
          action: '非依法必招项目时间规则偏离放行',
          result: `${r.rule}（B-004 售标→开标≥20日/B-009 发售期≥5日）不满足但 legalMandatory=false`,
          riskFlag: '低',
        },
      }).catch(() => undefined);
    }
    return r;
  }

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

    // P0-4 闸门：关联项目已进入投标/开标/评标流程（SUBMIT/OPENING/EVALUATING）时禁删公告。
    // 置于事务前拦截——零副作用：不下发任何级联删除/复位/MinIO 清理，引导先完成流标或归档。
    if (project) {
      const blocked = ['SUBMIT', 'OPENING', 'EVALUATING'].includes(project.stage);
      if (blocked) {
        throw new ConflictException({ error: '该项目已进入投标/开标/评标流程，公告不可删除——请先完成流标或归档后再删除公告', code: 'BID_IN_PROGRESS' });
      }
    }

    try {
      await this.prisma.$transaction(async (tx) => {
        // 终审裁定（2026-08-21）：DOWNLOAD/ABORTED/ARCHIVED 三态仅解关联——追加风险备注、解除标书关联，
        // 不重置阶段、不级联删除开标/评标产物、不清理 MinIO（SUBMIT+ 已由上方 409 闸门拦截）。
        if (project) {
          await tx.bidProject.update({
            where: { projectCode: relatedProjectCode! },
            data: {
              riskNote: (project.riskNote || '') + '（来源公告已删除）',
            },
          });
          await tx.bidDocument.updateMany({
            where: { announcementId: id },
            data: { bidProjectId: null },
          });
        }

        await tx.announcement.delete({ where: { id } });
      });
    } catch (e) {
      this.logger.error(
        `公告删除事务失败 (announcementId=${id}): ${(e as Error).message}`,
      );
      throw e; // re-throw so caller knows delete failed
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
    // A3（GB/T 43711 7.2.2.3）：直接采购理由随公告同步到 BidProject.directSourcingReason
    directSourcingReason: { type: 'string' },
    // C1（7.5.2.2）：预成交公示/成交公告的异议渠道
    objection: { type: 'string' },
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
