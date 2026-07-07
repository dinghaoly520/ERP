import { Injectable } from '@nestjs/common';
import { AttachmentType, ResultStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

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

function startOfDay(value: string) {
  return new Date(`${value}T00:00:00+08:00`);
}

function endOfDay(value: string) {
  return new Date(`${value}T23:59:59.999+08:00`);
}

function diffDays(from: Date, to: Date) {
  const ms = to.getTime() - from.getTime();
  return Math.max(0, Math.ceil(ms / (1000 * 60 * 60 * 24)));
}

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async getDashboard(startDate?: string, endDate?: string) {
    const where =
      startDate && endDate
        ? {
            procurementDate: {
              gte: startOfDay(startDate),
              lte: endOfDay(endDate),
            },
          }
        : {};

    const rounds = await this.prisma.procurementRound.findMany({
      where,
      orderBy: [{ procurementDate: 'asc' }, { createdAt: 'asc' }],
      include: {
        project: true,
        department: true,
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
    const abnormalCount = rounds.filter(
      (item) => item.resultStatus !== ResultStatus.AWARDED,
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

    const trendMap = new Map<
      string,
      {
        label: string;
        count: number;
        amount: number;
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

    for (const round of rounds) {
      const dateKey = round.procurementDate
        ? round.procurementDate.toISOString().slice(0, 10)
        : 'unknown';
      const trendItem = trendMap.get(dateKey) ?? {
        label: round.procurementDate
          ? `${round.procurementDate.getUTCMonth() + 1}/${String(
              round.procurementDate.getUTCDate(),
            ).padStart(2, '0')}`
          : '未填',
        count: 0,
        amount: 0,
        projects: [],
      };
      trendItem.count += 1;
      // Only count award amount for awarded projects
      if (round.resultStatus === ResultStatus.AWARDED) {
        trendItem.amount += decimalToNumber(round.awardAmount);
      }
      trendItem.projects.push({
        name: round.project.name,
        date: round.procurementDate
          ? `${round.procurementDate.getUTCMonth() + 1}月${round.procurementDate.getUTCDate()}日`
          : '未填',
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
        date: round.procurementDate
          ? `${round.procurementDate.getUTCMonth() + 1}月${round.procurementDate.getUTCDate()}日`
          : '未填',
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
        date: round.procurementDate
          ? `${round.procurementDate.getUTCMonth() + 1}月${round.procurementDate.getUTCDate()}日`
          : '未填',
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
          date: round.procurementDate
            ? `${round.procurementDate.getUTCMonth() + 1}月${round.procurementDate.getUTCDate()}日`
            : '未填',
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
          date: round.procurementDate
            ? `${round.procurementDate.getUTCMonth() + 1}月${round.procurementDate.getUTCDate()}日`
            : '未填',
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
          const dateStr = round.procurementDate
            ? `${round.procurementDate.getUTCMonth() + 1}月${round.procurementDate.getUTCDate()}日`
            : '未填';

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

      if (round.resultStatus !== ResultStatus.AWARDED) {
        const label = round.resultText || '待进一步处理';
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
          date: round.procurementDate
            ? `${round.procurementDate.getUTCMonth() + 1}月${round.procurementDate.getUTCDate()}日`
            : '未填',
          department: round.department?.name ?? '未归属部门',
          budgetLabel: formatWan(decimalToNumber(round.budgetAmount)),
          reason: label,
        });
        reasonMap.set(label, reasonItem);
      }
    }

    const trendSeries = [...trendMap.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, item]) => ({
        date,
        label: item.label,
        count: item.count,
        amount: Number((item.amount / 10000).toFixed(1)),
        projects: item.projects,
      }));

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
          date: item.procurementDate
            ? `${item.procurementDate.getUTCMonth() + 1}月${item.procurementDate.getUTCDate()}日`
            : '未填',
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
    const riskProjects = rounds
      .filter((item) => item.resultStatus !== ResultStatus.AWARDED)
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
            : item.resultStatus === ResultStatus.PENDING
              ? '中'
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
      methodStats,
      attachmentProgress,
      supplierStats,
      resultStats,
      nonAwardReasons,
      savingsRanking,
      riskProjects,
    };
  }
}
