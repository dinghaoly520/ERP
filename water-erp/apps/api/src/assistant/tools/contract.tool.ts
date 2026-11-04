import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AssistantTool, AssistantToolCtx, ToolResult } from './assistant-tool';
import { toolCompanyWhere } from './company-filter';
import { CONTRACT_STATUS_LABEL, keyOfLabel, t } from './labels';

function formatWan(value: unknown): string {
  const n = Number(value);
  if (!Number.isFinite(n) || n === 0) return '-';
  return `${(n / 10000).toFixed(1)}万`;
}

function dateLabel(d: Date | null | undefined): string {
  if (!d) return '-';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * 合同履约工具（2026-11-04 数据广度补齐）：定标之后此前全盲区——「合同签了没、
 * 金额多少、履行到哪、签约时限快到了吗」不可问。金额口径：amount=元。
 */
@Injectable()
export class ContractTool implements AssistantTool {
  name = 'contract';
  description =
    '查询合同与履约状态（定标之后：合同编号/供应商/金额/签约与履行状态）。args: { action: "list"|"stats"|"signing_soon", keyword?, status?, limit? }——list 按项目编号/供应商名筛选（status 支持中文：待签约/已签约/履行中/已验收等），stats=状态分布+金额合计，signing_soon=临近签约时限未签的合同。问「合同签了没/履行到哪」用本工具。';

  constructor(private readonly prisma: PrismaService) {}

  async execute(args: Record<string, unknown> = {}, ctx?: AssistantToolCtx): Promise<ToolResult> {
    const action = (args.action as string) || 'list';
    const keyword = (args.keyword as string) || undefined;
    const statusRaw = args.status as string | undefined;
    const limit = Math.min(Math.max(Number(args.limit) || 10, 1), 20);
    const companyWhere = toolCompanyWhere(ctx);
    // 状态中文反查枚举键（LLM 常传「已签约」）
    const status = statusRaw ? keyOfLabel(CONTRACT_STATUS_LABEL, statusRaw) : undefined;
    if (statusRaw && !status) {
      return { success: false, error: `未知合同状态「${statusRaw}」，可用：${Object.values(CONTRACT_STATUS_LABEL).join('、')}` };
    }
    const baseWhere = {
      ...companyWhere,
      ...(status ? { status } : {}),
      ...(keyword
        ? { OR: [{ projectCode: { contains: keyword } }, { supplierName: { contains: keyword } }] }
        : {}),
    };

    if (action === 'stats') {
      const contracts = await this.prisma.contract.findMany({
        where: baseWhere,
        select: { status: true, amount: true },
      });
      const map = new Map<string, { count: number; amount: number }>();
      for (const c of contracts) {
        const cur = map.get(c.status) ?? { count: 0, amount: 0 };
        cur.count += 1;
        cur.amount += Number(c.amount) || 0;
        map.set(c.status, cur);
      }
      const total = contracts.length;
      const amountTotal = contracts.reduce((s, c) => s + (Number(c.amount) || 0), 0);
      const rows = Array.from(map.entries())
        .sort((a, b) => b[1].count - a[1].count)
        .map(([st, v]) => ({
          status: t(CONTRACT_STATUS_LABEL, st),
          count: v.count,
          amount: formatWan(v.amount),
        }));
      return {
        success: true,
        cards: [
          {
            type: 'metric',
            title: '合同总览',
            metrics: [
              { label: '合同数', value: String(total) },
              { label: '金额合计', value: formatWan(amountTotal) },
            ],
          },
          ...(rows.length
            ? [{
                type: 'table' as const,
                title: '合同状态分布',
                columns: [
                  { key: 'status', label: '状态' },
                  { key: 'count', label: '数量' },
                  { key: 'amount', label: '金额' },
                ],
                viz: { kind: 'distribution', category: 'status', value: 'count' },
                rows,
              }]
            : []),
        ],
      };
    }

    if (action === 'signing_soon') {
      const contracts = await this.prisma.contract.findMany({
        where: { ...companyWhere, status: { in: ['drafting', 'internal_review', 'approved_for_signing'] }, signDeadline: { not: null } },
        orderBy: { signDeadline: 'asc' },
        take: limit,
      });
      const now = Date.now();
      return {
        success: true,
        cards: [
          {
            type: 'table',
            title: `待签约合同（${contracts.length} 份，按签约时限排序）`,
            columns: [
              { key: 'contractCode', label: '合同编号' },
              { key: 'supplier', label: '供应商' },
              { key: 'deadline', label: '签约时限' },
              { key: 'status', label: '状态' },
              { key: 'urgency', label: '紧急度' },
            ],
            rows: contracts.map((c) => {
              const days = c.signDeadline ? Math.ceil((c.signDeadline.getTime() - now) / 86400000) : null;
              return {
                contractCode: c.contractCode,
                supplier: c.supplierName,
                deadline: dateLabel(c.signDeadline),
                status: t(CONTRACT_STATUS_LABEL, c.status),
                urgency: days == null ? '-' : days < 0 ? `已超期 ${-days} 天` : days <= 3 ? `剩 ${days} 天` : `${days} 天`,
              };
            }),
          },
        ],
      };
    }

    // default: list
    const contracts = await this.prisma.contract.findMany({
      where: baseWhere,
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    if (contracts.length === 0) {
      return {
        success: true,
        cards: [{
          type: 'metric',
          title: '合同状态',
          metrics: [{ label: '状态', value: '暂无匹配合同' }],
        }],
      };
    }
    return {
      success: true,
      cards: [
        {
          type: 'table',
          title: `合同清单（${contracts.length} 份）`,
          columns: [
            { key: 'contractCode', label: '合同编号' },
            { key: 'supplier', label: '供应商' },
            { key: 'amount', label: '金额' },
            { key: 'status', label: '状态' },
            { key: 'signedAt', label: '签约日期' },
          ],
          rows: contracts.map((c) => ({
            contractCode: c.contractCode,
            supplier: c.supplierName,
            amount: formatWan(c.amount),
            status: t(CONTRACT_STATUS_LABEL, c.status),
            signedAt: dateLabel(c.signedAt),
          })),
        },
      ],
    };
  }
}
