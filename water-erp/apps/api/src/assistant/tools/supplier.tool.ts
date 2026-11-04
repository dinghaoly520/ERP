import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { AssistantTool, AssistantToolCtx, ToolResult } from './assistant-tool';
import { toolCompanyWhere } from './company-filter';
import { SUPPLIER_STATUS_LABEL, keyOfLabel, t } from './labels';
import { openPiiForMask } from '../../common/crypto/sm-field-crypto';

@Injectable()
export class SupplierTool implements AssistantTool {
  name = 'supplier';
  description =
    '查询供应商列表/详情/统计/风险画像/待审核项/活跃排名。args: { action: "list"|"detail"|"stats"|"pending"|"risk"|"top", keyword?, status?, supplierId?, limit?, topN? }——stats=多维度结构（状态/行业/企业类型分布+概览，「供应商分布/结构」类问题用 stats）；list 支持 keyword=供应商名称关键词（按名找供应商先用它）';

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async execute(args: Record<string, unknown> = {}, ctx?: AssistantToolCtx): Promise<ToolResult> {
    const action = (args.action as string) || 'list';
    const statusRaw = args.status as string | undefined;
    // 状态容错（「已入库/待审核」反查枚举键；未知值按不过滤处理）
    const status = statusRaw ? keyOfLabel(SUPPLIER_STATUS_LABEL, statusRaw) : undefined;
    const supplierId = args.supplierId as string | undefined;
    const limit = (args.limit as number) || 10;
    const companyWhere = toolCompanyWhere(ctx);

    if (action === 'detail' && supplierId) {
      const supplier = await this.prisma.supplier.findUnique({
        where: { ...companyWhere, id: supplierId },
        include: {
          contacts: { select: { name: true, phone: true, email: true, isPrimary: true } },
          _count: { select: { evaluations: true, bidSuppliers: true, changeRecords: true } },
        },
      });
      if (!supplier) return { success: false, error: '供应商不存在' };
      // 联系人电话/邮箱明文出口（2026-10-30 口径同 list()/遴选视图：助手=员工操作辅助面，密文即不可用；
      // 2026-11-04 用户裁定「可以明文，但调用需要留痕」——AuditLog 记录谁经水叮当看了哪家联系人）
      this.audit
        .log({
          userId: ctx?.user?.sub ?? 'unknown',
          action: '水叮当明文查看供应商联系人',
          resourceType: 'supplier',
          resourceId: supplierId,
          details: { via: 'assistant-supplier-detail', fields: ['contacts.phone', 'contacts.email'], supplierName: supplier.name },
        })
        .catch(() => {/* 留痕 best-effort：审计库抖动不阻断问答 */});
      return {
        success: true,
        data: {
          ...supplier,
          industry: supplier.industry,
          contacts: supplier.contacts.map(c => ({ ...c, phone: openPiiForMask(c.phone), email: openPiiForMask(c.email) })),
        },
      };
    }

    if (action === 'pending') {
      const pending = await this.prisma.supplier.findMany({
        where: { ...companyWhere, status: 'PENDING' },
        take: limit,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true, name: true, enterpriseType: true,
          creditCode: true, createdAt: true, industry: true,
        },
      });
      return {
        success: true,
        cards: [{
          type: 'table',
          title: `待审核供应商（${pending.length}个）`,
          columns: [
            { key: 'name', label: '名称' },
            { key: 'enterpriseType', label: '企业类型' },
            { key: 'industry', label: '行业' },
            { key: 'creditCode', label: '信用代码' },
          ],
          rows: pending.map((s) => ({
            name: s.name,
            enterpriseType: s.enterpriseType,
            industry: s.industry || '-',
            creditCode: s.creditCode || '-',
          })),
        }],
        data: pending,
      };
    }

    if (action === 'top') {
      // Top suppliers by bid participation count
      const topN = Number(args.topN) || 10;
      const suppliers = await this.prisma.supplier.findMany({
        where: { ...companyWhere, status: 'APPROVED' },
        take: topN,
        select: {
          id: true, name: true,
          _count: { select: { bidSuppliers: true } },
        },
        orderBy: { bidSuppliers: { _count: 'desc' } },
      });
      return {
        success: true,
        cards: [{
          type: 'table', title: `供应商投标参与度排名（Top ${topN}）`,
          columns: [
            { key: 'name', label: '供应商名称' },
            { key: 'bidCount', label: '参与项目数' },
          ],
          rows: suppliers.map((s) => ({ name: s.name, bidCount: s._count.bidSuppliers })),
          viz: { kind: 'ranking', value: 'bidCount', category: 'name', topN },
        }],
      };
    }

    if (action === 'risk') {
      // Risk: disabled, blacklisted, or suppliers with no evaluations
      const risky = await this.prisma.supplier.findMany({
        where: { ...companyWhere, status: { in: ['DISABLED', 'BLACKLIST'] } },
        take: limit,
        select: { id: true, name: true, status: true, enterpriseType: true },
      });
      return {
        success: true,
        cards: [{
          type: 'table',
          title: `风险供应商（${risky.length}个）`,
          columns: [
            { key: 'name', label: '名称' },
            { key: 'status', label: '状态' },
            { key: 'enterpriseType', label: '类型' },
          ],
          rows: risky.map((s) => ({ name: s.name, status: t(SUPPLIER_STATUS_LABEL, s.status), enterpriseType: s.enterpriseType })),
        }],
      };
    }

