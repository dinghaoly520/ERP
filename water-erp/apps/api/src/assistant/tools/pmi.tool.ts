import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AssistantTool, AssistantToolCtx, ToolResult } from './assistant-tool';
import { toolCompanyWhere } from './company-filter';
import { PMI_STATUS_LABEL, t } from './labels';
import { methodFilter } from './method-filter.util';
/** 采购流程阶段（PMI currentStage）canon 标签——与进展页/cockpit 同源 */
import { STAGE_LABELS as PM_STAGE_LABELS } from '../../progress/progress.service';

function formatWan(value: unknown): string {
  const n = Number(value);
  if (!Number.isFinite(n) || n === 0) return '-';
  return `${(n / 10000).toFixed(1)}万`;
}

function dateLabel(d: Date | null | undefined): string {
  if (!d) return '未登记';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * 采购项目工具（PMI 口径，2026-11-04 用户裁定「采购项目=项目管理、除邀请招标外都是采购」）。
 * 此前只有 global_overview 的计数——清单/详情类提问会被误导去台账工具（轮次口径），
 * 是下一场口径事故温床；本工具补齐 PMI 清单/详情。
 */
@Injectable()
export class PmiTool implements AssistantTool {
  name = 'pmi';
  description =
    '查询采购项目（项目管理口径，2026-11-04 裁定 canon）：清单/详情——阶段=采购流程九阶段、预算/成交金额、立项/归档信息。args: { action: "list"|"detail", keyword?, method?, stage?, status?, projectId?, limit? }——stage 如 采购文件/开标评标/合同（九阶段中文名或英文键均可），status=ACTIVE|ARCHIVED|TERMINATED。台账轮次/金额汇总请用 procurement，项目总数统计请用 global_overview。';

  constructor(private readonly prisma: PrismaService) {}

  async execute(args: Record<string, unknown> = {}, ctx?: AssistantToolCtx): Promise<ToolResult> {
    const action = (args.action as string) || 'list';
    const keyword = (args.keyword as string) || (args.projectName as string) || undefined;
    const method = args.method as string | undefined;
    const stage = args.stage as string | undefined;
    const status = args.status as string | undefined;
    const projectId = args.projectId as string | undefined;
    const limit = Math.min(Math.max(Number(args.limit) || 10, 1), 20);
    const companyWhere = toolCompanyWhere(ctx);

    // 阶段入参兼容中文标签与简写（LLM 常给「开标」而非「开标评标」）——反查 canon 键
    let stageWhere: unknown = stage;
    if (stage) {
      const entries = Object.entries(PM_STAGE_LABELS);
      const exact = entries.find(([, label]) => label === stage || label.replace(/采购|公示/g, '') === stage);
      if (exact) {
        stageWhere = exact[0];
      } else {
        // 标签或键包含入参（如「开标」匹配「开标评标」）——命中多个取全集
        const hits = entries.filter(([key, label]) => label.includes(stage) || key.toLowerCase().includes(stage.toLowerCase()));
        if (hits.length > 0) stageWhere = { in: hits.map(([key]) => key) };
      }
    }
    // 方式入参容错（LLM 简称 + 轮次/PMI 两套词汇互通）：method-filter.util
    const methodWhere = method ? methodFilter(method) : {};

    if (action === 'detail' && projectId) {
      const item = await this.prisma.projectManagementItem.findFirst({
        where: { id: projectId, ...companyWhere },
      });
      if (!item) return { success: false, error: '采购项目不存在或不在数据范围内' };
      return {
        success: true,
        cards: [
          {
            type: 'table',
            title: '采购项目详情',
            columns: [
              { key: '项', label: '项' },
              { key: '值', label: '值' },
            ],
            rows: [
              { 项: '项目名称', 值: item.title },
              { 项: '项目编号', 值: item.projectCode ?? '-' },
              { 项: '采购方式', 值: item.procurementMethod },
              { 项: '当前阶段', 值: t(PM_STAGE_LABELS, item.currentStage) },
              { 项: '状态', 值: t(PMI_STATUS_LABEL, item.status) },
              { 项: '预算', 值: formatWan(item.budgetAmount) },
              { 项: '合同金额', 值: formatWan(item.contractAmount) },
              { 项: '立项日期', 值: dateLabel(item.initiationDate) },
              { 项: '成交供应商', 值: item.awardedSupplier ?? '-' },
              { 项: '采购单位', 值: item.companyName ?? '-' },
              ...(item.terminationReason ? [{ 项: '终止原因', 值: item.terminationReason }] : []),
            ],
          },
        ],
      };
    }

    // default: list（回收站项目不入清单）
    const where = {
      status: (status && ['ACTIVE', 'ARCHIVED', 'TERMINATED'].includes(status) ? status : { not: 'RECYCLED' }) as never,
      ...companyWhere,
      ...methodWhere,
      ...(stage ? { currentStage: stageWhere as never } : {}),
      ...(keyword ? { title: { contains: keyword } } : {}),
    };
    const items = await this.prisma.projectManagementItem.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      take: limit,
      select: {
        id: true,
        title: true,
        procurementMethod: true,
        currentStage: true,
        status: true,
        budgetAmount: true,
        companyName: true,
      },
    });
    return {
      success: true,
      cards: [
        {
          type: 'table',
          title: `采购项目清单（${items.length} 个）`,
          columns: [
            { key: '项目', label: '项目' },
            { key: '方式', label: '方式' },
            { key: '阶段', label: '阶段' },
            { key: '预算', label: '预算' },
            { key: '状态', label: '状态' },
          ],
          rows: items.map((it) => ({
            项目: it.title,
            方式: it.procurementMethod,
            阶段: t(PM_STAGE_LABELS, it.currentStage),
            预算: formatWan(it.budgetAmount),
            状态: t(PMI_STATUS_LABEL, it.status),
          })),
          /* data 负载（detail 跳转用）：id 列表与行同序——前端点行可带 projectId 问详情 */
          data: { ids: items.map((it) => it.id) },
        },
      ],
    };
  }
}
