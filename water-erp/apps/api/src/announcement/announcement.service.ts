import { Injectable, BadRequestException, ConflictException, Logger, NotFoundException, Optional } from '@nestjs/common';
import { assertBidNoticeTiming } from '../bid/bid-timing-rules';
import { parseFlexibleDate } from '../common/parse-date.util';
import { joinSoftWrappedPlainText } from '../tender-write/announcement-content-html.util';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationService } from '../notification/notification.service';
import { Inject, forwardRef } from '@nestjs/common';
import { CreateAnnouncementDto, UpdateAnnouncementDto } from './dto/create-announcement.dto';
import { AnnouncementAiService } from './announcement-ai.service';
import { SunshinePushService } from './sunshine-push.service';
import { normalizeScheduledPublishMetadata, parseScheduledPublishDate } from './scheduled-publish.util';
import { BidService } from '../bid/bid.service';
import { ProjectManagementService } from '../project-management/project-management.service';
import { BidDocumentService } from './bid-document.service';
import { ANNOUNCEMENT_TYPE_LABELS, ANNOUNCEMENT_TYPE_DATA_CLASS, PUBLIC_VISIBLE_CLASSES } from '@water-erp/shared';
import { checkBidNoticeElements, type ChecklistWarning } from './bid-notice-checklist';
import type { CompanyWhere } from '../company/company-scope';
import { GbCodeService } from '../common/gb-code.service';

/** 回收站操作人上下文（与 confirmWinnerNotice 的 operator 同构，2026-09-26） */
export type RecycleOperator = { operatorId?: string; operatorName?: string; ipAddress?: string; userAgent?: string };

@Injectable()
export class AnnouncementService {
  private readonly logger = new Logger(AnnouncementService.name);

  constructor(
    private prisma: PrismaService,
    private announcementAi: AnnouncementAiService,
    @Optional() private bidService?: BidService,
    @Optional() private projectManagementService?: ProjectManagementService,
    @Optional() private bidDocumentService?: BidDocumentService,
    @Optional() @Inject(forwardRef(() => NotificationService))
    private readonly notifications?: NotificationService,
    /** 发布赋码闸自愈用（@Optional：无注入时缺码仍硬拦，兼容测试直构） */
    @Optional() private readonly gbCode?: GbCodeService,
    /** 阳光采购平台推送（2026-10-28 测试联调）——置末位不动既有位置构造（测试直构按位传参） */
    @Optional() private readonly sunshinePush?: SunshinePushService,
  ) {}

  /** 公告类型→中文名称（AI 摘要 prompt 期望中文类型名；两段式公示语义收口 shared） */
  private static readonly TYPE_LABELS: Record<string, string> = { ...ANNOUNCEMENT_TYPE_LABELS };

  /** 对接专项 Phase 1（T4）：发布赋码闸（自愈版，2026-10-20 缺码事故）——发布关联 BidProject
   *  的公告时，项目须已有 21 位国标采购编码（省平台统一交易识别码前置）。无关联项目（POLICY/
   *  PLATFORM 等）不拦。缺码不再硬拦：旁路创建（ensureBidProject 懒建/流标重启等）的缺码行
   *  现场补码放行；仅自愈失败（分配器抛错/未注入）才拒绝。 */
  private async assertGbCodeIfLinked(relatedProjectCode?: string | null) {
    if (!relatedProjectCode) return;
    const project = await this.prisma.bidProject.findUnique({
      where: { projectCode: relatedProjectCode },
      select: { id: true, gbProcureCode: true, projectManagementItemId: true },
    });
    if (!project || project.gbProcureCode) return;
    if (this.gbCode) {
      try {
        const { gbProcureCode } = await this.gbCode.backfillProcureCodeFor(project);
        this.logger.warn(`发布赋码闸自愈：${relatedProjectCode} 现场补码 ${gbProcureCode}（旁路创建缺码行已治愈）`);
        return;
      } catch (e) {
        this.logger.warn(`发布赋码闸自愈失败，转硬拦: ${(e as Error).message}`);
      }
    }
    throw new BadRequestException({
      error: '项目未取得国标采购编码（gbProcureCode）且自动补码失败——请稍后重试，或由管理员执行 apps/api/scripts/backfill-gb-codes.ts --execute 补码后发布',
      code: 'GB_CODE_REQUIRED',
    });
  }

  /**
   * 客户端直供 aiSummary 命中提示词泄漏特征时不采用，转由服务端生成。
   * 保留端到端测试直供短文本、跳过 LLM 的约定（test/bid.e2e-spec.ts）。
   */

  private sanitizeClientAiSummary(raw: string | undefined): string | undefined {
    const v = raw?.trim();
    if (!v) return undefined;
    return this.announcementAi.looksLikePromptLeak(v) ? undefined : v;
  }

