import { Injectable, NotFoundException } from '@nestjs/common';
import { BID_DEADLINE_BEFORE_OPENING_MS, formatDurationCn } from '@water-erp/shared';
import { PrismaService } from '../prisma/prisma.service';
import { parseFlexibleDate } from '../common/parse-date.util';

/**
 * B3 项目时间信息轴（CTS-EBS01 A-204：项目相关时间信息的建立和维护）。
 * 聚合 PMI / BidProject / BidSignPacket / Contract / Announcement 五域十类时间节点：
 * 采购立项 · 采购文件获取 · 采购公告发布 · 投标截止 · 开标 · 评标结束 · 中标公告发布 ·
 * 流标公告发布 · 合同签订 · 归档。
 * 输出：固定业务顺序——此前有值节点按时间升序，
 * 时间压缩/回填场景下「归档」会插进中间（实测 6/23 归档排在 9/7 文件获取
 * 之前），阅读割裂；缺值节点原地灰显占位（前端「未登记」）。
 * 兜底：采购立项 initiationDate 缺 → PMI.createdAt（建档即立项下限）；
 * 合同签订 Contract.signedAt 缺 → CONTRACT 阶段 completedAt（阶段完成≈签订完成）。
 * 公告发布：取项目关联公告的最后一次发布时刻——采购公告=BID_NOTICE/PREQUAL_NOTICE，
 * 中标公告=WIN_BID_NOTICE/PRE_WIN_NOTICE/WIN_NOTICE，流标公告=FAILED_BID_NOTICE；
 * 关联口径与 syncBidProject 一致（relatedProjectCode 兼容 PMI 编码与 BidProject 编码两个编码空间）。
 * 评标结束（2026-10-13 用户裁定）= :3007 生成评标回流包（发回 :3005）的时刻：
 * BidSignPacket.handoverFileAssetId 置位即回流包已生成，时刻取该 FileAsset.createdAt
 * （packet 表无回流时间戳列；多轮采购取 generatedAt 最新且已回流的包）。
 */

export interface TimelineNode {
  key: string;
  label: string;
  time: string | null; // ISO；null=尚未发生/未登记
  timeEnd?: string | null; // ISO；区间类节点（采购文件获取）的结束时刻
  source: string; // 来源模块（展示用）
}

/**
 * String 字段时间（bidOpeningTime/documentAcquireTime）规范化：可解析则转 ISO，否则 null。
 * 用 parseFlexibleDate：AI 提取的值多为中文格式（"2026年3月23日14:00"），且
 * documentAcquireTime 常是区间文本（"2026年03月23日09:00至2026年03月26日15:00"）——
 * 取区间起点；new Date() 直解析不了这类文本（曾致时间轴「采购文件获取 未登记」）。
 */
function normalizeMaybeDate(raw: string | null | undefined): string | null {
  const d = parseFlexibleDate(raw);
  return d ? d.toISOString() : null;
}

/**
 * 区间文本（"2026年03月23日09:00至2026年03月26日15:00"）→ 起止时刻。
 * 逐段匹配所有"年月日(时分)"片段：首段=起点、末段=终点（同段/单点文本 → 终点 null）。
 * 终点片段缺少年份（如"至03月26日15:00"）时无法独立成 Date，退化为单点。
 * 冒号必须出现（(\d{1,2}):(\d{2})）：可选冒号时纯日期区间"10月10日-2026年10月14日"
 * 会被 \D+ 跨段吞位，把次段年份 2026 的"20""26"误当 20:26 时分（2026-10-12 实录）。
 */
function parseDateRange(raw: string | null | undefined): { start: string | null; end: string | null } {
  if (!raw) return { start: null, end: null };
  const re = /(\d{4})\D+(\d{1,2})\D+(\d{1,2})(?:\D+(\d{1,2}):(\d{2}))?/g;
  const parts: Date[] = [];
  for (const m of raw.matchAll(re)) {
    // 中文口语日期的语义即北京时间：显式 +8 构造（Date.UTC 减 8h），与服务器/CI 时区解耦
    // （组件构造 new Date(y,m,d) 依赖宿主时区——UTC runner 上本地零点变 00:00Z，时间轴日期漂移）
    const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4] ?? 0), Number(m[5] ?? 0)) - 8 * 3_600_000);
    if (!Number.isNaN(d.getTime())) parts.push(d);
  }
  if (parts.length === 0) return { start: null, end: null };
  return { start: parts[0].toISOString(), end: parts.length > 1 ? parts[parts.length - 1].toISOString() : null };
}

/**
 * Prisma DateTime（timestamp without time zone）→ ISO：恒等输出。
 * 驱动按 UTC epoch 读写（写入时把 Date 序列化为 UTC 裸值，读出还原同一时刻），
 * toISOString() 即正确。此前按「DB 裸值=本地时刻」假设做 −8h 补偿，与写侧的
 * 本地构造口径（如 new Date('YYYY-MM-DDT00:00:00')）双重折算——立项 2026-10-08
 * 显示成 10-07 16:00（2026-10-09 实录），且波及开标/截止/签约/归档等全部真实时刻
 * 节点。旧口径存量数据已随本次修复迁移归一（00:00 裸值行 −8h）。
 */