    if (action === 'stats') {
      /* 多维度结构（2026-11-04 用户裁定：分布类=多结构全维度）——状态之外补
       * 行业（注册国民经济行业，2026-10-29 裁定的分类口径）/企业类型/成交活跃度 */
      const [byStatus, byIndustry, byType, awardedNames] = await Promise.all([
        this.prisma.supplier.groupBy({
          by: ['status'], where: { ...companyWhere }, _count: true,
        }),
        this.prisma.supplier.groupBy({
          by: ['industry'], where: { ...companyWhere }, _count: true,
        }),
        this.prisma.supplier.groupBy({
          by: ['enterpriseType'], where: { ...companyWhere }, _count: true,
        }),
        // 有成交记录家数（台账轮次成交供应商，名称双轨——distinct 名称即家数近似）
        this.prisma.procurementRound.findMany({
          where: { isRecycled: false, resultStatus: 'AWARDED', awardedSupplierName: { not: null }, ...companyWhere },
          distinct: ['awardedSupplierName'],
          select: { awardedSupplierName: true },
        }),
      ]);
      byStatus.sort((a, b) => b._count - a._count);
      const suppTotal = byStatus.reduce((s, r) => s + r._count, 0);
      const pctOf = (n: number) => (suppTotal > 0 ? ((n / suppTotal) * 100).toFixed(1) + '%' : '-');
      const countOf = (status: string) => byStatus.find((s) => s.status === status)?._count ?? 0;
      // 行业/类型：null/空 → 未登记；行业取 Top8（国民经济行业类目多），其余并入「其他」
      const dimRows = (groups: Array<{ _count: number } & Record<string, unknown>>, key: string, topN?: number) => {
        const mapped = groups
          .map((g) => ({ name: String(g[key] ?? '').trim() || '未登记', count: g._count }))
          .sort((a, b) => b.count - a.count);
        if (!topN || mapped.length <= topN) return mapped;
        const head = mapped.slice(0, topN);
        const rest = mapped.slice(topN).reduce((s, x) => s + x.count, 0);
        return rest > 0 ? [...head, { name: '其他', count: rest }] : head;
      };
      return {
        success: true,
        cards: [
          {
            type: 'metric', title: '供应商资源概览',
            metrics: [
              { label: '供应商总数', value: String(suppTotal) },
              { label: '已入库', value: String(countOf('APPROVED')) },
              { label: '待审核', value: String(countOf('PENDING')) },
              { label: '风险（停用+黑名单）', value: String(countOf('DISABLED') + countOf('BLACKLIST')) },
              { label: '有成交记录', value: String(awardedNames.length) },
            ],
          },
          {
            type: 'table', title: '供应商状态分布',
            columns: [
              { key: 'status', label: '状态' },
              { key: 'count', label: '数量' },
              { key: 'pct', label: '占比' },
            ],
            rows: byStatus.map((s) => ({
              status: t(SUPPLIER_STATUS_LABEL, s.status),
              count: s._count,
              pct: pctOf(s._count),
            })),
            viz: { kind: 'distribution', category: 'status', value: 'count' },
          },
          {
            type: 'table', title: '行业分布（注册国民经济行业）',
            columns: [
              { key: 'industry', label: '行业' },
              { key: 'count', label: '数量' },
              { key: 'pct', label: '占比' },
            ],
            rows: dimRows(byIndustry, 'industry', 8).map((x) => ({ industry: x.name, count: x.count, pct: pctOf(x.count) })),
            viz: { kind: 'distribution', category: 'industry', value: 'count' },
          },
          {
            type: 'table', title: '企业类型分布',
            columns: [
              { key: 'etype', label: '企业类型' },
              { key: 'count', label: '数量' },
              { key: 'pct', label: '占比' },
            ],
            rows: dimRows(byType, 'enterpriseType').map((x) => ({ etype: x.name, count: x.count, pct: pctOf(x.count) })),
            viz: { kind: 'distribution', category: 'etype', value: 'count' },
          },
        ],
      };
    }

    // default: list（keyword=名称关键词——2026-11-04 实测按名提问曾查无此人；出卡替代裸 data）
    const keyword = (args.keyword as string) || (args.name as string) || undefined;
    const where = {
      ...companyWhere,
      ...(status ? { status: status as never } : {}),
      ...(keyword ? { name: { contains: keyword } } : {}),
    };
    const suppliers = await this.prisma.supplier.findMany({
      where, take: limit, orderBy: { createdAt: 'desc' },
      select: {
        id: true, name: true, enterpriseType: true, status: true,
        legalPerson: true, createdAt: true, industry: true,
      },
    });
    return {
      success: true,
      data: suppliers,
      cards: [{
        type: 'table',
        title: `供应商清单（${suppliers.length}家）`,
        columns: [
          { key: 'name', label: '名称' },
          { key: 'status', label: '状态' },
          { key: 'enterpriseType', label: '类型' },
          { key: 'industry', label: '行业' },
        ],
        rows: suppliers.map((x) => ({
          name: x.name,
          status: t(SUPPLIER_STATUS_LABEL, x.status),
          enterpriseType: x.enterpriseType,
          industry: x.industry || '-',
        })),
      }],
    };
  }
}