  async create(
    dto: CreateAnnouncementDto,
    authorId?: string,
    companyStamp: { companyId?: string; companyName?: string } = {},
  ) {
    const suppliedAi = this.sanitizeClientAiSummary(dto.aiSummary);
    const aiSummary = suppliedAi ?? await this.announcementAi.summarize({
      title: dto.title,
      type: AnnouncementService.TYPE_LABELS[dto.type] ?? dto.type,
      content: dto.content,
    });

    const status = (dto.status as any) ?? 'DRAFT';

    // W2（B-004/B-009）：依法必招时间规则预检——置于建行之前，违者 400 且不留孤儿公告
    if (dto.type === 'BID_NOTICE' && status === 'PUBLISHED') {
      await this.assertBidNoticeTimingGuard(dto);
    }

    // 对接专项 Phase 1（T4）：发布赋码强制闸（create 路径——发布即生效的公告）
    if (status === 'PUBLISHED') {
      await this.assertGbCodeIfLinked(dto.relatedProjectCode);
    }

    // 正式盖章版引用校验（2026-09-27 用户裁定）：BID_NOTICE 即时发布且引用采购文件 → 必须
    // 与 03 指针一致；置于建行之前（同 W2/T4 口径：违者 400 且不留孤儿公告）
    if (dto.type === 'BID_NOTICE' && status === 'PUBLISHED') {
      await this.assertOfficialTenderReference(
        ((dto.metadata as Record<string, any>) ?? {}),
        dto.relatedProjectCode,
      );
    }

    // GB/T 43711（7.3）：谈判采购通过定向邀请组织，不发布采购公告（前端类别矩阵
    // ANNOUNCEMENT_AVAILABILITY 已限定谈判只有流标/中标公告）——此为 API 直发防线
    if (dto.type === 'BID_NOTICE' && (dto.metadata as Record<string, any> | null)?.method === '谈判采购') {
      throw new BadRequestException({
        error: '谈判采购不发布采购公告：应通过供应商邀请（定向邀请函 + 回执）组织，供应商接受邀请后自动纳入投标项目',
        code: 'NEGOTIATION_NO_PROCUREMENT_NOTICE',
      });
    }

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
        ...(dto.metadata !== undefined && { metadata: normalizeScheduledPublishMetadata(dto.metadata) as any }),
      },
      include: { attachments: { include: { fileAsset: { select: { id: true, originalName: true, size: true, mimeType: true } } } } },
    });

    // C1（7.5.2）：直接以 PUBLISHED 创建的预成交公示/成交公告同样设置公示期（登记制路径，
    // publishDate 可回填线下实际发布日 → 公示期随之起算）；
    // BID_NOTICE 同样设 3 天公示期（2026-09-09：前端状态徽标「公示中/已公示」按此判定，兜底同款）。
    // 注意不含 WIN_BID_NOTICE：中标公告的公示期由 BidService.getPublicityStatus 读时推导
    // （publishDate+3d）——持久化会让公开端 isOfflined 在 3 天后把结果公告打成标题壳下线。
    if ((dto.type === 'PRE_WIN_NOTICE' || dto.type === 'WIN_NOTICE' || dto.type === 'BID_NOTICE') && status === 'PUBLISHED' && !result.publicityEnd) {
      const end = new Date(result.publishDate || new Date());
      end.setDate(end.getDate() + 3);
      await this.prisma.announcement.update({ where: { id: result.id }, data: { publicityEnd: end } });
      result.publicityEnd = end;
    }

    // 中标公告发布即链接/确认中标候选人（2026-10-19）：评标结果结构化落 metadata.winCandidates
    if (result.type === 'WIN_BID_NOTICE' && status === 'PUBLISHED') {
      await this.linkWinBidCandidates(result.id, result.relatedProjectCode);
    }

    // create 端点也触发联动（status=PUBLISHED + BID_NOTICE）
    const isBidNoticePublish = dto.type === 'BID_NOTICE' && status === 'PUBLISHED';
    if (isBidNoticePublish) {
      // 引用采购文件发布时，自动生成加密 BidDocument。
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
      // 阳光采购平台推送（2026-10-28 测试联调）：metadata.sunshinePublish 快照外发，结果留痕同字段
      void this.sunshinePush?.onPublish({ id: result.id, content: result.content, metadata: result.metadata });
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
    params: { type?: string; status?: string; search?: string; page?: number; pageSize?: number; sortBy?: string; sortOrder?: 'asc' | 'desc' },
    companyFilter: CompanyWhere = {},
    opts: { publicVisibilityOnly?: boolean; excludeIds?: string[]; extraWhere?: Record<string, any> } = {},
  ) {
    const page = params.page ?? 1;
    const pageSize = params.pageSize ?? 20;
    const skip = (page - 1) * pageSize;

    // 公司隔离：非 admin 只见本公司公告；admin 可切公司/全部
    const where: any = { ...companyFilter };
    // 供应商公告中心公司隔离（2026-10-20）：复合过滤（归属公司∪平台级∪定向白名单）走 AND 注入
    // ——与 publicVisibilityOnly 同理，search 分支会覆写 where.OR，不能挂 OR 顶层
    if (opts.extraWhere) {
      where.AND = [...(where.AND ?? []), opts.extraWhere];
    }
    // A2（表 B.1）：公开门户仅出 应公开/宜公开（存量 null 按"已发布即可见"放行）。
    // 用 AND 组合——search 分支会覆写 where.OR，不能挂 OR 上
    if (opts.publicVisibilityOnly) {
      where.AND = [...(where.AND ?? []), { OR: [{ dataClass: { in: [...PUBLIC_VISIBLE_CLASSES] } }, { dataClass: null }] }];
    }
    // 供应商视角排除集（2026-09-29 spec，supplierList 预取后传入）：定向但不属于本人的公告 id。
    // 不在 jsonb 层做"不等于"——Prisma path 过滤不支持 not，且 SQL NULL 语义会误伤无 visibility 键的存量行。
    if (opts.excludeIds?.length) {
      where.id = { notIn: opts.excludeIds };
    }
    if (params.type) {
      // 逗号分隔多类型（2026-09-09：「中标公告」tab 联合 WIN_BID_NOTICE + 历史存量 PRE_WIN_NOTICE）
      const types = params.type.split(',').map((t: string) => t.trim()).filter(Boolean);
      where.type = types.length > 1 ? { in: types } : params.type;
    }
    if (params.status === 'OFFLINED') {
      // 衍生态筛选（2026-10-28）：「已下线」=公示期满的 PUBLISHED（与 displayStatus 徽标同集）——
      // 此前下拉「已下线」映射 ARCHIVED（其徽标实为「已公示」，09-26 已移除下线→ARCHIVED 动作）
      where.status = 'PUBLISHED';
      where.publicityEnd = { lte: new Date() };
    } else if (params.status) {
      // 2026-09-26 回收站体系：status 支持逗号分隔（回收站传 HIDDEN,OFFLINE），与 type 逗号语义一致
      const statuses = params.status.split(',').map((s: string) => s.trim()).filter(Boolean);
      where.status = statuses.length > 1 ? { in: statuses } : params.status;
    } else {
      // 2026-09-26 回收站体系：默认排除回收站内容（隐藏/下架只在回收站可见，公开端本就只出 PUBLISHED）
      // 2026-10-16 用户裁定：草稿不再混入管理端「全部」列表——草稿统一收纳进「待处理草稿」KPI 弹窗，
      // 显式 status=DRAFT 仍可查（KPI 弹窗/草稿筛选用），仅默认「全部」排除
      where.status = { notIn: ['HIDDEN', 'OFFLINE', 'DRAFT'] };
    }
    if (params.search) {
      // 2026-10-14：补 relatedProjectCode——项目编号可搜（:3002 顶栏/列表、:3004 公告中心、:3005 管理端共用本口径）
      where.OR = [
        { title: { contains: params.search, mode: 'insensitive' } },
        { content: { contains: params.search, mode: 'insensitive' } },
        { relatedProjectCode: { contains: params.search, mode: 'insensitive' } },
      ];
    }

    // R7-3：排序下沉服务端（白名单：浏览/类型/状态/发布日期；isTop 恒置顶）——
    // 此前前端对当前页 15 条客户端排序，跨页结果错误且表头暗示全局语义
    const SORTABLE: Record<string, string> = { publishDate: 'publishDate', viewCount: 'viewCount', type: 'type', status: 'status', createdAt: 'createdAt' };
    const orderBy: any[] = [{ isTop: 'desc' }];
    if (params.sortBy && SORTABLE[params.sortBy]) {
      orderBy.push({ [SORTABLE[params.sortBy]]: params.sortOrder === 'asc' ? 'asc' : 'desc' });
    }
    // 决胜键去重：sortBy=publishDate 时不重复追加（数组重复键 Prisma 可能拒收）
    if (!params.sortBy || SORTABLE[params.sortBy] !== 'publishDate') {
      orderBy.push({ publishDate: 'desc' });
    }
    orderBy.push({ createdAt: 'desc' });

    const [total, items] = await Promise.all([
      this.prisma.announcement.count({ where }),
      this.prisma.announcement.findMany({
        where,
        skip,
        take: pageSize,
        orderBy,
        include: {
          attachments: { include: { fileAsset: { select: { id: true, originalName: true, size: true, mimeType: true } } } },
          bidDocument: { select: { id: true, title: true, accessScope: true, requirePayment: true, price: true, downloadCount: true } },
        },
      }),
    ]);

    return { total, page, pageSize, items };
  }

  /** 按公司分组全量计数（2026-09-27 公司下拉语境化 + 全部公司分组标题；与 list 同筛选） */
  async companyCounts(
    params: { type?: string; status?: string; search?: string },
    companyFilter: CompanyWhere = {},
  ) {
    const where: any = { ...companyFilter };
    if (params.type) {
      const types = params.type.split(',').map((t: string) => t.trim()).filter(Boolean);
      where.type = types.length > 1 ? { in: types } : params.type;
    }
    if (params.status === 'OFFLINED') {
      // 衍生态同 list()（2026-10-28）：OFFLINED 筛选下分组计数与列表同集，否则分组归零
      where.status = 'PUBLISHED';
      where.publicityEnd = { lte: new Date() };
    } else if (params.status) {
      const statuses = params.status.split(',').map((s: string) => s.trim()).filter(Boolean);
      where.status = statuses.length > 1 ? { in: statuses } : params.status;
    } else {
      // 与 list() 同口径：默认「全部」排除草稿（2026-10-16），公司分组计数与列表一致
      where.status = { notIn: ['HIDDEN', 'OFFLINE', 'DRAFT'] };
    }
    if (params.search) {
      // 2026-10-14：补 relatedProjectCode——项目编号可搜（:3002 顶栏/列表、:3004 公告中心、:3005 管理端共用本口径）
      where.OR = [
        { title: { contains: params.search, mode: 'insensitive' } },
        { content: { contains: params.search, mode: 'insensitive' } },
        { relatedProjectCode: { contains: params.search, mode: 'insensitive' } },
      ];
    }
    const groups = await this.prisma.announcement.groupBy({ by: ['companyName'], where, _count: { _all: true } });
    return groups
      .map(g => ({ name: g.companyName?.trim() || '未归属', count: g._count._all }))
      .sort((a, b) => (a.name === '未归属' ? 1 : b.name === '未归属' ? -1 : b.count - a.count || a.name.localeCompare(b.name, 'zh')));
  }

  /** Public listing — only published items；公开端不含招标文件（首页不泄露）；RESTRICTED 可见范围不流转到首页 */
  async publicList(params: { type?: string; search?: string; page?: number; pageSize?: number }) {
    // 契约（2026-08-20 拍板，2026-10-20 修订）：公开门户（:3002）**全量展示所有公司公告**——
    // 匿名公开端无从判归属，公司隔离不适用。供应商门户（:3004）已改公司隔离
    // （supplierList，2026-10-20 用户裁定：归属公司 ∪ 平台级 ∪ 定向白名单命中）。
    // A2（表 B.1）：查询层过滤公开级别（total 与 items 同口径）
    // v2（2026-09-26 拍板）：已下线（公示期满的 PUBLISHED / 存量 ARCHIVED）仍列标题壳——
    // 服务端剥正文/摘要 + titleOnly 标记，门户只渲染不可点标题；下架(OFFLINE)/隐藏(HIDDEN)完全不出。
    const res = await this.list({ ...params, status: 'PUBLISHED,ARCHIVED' }, {}, { publicVisibilityOnly: true });
    return { ...res, items: res.items
      .filter((a: any) => a.metadata?.visibility !== 'RESTRICTED')
      .map((a: any) => this.isOfflined(a) ? this.titleOnlyStub(a) : this.stripForPublic(a)) };
  }

  /** 供应商视角列表（:3004 公告中心，2026-09-29 spec）——公开 ∪ 定向命中本供应商。
   *  与 publicList 同口径（PUBLISHED/ARCHIVED、公开级 dataClass、脱敏/标题壳、排序），
   *  但不剥离 RESTRICTED——定向公告对被选供应商可见；:3002 公开门户继续走 publicList 不受影响。
   *  公司隔离（2026-10-20 用户裁定，推翻 2026-08-20「全量展示所有公司公告」契约）：只出
   *  归属公司（APPROVED SupplierCompanyLink）∪ 平台级（companyId null）的公告；
   *  定向公告白名单命中豁免公司闸——显式点名 > 公司归属。
   *  归属判定：预取 RESTRICTED 小集合（通常个位数）在 JS 判 restrictedSupplierIds 是否含本 id，
   *  不属于本人的以 id notIn 排除——分页 total 与排序在主查询内保持真实。 */
  async supplierList(
    params: { type?: string; search?: string; page?: number; pageSize?: number },
    supplierId: string,
  ) {
    const [links, restricted] = await Promise.all([
      this.prisma.supplierCompanyLink.findMany({
        where: { supplierId, status: 'APPROVED' },
        select: { companyId: true },
      }),
      this.prisma.announcement.findMany({
        where: { status: { in: ['PUBLISHED', 'ARCHIVED'] }, metadata: { path: ['visibility'], equals: 'RESTRICTED' } },
        select: { id: true, metadata: true },
      }),
    ]);
    const companyIds = links.map(l => l.companyId);
    const mineIds = restricted
      .filter((r: any) => Array.isArray(r.metadata?.restrictedSupplierIds) && r.metadata.restrictedSupplierIds.includes(supplierId))
      .map((r: any) => r.id);
    const notMine = restricted.map((r: any) => r.id).filter(id => !mineIds.includes(id));
    const res = await this.list(
      { ...params, status: 'PUBLISHED,ARCHIVED' },
      {},
      {
        publicVisibilityOnly: true,
        ...(notMine.length ? { excludeIds: notMine } : {}),
        extraWhere: {
          OR: [
            { companyId: { in: companyIds } },
            { companyId: null }, // 平台级公告（无归属公司）对全体供应商可见
            ...(mineIds.length ? [{ id: { in: mineIds } }] : []), // 定向白名单命中豁免公司闸
          ],
        },
      },
    );
    return { ...res, items: res.items.map((a: any) => {
      const base = this.isOfflined(a) ? this.titleOnlyStub(a) : this.stripForPublic(a);
      return { ...base, visibility: (a.metadata as Record<string, any>)?.visibility === 'RESTRICTED' ? 'RESTRICTED' : 'PUBLIC' };
    }) };
  }

  /** 已下线判定：公示期满（有 publicityEnd 才会到期；政策/平台等无公示期永不过期）或存量 ARCHIVED */
  private isOfflined(a: any): boolean {
    return this.offlinedReason(a) !== null;
  }

  /** 已下线归因（2026-10-20）：PUBLICITY_ENDED=公示期满（公告渠道内容展示窗口关闭）；
   *  OFFLINED=存量手动下线（ARCHIVED）。门户据此出差异化提示文案
   *  （「公示期已过，不再显示公示内容」vs「该公告已下线」）。 */
  private offlinedReason(a: any): 'PUBLICITY_ENDED' | 'OFFLINED' | null {
    if (a.status === 'ARCHIVED') return 'OFFLINED';
    if (a.status === 'PUBLISHED' && a.publicityEnd && new Date(a.publicityEnd).getTime() < Date.now()) return 'PUBLICITY_ENDED';
    return null;
  }

  /** 已下线标题壳：保留标题/类型/时间等元信息，正文与摘要置空（内容不可看，v2 拍板）；
   *  附件/招标文件一并剥除（2026-10-20：正文不可看则附件亦不可下载），
   *  带 offlinedReason 供门户详情提示页渲染 */
  private titleOnlyStub(a: any) {
    const { attachments, ...base } = this.stripForPublic(a) as any;
    return { ...base, content: '', summary: null, aiSummary: null, titleOnly: true, offlinedReason: this.offlinedReason(a) ?? 'OFFLINED' };
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

  async getPublic(id: string, user?: { sub?: string; role?: string }) {
    const announcement = await this.get(id);
    // A2（表 B.1）：与列表同口径——应保密/未发布到公开级的公告详情不可按 id 直取。
    // 2026-10-21 前置加固：dataClass/RESTRICTED 闸门先于「已下线标题壳」返回——否则保密级/
    // 定向公告公示期满后，壳（含 metadata.restrictedSupplierIds）对任意直链者裸出（改壳前是 400 拒绝面）。
    if (announcement.dataClass && !(PUBLIC_VISIBLE_CLASSES as readonly string[]).includes(announcement.dataClass)) {
      throw new BadRequestException({ error: '公告不存在或不可公开', code: 'NOT_PUBLIC' });
    }
    // P1 收口（2026-09-28 审计）：RESTRICTED（部分供应商可见）详情校验 visibility——
    // 列表过滤了、任何未登录者拿 id 却不可直读。放行集=被选定供应商本人
    // （登录 token → Supplier.userId 反查 → restrictedSupplierIds 命中）。
    const meta = (announcement.metadata ?? {}) as Record<string, unknown>;
    if (meta.visibility === 'RESTRICTED') {
      let eligible = false;
      if (user?.sub) {
        const supplier = await this.prisma.supplier.findUnique({
          where: { userId: user.sub },
          select: { id: true },
        });
        eligible =
          !!supplier &&
          Array.isArray(meta.restrictedSupplierIds) &&
          (meta.restrictedSupplierIds as string[]).includes(supplier.id);
      }
      if (!eligible) {
        throw new BadRequestException({ error: '公告不存在或不可公开', code: 'NOT_PUBLIC' });
      }
    }
    if (announcement.status !== 'PUBLISHED') {
      // 2026-10-20 用户裁定：ARCHIVED（已下线）不再 400 拒绝——返回标题壳（offlinedReason），
      // 门户点进去渲染「该公告已下线」提示页；未发布（DRAFT 等）仍拒绝
      if (announcement.status === 'ARCHIVED') {
        return this.titleOnlyStub(announcement);
      }
      throw new BadRequestException({ error: '公告未发布', code: 'NOT_PUBLISHED' });
    }
    // 2026-10-20 用户裁定：公示期满的 PUBLISHED 同样返回标题壳（PUBLICITY_ENDED）——
    // 门户点进去渲染「公示期已过，不再显示公示内容」；不计浏览（能走到这里的都已过
    // dataClass/RESTRICTED 闸门，壳无正文/附件可泄）。注意：公示期满仅作用于公告渠道——
    // 供应商「项目机会」详情须持续显示公告原文与采购文件
    // （supplier-portal resolveOwnAnnouncement 只硬过滤 status）。
    if (announcement.publicityEnd && new Date(announcement.publicityEnd).getTime() < Date.now()) {
      return this.titleOnlyStub(announcement);
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
    return { ...rest, content: this.normalizePublicContent(a.content as string | null) };
  }

  /**
   * 公开端正文归一：
   * - 剥离未替换的 {{占位符}}（生成链路漏替换时不再裸露给公众，置灰说明代替）；
   * - 纯文本正文（无任何 HTML 标签、无换行结构）按中文章节序号智能分段为 <p>——
   *   docx→mammoth 提取的公告全文若被上游压成单行，公开详情页不再是"缩成一团"。
   */
  private normalizePublicContent(raw: string | null | undefined): string {
    if (!raw) return raw ?? '';
    let text = raw;
    // 1. 清理未替换占位符：{{最高限价}} / {{报价11}} 等 → 移除，避免破句
    text = text.replace(/\{\{[^}]{1,30}\}\}/g, '');
    text = text.replace(/（¥\s*）（）/g, '');
    // 2. 已含有效 HTML 结构（≥2 个块级标签，或含 br/table 等结构标签）→ 只做占位清理。
    // 单个 <p> 整段包裹视同纯文本（mammoth 单段/历史单 <p> 全文的压缩态）
    const blockTags = text.match(/<(p|div|br|h[1-6]|table|ul|ol)[\s>]/gi) ?? [];
    if (blockTags.length >= 2) return text;
    text = text.replace(/^<p[^>]*>/i, '').replace(/<\/p>$/i, '').trim();
    // 3. 纯文本：先合并 PDF 软换行（句中断 \n——切段会放大成每行一段，门户词中断行，
    //    2026-10-22 实录回归；守卫：句读/列表/标题/落款/收尾行），再按章节序号与长句边界分段
    text = joinSoftWrappedPlainText(text);
    const sections = text
      .replace(/([一二三四五六七八九十]、)/g, '\n$1')
      .replace(/(第[一二三四五六七八九十]+名)/g, '\n$1')
      .replace(/(四川水发[^，。\n]{0,20}(有限公司|采购中心))/g, '\n$1')
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    const esc = (x: string) => x.replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c] as string));
    return sections.map((l) => `<p>${esc(l)}</p>`).join('');
  }

  async update(id: string, dto: UpdateAnnouncementDto) {
    const announcement = await this.prisma.announcement.findUnique({ where: { id } });
    if (!announcement) throw new BadRequestException({ error: '公告不存在', code: 'NOT_FOUND' });

    // 已发布不可静默转回草稿（2026-09-29 二审 P2）：发布瞬间的联动（供应商通知、
    // BidProject 关联、公示期起算）都已生效，回退草稿会让公开内容凭空消失且无留痕。
    // 撤回请走下架（offline，进回收站、有审计）。
    if (announcement.status === 'PUBLISHED' && dto.status === 'DRAFT') {
      throw new BadRequestException({ error: '公告已发布，不能转回草稿；如需撤回请使用下架', code: 'PUBLISHED_NO_DEMOTE' });
    }

    const title = dto.title ?? announcement.title;
    const type = dto.type ?? announcement.type;
    const content = dto.content ?? announcement.content;
    const suppliedAi = this.sanitizeClientAiSummary(dto.aiSummary);
    const shouldRegenerateSummary = suppliedAi === undefined && (
      dto.title !== undefined || dto.content !== undefined || dto.type !== undefined
    );
    const aiSummary = suppliedAi ?? (shouldRegenerateSummary
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

    // 对接专项 Phase 1（T4）：发布赋码强制闸（update 路径——状态转入 PUBLISHED 时）
    if (isPublishTransition) {
      await this.assertGbCodeIfLinked(dto.relatedProjectCode ?? announcement.relatedProjectCode);
    }

    // 正式盖章版引用校验（2026-09-27）：BID_NOTICE 转入发布且引用采购文件 → 必须与 03 指针
    // 一致；置于写库之前（定时发布/草稿转发布同样受闸，取数与 W2 同口径 dto ?? 库中值）
    if (isBidNoticePublish) {
      await this.assertOfficialTenderReference(
        ((dto.metadata ?? announcement.metadata) as Record<string, any>) ?? {},
        dto.relatedProjectCode ?? announcement.relatedProjectCode,
      );
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
        ...(dto.metadata !== undefined && { metadata: normalizeScheduledPublishMetadata(dto.metadata) as any }),
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
        // 竞态早退（2026-10-29 审计 B）：此前 fall-through 会把发布联动再执行一遍——
        // 供应商通知双发、补遗计数（addendumNo）双加。赢家已执行全部联动，输家直接
        // 返回已发布版本，不再触碰任何发布副作用。
        if (!result) throw new BadRequestException({ error: '公告不存在或已删除', code: 'NOT_FOUND' });
        return Object.assign(result, { checklistWarnings: [] });
      } else {
        throw e;
      }
    }

    if (!result) {
      throw new BadRequestException({ error: '公告不存在或已删除', code: 'NOT_FOUND' });
    }

    // A1→C1（GB/T 43711 7.5.2）：预成交公示发布时自动设置公示期（3 个日历日）；
    // WIN_NOTICE 保留同逻辑以兼容存量"中标公示"与手动直发成交公告的路径。
    // 不含 WIN_BID_NOTICE——中标公告公示期由 BidService.getPublicityStatus 读时推导（见 create 同款注释）
    if ((result.type === 'PRE_WIN_NOTICE' || result.type === 'WIN_NOTICE' || result.type === 'BID_NOTICE') && targetStatus === 'PUBLISHED' && !result.publicityEnd) {
      const end = new Date(result.publishDate || new Date());
      end.setDate(end.getDate() + 3);
      await this.prisma.announcement.update({ where: { id: result.id }, data: { publicityEnd: end } });
      result.publicityEnd = end;
    }

    // 中标公告发布即链接/确认中标候选人（2026-10-19，与 create 路径同款）
    if (result.type === 'WIN_BID_NOTICE' && isPublishTransition) {
      await this.linkWinBidCandidates(result.id, result.relatedProjectCode);
    }

    // 联动：BID_NOTICE 首次发布 → 创建 BidProject
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
      // 阳光采购平台推送（2026-10-29 流程侧接线，与 create 即时发布同口径）：发布向导的
      // 「定时发布/按公示期起始」走 DRAFT+scheduledPublishDate → cron → 本 update 路径，
      // 编辑页手动转发布与列表批量发布亦汇于此——此前只挂在 create（:209），定时发布的
      // sunshinePublish 快照无人消费、推送静默丢失。onPublish 内部全捕获，无快照即跳过。
      // （P2025 竞态分支已早退，赢家独推、无双发。）
      void this.sunshinePush?.onPublish({ id: result.id, content: result.content, metadata: result.metadata });
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
        await (this.notifications ? this.notifications.create({
            userId: s.userId,
            type: 'ANNOUNCEMENT_PUBLISHED',
            title: `【与您相关】补遗公告：${ann.title}`, // 参与供应商定向（ADDENDUM 属项目内类，A1 同口径）
            content: `您参与的采购项目发布补遗/澄清公告，请及时查看并按新要求准备响应文件。`,
            link: `/announcements/${ann.id}`,
          }) : this.prisma.notification.create({ data: {
            userId: s.userId,
            type: 'ANNOUNCEMENT_PUBLISHED',
            title: `【与您相关】补遗公告：${ann.title}`, // 参与供应商定向（ADDENDUM 属项目内类，A1 同口径）
            content: `您参与的采购项目发布补遗/澄清公告，请及时查看并按新要求准备响应文件。`,
            link: `/announcements/${ann.id}`,
          } })).catch(() => {});
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

    // 7.5.2.5：公示期内"未发生否决情形"方可成交——未决异议（待答复/投诉处理中）阻断确认
    const pendingObjections = await this.prisma.supplierObjection.count({
      where: {
        status: { in: ['open', 'complaint'] },
        OR: [
          { announcementId: pre.id },
          ...(pre.relatedProjectCode ? [{ projectCode: pre.relatedProjectCode }] : []),
        ],
      },
    });
    if (pendingObjections > 0) {
      throw new BadRequestException({
        error: `该公示存在 ${pendingObjections} 项未决异议（待答复/投诉处理中），须先答复或处理完毕（7.5.2.5/7.5.2.6）`,
        code: 'OBJECTION_PENDING',
      });
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

  /**
   * 发布向导「中标公告」（WIN_BID_NOTICE）发布时链接中标候选人（2026-10-19）：
   * 评标结果（最近一轮，rank 排序）结构化落 metadata.winCandidates——rank1 推荐即
   * 「确认的中标候选人」，候选全量随公告留档（形状对齐 BidService.ensureWinnerNotice），
   * 供 publicity-status / 门户展示与审计追溯。无关联项目或无评标结果 → 静默跳过
   * （登记制/线下评标公告不拦发布），失败仅告警不阻塞。
   */
  private async linkWinBidCandidates(announcementId: string, relatedProjectCode: string | null | undefined) {
    try {
      const code = relatedProjectCode?.trim();
      if (!code) return;
      // 编号空间：公告存 PMI 业务编号（ZJ-xxx）或 BidProject 内部编号（BID-时间戳）——先 PMI 后直查
      const pm = await this.prisma.projectManagementItem.findUnique({
        where: { projectCode: code },
        select: { id: true },
      });
      const project = pm
        ? await this.prisma.bidProject.findFirst({
            where: { projectManagementItemId: pm.id },
            orderBy: { createdAt: 'desc' },
            select: { id: true },
          })
        : await this.prisma.bidProject.findUnique({ where: { projectCode: code }, select: { id: true } });
      if (!project) return;
      const results = await this.prisma.bidEvaluationResult.findMany({
        where: { projectId: project.id },
        orderBy: [{ generatedAt: 'desc' }, { rank: 'asc' }],
        select: { rank: true, supplierName: true, bidPrice: true, totalScore: true, recommended: true, generatedAt: true },
      });
      if (results.length === 0) return;
      // 多轮采购只链接最近一轮（同批 generatedAt）
      const latestGeneratedAt = results[0].generatedAt as Date;
      const latest = results.filter(r => (r.generatedAt as Date).getTime() === latestGeneratedAt.getTime());
      const winner = latest.find(r => r.rank === 1 && r.recommended);

      const ann = await this.prisma.announcement.findUnique({
        where: { id: announcementId },
        select: { metadata: true },
      });
      const meta = { ...((ann?.metadata as Record<string, any>) ?? {}) };
      meta.winCandidates = {
        confirmedAt: new Date().toISOString(),
        winner: winner
          ? { rank: 1, supplierName: winner.supplierName, ...(winner.bidPrice != null ? { bidPrice: Number(winner.bidPrice) } : {}) }
          : null,
        candidates: latest.map(r => ({
          rank: r.rank,
          supplierName: r.supplierName,
          recommended: r.recommended,
          ...(r.bidPrice != null ? { bidPrice: Number(r.bidPrice) } : {}),
        })),
      };
      await this.prisma.announcement.update({ where: { id: announcementId }, data: { metadata: meta as any } });
      this.logger.log(`中标公告 ${announcementId} 已链接中标候选人（项目 ${project.id}，${latest.length} 名候选）`);
    } catch (e) {
      this.logger.warn(`中标公告链接中标候选人失败（不阻塞发布）: ${(e as Error).message}`);
    }
  }

  /* ── 回收站体系（2026-09-26）：隐藏/下架/恢复，UI 不再提供删除 ── */

  /** 隐藏：任意状态 → HIDDEN，进回收站（主列表与公开门户均不可见） */
  async hide(id: string, operator: RecycleOperator = {}) {
    return this.applyRecycle(id, 'HIDDEN', operator);
  }

  /** 下架：任意状态 → OFFLINE 终态，进回收站（v2 拍板：不再限定仅已发布） */
  async offline(id: string, operator: RecycleOperator = {}) {
    return this.applyRecycle(id, 'OFFLINE', operator);
  }

  /** 隐藏/下架共用落地：状态流转 + metadata.recycle 留痕（原状态/动作/时间/操作人）+ 历史动作 */
  private async applyRecycle(id: string, target: 'HIDDEN' | 'OFFLINE', operator: RecycleOperator) {
    const ann = await this.prisma.announcement.findUnique({ where: { id } });
    if (!ann) throw new NotFoundException({ error: '公告不存在', code: 'NOT_FOUND' });
    if (ann.status === 'HIDDEN' || ann.status === 'OFFLINE') {
      throw new ConflictException({ error: '该公告已在回收站中，请先恢复后再操作', code: 'ALREADY_IN_RECYCLE' });
    }
    // v2 拍板（2026-09-26）：下架/隐藏对任意状态可用——下架为终态（不可恢复），隐藏可恢复
    // 合并写入：保留其余 metadata 键（编辑页整存 metadata 时 recycle 随行）
    const meta = { ...((ann.metadata as Record<string, any>) ?? {}) };
    meta.recycle = { from: ann.status, action: target, at: new Date().toISOString(), by: operator.operatorName ?? null };
    const result = await this.prisma.announcement.update({ where: { id }, data: { status: target, metadata: meta as any } });
    await this.prisma.announcementHistory.create({
      data: {
        announcementId: id, action: target === 'HIDDEN' ? 'HIDE' : 'OFFLINE',
        title: result.title, type: result.type, status: result.status, changedFields: ['status'],
        operatorId: operator.operatorId ?? null, operatorName: operator.operatorName ?? null,
        ipAddress: operator.ipAddress ?? null, userAgent: operator.userAgent ?? null,
      },
    }).catch(e => this.logger.warn(`回收站留痕写入失败（不阻塞）: ${(e as Error).message}`));
    this.logger.log(`公告 ${id} 已${target === 'HIDDEN' ? '隐藏' : '下架'}进回收站（原状态 ${ann.status}）`);
    return result;
  }

  /** 恢复：按 metadata.recycle.from 还原状态并清除回收标记（缺失/非法兜底 DRAFT） */
  async restore(id: string, operator: RecycleOperator = {}) {
    const ann = await this.prisma.announcement.findUnique({ where: { id } });
    if (!ann) throw new NotFoundException({ error: '公告不存在', code: 'NOT_FOUND' });
    if (ann.status === 'OFFLINE') {
      throw new ConflictException({ error: '已下架的公告不可恢复（下架为终态），如需重新发布请新建', code: 'OFFLINE_NOT_RESTORABLE' });
    }
    if (ann.status !== 'HIDDEN') {
      throw new ConflictException({ error: '该公告不在回收站中', code: 'NOT_IN_RECYCLE' });
    }
    const meta = (ann.metadata as Record<string, any>) ?? {};
    const from = ['DRAFT', 'PUBLISHED', 'ARCHIVED'].includes(meta.recycle?.from) ? meta.recycle.from : 'DRAFT';
    const { recycle: _dropped, ...rest } = meta;
    // 定时拆弹（2026-10-29 审计 E）：草稿在回收站期间定时时刻已过的，恢复后若保留
    // scheduledPublishDate 会被 scheduler 在 60 秒内突然发布——恢复语义是「拿回草稿」而非
    // 「补发」。过期定时一律剥除；未到期的保留（隐藏只是暂停，恢复后按原时刻照常发布）。
    if (from === 'DRAFT' && rest.scheduledPublishDate) {
      const due = parseScheduledPublishDate(rest.scheduledPublishDate);
      if (due && due <= new Date()) {
        delete rest.scheduledPublishDate;
        this.logger.log(`公告 ${id} 恢复：定时时刻已过，剥除 scheduledPublishDate（不自动补发，需手动重新发布）`);
      }
    }
    const result = await this.prisma.announcement.update({ where: { id }, data: { status: from, metadata: rest as any } });
    await this.prisma.announcementHistory.create({
      data: {
        announcementId: id, action: 'RESTORE', title: result.title, type: result.type, status: result.status,
        changedFields: ['status'],
        operatorId: operator.operatorId ?? null, operatorName: operator.operatorName ?? null,
        ipAddress: operator.ipAddress ?? null, userAgent: operator.userAgent ?? null,
      },
    }).catch(e => this.logger.warn(`回收站恢复留痕写入失败（不阻塞）: ${(e as Error).message}`));
    this.logger.log(`公告 ${id} 已从回收站恢复为 ${from}`);
    return result;
  }

  /** 项目内公告类型：收件人定向为该项目供应商名册（受邀/已投递）——
   *  结果类/项目内公告对名册外的供应商是纯噪音（2026-09-26 降噪，dev 库曾 100 条/70 未读）。
   *  新机会类（BID_NOTICE/PREQUAL_NOTICE）与平台类（POLICY/PLATFORM）仍全量。 */
  private static readonly PROJECT_SCOPED_ANN_TYPES = new Set([
    'ADDENDUM', 'CLARIFY_NOTICE', 'PRE_WIN_NOTICE', 'WIN_NOTICE', 'WIN_BID_NOTICE',
    'CONTRACT_NOTICE', 'PERFORMANCE_NOTICE', 'FAILED_BID_NOTICE',
  ]);

  /** 按公告可见范围向供应商用户发送站内通知（发布时调用）。
   *  优先级：RESTRICTED → restrictedSupplierIds；项目内类型 → 该项目供应商名册；其余 → 全部已启用供应商。 */
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
    } else if (AnnouncementService.PROJECT_SCOPED_ANN_TYPES.has(String(meta.__type))) {
      // 项目内公告 → 定向该项目供应商名册；无项目关联或名册为空则不广播（发也是噪音）
      const ann = await this.prisma.announcement.findUnique({
        where: { id: annId },
        select: { relatedProjectCode: true },
      });
      const code = ann?.relatedProjectCode;
      if (code) {
        const roster = await this.prisma.bidSupplier.findMany({
          where: { project: { projectCode: code } },
          select: { supplier: { select: { userId: true } } },
        });
        userIds = roster.map(r => r.supplier?.userId).filter((u): u is string => !!u);
      } else {
        userIds = [];
        this.logger.warn(`项目内公告「${title}」（${meta.__type}）无项目关联，跳过站内通知`);
      }
    } else {
      const users = await this.prisma.user.findMany({
        where: { role: 'supplier', isActive: true },
        select: { id: true },
      });
      userIds = users.map(u => u.id);
    }

    const typeLabel: Record<string, string> = { ...ANNOUNCEMENT_TYPE_LABELS };
    const label = typeLabel[meta.__type] || '公告';
    // 定向类（名册内）公告带【与您相关】前缀，与全量新机会/平台类公告一眼区分（2026-09-26 A1）
    const relevancePrefix = AnnouncementService.PROJECT_SCOPED_ANN_TYPES.has(String(meta.__type)) ? '【与您相关】' : '';
    let sent = 0;
    for (const userId of userIds) {
      try {
        await (this.notifications ? this.notifications.create({
            userId,
            type: 'ANNOUNCEMENT_PUBLISHED',
            title: `${relevancePrefix}新${label}：${title}`,
            content: `${label}「${title}」已发布，请前往公告中心查看详情。`,
            link: `/announcements/${annId}`,
          }) : this.prisma.notification.create({ data: {
            userId,
            type: 'ANNOUNCEMENT_PUBLISHED',
            title: `${relevancePrefix}新${label}：${title}`,
            content: `${label}「${title}」已发布，请前往公告中心查看详情。`,
            link: `/announcements/${annId}`,
          } })).catch(() => {});
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
    // 直建发布（无关联项目）读 metadata.legalMandatory（向导勾选）；关联项目以项目列为准
    // （列已随直建建项/项目管理录入持久化，metadata 不反向覆盖）
    const legalMandatory = existing ? existing.legalMandatory === true : meta.legalMandatory === true;
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

  /**
   * 正式盖章版引用校验（2026-09-27 用户裁定）：公告引用的采购文件必须与 03「采购文件」
   * 步骤标记的正式盖章版指针一致——服务端权威闸，防绕过 04 向导直发任意文件
   * （04 前端为只读派生，正常路径必一致；不一致即说明绕过了向导）。
   * 仅当 metadata 带 selectedTenderObjectKey 且 relatedProjectCode 能定位 PMI 时校验，
   * 无项目关联的手工公告不受影响。指针查找口径与 04 向导同源：先按 currentRound
   * 匹配 03 行，缺行回退首条（旧数据 round 空值）。
   */
  private async assertOfficialTenderReference(
    meta: Record<string, any>,
    relatedProjectCode?: string | null,
  ) {
    const key: string | undefined = meta.selectedTenderObjectKey;
    if (!key || !relatedProjectCode) return;
    const pmi = await this.prisma.projectManagementItem.findUnique({
      where: { projectCode: relatedProjectCode },
      select: { id: true, currentRound: true },
    });
    if (!pmi) return;
    const round = pmi.currentRound ?? 1;
    const stage =
      (await this.prisma.projectManagementStage.findFirst({
        where: { projectManagementItemId: pmi.id, stageKey: 'TENDER_DOCUMENT', round },
        select: { officialTenderAttachmentId: true },
      })) ??
      (await this.prisma.projectManagementStage.findFirst({
        where: { projectManagementItemId: pmi.id, stageKey: 'TENDER_DOCUMENT' },
        select: { officialTenderAttachmentId: true },
      }));
    const officialObjectKey = stage?.officialTenderAttachmentId
      ? (
          await this.prisma.attachment.findUnique({
            where: { id: stage.officialTenderAttachmentId },
            select: { objectKey: true },
          })
        )?.objectKey
      : null;
    if (officialObjectKey !== key) {
      throw new BadRequestException({
        error:
          '公告引用的采购文件与 03「采购文件」步骤标记的正式盖章版不一致（或未标记）——请从项目管理第四步「公告制作与发布」向导重新发布。',
        code: 'OFFICIAL_TENDER_MISMATCH',
      });
    }
  }

  private async syncBidProject(annId: string, announcement: { id: string; title: string; publishDate: Date | null; metadata?: any; relatedProjectCode?: string | null; authorId?: string | null; companyId?: string | null; companyName?: string | null }) {
    if (!this.bidService) return;
    try {
      const meta = AnnouncementService.validateMetadata(announcement.metadata);
      // relatedProjectCode 的两个编码空间
      // 3005 向导传的是 PMI（ProjectManagementItem）projectCode，而旧逻辑拿它 findUnique
      // BidProject.projectCode —— 永远 miss → 每次发布都走「直建新项」分支，产生孤儿 PMI
      // 且立项↔招标关联断裂。正确次序：
      //   a) 按 PMI 编码找立项项目 → 其名下最新 BidProject（多轮取最新一轮）
      //   b) 回退按 BidProject 编码直接找（公告直建项目后 relatedProjectCode 被回写为
      //      BidProject 编码，二次发布走此路径）
      let existingProject: Awaited<ReturnType<typeof this.prisma.bidProject.findFirst>> = null;
      let linkedPmi: { id: string; projectCode: string | null } | null = null;
      if (announcement.relatedProjectCode) {
        const pmi = await this.prisma.projectManagementItem.findUnique({
          where: { projectCode: announcement.relatedProjectCode },
          select: { id: true, projectCode: true },
        });
        if (pmi) {
          linkedPmi = pmi;
          existingProject = await this.prisma.bidProject.findFirst({
            where: { projectManagementItemId: pmi.id },
            orderBy: { createdAt: 'desc' },
          });
        }
        if (!existingProject) {
          existingProject = await this.prisma.bidProject.findUnique({
            where: { projectCode: announcement.relatedProjectCode },
          });
          if (existingProject?.projectManagementItemId && !linkedPmi) {
            linkedPmi = await this.prisma.projectManagementItem.findUnique({
              where: { id: existingProject.projectManagementItemId },
              select: { id: true, projectCode: true },
            });
          }
        }
      }

      // A-87：发布联动命中的项目 id——两分支（关联既有/直建新项）收敛后触发要点提取前移
      let linkedProjectId: string | null = null;

      if (existingProject) {
        linkedProjectId = existingProject.id;
        // 旧数据 BidProject 可能缺 PMI 关联（发布匹配失败的历史遗留）——命中 PMI 时回填
        if (linkedPmi && !existingProject.projectManagementItemId) {
          await this.prisma.bidProject.update({
            where: { id: existingProject.id },
            data: { projectManagementItemId: linkedPmi.id },
          });
          existingProject.projectManagementItemId = linkedPmi.id;
          this.logger.log(`回填 BidProject ${existingProject.projectCode} ↔ PMI ${linkedPmi.projectCode} 关联`);
        }
        await this.bidService.syncFromAnnouncement(existingProject.id, { title: announcement.title }, meta);
        this.logger.log(`公告已关联项目 ${existingProject.projectCode}，同步更新字段`);
        // 流标公告：发布后联动 BidProject 流标——终态（ABORTED/ARCHIVED）跳过不报错
        //（2026-10-23 统一流：开标归档流标后 :3005 补发流标公告，联动撞 ARCHIVED→ABORTED
        //  单向棘轮终态守卫 409；ABORTED 幂等但显式跳过更清晰）
        if (meta.category === 'failed_bid') {
          const fresh = await this.prisma.bidProject.findUnique({
            where: { id: existingProject.id },
            select: { stage: true },
          });
          if (fresh && (fresh.stage === 'ABORTED' || fresh.stage === 'ARCHIVED')) {
            this.logger.log(`流标公告已发布，项目 ${existingProject.projectCode} 已处终态（${fresh.stage}），跳过联动流标`);
          } else {
            await this.bidService.abortBidProject(existingProject.id);
            this.logger.log(`流标公告已发布，项目 ${existingProject.projectCode} 已标记为 ABORTED`);
          }
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
          // 2026-10-19 编号统一：直建项目继承宿主 PMI 业务编号（relatedProjectCode 同码）
          linkedPmi,
        );
        linkedProjectId = project.id;
        await this.prisma.announcement.update({ where: { id: annId }, data: { relatedProjectCode: project.projectCode } });
        const bidDoc = await this.prisma.bidDocument.findUnique({ where: { announcementId: annId } });
        if (bidDoc) {
          await this.prisma.bidDocument.update({ where: { announcementId: annId }, data: { bidProjectId: project.id } });
        }
        // N16 方案 A：公告直建项目补最小 PMI 并回填关联（新建部分原子）——
        // 3005 开标确认面板（评分标准/主持人/按时开标/归档/公示）以 PMI 为宿主，此前此类项目无宿主
        // relatedProjectCode 已命中既有 PMI 时（立项后首次发公告），新建的
        // BidProject 直接关联该 PMI —— 不再另建孤儿 PMI。
        if (linkedPmi) {
          await this.prisma.bidProject.update({
            where: { id: project.id },
            data: {
              projectManagementItemId: linkedPmi.id,
              riskNote: `${project.riskNote || ''}；PMI ${linkedPmi.projectCode}`,
            },
          });
          this.logger.log(`公告发布关联既有立项 ${linkedPmi.projectCode} → BidProject ${project.projectCode}（未另建 PMI）`);
        } else if (this.projectManagementService) {
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

      // A-87：BID_NOTICE 发布即前移招标要点提取——此前提取只在启动评标时发生，供应商在
      // 整个 BID 阶段看不到结构化要点。fire-and-forget：失败仅告警不阻塞发布；ensureTenderAnalysis
      // 自带幂等闸（requirements 已提取且无待派发 bidder 跳过入队），重复发布/下架再发布不重复入队。
      // 流标公告（failed_bid）随即置 ABORTED，无提取意义，跳过。E2 白名单化后 meta.category 已可达，
      // 此处仍读原始 metadata——过渡双读：白名单化前的存量数据兜底，下清理批移除。
      const rawCategory = (announcement.metadata as Record<string, any> | null | undefined)?.category;
      if (linkedProjectId && rawCategory !== 'failed_bid' && typeof this.bidService?.ensureTenderAnalysis === 'function') {
        void Promise.resolve(this.bidService.ensureTenderAnalysis(linkedProjectId)).catch(e =>
          this.logger.warn(`招标要点提取入队失败 (project=${linkedProjectId}): ${(e as Error).message}`),
        );
      }

      // 拟定供应商入参与名单：直接采购公告发布后，公告「拟定供应商名称」
      // （metadata.supplierName，向导发布时随草稿快照写入）自动纳入 BidSupplier——
      // 项目基本信息「供应商参与」区块（getParticipants ∪ bidSuppliers）即可见；
      // 供应商在库时按名关联 id。
      // 2026-10-16 口径修订：不再同时回填 PMI.awardedSupplier——「中标单位」展示字段
      // 在发布公告时点即有值属过早（业务上应开标评标后才获取）；合法写入时点 =
      // 评标结果回写（bidService）/ 定标审批表 / 中标通知书 / 合同附件解析。
      const proposedSupplier = String((announcement.metadata as Record<string, any> | null | undefined)?.supplierName ?? '').trim();
      if (linkedProjectId && proposedSupplier && rawCategory !== 'failed_bid') {
        try {
          const supplier = await this.prisma.supplier.findFirst({
            where: { OR: [{ name: proposedSupplier }, { normalizedName: proposedSupplier.toLowerCase() }] },
            select: { id: true },
          });
          await this.prisma.bidSupplier.upsert({
            where: { projectId_supplierName: { projectId: linkedProjectId, supplierName: proposedSupplier } },
            create: {
              projectId: linkedProjectId,
              supplierName: proposedSupplier,
              ...(supplier ? { supplierId: supplier.id } : {}),
            },
            update: supplier ? { supplierId: supplier.id } : {},
          });
          this.logger.log(`拟定供应商已纳入参与名单: ${proposedSupplier} → 项目 ${linkedProjectId}`);
        } catch (e) {
          this.logger.warn(`拟定供应商入参与名单失败: ${(e as Error).message}`);
        }
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

    // 闸门：关联项目已进入投标/开标/评标流程（SUBMIT/OPENING/EVALUATING）时禁删公告。
    // 置于事务前拦截——零副作用：不下发任何级联删除/复位/MinIO 清理，引导先完成流标或归档。
    if (project) {
      const blocked = ['SUBMIT', 'OPENING', 'EVALUATING'].includes(project.stage);
      if (blocked) {
        throw new ConflictException({ error: '该项目已进入投标/开标/评标流程，公告不可删除——请先完成流标或归档后再删除公告', code: 'BID_IN_PROGRESS' });
      }
    }

    try {
      await this.prisma.$transaction(async (tx) => {
        // DOWNLOAD/ABORTED/ARCHIVED 三态仅解关联——追加风险备注、解除标书关联，
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

  async getStats(companyFilter: CompanyWhere = {}) {
    // 公司隔离：统计聚合在隔离后的数据集上计算
    const where = { ...companyFilter };
    // 本月起点（服务端口径——此前前端用"当前页 15 条"冒充全量统计，2026-09-28 审计 P1）。
    // 北京时间（UTC+8）月初：服务器跑 UTC 时 `new Date(y, m, 1)` 会漏计月初 8 小时（二审 P2）
    const nowBeijing = new Date(Date.now() + 8 * 3600_000);
    const monthStart = new Date(
      Date.UTC(nowBeijing.getUTCFullYear(), nowBeijing.getUTCMonth(), 1) - 8 * 3600_000,
    );
    // 已发布 KPI 口径（2026-10-28 收口）：副标签「已生效可见」+ 展示层 displayStatus v2
    // （2026-09-26）——公示期满（publicityEnd 已过）的 PUBLISHED 行展示为「已下线」，不入
    // 「已发布」计数（原全量 PUBLISHED 使 KPI 与同屏徽标矛盾）；无公示期字段的类型
    // （政策/平台等）永不下线，保持计入。公示期满单列 publicityEnded。
    const now = new Date();
    const [total, published, publicityEnded, bidNotice, winNotice, policy, drafts, publishedThisMonth, viewsAgg] = await Promise.all([
      this.prisma.announcement.count({ where }),
      this.prisma.announcement.count({
        where: { ...where, status: 'PUBLISHED', OR: [{ publicityEnd: null }, { publicityEnd: { gt: now } }] },
      }),
      this.prisma.announcement.count({ where: { ...where, status: 'PUBLISHED', publicityEnd: { lte: now } } }),
      this.prisma.announcement.count({ where: { ...where, type: 'BID_NOTICE', status: 'PUBLISHED' } }),
      this.prisma.announcement.count({ where: { ...where, type: 'WIN_NOTICE', status: 'PUBLISHED' } }),
      this.prisma.announcement.count({ where: { ...where, type: 'POLICY', status: 'PUBLISHED' } }),
      this.prisma.announcement.count({ where: { ...where, status: 'DRAFT' } }),
      this.prisma.announcement.count({ where: { ...where, status: 'PUBLISHED', publishDate: { gte: monthStart } } }),
      this.prisma.announcement.aggregate({ where: { ...where, status: 'PUBLISHED' }, _sum: { viewCount: true } }),
    ]);
    return {
      total, published, publicityEnded, bidNotice, winNotice, policy,
      drafts, publishedThisMonth,
      totalViews: viewsAgg._sum.viewCount ?? 0,
    };
  }

  /** 运行时校验公告 metadata 字段类型，防止 typo 导致静默数据丢失 */
  private static METADATA_SCHEMA: Record<string, { type: string; values?: readonly string[] }> = {
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
    // E2：公告分类枚举——前端 AnnouncementCategory 三值（web/lib/types/announcement.ts）+ publicity（中标公示预留）。
    // 白名单化后 :650 流标分支经 meta.category 可达（此前恒 undefined 死分支）；非枚举值由 validateMetadata 剥落
    category: { type: 'string', values: ['procurement_document', 'failed_bid', 'winning_bid', 'publicity'] },
    // （2026-09-09 补录入口）：依法必招标式——BID_NOTICE 直建发布时 W2 guard 的强制校验入口
    // （发布向导勾选）；随 createFromAnnouncement 持久化到 BidProject.legalMandatory（后续以项目列为准）
    legalMandatory: { type: 'boolean' },
  };

  private static validateMetadata(raw: any): Record<string, any> {
    if (typeof raw !== 'object' || raw === null) return {};
    const validated: Record<string, any> = {};
    for (const [key, spec] of Object.entries(AnnouncementService.METADATA_SCHEMA)) {
      if (raw[key] !== undefined) {
        // E2：枚举键（values 白名单）非枚举值剥落——防 typo/伪造分类触发流标等联动
        if (spec.values && !spec.values.includes(raw[key])) continue;
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

    // 1. 解析关联项目（三级回退）
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
          // 项目解析走 PMI 外键（2026-09-29）：此前按标题全局匹配 BidProject，同名项目会把
          // 别家名册串进本公告参与列表——实测 SWHI-JJ-2026092902（竞价）详情「供应商参与」
          // 显示的竟是 TP-2026092901（谈判）的受邀供应商。外键未关联的存量老项目再按标题兜底。
          bp = await this.prisma.bidProject.findFirst({
            where: { projectManagementItemId: pmi.id },
            select: { id: true, name: true, projectCode: true, stage: true, deadline: true },
            orderBy: [{ round: 'desc' }, { createdAt: 'desc' }],
          });
          if (!bp) {
            bp = await this.prisma.bidProject.findFirst({
              where: { name: pmi.title },
              select: { id: true, name: true, projectCode: true, stage: true, deadline: true },
              orderBy: { createdAt: 'desc' },
            });
          }
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

    // 2. 查询：招标文件 + 下载记录 + 项目供应商 + 投标提交
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

    // 3. 合并去重：下载者 ∪ 项目供应商
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

    // 4. 返回
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

  /** 按项目编号查参与供应商（项目基本信息「供应商参与」数据源）：
   *  取该项目最新一条采购/资格预审公告的投标情况（下载者 ∪ 项目供应商，去重）。 */
  async getProjectParticipants(projectCode: string) {
    const ann = await this.prisma.announcement.findFirst({
      where: { relatedProjectCode: projectCode, type: { in: ['BID_NOTICE', 'PREQUAL_NOTICE'] } },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });
    if (!ann) {
      return { announcementId: null, suppliers: [], stats: { total: 0, submitted: 0 } };
    }
    const result = await this.getParticipants(ann.id);
    return {
      announcementId: ann.id,
      suppliers: result.suppliers,
      stats: result.stats,
    };
  }

  /** 发布前查重（发布配置点「发布」时）：同标题 或 同项目编号+同类型 的已发布/已归档公告。
   *  命中不阻断——由前端弹窗提示，经办确认后可仍要发布（流标重发等合法场景）。 */
  async checkDuplicate(
    dto: { title?: string; relatedProjectCode?: string; type?: string },
    companyFilter: CompanyWhere = {},
  ) {
    const or: any[] = [];
    if (dto.title?.trim()) or.push({ title: dto.title.trim() });
    if (dto.relatedProjectCode?.trim() && dto.type) {
      or.push({ relatedProjectCode: dto.relatedProjectCode.trim(), type: dto.type });
    }
    if (or.length === 0) return { matches: [] };
    const matches = await this.prisma.announcement.findMany({
      where: { ...companyFilter, status: { in: ['PUBLISHED', 'ARCHIVED'] }, OR: or },
      select: {
        id: true, title: true, type: true, status: true,
        publishDate: true, relatedProjectCode: true,
      },
      orderBy: [{ publishDate: 'desc' }, { createdAt: 'desc' }],
      take: 5,
    });
    return { matches };
  }
}
