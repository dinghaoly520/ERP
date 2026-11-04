import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AssistantTool, AssistantToolCtx, ToolResult } from './assistant-tool';
import { toolCompanyWhere } from './company-filter';
import { RESULT_STATUS_LABEL, t } from './labels';
import { methodFilter } from './method-filter.util';

/** 金额格式：内部元 → 「X.X万」展示（台账页/驾驶舱同款万位口径） */
function formatWan(value: unknown): string {
  const n = Number(value);
  if (!Number.isFinite(n) || n === 0) return '-';
  return `${(n / 10000).toFixed(1)}万`;
}

/** 本地时区取「YYYY-MM」——toISOString().slice(0,7) 是 UTC 切片，+08 月初/月末会落错月
 *  （2026-11-04 审查 P1-12；memory web-local-date-no-utc-slice 同型罪） */
function localMonthOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function dateLabel(d: Date | null): string {
  if (!d) return '未登记';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * 采购台账工具（2026-11-04 翻新：数据源从旧立项表 ProcurementProject——全库仅 1 行的
 * 弃用旧轨——改为轮次表 ProcurementRound，即台账页/驾驶舱的真实数据源）。旧 action
 * （立项 list/detail/stats/pending）随之废弃：立项审批流无写入口恒空、「待处理」与页面
 * 同名不同义曾恒答 0。采购项目总数请用 global_overview（PMI 口径）。
 */
@Injectable()
export class ProcurementTool implements AssistantTool {
  name = 'procurement';
  description =
    '查询采购台账（轮次口径：与台账页同数据源）。args: { action: "list"|"detail"|"stats"|"pending"|"abnormal"|"monthly"|"methods"|"suppliers", keyword?, method?, resultStatus?, roundId?, startDate?, endDate?, limit? }——list=轮次清单（可按项目名/方式/结果筛选），detail=轮次详情（roundId），stats=区间汇总（预算/成交/节资+结果分布），pending=待处理清单（未定案压预算），abnormal=异常/终止轮次及原因，monthly=月度趋势（轮次+成交额），methods=按采购方式成交分布，suppliers=成交供应商排行。';

  constructor(private readonly prisma: PrismaService) {}

  async execute(args: Record<string, unknown> = {}, ctx?: AssistantToolCtx): Promise<ToolResult> {
    const action = (args.action as string) || 'list';
    const keyword = (args.keyword as string) || (args.projectName as string) || undefined;
    const method = args.method as string | undefined;
    const resultStatus = args.resultStatus as string | undefined;
    const roundId = args.roundId as string | undefined;
    const startDate = args.startDate as string | undefined;
    const endDate = args.endDate as string | undefined;
    // limit 钳制（2026-11-04 审查 P2-15）：LLM 传大数防全表进卡片与上下文
    const limit = Math.min(Math.max(Number(args.limit) || 10, 1), 20);
    const companyWhere = toolCompanyWhere(ctx);

    const baseWhere = {
      isRecycled: false as const,
      ...companyWhere,
      // 方式容错（LLM 简称 + 轮次/PMI 两套词汇互通）：method-filter.util
      ...(method ? methodFilter(method) : {}),
      ...(resultStatus ? { resultStatus: resultStatus as never } : {}),
      ...(keyword ? { project: { name: { contains: keyword } } } : {}),
      ...(startDate || endDate
        ? {
            procurementDate: {
              ...(startDate ? { gte: new Date(`${startDate}T00:00:00`) } : {}),
              ...(endDate ? { lte: new Date(`${endDate}T23:59:59`) } : {}),
            },
          }
        : {}),
    };

    if (action === 'detail' && roundId) {
      const round = await this.prisma.procurementRound.findFirst({
        where: { id: roundId, isRecycled: false, ...companyWhere },
        include: { project: { select: { name: true, projectCode: true } } },
      });
      if (!round) return { success: false, error: '轮次不存在或不在数据范围内' };
      return {
        success: true,
        cards: [
          {
            type: 'table',
            title: '台账轮次详情',
            columns: [
              { key: '项', label: '项' },
              { key: '值', label: '值' },
            ],
            rows: [
              { 项: '项目', 值: round.project?.name ?? '-' },
              { 项: '项目编号', 值: round.project?.projectCode ?? '-' },
              { 项: '轮次', 值: `第 ${round.roundNo} 轮` },
              { 项: '采购方式', 值: round.procurementMethod },
              { 项: '采购日期', 值: dateLabel(round.procurementDate) },
              { 项: '预算', 值: formatWan(round.budgetAmount) },
              { 项: '控制价', 值: formatWan(round.controlAmount) },
              { 项: '成交额', 值: formatWan(round.awardAmount) },
              { 项: '结果', 值: t(RESULT_STATUS_LABEL, round.resultStatus) },
              { 项: '成交供应商', 值: round.awardedSupplierName || '-' },
              ...(round.terminationReason ? [{ 项: '终止原因', 值: round.terminationReason }] : []),
              { 项: '采购单位', 值: round.companyName || '-' },
            ],
          },
        ],
      };
    }

    if (action === 'stats') {
      const [byStatus, awardedAgg] = await Promise.all([
        this.prisma.procurementRound.groupBy({
          by: ['resultStatus'],
          where: baseWhere,
          _count: true,
          _sum: { budgetAmount: true },
        }),
        // 节资口径同 getStats（2026-10-28 收口）：仅已成交且预算/成交为正、预算≥成交
        this.prisma.procurementRound.aggregate({
          where: {
            ...baseWhere,
            resultStatus: 'AWARDED',
            budgetAmount: { gt: 0 },
            awardAmount: { gt: 0 },
          },
          _sum: { budgetAmount: true, awardAmount: true },
        }),
      ]);
      const totalCount = byStatus.reduce((s, r) => s + r._count, 0);
      const awardSum = Number(awardedAgg._sum.awardAmount) || 0;
      const budgetSum = Number(awardedAgg._sum.budgetAmount) || 0;
      const savings = Math.max(budgetSum - awardSum, 0);
      const savingsRate = budgetSum > 0 ? ((savings / budgetSum) * 100).toFixed(1) : null;
      byStatus.sort((a, b) => b._count - a._count);
      const rows: Array<Record<string, unknown>> = byStatus.map((r) => ({
        结果: t(RESULT_STATUS_LABEL, r.resultStatus),
        轮次: r._count,
        占比: totalCount > 0 ? ((r._count / totalCount) * 100).toFixed(1) + '%' : '-',
        预算: formatWan(r._sum.budgetAmount),
      }));
      rows.push({ _total: true, 结果: '合计', 轮次: totalCount, 占比: '100%', 预算: formatWan(byStatus.reduce((s, r) => s + (Number(r._sum.budgetAmount) || 0), 0)) });
      return {
        success: true,
        cards: [
          {
            type: 'metric',
            title: `台账汇总（${startDate ? `${startDate} 至 ${endDate ?? '今天'}` : '全部'}）`,
            metrics: [
              { label: '轮次', value: String(totalCount) },
              { label: '成交总额', value: formatWan(awardSum) },
              { label: '节资', value: formatWan(savings) },
              { label: '节资率', value: savingsRate != null ? `${savingsRate}%` : '—' },
            ],
          },
          {
            type: 'table',
            title: '结果分布',
            columns: [
              { key: '结果', label: '结果' },
              { key: '轮次', label: '轮次' },
              { key: '占比', label: '占比' },
              { key: '预算', label: '预算' },
            ],
            viz: { kind: 'distribution', category: '结果', value: '轮次' },
            rows,
          },
        ],
      };
    }

    if (action === 'pending' || action === 'abnormal') {
      const where =
        action === 'pending'
          ? { ...baseWhere, resultStatus: 'PENDING' as never }
          : { ...baseWhere, resultStatus: { in: ['FAILED_REVIEW', 'FILE_REVISION_REQUIRED', 'INVALID_RESPONSE', 'CANCELLED'] } as never };
      const rounds = await this.prisma.procurementRound.findMany({
        where,
        orderBy: [{ procurementDate: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
        take: limit,
        include: { project: { select: { name: true } } },
      });
      const budgetSum = rounds.reduce((s, r) => s + (Number(r.budgetAmount) || 0), 0);
      const title =
        action === 'pending'
          ? `待处理轮次（${rounds.length} 个，压预算 ${formatWan(budgetSum)}）`
          : `异常/终止轮次（${rounds.length} 个）`;
      return {
        success: true,
        cards: [
          {
            type: 'table',
            title,
            columns: [
              { key: '项目', label: '项目' },
              { key: '方式', label: '方式' },
              { key: '预算', label: '预算' },
              { key: '结果', label: '结果' },
              ...(action === 'abnormal' ? [{ key: '原因', label: '原因' as const }] : []),
            ],
            rows: rounds.map((r) => ({
              项目: r.project?.name ?? '-',
              方式: r.procurementMethod,
              预算: formatWan(r.budgetAmount),
              结果: t(RESULT_STATUS_LABEL, r.resultStatus),
              ...(action === 'abnormal'
                ? { 原因: r.terminationReason || t(RESULT_STATUS_LABEL, r.resultStatus) }
                : {}),
            })),
          },
        ],
      };
    }

    if (action === 'monthly') {
      /* 月度趋势（2026-11-04 增强）：轮次计数 + 成交额（本地时区切月——UTC 切片会
       * 把 +08 月初/月末的采购日期落错月桶） */
      const rounds = await this.prisma.procurementRound.findMany({
        where: { isRecycled: false, procurementDate: { not: null }, ...companyWhere },
        select: { procurementDate: true, awardAmount: true },
      });
      const monthMap = new Map<string, { count: number; award: number }>();
      for (const r of rounds) {
        if (!r.procurementDate) continue; // 防御：where 已滤 not null，双保险
        const m = localMonthOf(r.procurementDate);
        const cur = monthMap.get(m) ?? { count: 0, award: 0 };
        cur.count += 1;
        cur.award += Number(r.awardAmount) || 0;
        monthMap.set(m, cur);
      }
      const rows = Array.from(monthMap.entries())
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([月份, v]) => ({ 月份, 轮次: v.count, 成交额: formatWan(v.award) }));
      return {
        success: true,
        cards: [
          {
            type: 'table',
            title: '采购月度趋势（台账轮次）',
            columns: [
              { key: '月份', label: '月份' },
              { key: '轮次', label: '轮次' },
              { key: '成交额', label: '成交额' },
            ],
            viz: { kind: 'trend', value: '轮次', timeField: '月份' },
            rows,
          },
        ],
      };
    }

    if (action === 'methods') {
      const rounds = await this.prisma.procurementRound.findMany({
        where: baseWhere,
        select: { procurementMethod: true, awardAmount: true, budgetAmount: true },
      });
      const map = new Map<string, { count: number; award: number }>();
      for (const r of rounds) {
        const cur = map.get(r.procurementMethod) ?? { count: 0, award: 0 };
        cur.count += 1;
        cur.award += Number(r.awardAmount) || 0;
        map.set(r.procurementMethod, cur);
      }
      const rows = Array.from(map.entries())
        .sort((a, b) => b[1].award - a[1].award)
        .map(([方式, v]) => ({ 方式, 轮次: v.count, 成交额: formatWan(v.award) }));
      return {
        success: true,
        cards: [
          {
            type: 'table',
            title: '采购方式成交分布',
            columns: [
              { key: '方式', label: '方式' },
              { key: '轮次', label: '轮次' },
              { key: '成交额', label: '成交额' },
            ],
            viz: { kind: 'distribution', category: '方式', value: '轮次' },
            rows,
          },
        ],
      };
    }

    if (action === 'suppliers') {
      const rounds = await this.prisma.procurementRound.findMany({
        where: { ...baseWhere, resultStatus: 'AWARDED', awardedSupplierName: { not: null } },
        select: { awardedSupplierName: true, awardAmount: true },
      });
      const map = new Map<string, { count: number; award: number }>();
      for (const r of rounds) {
        const name = (r.awardedSupplierName ?? '').trim();
        if (!name) continue;
        const cur = map.get(name) ?? { count: 0, award: 0 };
        cur.count += 1;
        cur.award += Number(r.awardAmount) || 0;
        map.set(name, cur);
      }
      const rows = Array.from(map.entries())
        .sort((a, b) => b[1].award - a[1].award)
        .slice(0, limit)
        .map(([供应商, v]) => ({ 供应商, 成交次数: v.count, 成交额: formatWan(v.award) }));
      return {
        success: true,
        cards: [
          {
            type: 'table',
            title: '成交供应商排行',
            columns: [
              { key: '供应商', label: '供应商' },
              { key: '成交次数', label: '成交次数' },
              { key: '成交额', label: '成交额' },
            ],
            viz: { kind: 'ranking', category: '供应商', value: '成交次数' },
            rows,
          },
        ],
      };
    }

    // default: list（轮次清单——采购日期降序、NULLS LAST：无日期轮次不再置顶）
    const rounds = await this.prisma.procurementRound.findMany({
      where: baseWhere,
      orderBy: [{ procurementDate: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
      take: limit,
      include: { project: { select: { name: true } } },
    });
    return {
      success: true,
      cards: [
        {
          type: 'table',
          title: `台账轮次清单（${rounds.length} 个）`,
          columns: [
            { key: '项目', label: '项目' },
            { key: '方式', label: '方式' },
            { key: '日期', label: '日期' },
            { key: '预算', label: '预算' },
            { key: '成交额', label: '成交额' },
            { key: '结果', label: '结果' },
          ],
          rows: rounds.map((r) => ({
            项目: r.project?.name ?? '-',
            方式: r.procurementMethod,
            日期: dateLabel(r.procurementDate),
            预算: formatWan(r.budgetAmount),
            成交额: formatWan(r.awardAmount),
            结果: t(RESULT_STATUS_LABEL, r.resultStatus),
          })),
        },
      ],
    };
  }
}
