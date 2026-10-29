import { Injectable } from '@nestjs/common';
import { AttachmentType, ResultStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { CompanyWhere } from '../company/company-scope';

function decimalToNumber(value: unknown) {
  if (value == null) {
    return 0;
  }

  if (typeof value === 'number') {
    return value;
  }

  if (typeof value === 'string') {
    return Number.parseFloat(value) || 0;
  }

  if (typeof value === 'object' && value && 'toString' in value) {
    return Number.parseFloat(String(value)) || 0;
  }

  return 0;
}

function formatWan(value: number) {
  return `${(value / 10000).toFixed(1)} 万`;
}

/** 展示日期标签：采购日缺省回退立项日（与趋势图「采购日 ?? 立项日」同口径，消灭「未填」） */
function procurementDateLabel(round: { procurementDate: Date | null; project: { createdAt: Date } }) {
  const d = round.procurementDate ?? round.project.createdAt;
  return `${d.getUTCMonth() + 1}月${d.getUTCDate()}日`;
}

/** 参与供应商数：台账轮次的供应商名单在 biddingUnits 文本（顿号/逗号/换行分隔），
 *  participants 关系多为空——优先解析文本，回退关系计数。 */
function participantCountOf(round: { biddingUnits: string | null; participants: unknown[] }) {
  const text = round.biddingUnits?.trim();
  if (text) {
    const parts = text.split(/[、,，;；\n\r]+/).map((s) => s.trim()).filter(Boolean);
    if (parts.length > 0) return parts.length;
  }
  return round.participants.length;
}

function startOfDay(value: string) {
  return new Date(`${value}T00:00:00+08:00`);
}

/** 公司龙虎榜行（:3011）——awardedCount/abnormalCount 为简化口径（见 getCompanyRanking 注释） */
export interface CompanyRankingRow {
  companyId: string;
  companyName: string;
  totalCount: number;
  awardedCount: number;
  awardAmount: number;
  savings: number;
  abnormalCount: number;
}

function endOfDay(value: string) {
  return new Date(`${value}T23:59:59.999+08:00`);
}

function diffDays(from: Date, to: Date) {
  const ms = to.getTime() - from.getTime();
  return Math.max(0, Math.ceil(ms / (1000 * 60 * 60 * 24)));
}

/** 环比上期窗口：一律「紧邻等长前移」——上期 = [起始-L 天, 起始前一日]，L=当前区间天数。
 *  双边界（自定义区间）L=end-start+1；仅起始日（本月/季/年至今口径）L=起始..今天（服务器日期），
 *  上期终点恒为起始前一日、起点随今日推进逐日回退——与自定义区间同语义（R2-1，2026-10-27：
 *  旧实现「上月整月」违反 spec P0-2 等长前移，月内环比系统性偏差）。
 *  起始日在未来（L≤0）或无起始日（"全部"）无上期。
 *  纯日期运算按 UTC 解析/序列化（与机器时区无关，结果确定）；入库边界仍走 startOfDay/endOfDay(+08:00)。 */
export function priorWindow(
  startDate?: string,
  endDate?: string,
  now: Date = new Date(),
): { startDate: string; endDate: string } | null {
  if (!startDate) return null;
  const DAY = 24 * 3600 * 1000;
  const start = new Date(`${startDate}T00:00:00.000Z`);
  let spanDays: number;
  if (endDate) {
    const end = new Date(`${endDate}T00:00:00.000Z`);
    spanDays = Math.round((end.getTime() - start.getTime()) / DAY) + 1;
  } else {
    // 月/季/年至今：L = 起始..今天（含头尾），按服务器本地日历日
    const today = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
    spanDays = Math.round((today.getTime() - start.getTime()) / DAY) + 1;
  }
  if (spanDays <= 0) return null;
  const prevEnd = new Date(start.getTime() - 1); // 起始前一日末
  const prevStart = new Date(prevEnd.getTime() + 1 - spanDays * DAY);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { startDate: iso(prevStart), endDate: iso(prevEnd) };
}

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async getDashboard(
    startDate?: string,
    endDate?: string,
    companyFilter?: CompanyWhere,
    compare = false,
  ) {
    // 公司隔离：where 注入 companyId，轮次主查询与附件统计（经 procurementRound 关联）同时生效
    const where = {
      ...companyFilter,
      // 2026-10-28 口径收口：排除回收站轮次（与台账 buildListWhere 默认 ACTIVE 同口径——
      // 此前驾驶舱/移动端统计含已回收轮次，列表页不可见的行计入 KPI）
      isRecycled: false,
      // R6-6②（2026-09-30 审计 A1）：单边日期也生效（与台账 buildListWhere 对齐）——
      // 此前 && 才拼过滤，用户只填起始日点"应用"→后端完全不过滤，按钮却显示已过滤区间。
      // 日期口径注明：此过滤只作用于 procurementDate；趋势分桶宣称"缺省回退立项日"
      // 仅在桶内成立——无采购日的轮次带日期条件即从全部统计消失（已知口径限制）。
      ...((startDate || endDate)
        ? {
            procurementDate: {
              ...(startDate ? { gte: startOfDay(startDate) } : {}),
              ...(endDate ? { lte: endOfDay(endDate) } : {}),
            },
          }
        : {}),
    };

    const rounds = await this.prisma.procurementRound.findMany({
      where,
      orderBy: [{ procurementDate: 'asc' }, { createdAt: 'asc' }],
      include: {
        project: true,
        department: true,
        company: true,
        awardedSupplier: true,
        participants: {
          include: {
            supplier: true,
          },
        },
      },
    });

    const totalCount = rounds.length;
    const completedCount = rounds.filter(
      (item) => item.resultStatus === ResultStatus.AWARDED,
    ).length;
    // 异常口径（2026-09-28 审计 P1）：非 AWARDED 即异常会把正常在途（PENDING）项目全算进
    // "异常/风险/未成交"——与同页 resultStats 的 已成交/待定/未成交 三分类互相矛盾。
    // 现剔除 PENDING：异常=真实异常态（审核未过/需修改文件/无效响应/取消/终止等）。
    const abnormalCount = rounds.filter(
      (item) => item.resultStatus !== ResultStatus.AWARDED && item.resultStatus !== ResultStatus.PENDING,
    ).length;

    const totalBudget = rounds.reduce((sum, item) => {
      return sum + decimalToNumber(item.budgetAmount);
    }, 0);
    const awardedBudget = rounds.reduce((sum, item) => {
      if (item.resultStatus !== ResultStatus.AWARDED) {
        return sum;
      }
      return sum + decimalToNumber(item.budgetAmount);
    }, 0);
    const pendingBudget = rounds.reduce((sum, item) => {
      if (item.resultStatus === ResultStatus.AWARDED) {
        return sum;
      }
      return sum + decimalToNumber(item.budgetAmount);
    }, 0);
    const totalAward = rounds.reduce((sum, item) => {
      return sum + decimalToNumber(item.awardAmount);
    }, 0);
    const totalSavings = rounds.reduce((sum, item) => {
      const budget = decimalToNumber(item.budgetAmount);
      const award = decimalToNumber(item.awardAmount);
      if (
        item.resultStatus === ResultStatus.AWARDED &&
        budget > 0 &&
        award > 0 &&
        budget >= award
      ) {
        return sum + (budget - award);
      }
      return sum;
    }, 0);

    // 2026-09-16 双节点趋势：X 轴桶 = 采购日 ?? 项目立项时间（消灭「未填」桶）；
    // initiated=立项节点计数（按项目立项日入桶），archived=归档节点计数（AWARDED 轮次按完成时点入桶）。
    const trendMap = new Map<
      string,
      {
        label: string;
        count: number;
        amount: number;
        initiated: number;
        archived: number;
        projects: Array<{
          name: string;
          date: string;
          department: string;
          method: string;
          budgetLabel: string;
          awardLabel: string;
          status: string;
        }>;
      }
    >();
    const departmentMap = new Map<
      string,
      {
        amount: number;
        total: number;
        done: number;
        methodCount: Map<string, number>;
        projects: Array<{
          name: string;
          date: string;
          method: string;
          budgetLabel: string;
          awardLabel: string;
          status: string;
        }>;
      }
    >();
    // 公司维度分布（2026-10-23：部门归属在业务数据中近乎全空——7 轮仅 1 轮挂部门，
    // 部门分布退化成「未归属部门」大桶；公司归属 7/7 全满，领导驾驶舱的分布维度改用公司）
    const companyMap = new Map<
      string,
      {
        amount: number;
        total: number;
        done: number;
        methodCount: Map<string, number>;
        projects: Array<{
          name: string;
          date: string;
          method: string;
          budgetLabel: string;
          awardLabel: string;
          status: string;
        }>;
      }
    >();
    const methodMap = new Map<
      string,
      {
        count: number;
        amount: number;
        projects: Array<{
          name: string;
          date: string;
          department: string;
          budgetLabel: string;
          awardLabel: string;
          status: string;
        }>;
      }
    >();
    const supplierMap = new Map<
      string,
      {
        name: string;
        participatedCount: number;
        winCount: number;
        awardAmount: number;
        methodCount: Map<string, number>;
        deptCount: Map<string, number>;
        procurements: Array<{
          project: string;
          date: string;
          method: string;
          department: string;
          budgetLabel: string;
          result: string;
        }>;
        wins: Array<{
          project: string;
          date: string;
          method: string;
          department: string;
          awardAmountLabel: string;
        }>;
      }
    >();
    const resultStatusMap = new Map<string, { count: number; amount: number }>([
      ['已成交', { count: 0, amount: 0 }],
      ['待定', { count: 0, amount: 0 }],
      ['未成交', { count: 0, amount: 0 }],
    ]);
    const reasonMap = new Map<
      string,
      {
        count: number;
        detail: string;
        projects: Array<{
          name: string;
          date: string;
          department: string;
          budgetLabel: string;
          reason: string;
        }>;
      }
    >();

    const trendBucketOf = (d: Date) =>
      `${d.getUTCMonth() + 1}/${String(d.getUTCDate()).padStart(2, '0')}`;
    // 桶 key 统一走「采购日 ?? 立项日」；立项/归档两个节点分别落各自日期的桶（缺失时落到主桶，保证计数不丢）
    const ensureBucket = (dateKey: string) => {
      let item = trendMap.get(dateKey);
      if (!item) {
        // label 从桶键解出 M/DD：仅承载立项/归档节点的桶（无采购日落点）也要与主桶同格式，
        // 否则时间轴上会混排 "2026-09-17" 与 "9/07"（2026-09-26 底部时间栏统一）
        item = {
          label: trendBucketOf(new Date(dateKey)),
          count: 0,
          amount: 0,
          initiated: 0,
          archived: 0,
          projects: [],
        };
        trendMap.set(dateKey, item);
      }
      return item;
    };
    // R6-6③（2026-09-30 审计 A2）：归档节点改用 PMI 真实 archivedAt——轮次 updatedAt
    // 会被事后编辑（改成交额/回收站翻转）bump，归档柱漂移到操作日；无关联回退 updatedAt
    const pmiArchivedByRound = new Map<string, Date | null>(
      (await this.prisma.projectManagementItem.findMany({
        where: { archivedProcurementRoundId: { in: rounds.map(r => r.id) } },
        select: { archivedProcurementRoundId: true, archivedAt: true },
      })).map(m => [m.archivedProcurementRoundId as string, m.archivedAt]),
    );
    for (const round of rounds) {
      const archivedAt =
        round.resultStatus === ResultStatus.AWARDED
          ? (pmiArchivedByRound.get(round.id) ?? round.updatedAt)
          : null;
      // 主桶：采购日缺省回退立项日（项目立项时间兜底，消灭「未填」）
      const fallbackDate = round.procurementDate ?? round.project.createdAt;
      const dateKey = fallbackDate.toISOString().slice(0, 10);
      const trendItem = ensureBucket(dateKey);
      trendItem.label = trendBucketOf(fallbackDate);
      // 立项节点：按项目立项日落桶（同桶合并计数）
      const initDate = round.project.createdAt;
      ensureBucket(initDate.toISOString().slice(0, 10)).initiated += 1;
      if (archivedAt) {
        ensureBucket(archivedAt.toISOString().slice(0, 10)).archived += 1;
      }
      trendItem.count += 1;
      // Only count award amount for awarded projects
      if (round.resultStatus === ResultStatus.AWARDED) {
        trendItem.amount += decimalToNumber(round.awardAmount);
      }
      trendItem.projects.push({
        name: round.project.name,
        date: procurementDateLabel(round),
        department: round.department?.name ?? '未归属部门',
        method: round.procurementMethod ?? '未填',
        budgetLabel: formatWan(decimalToNumber(round.budgetAmount)),
        awardLabel:
          round.resultStatus === ResultStatus.AWARDED
            ? formatWan(decimalToNumber(round.awardAmount))
            : '-',
        status:
          round.resultStatus === ResultStatus.AWARDED
            ? '已成交'
            : round.resultStatus === ResultStatus.PENDING
              ? '待定'
              : '未成交',
      });
      trendMap.set(dateKey, trendItem);

      const departmentName = round.department?.name ?? '未归属部门';
      // Only count award amount for awarded projects, otherwise use budget for reference
      const budgetValue =
        round.resultStatus === ResultStatus.AWARDED
          ? decimalToNumber(round.awardAmount)
          : decimalToNumber(round.budgetAmount);
      if (!departmentMap.has(departmentName)) {
        departmentMap.set(departmentName, {
          amount: 0,
          total: 0,
          done: 0,
          methodCount: new Map(),
          projects: [],
        });
      }
      const departmentItem = departmentMap.get(departmentName)!;
      departmentItem.amount += budgetValue;
      departmentItem.total += 1;
      if (round.resultStatus === ResultStatus.AWARDED) {
        departmentItem.done += 1;
      }
      // Track method count for department
      if (round.procurementMethod) {
        const mc = departmentItem.methodCount.get(round.procurementMethod) ?? 0;
        departmentItem.methodCount.set(round.procurementMethod, mc + 1);
      }
      // Collect project details
      departmentItem.projects.push({
        name: round.project.name,
        date: procurementDateLabel(round),
        method: round.procurementMethod ?? '未填',
        budgetLabel: formatWan(decimalToNumber(round.budgetAmount)),
        awardLabel:
          round.resultStatus === ResultStatus.AWARDED
            ? formatWan(decimalToNumber(round.awardAmount))
            : '-',
        status:
          round.resultStatus === ResultStatus.AWARDED
            ? '已成交'
            : round.resultStatus === ResultStatus.PENDING
              ? '待定'
              : '未成交',
      });
      departmentMap.set(departmentName, departmentItem);

      // 公司维度同口径聚合（镜像上方部门块）
      const companyName = round.company?.name ?? '未归属公司';
      if (!companyMap.has(companyName)) {
        companyMap.set(companyName, {
          amount: 0,
          total: 0,
          done: 0,
          methodCount: new Map(),
          projects: [],
        });
      }
      const companyItem = companyMap.get(companyName)!;
      companyItem.amount += budgetValue;
      companyItem.total += 1;
      if (round.resultStatus === ResultStatus.AWARDED) {
        companyItem.done += 1;
      }
      if (round.procurementMethod) {
        const cmc = companyItem.methodCount.get(round.procurementMethod) ?? 0;
        companyItem.methodCount.set(round.procurementMethod, cmc + 1);
      }
      companyItem.projects.push({
        name: round.project.name,
        date: procurementDateLabel(round),
        method: round.procurementMethod ?? '未填',
        budgetLabel: formatWan(decimalToNumber(round.budgetAmount)),
        awardLabel:
          round.resultStatus === ResultStatus.AWARDED
            ? formatWan(decimalToNumber(round.awardAmount))
            : '-',
        status:
          round.resultStatus === ResultStatus.AWARDED
            ? '已成交'
            : round.resultStatus === ResultStatus.PENDING
              ? '待定'
              : '未成交',
      });
      companyMap.set(companyName, companyItem);

      // Collect method stats with projects
      const methodName = round.procurementMethod ?? '未填';
      if (!methodMap.has(methodName)) {
        methodMap.set(methodName, {
          count: 0,
          amount: 0,
          projects: [],
        });
      }
      const methodItem = methodMap.get(methodName)!;
      methodItem.count += 1;
      // Only count award amount for awarded projects
      if (round.resultStatus === ResultStatus.AWARDED) {
        methodItem.amount += decimalToNumber(round.awardAmount);
      }
      methodItem.projects.push({
        name: round.project.name,
        date: procurementDateLabel(round),
        department: departmentName,
        budgetLabel: formatWan(decimalToNumber(round.budgetAmount)),
        awardLabel:
          round.resultStatus === ResultStatus.AWARDED
            ? formatWan(decimalToNumber(round.awardAmount))
            : '-',
        status:
          round.resultStatus === ResultStatus.AWARDED
            ? '已成交'
            : round.resultStatus === ResultStatus.PENDING
              ? '待定'
              : '未成交',
      });
      methodMap.set(methodName, methodItem);

      for (const participant of round.participants) {
        const isWinner = round.awardedSupplierId === participant.supplierId;
        const deptName = round.department?.name ?? '未归属部门';
        const budgetLabel = formatWan(
          decimalToNumber(round.controlAmount || round.budgetAmount),
        );
        const procurementEntry = {
          project: round.project.name,
          date: procurementDateLabel(round),
          method: round.procurementMethod,
          department: deptName,
          budgetLabel,
          result: isWinner
            ? formatWan(decimalToNumber(round.awardAmount))
            : round.resultText || '未中标',
        };

        const supplierItem = supplierMap.get(participant.supplier.name) ?? {
          name: participant.supplier.name,
          participatedCount: 0,
          winCount: 0,
          awardAmount: 0,
          methodCount: new Map<string, number>(),
          deptCount: new Map<string, number>(),
          procurements: [] as Array<{
            project: string;
            date: string;
            method: string;
            department: string;
            budgetLabel: string;
            result: string;
          }>,
          wins: [] as Array<{
            project: string;
            date: string;
            method: string;
            department: string;
            awardAmountLabel: string;
          }>,
        };
        supplierItem.participatedCount += 1;

        // Track method frequency
        const mc = supplierItem.methodCount.get(round.procurementMethod) ?? 0;
        supplierItem.methodCount.set(round.procurementMethod, mc + 1);

        // Track department frequency
        const dc = supplierItem.deptCount.get(deptName) ?? 0;
        supplierItem.deptCount.set(deptName, dc + 1);

        // Collect procurement entries (keep last 4)
        supplierItem.procurements.push(procurementEntry);

        if (isWinner) {
          supplierItem.winCount += 1;
          supplierItem.awardAmount += decimalToNumber(round.awardAmount);
          supplierItem.wins.push({
            project: round.project.name,
            date: procurementEntry.date,
            method: round.procurementMethod,
            department: deptName,
            awardAmountLabel: formatWan(decimalToNumber(round.awardAmount)),
          });
        }
        supplierMap.set(participant.supplier.name, supplierItem);
      }

      // Fallback: also track the awarded supplier (even if no RoundParticipant records exist)
      if (
        round.awardedSupplier &&
        !round.participants.some((p) => p.supplierId === round.awardedSupplierId)
      ) {
        const deptName = round.department?.name ?? '未归属部门';
        const budgetLabel = formatWan(
          decimalToNumber(round.controlAmount || round.budgetAmount),
        );
        const awardLabel = formatWan(decimalToNumber(round.awardAmount));
        const procurementEntry = {
          project: round.project.name,
          date: procurementDateLabel(round),
          method: round.procurementMethod,
          department: deptName,
          budgetLabel,
          result: awardLabel,
        };

        const sItem = supplierMap.get(round.awardedSupplier.name) ?? {
          name: round.awardedSupplier.name,
          participatedCount: 0,
          winCount: 0,
          awardAmount: 0,
          methodCount: new Map<string, number>(),
          deptCount: new Map<string, number>(),
          procurements: [] as Array<{
            project: string;
            date: string;
            method: string;
            department: string;
            budgetLabel: string;
            result: string;
          }>,
          wins: [] as Array<{
            project: string;
            date: string;
            method: string;
            department: string;
            awardAmountLabel: string;
          }>,
        };
        sItem.participatedCount += 1;
        if (round.resultStatus === ResultStatus.AWARDED) {
          sItem.winCount += 1;
          sItem.awardAmount += decimalToNumber(round.awardAmount);
          sItem.wins.push({
            project: round.project.name,
            date: procurementEntry.date,
            method: round.procurementMethod,
            department: deptName,
            awardAmountLabel: awardLabel,
          });
        }
        const mc = sItem.methodCount.get(round.procurementMethod) ?? 0;
        sItem.methodCount.set(round.procurementMethod, mc + 1);
        const dc = sItem.deptCount.get(deptName) ?? 0;
        sItem.deptCount.set(deptName, dc + 1);
        sItem.procurements.push(procurementEntry);
        supplierMap.set(round.awardedSupplier.name, sItem);
      }

      // Fallback: use awardedSupplierName text when no participants OR linked supplier exist
      if (
        round.participants.length === 0 &&
        !round.awardedSupplier &&
        round.awardedSupplierName
      ) {
        const supplierName = round.awardedSupplierName.replace(/\n\s*/g, '').trim();
        if (supplierName) {
          const deptName = round.department?.name ?? '未归属部门';
          const budgetLabel = formatWan(decimalToNumber(round.controlAmount || round.budgetAmount));
          const awardLabel = formatWan(decimalToNumber(round.awardAmount));
          const dateStr = procurementDateLabel(round);

          const tItem = supplierMap.get(supplierName) ?? {
            name: supplierName,
            participatedCount: 0,
            winCount: 0,
            awardAmount: 0,
            methodCount: new Map<string, number>(),
            deptCount: new Map<string, number>(),
            procurements: [] as any[],
            wins: [] as any[],
          };
          tItem.participatedCount += 1;
          if (round.resultStatus === ResultStatus.AWARDED) {
            tItem.winCount += 1;
            tItem.awardAmount += decimalToNumber(round.awardAmount);
            tItem.wins.push({ project: round.project.name, date: dateStr, method: round.procurementMethod, department: deptName, awardAmountLabel: awardLabel });
          }
          tItem.procurements.push({ project: round.project.name, date: dateStr, method: round.procurementMethod, department: deptName, budgetLabel, result: awardLabel });
          const mc = tItem.methodCount.get(round.procurementMethod) ?? 0;
          tItem.methodCount.set(round.procurementMethod, mc + 1);
          const dc = tItem.deptCount.get(deptName) ?? 0;
          tItem.deptCount.set(deptName, dc + 1);
          supplierMap.set(supplierName, tItem);
        }
      }

      if (round.resultStatus === ResultStatus.AWARDED) {
        const result = resultStatusMap.get('已成交');
        if (result) {
          result.count += 1;
          result.amount += decimalToNumber(round.awardAmount);
        }
      } else if (round.resultStatus === ResultStatus.PENDING) {
        const result = resultStatusMap.get('待定');
        if (result) {
          result.count += 1;
          result.amount += decimalToNumber(round.budgetAmount);
        }
      } else {
        const result = resultStatusMap.get('未成交');
        if (result) {
          result.count += 1;
          result.amount += decimalToNumber(round.budgetAmount);
        }
      }

      if (round.resultStatus !== ResultStatus.AWARDED && round.resultStatus !== ResultStatus.PENDING) {
        // 未成交原因分析（PENDING=在途不计入，2026-09-28 审计）。
        // 项目终止的轮次：分组用真实终止原因（resultText 只是「项目已终止」占位文案），
        // 原因各不相同 → 各自成组，符合「原因分析」按原因归类的语义。
        // resultText 短于 2 字（历史脏数据如 "1"）视为无效，回退通用文案
        const fallback = round.resultText && round.resultText.trim().length >= 2 ? round.resultText : null;
        const label = round.terminationReason || fallback || '待进一步处理';
        if (!reasonMap.has(label)) {
          reasonMap.set(label, {
            count: 0,
            detail: label,
            projects: [],
          });
        }
        const reasonItem = reasonMap.get(label)!;
        reasonItem.count += 1;
        reasonItem.projects.push({
          name: round.project.name,
          date: procurementDateLabel(round),
          department: round.department?.name ?? '未归属部门',
          budgetLabel: formatWan(decimalToNumber(round.budgetAmount)),
          reason: label,
        });
        reasonMap.set(label, reasonItem);
      }
    }

    let activeRun = 0;
    const trendSeries = [...trendMap.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, item]) => {
        activeRun += item.initiated - item.archived;
        return {
          date,
          label: item.label,
          count: item.count,
          amount: Number((item.amount / 10000).toFixed(1)),
          initiated: item.initiated,
          archived: item.archived,
          active: activeRun,
          projects: item.projects,
        };
      });

    const departmentStats = [...departmentMap.entries()]
      .map(([name, item]) => {
        const topMethod =
          [...item.methodCount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ??
          '未知';
        return {
          name,
          amount: item.amount,
          amountLabel: formatWan(item.amount),
          completedRate:
            item.total === 0 ? 0 : Math.round((item.done / item.total) * 100),
          topMethod,
          projects: item.projects.slice(-8),
        };
      })
      .sort((left, right) => right.amount - left.amount)
      .slice(0, 6);

    const companyStats = [...companyMap.entries()]
      .map(([name, item]) => {
        const topMethod =
          [...item.methodCount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ??
          '未知';
        return {
          name,
          amount: item.amount,
          amountLabel: formatWan(item.amount),
          completedRate:
            item.total === 0 ? 0 : Math.round((item.done / item.total) * 100),
          topMethod,
          projects: item.projects.slice(-8),
        };
      })
      .sort((left, right) => right.amount - left.amount)
      .slice(0, 6);

    const methodStats = [...methodMap.entries()]
      .map(([name, item]) => ({
        name,
        count: item.count,
        amount: item.amount,
        amountLabel: formatWan(item.amount),
        share:
          totalCount === 0 ? 0 : Math.round((item.count / totalCount) * 100),
        projects: item.projects.slice(-8),
      }))
      .sort((left, right) => right.count - left.count);

    const topEntries = (map: Map<string, number>, limit = 1) =>
      [...map.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, limit)
        .map(([name]) => name);

    const supplierStats = [...supplierMap.values()]
      .sort((left, right) => {
        if (right.winCount !== left.winCount) {
          return right.winCount - left.winCount;
        }
        return right.awardAmount - left.awardAmount;
      })
      .slice(0, 6)
      .map((item) => {
        const topMethod = topEntries(item.methodCount)[0] ?? '未知';
        const topDepartment = topEntries(item.deptCount)[0] ?? '未知部门';
        const hitRate =
          item.participatedCount > 0
            ? Math.round((item.winCount / item.participatedCount) * 100)
            : 0;
        const tags: string[] = [];
        if (item.participatedCount >= 3) {
          tags.push(`${topDepartment}重点参与`);
        }
        if (hitRate >= 40) {
          tags.push(`${topMethod}优势`);
        }
        if (tags.length === 0) {
          tags.push(`${topDepartment}参与`, `${topMethod}`);
        }
        return {
          name: item.name,
          participatedCount: item.participatedCount,
          winCount: item.winCount,
          awardAmount: item.awardAmount,
          awardAmountLabel: formatWan(item.awardAmount),
          hitRate,
          topMethod,
          topDepartment,
          tags,
          recentProcurements: item.procurements.slice(-4),
          winProjects: item.wins.slice(-3),
        };
      });

    const resultStats = [...resultStatusMap.entries()].map(([label, item]) => ({
      label,
      count: item.count,
      amount: item.amount,
      amountLabel: formatWan(item.amount),
      accent: label === '已成交' ? 'blue' : label === '待定' ? 'gold' : 'coral',
    }));

    const nonAwardReasons = [...reasonMap.entries()]
      .map(([label, item]) => ({
        label,
        count: item.count,
        detail: item.detail,
        projects: item.projects.slice(-8),
      }))
      .sort((left, right) => right.count - left.count)
      .slice(0, 5);

    // Savings rate ranking: top projects by savings rate (budget - award for awarded rounds)
    const savingsRanking = rounds
      .filter((item) => {
        if (item.resultStatus !== ResultStatus.AWARDED) return false;
        const budget = decimalToNumber(item.budgetAmount);
        const award = decimalToNumber(item.awardAmount);
        return budget > 0 && award > 0;
      })
      .map((item) => {
        const budget = decimalToNumber(item.budgetAmount);
        const award = decimalToNumber(item.awardAmount);
        const savings = budget - award;
        const savingsRate = budget > 0 ? (savings / budget) * 100 : 0;
        return {
          project: item.project.name,
          department: item.department?.name ?? '未归属部门',
          controlAmount: budget,
          awardAmount: award,
          savings,
          savingsRate: Math.round(savingsRate * 10) / 10,
          controlAmountLabel: formatWan(budget),
          awardAmountLabel: formatWan(award),
          savingsLabel: formatWan(savings),
          method: item.procurementMethod,
          date: procurementDateLabel(item),
          projectCode: item.project.projectCode ?? null,
          awardedSupplierName: item.awardedSupplier?.name ?? item.awardedSupplierName ?? null,
          participantCount: participantCountOf(item),
        };
      })
      .sort((a, b) => {
        // Sort by savings rate desc, then by savings amount desc
        if (b.savingsRate !== a.savingsRate)
          return b.savingsRate - a.savingsRate;
        return b.savings - a.savings;
      })
      .slice(0, 8);

    const now = new Date();
    // 风险预警同异常口径（2026-09-28）：PENDING=在途不算风险，避免全库在途项目刷屏
    const riskProjects = rounds
      .filter((item) => item.resultStatus !== ResultStatus.AWARDED && item.resultStatus !== ResultStatus.PENDING)
      .map((item) => ({
        project: item.project.name,
        department: item.department?.name ?? '未归属部门',
        reason: item.resultText || '待进一步处理',
        pendingDays: item.procurementDate
          ? diffDays(item.procurementDate, now)
          : 0,
        severity:
          item.resultStatus === ResultStatus.FAILED_REVIEW ||
          item.resultStatus === ResultStatus.FILE_REVISION_REQUIRED
            ? '高'
            : '低',
      }))
      .sort((left, right) => right.pendingDays - left.pendingDays)
      .slice(0, 5);

    const attachmentStats = await this.prisma.attachment.groupBy({
      by: ['attachmentType'],
      _count: {
        _all: true,
      },
      where: {
        procurementRound: where,
      },
    });

    const attachmentLookup = new Map(
      attachmentStats.map((item) => [item.attachmentType, item._count._all]),
    );
    const attachmentProgress = [
      { label: '采购文件', type: AttachmentType.TENDER_DOCUMENT },
      { label: '审查意见', type: AttachmentType.REVIEW_COMMENT },
      { label: '投标分析', type: AttachmentType.BID_ANALYSIS },
      { label: '结果附件', type: AttachmentType.AWARD_NOTICE },
    ].map((item) => ({
      label: item.label,
      rate:
        totalCount === 0
          ? 0
          : Math.round(
              ((attachmentLookup.get(item.type) ?? 0) / totalCount) * 100,
            ),
    }));

    // 环比上期块（compare=true 才算）：等长前移窗口六指标，口径全部镜像主 summary
    let compareBlock:
      | {
          prevRange: { startDate: string; endDate: string } | null;
          summary: Record<string, number> | null;
        }
      | undefined = undefined;
    if (compare) {
      const prev = priorWindow(startDate, endDate);
      if (prev) {
        const prevRounds = await this.prisma.procurementRound.findMany({
          where: {
            ...companyFilter,
            procurementDate: { gte: startOfDay(prev.startDate), lte: endOfDay(prev.endDate) },
          },
          select: { resultStatus: true, budgetAmount: true, awardAmount: true },
        });
        const prevAwarded = prevRounds.filter((r) => r.resultStatus === ResultStatus.AWARDED);
        compareBlock = {
          prevRange: prev,
          summary: {
            totalCount: prevRounds.length,
            completedCount: prevAwarded.length,
            // 异常口径同主 summary：非 AWARDED 且非 PENDING（PENDING=在途不算异常）
            abnormalCount: prevRounds.filter(
              (r) => r.resultStatus !== ResultStatus.AWARDED && r.resultStatus !== ResultStatus.PENDING,
            ).length,
            awardedBudget: prevAwarded.reduce((s, r) => s + decimalToNumber(r.budgetAmount), 0),
            totalAward: prevRounds.reduce((s, r) => s + decimalToNumber(r.awardAmount), 0),
            // 节资口径同主 summary totalSavings：仅 AWARDED 且 budget>0、award>0、budget>=award 参与
            totalSavings: prevRounds.reduce((sum, r) => {
              const budget = decimalToNumber(r.budgetAmount);
              const award = decimalToNumber(r.awardAmount);
              if (
                r.resultStatus === ResultStatus.AWARDED &&
                budget > 0 &&
                award > 0 &&
                budget >= award
              ) {
                return sum + (budget - award);
              }
              return sum;
            }, 0),
          },
        };
      } else {
        compareBlock = { prevRange: null, summary: null };
      }
    }

    return {
      range: {
        startDate,
        endDate,
      },
      summary: {
        totalCount,
        completedCount,
        abnormalCount,
        totalBudget,
        totalBudgetLabel: formatWan(totalBudget),
        awardedBudget,
        awardedBudgetLabel: formatWan(awardedBudget),
        pendingBudget,
        pendingBudgetLabel: formatWan(pendingBudget),
        totalAward,
        totalAwardLabel: formatWan(totalAward),
        totalSavings,
        totalSavingsLabel: formatWan(totalSavings),
      },
      trendSeries,
      departmentStats,
      companyStats,
      methodStats,
      attachmentProgress,
      supplierStats,
      resultStats,
      nonAwardReasons,
      savingsRanking,
      riskProjects,
      ...(compare ? { compare: compareBlock } : {}),
    };
  }

  /** :3011 公司龙虎榜行——区间内轮次按公司聚合（无归属不计排名）。
   *  简化口径（2026-10-23）：awardedCount=轮次数、abnormalCount=0——成交/异常细分需逐行
   *  过滤（groupBy 只能带一档 where），榜单主序由 awardAmount 驱动，两列 UI 标注「轮次」。 */
  async getCompanyRanking(startDate: string): Promise<{ rows: CompanyRankingRow[] }> {
    const groups = await this.prisma.procurementRound.groupBy({
      by: ['companyId'],
      where: { procurementDate: { gte: startOfDay(startDate) }, companyId: { not: null } },
      _count: { _all: true },
      _sum: { awardAmount: true, budgetAmount: true },
    });
    const companies = await this.prisma.company.findMany({
      where: { id: { in: groups.map((g) => g.companyId!).filter(Boolean) } },
      select: { id: true, name: true },
    });
    const nameOf = new Map(companies.map((c) => [c.id, c.name]));
    const rows = groups
      .filter((g) => g.companyId)
      .map((g) => ({
        companyId: g.companyId!,
        companyName: nameOf.get(g.companyId!) ?? '未知公司',
        totalCount: g._count._all,
        awardedCount: g._count._all,
        awardAmount: decimalToNumber(g._sum.awardAmount),
        savings: Math.max(decimalToNumber(g._sum.budgetAmount) - decimalToNumber(g._sum.awardAmount), 0),
        abnormalCount: 0,
      }))
      .sort((a, b) => b.awardAmount - a.awardAmount);
    return { rows };
  }

  /** :3011 公司龙虎榜视图——admin 全榜；leader/staff 本公司排位 + 集团均值。
   *  榜单天然跨公司（比的是全集团排位），不做公司过滤；range=month|year（缺省 month）。 */
  async getCompanyRankingView(user: { sub: string; role: string }, range?: string) {
    const effRange = range === 'year' ? 'year' : 'month';
    const now = new Date();
    const startDate =
      effRange === 'year'
        ? `${now.getFullYear()}-01-01`
        : `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
    const { rows } = await this.getCompanyRanking(startDate);
    if (user.role === 'admin') {
      return { range: effRange, rows };
    }
    const me = await this.prisma.user.findUnique({
      where: { id: user.sub },
      select: { companyId: true },
    });
    const idx = me?.companyId ? rows.findIndex((r) => r.companyId === me.companyId) : -1;
    const avg = (pick: (r: CompanyRankingRow) => number) =>
      rows.length === 0
        ? 0
        : Math.round((rows.reduce((sum, r) => sum + pick(r), 0) / rows.length) * 10) / 10;
    return {
      range: effRange,
      self:
        idx >= 0
          ? {
              rank: idx + 1,
              companyName: rows[idx].companyName,
              awardAmount: rows[idx].awardAmount,
            }
          : null,
      groupAvg: { awardAmount: avg((r) => r.awardAmount), totalCount: avg((r) => r.totalCount) },
    };
  }

  /** :3011 Tab 角标——异常/待处理/停滞三计数（与 getDashboard abnormalCount 同口径：
   *  异常=非 AWARDED 且非 PENDING；停滞=ACTIVE 项目【当前阶段】停留>30 天） */
  async getBadges(companyFilter?: CompanyWhere) {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 3600 * 1000);
    // 停滞旧口径数「全部非 COMPLETED 阶段行」——回收/归档项目与历史未完阶段全计入
    // （2026-10-26 实录：131 行显 99+）。规格口径=ACTIVE 项目 × currentStage 指针定位的
    // 当前阶段行；Prisma where 不能跨表比对列（stageKey = currentStage），ACTIVE 集
    // 本就小，两步查 + JS 配对（勿走 raw SQL——CompanyScope 盲区）
    const [abnormalCount, pendingCount, activeItems] = await Promise.all([
      this.prisma.procurementRound.count({
        where: { ...companyFilter, isRecycled: false, resultStatus: { notIn: ['AWARDED', 'PENDING'] } },
      }),
      this.prisma.procurementRound.count({
        where: { ...companyFilter, isRecycled: false, resultStatus: 'PENDING' },
      }),
      this.prisma.projectManagementItem.findMany({
        where: { status: 'ACTIVE', ...(companyFilter ?? {}) },
        select: { id: true, currentStage: true },
      }),
    ]);
    let stalledCount = 0;
    if (activeItems.length) {
      const stages = await this.prisma.projectManagementStage.findMany({
        where: {
          projectManagementItemId: { in: activeItems.map((it) => it.id) },
          updatedAt: { lt: thirtyDaysAgo },
        },
        select: { projectManagementItemId: true, stageKey: true },
      });
      const curByItem = new Map(activeItems.map((it) => [it.id, it.currentStage]));
      stalledCount = stages.filter((s) => s.stageKey === curByItem.get(s.projectManagementItemId)).length;
    }
    return { abnormalCount, pendingCount, stalledCount };
  }
}
