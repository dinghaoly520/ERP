import { Injectable, NotFoundException } from '@nestjs/common';
import { BID_DEADLINE_BEFORE_OPENING_MS } from '@water-erp/shared';
import { PrismaService } from '../prisma/prisma.service';
import { parseFlexibleDate } from '../common/parse-date.util';

/**
 * B3 项目时间信息轴（CTS-EBS01 A-204：项目相关时间信息的建立和维护）。
 * 聚合 PMI / BidProject / Contract 三域六类时间节点：
 * 采购立项 · 采购文件获取 · 投标截止 · 开标 · 合同签订 · 归档。
 * 输出：固定业务顺序（2026-09-08 用户拍板）——此前有值节点按时间升序，
 * 时间压缩/回填场景下「归档」会插进中间（实测 6/23 归档排在 9/7 文件获取
 * 之前），阅读割裂；缺值节点原地灰显占位（前端「未登记」）。
 * 兜底：采购立项 initiationDate 缺 → PMI.createdAt（建档即立项下限）；
 * 合同签订 Contract.signedAt 缺 → CONTRACT 阶段 completedAt（阶段完成≈签订完成）。
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
 */
function parseDateRange(raw: string | null | undefined): { start: string | null; end: string | null } {
  if (!raw) return { start: null, end: null };
  const re = /(\d{4})\D+(\d{1,2})\D+(\d{1,2})(?:\D+(\d{1,2}):?(\d{2}))?/g;
  const parts: Date[] = [];
  for (const m of raw.matchAll(re)) {
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4] ?? 0), Number(m[5] ?? 0));
    if (!Number.isNaN(d.getTime())) parts.push(d);
  }
  if (parts.length === 0) return { start: null, end: null };
  return { start: parts[0].toISOString(), end: parts.length > 1 ? parts[parts.length - 1].toISOString() : null };
}

/**
 * Prisma DateTime（timestamp without time zone）→ ISO。
 * DB 裸值的业务语义是本地时刻，但驱动按 UTC epoch 读出；直接 toISOString() 会让前端
 * （按本地解析 ISO）多出时区差（上海 +8h）——立项 00:00 显成 08:00、开标 14:00 显成 22:00。
 * 与 parseDateRange/parseFlexibleDate 的"本地构造"口径对齐：按本地时区折算后输出。
 */
function toIsoFromBare(d: Date | null | undefined): string | null {
  if (!d) return null;
  return new Date(d.getTime() + d.getTimezoneOffset() * 60000).toISOString();
}

@Injectable()
export class TimelineService {
  constructor(private readonly prisma: PrismaService) {}

  async getTimeline(pmiId: string): Promise<TimelineNode[]> {
    const item = await this.prisma.projectManagementItem.findUnique({
      where: { id: pmiId },
      select: { id: true, createdAt: true, initiationDate: true, documentAcquireTime: true, bidOpeningTime: true, archivedAt: true },
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
    // 合同签订兜底：未走合同模块登记（signedAt 空）时取 CONTRACT 阶段完成时刻
    let contractSignIso = toIsoFromBare(contract?.signedAt);
    let contractSignSource = '合同';
    if (!contractSignIso) {
      const contractStage = await this.prisma.projectManagementStage.findFirst({
        where: { projectManagementItemId: pmiId, stageKey: 'CONTRACT', completedAt: { not: null } },
        select: { completedAt: true },
        orderBy: { completedAt: 'desc' },
      });
      if (contractStage) {
        contractSignIso = toIsoFromBare(contractStage.completedAt);
        contractSignSource = '合同阶段完成';
      }
    }

    // 采购文件获取是时段（AI 提取的起止区间；上传同步的单点值 → 无终点）
    const acquireRange = parseDateRange(item.documentAcquireTime);

    // 投标截止 = 开标前 24 小时（口径常量 BID_DEADLINE_BEFORE_OPENING_MS）：
    // BP.deadline 未登记时按开标时间自动推算展示，不再显示「未登记」
    const openingIso = toIsoFromBare(bp?.openTime) ?? normalizeMaybeDate(item.bidOpeningTime);
    const deadlineRaw = toIsoFromBare(bp?.deadline);
    const deadlineIso = deadlineRaw ?? (openingIso
      ? new Date(new Date(openingIso).getTime() - BID_DEADLINE_BEFORE_OPENING_MS).toISOString()
      : null);
    const deadlineSource = deadlineRaw ? '招标项目' : openingIso ? '按开标时间推算（前24小时）' : '招标项目';

    const nodes: TimelineNode[] = [
      // initiationDate 未登记（直建/AI 提取缺失）→ 建档时刻兜底，避免「采购立项 未登记」
      { key: 'initiation', label: '采购立项', time: toIsoFromBare(item.initiationDate) ?? toIsoFromBare(item.createdAt), source: item.initiationDate ? '项目管理' : '项目建档' },
      { key: 'documentAcquire', label: '采购文件获取', time: acquireRange.start, timeEnd: acquireRange.end, source: '项目管理' },
      { key: 'bidDeadline', label: '投标截止', time: deadlineIso, source: deadlineSource },
      { key: 'bidOpening', label: '开标', time: openingIso, source: '招标项目' },
      { key: 'contractSign', label: '合同签订', time: contractSignIso, source: contractSignSource },
      { key: 'archived', label: '归档', time: toIsoFromBare(item.archivedAt), source: '归档' },
    ];

    // 固定业务顺序（2026-09-08）：立项→获取→截止→开标→签约→归档，与流程阅读习惯一致；
    // 缺值节点原位保留（前端灰显「未登记」），不再按时间重排
    return nodes;
  }
}