function toIso(d: Date | null | undefined): string | null {
  if (!d) return null;
  return d.toISOString();
}

@Injectable()
export class TimelineService {
  constructor(private readonly prisma: PrismaService) {}

  async getTimeline(pmiId: string): Promise<TimelineNode[]> {
    const item = await this.prisma.projectManagementItem.findUnique({
      where: { id: pmiId },
      select: { id: true, projectCode: true, createdAt: true, initiationDate: true, documentAcquireTime: true, bidOpeningTime: true, archivedAt: true },
    });
    if (!item) throw new NotFoundException('未找到对应项目');

    // BidProject 取最新轮次（多轮采购以末轮开标/截标为准）
    const bp = await this.prisma.bidProject.findFirst({
      where: { projectManagementItemId: pmiId },
      select: { deadline: true, openTime: true },
      orderBy: { round: 'desc' },
    });
    const contract = await this.prisma.contract.findFirst({
      where: { projectManagementItemId: pmiId },
      select: { signedAt: true },
      orderBy: { createdAt: 'desc' },
    });

    // 评标结束 = :3007 回流包生成时刻（handoverFileAssetId → FileAsset.createdAt）
    const handoverPacket = await this.prisma.bidSignPacket.findFirst({
      where: { project: { projectManagementItemId: pmiId }, handoverFileAssetId: { not: null } },
      orderBy: { generatedAt: 'desc' },
      select: { handoverFileAssetId: true },
    });
    let evaluationEndIso: string | null = null;
    if (handoverPacket?.handoverFileAssetId) {
      const handoverAsset = await this.prisma.fileAsset.findUnique({
        where: { id: handoverPacket.handoverFileAssetId },
        select: { createdAt: true },
      });
      evaluationEndIso = toIso(handoverAsset?.createdAt ?? null);
    }

    // 公告发布时间：采购公告/中标公告的发布时刻记录进时间轴。
    // 关联口径与 announcement.syncBidProject 一致——relatedProjectCode 既可能是
    // PMI 编码，也可能是 BidProject 编码（公告直建项目后回写），两侧都查；
    // PMI 编码还需兼容旧两段式（2026-09-16 编码迁移为三段式，存量公告 relatedProjectCode
    // 仍存旧码，如 SWHI-YQ-2026090703 的旧码 YQ-2026090703——实测 miss 即此因）。
    const bpCodes = await this.prisma.bidProject.findMany({
      where: { projectManagementItemId: pmiId },
      select: { projectCode: true },
    });
    const legacyPmiCode = item.projectCode?.includes('-')
      ? item.projectCode.split('-').slice(1).join('-')
      : null;
    const relatedCodes = [item.projectCode, legacyPmiCode, ...bpCodes.map((b) => b.projectCode)]
      .filter((c): c is string => !!c);
    const published = relatedCodes.length
      ? await this.prisma.announcement.findMany({
          where: { status: 'PUBLISHED', relatedProjectCode: { in: relatedCodes } },
          select: { type: true, publishDate: true, createdAt: true },
        })
      : [];
    // 发布时刻取「最后一次」（2026-10-13 用户裁定）：多次发布/重发时，末次才是当前
    // 生效公告的时点（此前取最早，重发后时间轴仍停在首发布）。采购/中标公告同口径。
    const publishTimeOf = (types: string[]): string | null => {
      const hits = published.filter((a) => types.includes(a.type));
      if (hits.length === 0) return null;
      const latest = hits.reduce((max, a) => {
        const t = a.publishDate ?? a.createdAt;
        return t > max ? t : max;
      }, hits[0].publishDate ?? hits[0].createdAt);
      return toIso(latest);
    };
    const bidNoticeIso = publishTimeOf(['BID_NOTICE', 'PREQUAL_NOTICE']);
    const winNoticeIso = publishTimeOf(['WIN_BID_NOTICE', 'PRE_WIN_NOTICE', 'WIN_NOTICE']);
    const failedNoticeIso = publishTimeOf(['FAILED_BID_NOTICE']);

    // 无「采购公告公示」步骤的流程（谈判采购/直接采购，阶段模板不含 PUBLIC_ANNOUNCEMENT）：
    // 第三节点语义切换为「供应商邀请」——时间取首次「一键通知」点击时刻（notifiedAt 打戳，
    // 见 RsvpService.markNotified；rsvp.projectId 兼容 PMI/BidProject 两个 id 空间）
    const hasPublicAnnouncementStage = await this.prisma.projectManagementStage.findFirst({
      where: { projectManagementItemId: pmiId, stageKey: 'PUBLIC_ANNOUNCEMENT' },
      select: { id: true },
    });
    let supplierInviteIso: string | null = null;
    if (!hasPublicAnnouncementStage) {
      const bpIds = await this.prisma.bidProject.findMany({
        where: { projectManagementItemId: pmiId },
        select: { id: true },
      });
      // 时间口径（2026-10-20 用户裁定）：「供应商邀请」= 首次点击「一键通知」的时刻
      // （notifiedAt 打戳，多轮补选取最早=首轮）；存量行未打戳回退 token 签发时刻 createdAt
      const rsvpScope = { projectId: { in: [pmiId, ...bpIds.map((b) => b.id)] } };
      const firstNotified = await this.prisma.invitationRsvp.findFirst({
        where: { ...rsvpScope, notifiedAt: { not: null } },
        orderBy: { notifiedAt: 'asc' },
        select: { notifiedAt: true },
      });
      supplierInviteIso = toIso(firstNotified?.notifiedAt);
      if (!supplierInviteIso) {
        const firstRsvp = await this.prisma.invitationRsvp.findFirst({
          where: rsvpScope,
          orderBy: { createdAt: 'asc' },
          select: { createdAt: true },
        });
        supplierInviteIso = toIso(firstRsvp?.createdAt);
      }
    }
    // 合同签订兜底：未走合同模块登记（signedAt 空）时取 CONTRACT 阶段完成时刻
    let contractSignIso = toIso(contract?.signedAt);
    let contractSignSource = '合同';
    if (!contractSignIso) {
      const contractStage = await this.prisma.projectManagementStage.findFirst({
        where: { projectManagementItemId: pmiId, stageKey: 'CONTRACT', completedAt: { not: null } },
        select: { completedAt: true },
        orderBy: { completedAt: 'desc' },
      });
      if (contractStage) {
        contractSignIso = toIso(contractStage.completedAt);
        contractSignSource = '合同阶段完成';
      }
    }

    // 采购文件获取是时段（AI 提取的起止区间；上传同步的单点值 → 无终点）
    const acquireRange = parseDateRange(item.documentAcquireTime);

    // 投标截止 = 开标前间隔时长（口径常量 BID_DEADLINE_BEFORE_OPENING_MS）：
    // BP.deadline 未登记时按开标时间自动推算展示，不再显示「未登记」
    const openingIso = toIso(bp?.openTime) ?? normalizeMaybeDate(item.bidOpeningTime);
    const deadlineRaw = toIso(bp?.deadline);
    const deadlineIso = deadlineRaw ?? (openingIso
      ? new Date(new Date(openingIso).getTime() - BID_DEADLINE_BEFORE_OPENING_MS).toISOString()
      : null);
    const deadlineSource = deadlineRaw ? '招标项目' : openingIso ? `按开标时间推算（前${formatDurationCn(BID_DEADLINE_BEFORE_OPENING_MS)}）` : '招标项目';

    const nodes: TimelineNode[] = [
      // initiationDate 未登记（直建/AI 提取缺失）→ 建档时刻兜底，避免「采购立项 未登记」
      { key: 'initiation', label: '采购立项', time: toIso(item.initiationDate) ?? toIso(item.createdAt), source: item.initiationDate ? '项目管理' : '项目建档' },
      // 公告发布/供应商邀请前置于文件获取（业务时序：先发布公告再获取文件）
      hasPublicAnnouncementStage
        ? { key: 'bidNoticePublish', label: '采购公告发布', time: bidNoticeIso, source: '公告' }
        : { key: 'supplierInvitation', label: '供应商邀请', time: supplierInviteIso, source: '邀请通知' },
      { key: 'documentAcquire', label: '采购文件获取', time: acquireRange.start, timeEnd: acquireRange.end, source: '项目管理' },
      { key: 'bidDeadline', label: '投标截止', time: deadlineIso, source: deadlineSource },
      { key: 'bidOpening', label: '开标', time: openingIso, source: '招标项目' },
      // 评标结束：取 :3007 评标回流包生成（发回）时刻；未回流（评标中/未启动）→ 未登记
      { key: 'evaluationEnd', label: '评标结束', time: evaluationEndIso, source: '评标回流包' },
      { key: 'winNoticePublish', label: '中标公告发布', time: winNoticeIso, source: '公告' },
      // 流标公告发布：与中标公告互斥的结果公告分支（发布后 BidProject 置 ABORTED）
      { key: 'failedNoticePublish', label: '流标公告发布', time: failedNoticeIso, source: '公告' },
      { key: 'contractSign', label: '合同签订', time: contractSignIso, source: contractSignSource },
      { key: 'archived', label: '归档', time: toIso(item.archivedAt), source: '归档' },
    ];

    // 固定业务顺序：立项→获取→截止→开标→签约→归档，与流程阅读习惯一致；
    // 缺值节点原位保留（前端灰显「未登记」），不再按时间重排
    return nodes;
  }
}
