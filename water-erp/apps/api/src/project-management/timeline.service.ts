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

export interface TimelineRound {
  round: number;
  nodes: TimelineNode[];
}

@Injectable()
export class TimelineService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 按轮次输出（2026-11-03 用户裁定：流标后再次采购不得清掉第一轮时间轴——
   * 每轮一条完整十节点轴，公告/截止/开标/评标结束按轮归属解析；项目级节点归位：
   * 采购立项=首轮、合同签订/归档=末轮、采购文件获取（PMI 单值反映当前轮）=末轮）。
   */
  async getTimeline(pmiId: string): Promise<{ rounds: TimelineRound[]; currentRound: number }> {
    const item = await this.prisma.projectManagementItem.findUnique({
      where: { id: pmiId },
      select: { id: true, projectCode: true, createdAt: true, initiationDate: true, documentAcquireTime: true, bidOpeningTime: true, archivedAt: true, currentRound: true },
    });
    if (!item) throw new NotFoundException('未找到对应项目');

    const allBps = await this.prisma.bidProject.findMany({
      where: { projectManagementItemId: pmiId },
      select: { id: true, round: true, projectCode: true, deadline: true, openTime: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });
    const bpRound = (r: number) => allBps.filter((b) => (b.round ?? 1) === r);
    const roundList = [...new Set(allBps.map((b) => b.round ?? 1))].sort((a, b) => a - b);
    if (roundList.length === 0) roundList.push(1);
    const maxRound = roundList[roundList.length - 1];
    const currentRound = item.currentRound ?? maxRound;
    // 稳健性（2026-11-03）：reproc 已推进 PMI 指针但新轮 BidProject 尚未创建的窗口期——
    // currentRound 不在 BP 轮次集内时仍列出该轮（空轴），避免"第二轮凭空消失"被误读为未开轮
    if (currentRound > maxRound) roundList.push(currentRound);

    // 公告按轮归属：轮内 BidProject 编码 → 本轮；PMI 编码（含旧两段式）→ 首轮（公告直建发生在首轮，
    // 与 syncBidProject 关联口径一致；末次发布生效的既有裁定在轮内保持）
    const legacyPmiCode = item.projectCode?.includes('-')
      ? item.projectCode.split('-').slice(1).join('-')
      : null;
    const roundCodes = (r: number) => [
      ...(r === 1 ? [item.projectCode, legacyPmiCode] : []),
      ...bpRound(r).map((b) => b.projectCode),
    ].filter((c): c is string => !!c);
    const allCodes = [...new Set(roundList.flatMap(roundCodes))];
    const published = allCodes.length
      ? await this.prisma.announcement.findMany({
          where: { status: 'PUBLISHED', relatedProjectCode: { in: allCodes } },
          select: { type: true, publishDate: true, createdAt: true, relatedProjectCode: true },
        })
      : [];
    const publishTimeOf = (r: number, types: string[]): string | null => {
      const codes = new Set(roundCodes(r));
      const hits = published.filter((a) => types.includes(a.type) && a.relatedProjectCode != null && codes.has(a.relatedProjectCode));
      if (hits.length === 0) return null;
      const latest = hits.reduce((max, a) => {
        const t = a.publishDate ?? a.createdAt;
        return t > max ? t : max;
      }, hits[0].publishDate ?? hits[0].createdAt);
      return toIso(latest);
    };

    // 评标结束按轮：各轮回流包（handover 置位）generatedAt 最新者的 FileAsset.createdAt
    const packets = await this.prisma.bidSignPacket.findMany({
      where: { project: { projectManagementItemId: pmiId }, handoverFileAssetId: { not: null } },
      select: { handoverFileAssetId: true, generatedAt: true, project: { select: { round: true } } },
      orderBy: { generatedAt: 'desc' },
    });
    // 稳健性（2026-11-03）：同轮按 generatedAt 降序逐包回退——最新包的 FileAsset 被清理时
    // 用同轮更早的已回流包，而非直接判未登记
    const packetsByRound = new Map<number, typeof packets>();
    for (const pk of packets) {
      const r = pk.project.round ?? 1;
      if (!packetsByRound.has(r)) packetsByRound.set(r, []);
      packetsByRound.get(r)!.push(pk);
    }
    const assetIds = [...new Set(packets.map((pk) => pk.handoverFileAssetId as string))];
    const assetMap = assetIds.length
      ? new Map((await this.prisma.fileAsset.findMany({
          where: { id: { in: assetIds } },
          select: { id: true, createdAt: true },
        })).map((a) => [a.id, a]))
      : new Map<string, { id: string; createdAt: Date }>();
    const evalEndByRound = new Map<number, string>();
    for (const [r, list] of packetsByRound) {
      const hit = list.map((pk) => assetMap.get(pk.handoverFileAssetId as string)?.createdAt)
        .find((t) => !!t);
      evalEndByRound.set(r, toIso(hit ?? null) ?? '');
    }

    // 供应商邀请（无公示流程）按轮：PMI-id 行归首轮、BidProject-id 行归其轮；首次一键通知时刻
    const hasPublicAnnouncementStage = await this.prisma.projectManagementStage.findFirst({
      where: { projectManagementItemId: pmiId, stageKey: 'PUBLIC_ANNOUNCEMENT' },
      select: { id: true },
    });
    let rsvpRows: Array<{ projectId: string | null; notifiedAt: Date | null; createdAt: Date }> = [];
    if (!hasPublicAnnouncementStage) {
      rsvpRows = await this.prisma.invitationRsvp.findMany({
        where: { projectId: { in: [pmiId, ...allBps.map((b) => b.id)] } },
        select: { projectId: true, notifiedAt: true, createdAt: true },
        orderBy: { createdAt: 'asc' },
      });
    }
    const bpIdRound = new Map(allBps.map((b) => [b.id, b.round ?? 1]));
    const supplierInviteOf = (r: number): string | null => {
      const rows = rsvpRows.filter((x) => (x.projectId === pmiId ? 1 : (x.projectId ? (bpIdRound.get(x.projectId) ?? 1) : 1)) === r);
      if (rows.length === 0) return null;
      const notified = rows.filter((x) => x.notifiedAt).sort((a, b) => (a.notifiedAt as Date).getTime() - (b.notifiedAt as Date).getTime());
      if (notified.length) return toIso(notified[0].notifiedAt);
      return toIso(rows[0].createdAt);
    };

    // 合同签订：合同登记优先，缺则 CONTRACT 阶段完成兜底（均为项目级 → 末轮）
    const contract = await this.prisma.contract.findFirst({
      where: { projectManagementItemId: pmiId },
      select: { signedAt: true },
      orderBy: { createdAt: 'desc' },
    });
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

    const acquireRange = parseDateRange(item.documentAcquireTime);
    const initiationIso = toIso(item.initiationDate) ?? toIso(item.createdAt);

    const rounds: TimelineRound[] = roundList.map((r) => {
      const bp = bpRound(r)[0]; // 同轮多行取最新（与全库当前轮解析口径一致）
      const openingIso = toIso(bp?.openTime) ?? (r === currentRound ? normalizeMaybeDate(item.bidOpeningTime) : null);
      const deadlineRaw = toIso(bp?.deadline);
      const deadlineIso = deadlineRaw ?? (openingIso
        ? new Date(new Date(openingIso).getTime() - BID_DEADLINE_BEFORE_OPENING_MS).toISOString()
        : null);
      const deadlineSource = deadlineRaw ? '招标项目' : openingIso ? `按开标时间推算（前${formatDurationCn(BID_DEADLINE_BEFORE_OPENING_MS)}）` : '招标项目';
      const isLast = r === maxRound;

      const nodes: TimelineNode[] = [
        ...(r === 1
          ? [{ key: 'initiation', label: '采购立项', time: initiationIso, source: item.initiationDate ? '项目管理' : '项目建档' } as TimelineNode]
          : []),
        hasPublicAnnouncementStage
          ? { key: 'bidNoticePublish', label: '采购公告发布', time: publishTimeOf(r, ['BID_NOTICE', 'PREQUAL_NOTICE']), source: '公告' }
          : { key: 'supplierInvitation', label: '供应商邀请', time: supplierInviteOf(r), source: '邀请通知' },
        ...(isLast
          ? [{ key: 'documentAcquire', label: '采购文件获取', time: acquireRange.start, timeEnd: acquireRange.end, source: '项目管理' } as TimelineNode]
          : []),
        { key: 'bidDeadline', label: '投标截止', time: deadlineIso, source: deadlineSource },
        { key: 'bidOpening', label: '开标', time: openingIso, source: '招标项目' },
        { key: 'evaluationEnd', label: '评标结束', time: evalEndByRound.get(r) || null, source: '评标回流包' },
        { key: 'winNoticePublish', label: '中标公告发布', time: publishTimeOf(r, ['WIN_BID_NOTICE', 'PRE_WIN_NOTICE', 'WIN_NOTICE']), source: '公告' },
        { key: 'failedNoticePublish', label: '流标公告发布', time: publishTimeOf(r, ['FAILED_BID_NOTICE']), source: '公告' },
        ...(isLast
          ? [
              { key: 'contractSign', label: '合同签订', time: contractSignIso, source: contractSignSource } as TimelineNode,
              { key: 'archived', label: '归档', time: toIso(item.archivedAt), source: '归档' } as TimelineNode,
            ]
          : []),
      ];
      return { round: r, nodes };
    });

    return { rounds, currentRound };
  }
}
