import { Injectable } from '@nestjs/common';
import { PUBLIC_VISIBLE_CLASSES } from '@water-erp/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AssistantTool, AssistantToolCtx, ToolResult } from './assistant-tool';
import { announcementCompanyAllows, announcementCompanyWhere } from './company-filter';
import { ANNOUNCEMENT_TYPE_LABEL, t as translate } from './labels';

/** 公开域判定（2026-09-29 二审 P1）：AI 工具只答"已发布且公开可见"的公告——
 *  草稿/保密级/定向（RESTRICTED 部分供应商可见）一律不进 AI 上下文，
 *  与 /announcements/public 列表同口径。否则匿名问"公告详情"即可带出定向公告正文，
 *  旁路公告可见性收口。 */
export function isPubliclyVisible(ann: { status: string; dataClass?: string | null; metadata?: unknown }): boolean {
  if (ann.status !== 'PUBLISHED') return false;
  if (ann.dataClass && !(PUBLIC_VISIBLE_CLASSES as readonly string[]).includes(ann.dataClass)) return false;
  const meta = ann.metadata as Record<string, unknown> | null | undefined;
  return !(meta && meta.visibility === 'RESTRICTED');
}

/** 列表/统计查询的公开域 where 片段（SQL 可表达部分：已发布 + 数据等级公开）。
 *  visibility 的 JSON 过滤不能进 SQL——Prisma path 过滤对「键缺失」按三值逻辑把行排除
 *  （2026-11-04 实录：17 篇公开公告 SQL 只剩 7，且 path+null 组合直接校验报错
 *  「Argument metadata is missing」——PUBLIC_WHERE 旧形从写出起就没跑通过）。
 *  visibility 判定由 isPubliclyVisible 在内存过滤兜底（单一事实源，SQL/JS 同口径）。 */
export const PUBLIC_WHERE = {
  status: 'PUBLISHED' as const,
  OR: [{ dataClass: { in: [...PUBLIC_VISIBLE_CLASSES] } }, { dataClass: null }],
};

@Injectable()
export class AnnouncementTool implements AssistantTool {
  name = 'announcement';
  description =
    '查询已公开的公告列表/详情/统计，支持按类型筛选。args: { action: "list"|"detail"|"stats", type?, announcementId?, limit? }';

  constructor(private readonly prisma: PrismaService) {}

  async execute(args: Record<string, unknown> = {}, ctx?: AssistantToolCtx): Promise<ToolResult> {
    const action = (args.action as string) || 'list';
    const type = args.type as string | undefined;
    const announcementId = args.announcementId as string | undefined;
    const limit = (args.limit as number) || 10;
    // 公司口径（2026-11-03 用户裁定）：管理端公告按归属公司隔离（平台级全员可见）；
    // 匿名=不过滤（公开可见性仍由 PUBLIC_WHERE 把关）
    const companyScope = announcementCompanyWhere(ctx);

    if (action === 'detail' && announcementId) {
      const ann = await this.prisma.announcement.findUnique({
        where: { id: announcementId },
        include: { _count: { select: { attachments: true } } },
      });
      // findUnique 直查旁路收口：公司归属 JS 侧判定（where 片段进不了 unique 查询）
      if (!ann || !isPubliclyVisible(ann) || !announcementCompanyAllows(ctx, ann.companyId)) {
        return { success: false, error: '公告不存在或不可见' };
      }
      return { success: true, data: ann };
    }

    if (action === 'stats') {
      /* 多维度结构（2026-11-04 用户裁定）：类型之外补发布趋势（近 12 个月，本地时区切月）。
       * 单查询内存聚合：PUBLIC_WHERE 含 metadata.path JSON 过滤，groupBy 查询计划器
       * 不支持（存量潜伏 bug——stats 从写出起就 500，今日「公告分析」提问才引爆） */
      const fetched = await this.prisma.announcement.findMany({
        where: { ...PUBLIC_WHERE, ...companyScope } as never,
        select: { type: true, publishDate: true, status: true, dataClass: true, metadata: true },
      });
      // visibility 内存判定（isPubliclyVisible 单一事实源——SQL 侧见 PUBLIC_WHERE 注释）
      const rows = fetched.filter((a) => isPubliclyVisible(a as never));
      const published = rows.length;
      const typeMap = new Map<string, number>();
      const monthMap = new Map<string, number>();
      for (const row of rows) {
        typeMap.set(row.type, (typeMap.get(row.type) ?? 0) + 1);
        const d = row.publishDate;
        if (!d) continue;
        const m = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        monthMap.set(m, (monthMap.get(m) ?? 0) + 1);
      }
      const byType = Array.from(typeMap.entries()).sort((a, b) => b[1] - a[1]);
      const trendRows = Array.from(monthMap.entries())
        .sort((a, b) => a[0].localeCompare(b[0]))
        .slice(-12)
        .map(([月份, 篇数]) => ({ 月份, 篇数 }));
      const pctOf = (n: number) => (published > 0 ? ((n / published) * 100).toFixed(1) + '%' : '-');
      return {
        success: true,
        cards: [
          {
            type: 'metric', title: '公告概览',
            metrics: [{ label: '已发布公告', value: String(published) }],
          },
          {
            type: 'table', title: '按类型分布',
            columns: [
              { key: 'type', label: '类型' },
              { key: 'count', label: '数量' },
              { key: 'pct', label: '占比' },
            ],
            rows: byType.map(([type, count]) => ({
              type: translate(ANNOUNCEMENT_TYPE_LABEL, type),
              count,
              pct: pctOf(count),
            })),
            viz: { kind: 'distribution', category: 'type', value: 'count' },
          },
          {
            type: 'table', title: '发布趋势（近12个月）',
            columns: [
              { key: '月份', label: '月份' },
              { key: '篇数', label: '篇数' },
            ],
            rows: trendRows,
            viz: { kind: 'trend', value: '篇数', timeField: '月份' },
          },
        ],
      };
    }

    // default: list —— 公开域口径，不提供按草稿/下架状态筛选；公司归属同口径过滤
    const where: Record<string, unknown> = { ...PUBLIC_WHERE, ...companyScope };
    /* type 入参容错（2026-11-04 实测）：LLM 常传中文标签（「采购公告」）——裸进
     * enum where 即 Prisma 校验异常整工具失败；反查标签→枚举键，未知值友好报错 */
    if (type) {
      const enumValues = Object.keys(ANNOUNCEMENT_TYPE_LABEL);
      if (enumValues.includes(type)) {
        where.type = type;
      } else {
        const hit = Object.entries(ANNOUNCEMENT_TYPE_LABEL).find(([, label]) => label === type || label.includes(type));
        if (hit) where.type = hit[0];
        else return { success: false, error: `未知公告类型「${type}」，可用：${Object.values(ANNOUNCEMENT_TYPE_LABEL).join('、')}` };
      }
    }
    const fetched = await this.prisma.announcement.findMany({
      where: where as never,
      take: limit,
      orderBy: { publishDate: 'desc' },
      select: {
        id: true, title: true, type: true, status: true,
        publishDate: true, viewCount: true, isTop: true,
        dataClass: true, metadata: true,
      },
    });
    const announcements = fetched.filter((a) => isPubliclyVisible(a as never));
    /* 出卡（2026-11-04：此前裸 data 无卡） */
    return {
      success: true,
      data: announcements,
      cards: [{
        type: 'table',
        title: `公告列表（${announcements.length} 篇）`,
        columns: [
          { key: 'title', label: '标题' },
          { key: 'type', label: '类型' },
          { key: 'publishDate', label: '发布日期' },
        ],
        rows: announcements.map((a) => ({
          title: a.title,
          type: translate(ANNOUNCEMENT_TYPE_LABEL, a.type),
          publishDate: a.publishDate
            ? `${a.publishDate.getFullYear()}-${String(a.publishDate.getMonth() + 1).padStart(2, '0')}-${String(a.publishDate.getDate()).padStart(2, '0')}`
            : '-',
        })),
      }],
    };
  }
}
