import { Injectable, BadRequestException, ConflictException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { Workbook } from 'exceljs';
import { LlmService } from '../local-ai/llm.service';
import { EmbeddingService } from '../local-ai/embedding.service';
import { LlmOutputValidator } from '../local-ai/llm-output-validator';
import { NotificationService } from '../notification/notification.service';

/** AI 分类/属性确定性种子（同输入复现同结果，便于前端调试与回归）。 */
const AI_SEED = 42;
/** 叶子数超过该阈值才用 embedding 预筛候选；少于则全量喂给 LLM。 */
const EMBED_PRESCREEN_THRESHOLD = 30;
/** embedding 预筛保留的候选品类数（top-K）。 */
const EMBED_TOP_K = 10;
/** validateEnum 越界哨兵：品类 id / SELECT 选项不在合法集合时返回它，调用方据此判 null。 */
const ENUM_INVALID = '__INVALID_SENTINEL__';

/** 供应商目录供货申请类型 */
export type CatalogApplicationType = 'NEW_ITEM' | 'JOIN_EXISTING' | 'UPDATE_QUOTE';

export interface CatalogItemView {
  id: string;
  code: string;
  name: string;
  specification: string;
  category: string;
  group: string;
  categoryId?: number;
  categoryPath?: string;
  unit: string;
  referencePrice: number;
  priceMin: number;
  priceMax: number;
  lastDealPrice: number;
  averagePrice: number;
  supplier: string;
  supplierType: string;
  priceSource: string;
  region: string;
  taxIncluded: boolean;
  freightIncluded: boolean;
  changeRate: number;
  minOrder: string;
  remark: string | null;
  status: string;
  validUntil: string | null;
  updatedAt: string;
  createdAt: string;
  attributes?: Array<{ templateId: number; value: string; fieldKey: string; name: string; fieldType: string; unit?: string }>;
}

/** Prisma 的 Decimal 在 JSON 序列化时会变成字符串，前端按 number 使用，故在此统一转换。 */
function serialize(item: any): CatalogItemView {
  return {
    id: item.id,
    code: item.code,
    name: item.name,
    specification: item.specification,
    category: item.category,
    group: item.group,
    categoryId: item.categoryId ?? undefined,
    categoryPath: item.categoryRel?.code ? `${item.categoryRel.code}:${item.categoryRel.name}` : undefined,
    unit: item.unit,
    referencePrice: Number(item.referencePrice),
    priceMin: Number(item.priceMin),
    priceMax: Number(item.priceMax),
    lastDealPrice: Number(item.lastDealPrice),
    averagePrice: Number(item.averagePrice),
    supplier: item.supplier,
    supplierType: item.supplierType,
    priceSource: item.priceSource,
    region: item.region,
    taxIncluded: item.taxIncluded,
    freightIncluded: item.freightIncluded,
    changeRate: Number(item.changeRate),
    minOrder: item.minOrder,
    remark: item.remark,
    status: item.status,
    validUntil: item.validUntil ? new Date(item.validUntil).toISOString() : null,
    updatedAt: new Date(item.updatedAt).toISOString(),
    createdAt: new Date(item.createdAt).toISOString(),
    attributes: item.attributes?.map((a: any) => ({
      templateId: a.templateId,
      value: a.value,
      fieldKey: a.template?.fieldKey,
      name: a.template?.name,
      fieldType: a.template?.fieldType,
      unit: a.template?.unit,
    })) ?? [],
  };
}

/** 供应商角色不得看到价格字段（公共读端点对 supplier 脱敏；mall/内部角色给全量）。 */
function stripPricesForRole<T>(view: T, viewerRole?: string): T {
  if (viewerRole !== 'supplier') return view;
  const { referencePrice, priceMin, priceMax, lastDealPrice, averagePrice, changeRate, ...rest } = view as any;
  return rest as T;
}

@Injectable()
export class CatalogService {
  constructor(
    private prisma: PrismaService,
    // LocalAiModule 是 @Global()，直接注入即可，无需在 catalog.module.ts 增加 imports
    private readonly llm: LlmService,
    private readonly embedding: EmbeddingService,
    private readonly validator: LlmOutputValidator,
    private readonly notification: NotificationService,
  ) {}

  async list(params: {
    category?: string;
    region?: string;
    status?: string;
    source?: string;
    search?: string;
    includeInactive?: boolean;
    categoryId?: number;
  }, viewerRole?: string) {
    const filters: any[] = [];
    if (params.categoryId) {
      filters.push({ categoryId: Number(params.categoryId) });
    }
    if (params.category && params.category !== '全部') {
      filters.push({ OR: [{ category: params.category }, { group: params.category }] });
    }
    if (params.region && params.region !== '全部' && params.region !== '全省') {
      filters.push({ OR: [{ region: params.region }, { region: '全省' }] });
    }
    if (params.status && params.status !== '全部') filters.push({ status: params.status });
    if (params.source && params.source !== '全部') filters.push({ priceSource: params.source });
    // Mall default: only show active items. Admin may pass includeInactive=true.
    if (!params.includeInactive && !params.status) filters.push({ status: '有效' });
    if (params.search) {
      const kw = params.search.trim();
      if (kw) {
        filters.push({
          OR: [
            { code: { contains: kw, mode: 'insensitive' } },
            { name: { contains: kw, mode: 'insensitive' } },
            { specification: { contains: kw, mode: 'insensitive' } },
            { category: { contains: kw, mode: 'insensitive' } },
            { supplier: { contains: kw, mode: 'insensitive' } },
          ],
        });
      }
    }
    const where = filters.length ? { AND: filters } : undefined;
    const items = await this.prisma.catalogItem.findMany({
      where, orderBy: { code: 'asc' },
      include: { attributes: { include: { template: true } }, categoryRel: true },
    });
    return items.map(i => stripPricesForRole(serialize(i), viewerRole));
  }

  async get(id: string, viewerRole?: string) {
    const item = await this.prisma.catalogItem.findUnique({
      where: { id },
      include: { attributes: { include: { template: true } }, categoryRel: true },
    });
    if (!item) throw new BadRequestException({ error: '目录条目不存在', code: 'NOT_FOUND' });
    return stripPricesForRole(serialize(item), viewerRole);
  }

  async getHistory(id: string, viewerRole?: string) {
    // 价格历史对供应商不开放（mall 不以 supplier 角色调用此端点）
    if (viewerRole === 'supplier') return [];
    const rows = await this.prisma.priceHistory.findMany({
      where: { catalogItemId: id },
      orderBy: { recordedAt: 'asc' },
      select: { recordedAt: true, price: true, note: true },
    });
    return rows.map(r => ({
      recordedAt: r.recordedAt.toISOString(),
      price: Number(r.price),
      note: r.note,
    }));
  }

  /** 按供应商聚合目录（供应商维度浏览，不依赖 Supplier 登录表）。 */
  async listSuppliers(viewerRole?: string) {
    const items = await this.prisma.catalogItem.findMany({
      select: { supplier: true, supplierType: true, region: true, category: true, referencePrice: true },
    });
    const map = new Map<string, { supplier: string; supplierType: string; regions: Set<string>; categories: Set<string>; prices: number[]; count: number }>();
    for (const it of items) {
      let e = map.get(it.supplier);
      if (!e) {
        e = { supplier: it.supplier, supplierType: it.supplierType, regions: new Set(), categories: new Set(), prices: [], count: 0 };
        map.set(it.supplier, e);
      }
      e.regions.add(it.region);
      e.categories.add(it.category);
      e.prices.push(Number(it.referencePrice));
      e.count += 1;
    }
    return Array.from(map.values())
      .map(e => ({
        supplier: e.supplier,
        supplierType: e.supplierType,
        regions: Array.from(e.regions),
        categories: Array.from(e.categories),
        itemCount: e.count,
        minPrice: Math.min(...e.prices),
        maxPrice: Math.max(...e.prices),
        avgPrice: Math.round((e.prices.reduce((a, b) => a + b, 0) / e.prices.length) * 100) / 100,
      }))
      .sort((a, b) => b.itemCount - a.itemCount)
      .map(e => {
        if (viewerRole === 'supplier') {
          const { minPrice, maxPrice, avgPrice, ...rest } = e;
          return rest;
        }
        return e;
      });
  }

  async toggleFavorite(userId: string, itemId: string) {
    const key = { userId_catalogItemId: { userId, catalogItemId: itemId } };
    const existing = await this.prisma.userFavorite.findUnique({ where: key });
    if (existing) {
      // deleteMany 幂等：并发双取消时不会因记录已被删而抛 P2025 → 500
      await this.prisma.userFavorite.deleteMany({ where: { userId, catalogItemId: itemId } });
      return { favorited: false };
    }
    try {
      await this.prisma.userFavorite.create({ data: { userId, catalogItemId: itemId } });
      return { favorited: true };
    } catch (e) {
      // 并发双收藏撞唯一键 P2002 时视为「已收藏」，不抛 500
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return { favorited: true };
      throw e;
    }
  }

  async listFavorites(userId: string, viewerRole?: string) {
    const favs = await this.prisma.userFavorite.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      include: { catalogItem: true },
    });
    return favs.map(f => serialize(f.catalogItem)).filter(Boolean).map(v => stripPricesForRole(v, viewerRole));
  }

  // ── Admin operations ──

  private catalogDataDto(dto: any) {
    return {
      code: dto.code.trim(),
      name: dto.name.trim(),
      specification: dto.specification.trim(),
      category: dto.category.trim(),
      group: dto.group.trim(),
      categoryId: dto.categoryId ?? null,
      unit: dto.unit.trim(),
      referencePrice: dto.referencePrice,
      priceMin: dto.priceMin,
      priceMax: dto.priceMax,
      lastDealPrice: dto.lastDealPrice,
      averagePrice: dto.averagePrice,
      supplier: dto.supplier.trim(),
      supplierType: dto.supplierType.trim(),
      priceSource: dto.priceSource.trim(),
      region: dto.region.trim(),
      taxIncluded: dto.taxIncluded ?? true,
      freightIncluded: dto.freightIncluded ?? false,
      changeRate: dto.changeRate,
      minOrder: dto.minOrder.trim(),
      remark: dto.remark?.trim() || null,
      status: dto.status || '有效',
      validUntil: dto.validUntil ? new Date(dto.validUntil) : null,
    };
  }

  private validatePriceRangeDto(dto: any) {
    if (dto.priceMin > dto.referencePrice || dto.referencePrice > dto.priceMax) {
      throw new BadRequestException({ error: '参考价必须位于价格下限和价格上限之间', code: 'INVALID_PRICE_RANGE' });
    }
  }

  /** 审计日志为辅助记录：失败时降级（仅记录错误），不回滚/阻断主业务。照 reviewApplication「业务在事务内、审计在事务外」的模式。 */
  private async safeAudit(data: Prisma.AuditLogUncheckedCreateInput): Promise<void> {
    try {
      await this.prisma.auditLog.create({ data });
    } catch (err) {
      console.error('[catalog] 审计日志写入失败（已降级）:', err);
    }
  }

  async stats() {
    const [total, active, inactive, review, updatedThisMonth, pendingApplications] = await Promise.all([
      this.prisma.catalogItem.count(),
      this.prisma.catalogItem.count({ where: { status: '有效' } }),
      this.prisma.catalogItem.count({ where: { status: { in: ['下架', '停用'] } } }),
      this.prisma.catalogItem.count({ where: { status: { in: ['待复核', '价格波动', '即将过期'] } } }),
      this.prisma.catalogItem.count({ where: { updatedAt: { gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1) } } }),
      this.prisma.supplierCatalogApplication.count({ where: { status: 'PENDING' } }),
    ]);
    return { total, active, inactive, review, updatedThisMonth, pendingApplications };
  }

  async createAdminItem(userId: string, dto: any) {
    this.validatePriceRangeDto(dto);
    const data = this.catalogDataDto(dto);
    const created = await this.prisma.$transaction(async (tx: any) => {
      const item = await tx.catalogItem.create({ data });
      await tx.priceHistory.create({ data: { catalogItemId: item.id, price: data.referencePrice, recordedAt: new Date(), note: '手动新增' } });
      return item;
    });
    await this.safeAudit({ userId, action: 'CATALOG_CREATED', resourceType: created.code, details: { itemId: created.id, name: created.name } });
    return serialize(created);
  }

  async updateAdminItem(userId: string, id: string, dto: any) {
    this.validatePriceRangeDto(dto);
    const existing = await this.prisma.catalogItem.findUnique({ where: { id } });
    if (!existing) throw new BadRequestException({ error: '目录条目不存在', code: 'NOT_FOUND' });
    const data = this.catalogDataDto(dto);
    const oldPrice = Number(existing.referencePrice);
    const newPrice = Number(data.referencePrice);
    const priceChanged = oldPrice !== newPrice;
    const updated = await this.prisma.$transaction(async (tx: any) => {
      const item = await tx.catalogItem.update({ where: { id }, data });
      if (priceChanged) {
        await tx.priceHistory.create({ data: { catalogItemId: id, price: newPrice, recordedAt: new Date(), note: '手动调价' } });
      }
      return item;
    });
    await this.safeAudit({
      userId,
      action: priceChanged ? 'CATALOG_PRICE_CHANGED' : 'CATALOG_UPDATED',
      resourceType: updated.code,
      details: { itemId: id, oldPrice, newPrice, changedFields: Object.keys(data) },
    });
    return serialize(updated);
  }

  async changeStatus(userId: string, id: string, dto: { status: string; reason?: string }) {
    const existing = await this.prisma.catalogItem.findUnique({ where: { id } });
    if (!existing) throw new BadRequestException({ error: '目录条目不存在', code: 'NOT_FOUND' });
    const updated = await this.prisma.catalogItem.update({ where: { id }, data: { status: dto.status } });
    await this.safeAudit({
      userId,
      action: 'CATALOG_STATUS_CHANGED',
      resourceType: updated.code,
      details: { itemId: id, from: existing.status, to: dto.status, reason: dto.reason || null },
    });
    return serialize(updated);
  }

  async adminAuditLogs() {
    const actions = ['CATALOG_CREATED', 'CATALOG_UPDATED', 'CATALOG_PRICE_CHANGED', 'CATALOG_STATUS_CHANGED', 'CATALOG_IMPORTED', 'CATALOG_TEMPLATE_DOWNLOADED', 'CATALOG_EXPORTED'];
    const rows = await this.prisma.auditLog.findMany({
      where: { action: { in: actions } },
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: { user: { select: { username: true, displayName: true } } },
    });
    return rows.map((r: any) => ({
      id: r.id,
      action: r.action,
      resourceType: r.resourceType,
      details: r.details,
      user: r.user,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  async importTemplate(userId: string): Promise<Buffer> {
    const wb = new Workbook();
    const ws = wb.addWorksheet('电子商城目录导入模板');
    const cols = ['目录编码', '物资名称', '规格型号', '分类', '分组', '单位', '参考价', '价格下限', '价格上限',
      '最近成交价', '历史均价', '供应商', '供应商类型', '价格来源', '区域', '含税', '含运费',
      '价格变化率', '最小起订量', '状态', '有效期', '备注'];
    ws.columns = cols.map(h => ({ header: h, key: h, width: 18 }));
    ws.addRow({
      目录编码: 'CAT-DEMO-001', 物资名称: '示例物资', 规格型号: 'DN300', 分类: '管材', 分组: '工程材料',
      单位: '米', 参考价: 120, 价格下限: 100, 价格上限: 140, 最近成交价: 118, 历史均价: 119,
      供应商: '示例供应商', 供应商类型: '协议供应商', 价格来源: '人工维护', 区域: '全省',
      含税: '是', 含运费: '否', 价格变化率: 0, 最小起订量: '10米', 状态: '有效', 有效期: '2026-12-31',
      备注: '示例行，导入前请删除',
    });
    ws.getRow(1).font = { bold: true };
    await this.prisma.auditLog.create({ data: { userId, action: 'CATALOG_TEMPLATE_DOWNLOADED', resourceType: '电子商城导入模板', details: {} } });
    return Buffer.from(await wb.xlsx.writeBuffer() as ArrayBuffer);
  }

  async importItems(userId: string, file: Express.Multer.File) {
    if (!file) throw new BadRequestException({ error: '请选择导入文件', code: 'FILE_REQUIRED' });
    if (file.size > 5 * 1024 * 1024) throw new BadRequestException({ error: '文件大小不能超过 5MB', code: 'FILE_TOO_LARGE' });
    const { parseCatalogImport } = await import('./catalog-import');
    const parsed = await parseCatalogImport(file.buffer, file.originalname);
    let created = 0;
    let updated = 0;
    const failedRows = parsed.rows.filter(r => r.errors.length).map(r => ({ rowNumber: r.rowNumber, code: r.code, errors: r.errors }));
    for (const row of parsed.rows.filter(r => r.data)) {
      const dto = row.data!;
      try {
        const existing = await this.prisma.catalogItem.findUnique({ where: { code: dto.code } });
        const data = this.catalogDataDto(dto);
        if (existing) {
          const oldPrice = Number(existing.referencePrice);
          // 单行的「主写 + 价格历史」在同一事务内，保证原子；单行失败仅 skip 该行，不让整批 500
          await this.prisma.$transaction(async (tx: any) => {
            const saved = await tx.catalogItem.update({ where: { id: existing.id }, data });
            if (oldPrice !== Number(data.referencePrice)) {
              await tx.priceHistory.create({ data: { catalogItemId: saved.id, price: data.referencePrice, recordedAt: new Date(), note: '批量导入更新' } });
            }
          });
          updated += 1;
        } else {
          await this.prisma.$transaction(async (tx: any) => {
            const saved = await tx.catalogItem.create({ data });
            await tx.priceHistory.create({ data: { catalogItemId: saved.id, price: data.referencePrice, recordedAt: new Date(), note: '批量导入新增' } });
          });
          created += 1;
        }
      } catch (err: any) {
        // Prisma 抛错（唯一约束 / 外键等）被接住并计入该行失败，而非向上冒泡
        failedRows.push({ rowNumber: row.rowNumber, code: dto.code, errors: [err?.message || '写入失败'] });
      }
    }
    const result = { totalRows: parsed.rows.length, created, updated, failed: failedRows.length, failedRows };
    await this.safeAudit({ userId, action: 'CATALOG_IMPORTED', resourceType: file.originalname, details: result });
    return result;
  }

  async exportCatalog(userId: string, params: { category?: string; region?: string; status?: string; source?: string; search?: string }, viewerRole?: string): Promise<Buffer> {
    const items = await this.list(params, viewerRole);
    const hidePrice = viewerRole === 'supplier';
    const wb = new Workbook();
    const ws = wb.addWorksheet('采购目录');
    const cols: { header: string; key: string; width: number; price?: boolean }[] = [
      { header: '目录编码', key: 'code', width: 22 },
      { header: '物资名称', key: 'name', width: 24 },
      { header: '规格型号', key: 'specification', width: 30 },
      { header: '分类', key: 'category', width: 12 },
      { header: '组别', key: 'group', width: 12 },
      { header: '单位', key: 'unit', width: 8 },
      { header: '参考价', key: 'referencePrice', width: 12, price: true },
      { header: '价格下限', key: 'priceMin', width: 12, price: true },
      { header: '价格上限', key: 'priceMax', width: 12, price: true },
      { header: '最近成交价', key: 'lastDealPrice', width: 12, price: true },
      { header: '历史均价', key: 'averagePrice', width: 12, price: true },
      { header: '价格变化(%)', key: 'changeRate', width: 12, price: true },
      { header: '价格来源', key: 'priceSource', width: 12 },
      { header: '状态', key: 'status', width: 10 },
      { header: '供应商', key: 'supplier', width: 30 },
      { header: '供应商类型', key: 'supplierType', width: 12 },
      { header: '区域', key: 'region', width: 8 },
      { header: '含税', key: 'taxIncluded', width: 8 },
      { header: '含运费', key: 'freightIncluded', width: 8 },
      { header: '最小起订', key: 'minOrder', width: 12 },
      { header: '更新时间', key: 'updatedAt', width: 14 },
      { header: '有效期至', key: 'validUntil', width: 14 },
      { header: '备注', key: 'remark', width: 40 },
    ];
    const visibleCols = cols.filter(c => !(hidePrice && c.price));
    ws.columns = visibleCols.map(({ header, key, width }) => ({ header, key, width }));
    ws.addRows(items.map(it => {
      const row: Record<string, any> = {
        code: it.code, name: it.name, specification: it.specification, category: it.category, group: it.group,
        unit: it.unit, referencePrice: it.referencePrice, priceMin: it.priceMin, priceMax: it.priceMax,
        lastDealPrice: it.lastDealPrice, averagePrice: it.averagePrice, changeRate: it.changeRate,
        priceSource: it.priceSource, status: it.status, supplier: it.supplier, supplierType: it.supplierType,
        region: it.region, taxIncluded: it.taxIncluded ? '是' : '否', freightIncluded: it.freightIncluded ? '是' : '否',
        minOrder: it.minOrder, updatedAt: it.updatedAt.slice(0, 10), validUntil: it.validUntil ? it.validUntil.slice(0, 10) : '',
        remark: it.remark ?? '',
      };
      if (hidePrice) for (const c of cols) if (c.price) delete row[c.key];
      return row;
    }));
    ws.getRow(1).font = { bold: true };
    ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEef3fb' } };
    await this.prisma.auditLog.create({ data: { userId, action: 'CATALOG_EXPORTED', resourceType: '采购目录', details: { filters: params, itemCount: items.length } } });
    return Buffer.from(await wb.xlsx.writeBuffer() as ArrayBuffer);
  }

  // ── 品类树 ──

  async getCategoryTree() {
    const all = await this.prisma.catalogCategory.findMany({
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      include: { attributeTemplates: { orderBy: { sortOrder: 'asc' } } },
    });
    return this.buildTree(all);
  }

  private buildTree(all: any[], parentId: number | null = null): any[] {
    return all
      .filter((c: any) => c.parentId === parentId)
      .map((c: any) => ({
        ...c,
        children: this.buildTree(all, c.id),
      }));
  }

  async getCategory(id: number) {
    const c = await this.prisma.catalogCategory.findUnique({
      where: { id },
      include: { attributeTemplates: { orderBy: { sortOrder: 'asc' } } },
    });
    if (!c) throw new BadRequestException({ error: '品类不存在', code: 'NOT_FOUND' });
    return c;
  }

  async createCategory(userId: string, dto: any) {
    const data: any = {
      name: dto.name.trim(),
      code: dto.code?.trim() || null,
      parentId: dto.parentId ?? null,
      sortOrder: dto.sortOrder ?? 0,
      isLeaf: dto.isLeaf ?? false,
      icon: dto.icon?.trim() || null,
    };
    if (data.parentId) {
      const parent = await this.prisma.catalogCategory.findUnique({ where: { id: data.parentId } });
      if (!parent) throw new BadRequestException({ error: '父节点不存在', code: 'NOT_FOUND' });
    }
    const created = await this.prisma.catalogCategory.create({ data, include: { attributeTemplates: true } });
    await this.safeAudit({ userId, action: 'CATEGORY_CREATED', resourceType: created.name, details: { categoryId: created.id, parentId: created.parentId } });
    return created;
  }

  async updateCategory(userId: string, id: number, dto: any) {
    const existing = await this.prisma.catalogCategory.findUnique({ where: { id } });
    if (!existing) throw new BadRequestException({ error: '品类不存在', code: 'NOT_FOUND' });
    const data: any = {};
    if (dto.name !== undefined) data.name = dto.name.trim();
    if (dto.code !== undefined) data.code = dto.code?.trim() || null;
    if (dto.sortOrder !== undefined) data.sortOrder = dto.sortOrder;
    if (dto.isLeaf !== undefined) data.isLeaf = dto.isLeaf;
    if (dto.icon !== undefined) data.icon = dto.icon?.trim() || null;
    const updated = await this.prisma.catalogCategory.update({ where: { id }, data, include: { attributeTemplates: true } });
    await this.safeAudit({ userId, action: 'CATEGORY_UPDATED', resourceType: updated.name, details: { categoryId: id, changedFields: Object.keys(data) } });
    return updated;
  }

  async deleteCategory(userId: string, id: number) {
    const existing = await this.prisma.catalogCategory.findUnique({
      where: { id },
      include: { children: true, catalogItems: { take: 1 }, alertRules: { take: 1 }, attributeTemplates: { include: { itemAttributes: { take: 1 } } } },
    });
    if (!existing) throw new BadRequestException({ error: '品类不存在', code: 'NOT_FOUND' });
    if (existing.children.length > 0) throw new BadRequestException({ error: '该品类下有子节点，请先删除子节点', code: 'HAS_CHILDREN' });
    if (existing.catalogItems.length > 0) throw new BadRequestException({ error: '该品类下有目录项，请先迁移目录项', code: 'HAS_ITEMS' });
    // PriceAlertRule.categoryId 外键无 onDelete，有关联时直接删会抛 Prisma 原始错误，先拦下给业务提示
    if (existing.alertRules.length > 0) throw new BadRequestException({ error: '该品类下仍有价格预警规则，请先删除', code: 'HAS_ALERT_RULES' });
    // CategoryAttributeTemplate.categoryId 为 onDelete:Cascade，但 CatalogItemAttribute.templateId 无 onDelete(默认 Restrict)：
    // 若品类下模板已被目录项属性值引用，级联删模板会撞外键 P2003 → 500，先拦下给业务提示
    if (existing.attributeTemplates.some((t: any) => t.itemAttributes?.length)) {
      throw new BadRequestException({ error: '该品类下的属性模板已被目录项引用，请先清理相关属性值', code: 'HAS_ITEM_ATTRIBUTES' });
    }
    await this.prisma.catalogCategory.delete({ where: { id } });
    await this.safeAudit({ userId, action: 'CATEGORY_DELETED', resourceType: existing.name, details: { categoryId: id } });
    return { success: true };
  }

  async moveCategory(userId: string, id: number, dto: { newSortOrder: number; newParentId?: number | null }) {
    const existing = await this.prisma.catalogCategory.findUnique({ where: { id } });
    if (!existing) throw new BadRequestException({ error: '品类不存在', code: 'NOT_FOUND' });
    if (dto.newParentId != null) {
      if (dto.newParentId === id) throw new BadRequestException({ error: '不能将节点移动到自身下', code: 'INVALID_PARENT' });
      const parent = await this.prisma.catalogCategory.findUnique({ where: { id: dto.newParentId } });
      if (!parent) throw new BadRequestException({ error: '目标父节点不存在', code: 'NOT_FOUND' });
      // 防成环：从目标父节点沿父链向上走，若走到被移节点 id，说明 newParentId 位于 id 的子树内，移动会成环
      const all = await this.prisma.catalogCategory.findMany({ select: { id: true, parentId: true } });
      const parentMap = new Map<number, number | null>(all.map((c) => [c.id, c.parentId]));
      const seen = new Set<number>();
      let cursor: number | null = dto.newParentId;
      while (cursor != null) {
        if (cursor === id) throw new BadRequestException({ error: '不能移动到自身子节点下', code: 'INVALID_PARENT' });
        if (seen.has(cursor)) break; // 防御既有脏数据导致的死循环
        seen.add(cursor);
        cursor = parentMap.get(cursor) ?? null;
      }
    }
    // 区分「显式传 newParentId=null（移到根）」与「未传 newParentId（仅排序，父节点不变）」：
    // 旧逻辑 `newParentId != null ? newParentId : existing.parentId` 会把显式 null 也当成「不变」，导致永远无法移到根
    const moveParent = 'newParentId' in dto ? dto.newParentId : existing.parentId;
    const updated = await this.prisma.catalogCategory.update({
      where: { id },
      data: { sortOrder: dto.newSortOrder, parentId: moveParent ?? null },
    });
    await this.prisma.auditLog.create({ data: { userId, action: 'CATEGORY_MOVED', resourceType: updated.name, details: { categoryId: id, fromParentId: existing.parentId, toParentId: updated.parentId, sortOrder: dto.newSortOrder } } });
    return updated;
  }

  async toggleCategoryStatus(userId: string, id: number) {
    const existing = await this.prisma.catalogCategory.findUnique({ where: { id } });
    if (!existing) throw new BadRequestException({ error: '品类不存在', code: 'NOT_FOUND' });
    const nextStatus = existing.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
    const updated = await this.prisma.catalogCategory.update({ where: { id }, data: { status: nextStatus } });
    await this.prisma.auditLog.create({ data: { userId, action: 'CATEGORY_STATUS_CHANGED', resourceType: updated.name, details: { categoryId: id, from: existing.status, to: nextStatus } } });
    return updated;
  }

  // ── 属性模板 ──

  async createAttributeTemplate(userId: string, categoryId: number, dto: any) {
    const category = await this.prisma.catalogCategory.findUnique({ where: { id: categoryId } });
    if (!category) throw new BadRequestException({ error: '品类不存在', code: 'NOT_FOUND' });
    const data = {
      categoryId, name: dto.name.trim(), fieldKey: dto.fieldKey.trim(),
      fieldType: dto.fieldType, required: dto.required ?? false,
      options: dto.options ?? null, unit: dto.unit?.trim() || null, sortOrder: dto.sortOrder ?? 0,
    };
    const created = await this.prisma.categoryAttributeTemplate.create({ data });
    await this.prisma.auditLog.create({ data: { userId, action: 'ATTR_TEMPLATE_CREATED', resourceType: `${category.name}/${created.name}`, details: { categoryId, templateId: created.id, fieldKey: created.fieldKey } } });
    return created;
  }

  async updateAttributeTemplate(userId: string, id: number, dto: any) {
    const existing = await this.prisma.categoryAttributeTemplate.findUnique({ where: { id } });
    if (!existing) throw new BadRequestException({ error: '属性模板不存在', code: 'NOT_FOUND' });
    const data: any = {};
    if (dto.name !== undefined) data.name = dto.name.trim();
    if (dto.fieldType !== undefined) data.fieldType = dto.fieldType;
    if (dto.required !== undefined) data.required = dto.required;
    if (dto.options !== undefined) data.options = dto.options;
    if (dto.unit !== undefined) data.unit = dto.unit?.trim() || null;
    if (dto.sortOrder !== undefined) data.sortOrder = dto.sortOrder;
    return this.prisma.categoryAttributeTemplate.update({ where: { id }, data });
  }

  async deleteAttributeTemplate(userId: string, id: number) {
    const existing = await this.prisma.categoryAttributeTemplate.findUnique({
      where: { id },
      include: { itemAttributes: { take: 1 } },
    });
    if (!existing) throw new BadRequestException({ error: '属性模板不存在', code: 'NOT_FOUND' });
    // CatalogItemAttribute.templateId 外键无 onDelete，被目录项引用时直接删会抛 Prisma 原始错误，先拦下给业务提示
    if (existing.itemAttributes.length > 0) throw new BadRequestException({ error: '该属性模板已被目录项使用，请先移除相关属性值', code: 'HAS_ITEM_ATTRIBUTES' });
    await this.prisma.categoryAttributeTemplate.delete({ where: { id } });
    await this.safeAudit({ userId, action: 'ATTR_TEMPLATE_DELETED', resourceType: existing.name, details: { templateId: id, fieldKey: existing.fieldKey } });
    return { success: true };
  }

  async setItemAttributes(itemId: string, attributes: { templateId: number; value: string }[]) {
    const item = await this.prisma.catalogItem.findUnique({ where: { id: itemId } });
    if (!item) throw new BadRequestException({ error: '目录项不存在', code: 'NOT_FOUND' });
    await this.prisma.$transaction(async (tx: any) => {
      for (const attr of attributes) {
        await tx.catalogItemAttribute.upsert({
          where: { catalogItemId_templateId: { catalogItemId: itemId, templateId: attr.templateId } },
          create: { catalogItemId: itemId, templateId: attr.templateId, value: attr.value },
          update: { value: attr.value },
        });
      }
    });
    return this.get(itemId);
  }

  // ─── 供应商目录供货申请（管理员审核）───

  private serializeApplication(a: any) {
    return {
      ...a,
      quotedPrice: a.quotedPrice != null ? Number(a.quotedPrice) : null,
      counterPrice: a.counterPrice != null ? Number(a.counterPrice) : null,
      approvedReferencePrice: a.approvedReferencePrice != null ? Number(a.approvedReferencePrice) : null,
      approvedPriceMin: a.approvedPriceMin != null ? Number(a.approvedPriceMin) : null,
      approvedPriceMax: a.approvedPriceMax != null ? Number(a.approvedPriceMax) : null,
    };
  }

  async listApplications(params: { status?: string; type?: string }) {
    const where: any = {};
    if (params.status && params.status !== '全部') where.status = params.status;
    if (params.type && params.type !== '全部') where.type = params.type;
    const rows = await this.prisma.supplierCatalogApplication.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      include: {
        supplier: { select: { id: true, name: true, userId: true, status: true } },
        catalogItem: { select: { id: true, code: true, name: true, specification: true, category: true, group: true, unit: true } },
      },
    });
    return rows.map(a => this.serializeApplication(a));
  }

  async getApplication(id: string) {
    const a = await this.prisma.supplierCatalogApplication.findUnique({
      where: { id },
      include: {
        supplier: { select: { id: true, name: true, userId: true, status: true } },
        catalogItem: { select: { id: true, code: true, name: true, specification: true, category: true, group: true, unit: true } },
      },
    });
    if (!a) throw new BadRequestException({ error: '申请不存在', code: 'NOT_FOUND' });
    return this.serializeApplication(a);
  }

  /**
   * 管理员审核。action: approve | reject | return | counter
   * - approve: 通过并建立供货关系（NEW_ITEM 需 referencePrice + 可选 code）
   * - reject/return: 需 reason
   * - counter: 需 counterPrice（议价）
   */
  async reviewApplication(
    adminUserId: string,
    applicationId: string,
    body: {
      action: 'approve' | 'reject' | 'return' | 'counter';
      reason?: string;
      counterPrice?: string | number;
      counterNote?: string;
      finalPrice?: string | number;        // 通过时可覆盖最终报价
      referencePrice?: string | number;    // NEW_ITEM 通过必填：官方参考价
      priceMin?: string | number;
      priceMax?: string | number;
      validUntil?: string;
      code?: string;                        // NEW_ITEM 新目录编码（可选，缺省自动生成）
      categoryId?: string | number;         // NEW_ITEM 挂载到真实品类树节点（可选）
      reviewerNote?: string;
    },
  ) {
    const app = await this.prisma.supplierCatalogApplication.findUnique({
      where: { id: applicationId },
      include: { supplier: { select: { id: true, name: true, userId: true } } },
    });
    if (!app) throw new BadRequestException({ error: '申请不存在', code: 'NOT_FOUND' });
    if (app.status !== 'PENDING') {
      throw new BadRequestException({ error: '该申请不在待审核状态', code: 'INVALID_STATUS' });
    }

    const action = body.action;
    const now = new Date();

    // 审核员既已处理该申请，清掉 :3005 工作台对应待办（link 与 notifyReviewer 全等）。
    await this.resolveCatalogReviewerTodo(applicationId);

    // ── REJECT ──
    if (action === 'reject') {
      if (!body.reason?.trim()) throw new BadRequestException({ error: '请填写拒绝理由', code: 'MISSING_REASON' });
      const updated = await this.prisma.supplierCatalogApplication.update({
        where: { id: applicationId },
        data: { status: 'REJECTED', reviewedBy: adminUserId, reviewedAt: now, rejectReason: body.reason.trim(), reviewerNote: body.reviewerNote?.trim() || null },
      });
      await this.notify(app.supplier.userId, '供货申请未通过', `您的供货申请（${this.appTitle(app)}）未通过审核：${body.reason.trim()}`, '/catalog-applications');
      await this.prisma.auditLog.create({ data: { userId: adminUserId, action: 'CATALOG_APPLICATION_REJECTED', resourceType: this.appTitle(app), details: { applicationId, reason: body.reason.trim() } } });
      return this.serializeApplication(updated);
    }

    // ── RETURN ──
    if (action === 'return') {
      if (!body.reason?.trim()) throw new BadRequestException({ error: '请填写退回说明', code: 'MISSING_REASON' });
      const updated = await this.prisma.supplierCatalogApplication.update({
        where: { id: applicationId },
        data: { status: 'RETURNED', reviewedBy: adminUserId, reviewedAt: now, rejectReason: body.reason.trim(), reviewerNote: body.reviewerNote?.trim() || null },
      });
      await this.notify(app.supplier.userId, '供货申请已退回补正', `您的供货申请（${this.appTitle(app)}）需补正：${body.reason.trim()}`, '/catalog-applications');
      await this.prisma.auditLog.create({ data: { userId: adminUserId, action: 'CATALOG_APPLICATION_RETURNED', resourceType: this.appTitle(app), details: { applicationId, reason: body.reason.trim() } } });
      return this.serializeApplication(updated);
    }

    // ── COUNTER（议价）──
    if (action === 'counter') {
      const cp = Number(body.counterPrice);
      if (!body.counterPrice || cp <= 0) throw new BadRequestException({ error: '请填写有效议价反报价', code: 'MISSING_COUNTER_PRICE' });
      const updated = await this.prisma.supplierCatalogApplication.update({
        where: { id: applicationId },
        data: { status: 'COUNTERED', counterPrice: cp, counterNote: body.counterNote?.trim() || null, reviewedBy: adminUserId, reviewedAt: now, reviewerNote: body.reviewerNote?.trim() || null },
      });
      await this.notify(app.supplier.userId, '供货申请进入议价', `管理员对您的申请（${this.appTitle(app)}）提出反报价 ¥${cp}，请在门户确认或再报价。`, '/catalog-applications');
      await this.prisma.auditLog.create({ data: { userId: adminUserId, action: 'CATALOG_APPLICATION_COUNTERED', resourceType: this.appTitle(app), details: { applicationId, counterPrice: cp } } });
      return this.serializeApplication(updated);
    }

    // ── APPROVE ──
    if (action !== 'approve') {
      throw new BadRequestException({ error: '未知的审核动作', code: 'INVALID_ACTION' });
    }

    const finalPrice = body.finalPrice != null ? Number(body.finalPrice) : Number(app.quotedPrice);
    if (!(finalPrice > 0)) throw new BadRequestException({ error: '最终报价无效', code: 'INVALID_FINAL_PRICE' });

    // 占坑 + 建档同事务：条件 updateMany(PENDING→REVIEWING) 对被审行加行锁，串行化对同一申请的并发审核；
    // affected=0 说明已被处理。事务回滚时占坑一并回滚，不会残留 REVIEWING 中间态。
    const runApprove = () => this.prisma.$transaction(async (tx) => {
      const claimed = await tx.supplierCatalogApplication.updateMany({
        where: { id: applicationId, status: 'PENDING' },
        data: { status: 'REVIEWING' },
      });
      if (claimed.count === 0) throw new ConflictException('该申请已被处理');

      let catalogItemId = app.catalogItemId;

      // NEW_ITEM：先建 CatalogItem（管理员设定官方参考价，decision #2）
      if (app.type === 'NEW_ITEM') {
        const ref = Number(body.referencePrice);
        if (!body.referencePrice || !(ref > 0)) {
          throw new BadRequestException({ error: '新增品类通过时需填写官方参考价', code: 'MISSING_REFERENCE_PRICE' });
        }
        const code = (body.code?.trim()) || await this.genCatalogCode(tx, app.proposedGroup || '新增');
        const created = await tx.catalogItem.create({
          data: {
            code,
            name: app.proposedName!,
            specification: app.proposedSpec || '',
            category: app.proposedCategory!,
            group: app.proposedGroup!,
            categoryId: body.categoryId != null ? Number(body.categoryId) : null,
            unit: app.proposedUnit!,
            referencePrice: ref,
            priceMin: body.priceMin != null ? Number(body.priceMin) : ref,
            priceMax: body.priceMax != null ? Number(body.priceMax) : ref,
            lastDealPrice: ref,
            averagePrice: ref,
            changeRate: 0,
            supplier: '',
            supplierType: '入库供应商',
            priceSource: '市场询价',
            region: app.region || '全省',
            taxIncluded: app.taxIncluded,
            freightIncluded: app.freightIncluded,
            minOrder: app.minOrder || '',
            remark: '由供应商新增品类申请审核通过纳入',
            status: '有效',
            validUntil: body.validUntil ? new Date(body.validUntil) : null,
          },
        });
        catalogItemId = created.id;
      }

      // 建立供货关系（JOIN_EXISTING / NEW_ITEM 新建关系；UPDATE_QUOTE 更新现有关系）
      if (app.type === 'UPDATE_QUOTE') {
        await tx.catalogSupplier.update({
          where: { catalogItemId_supplierId: { catalogItemId: catalogItemId!, supplierId: app.supplierId } },
          data: {
            quotedPrice: finalPrice,
            deliveryPeriod: app.deliveryPeriod,
            region: app.region,
            minOrder: app.minOrder,
            taxIncluded: app.taxIncluded,
            freightIncluded: app.freightIncluded,
          },
        });
      } else {
        await tx.catalogSupplier.upsert({
          where: { catalogItemId_supplierId: { catalogItemId: catalogItemId!, supplierId: app.supplierId } },
          create: {
            catalogItemId: catalogItemId!,
            supplierId: app.supplierId,
            quotedPrice: finalPrice,
            deliveryPeriod: app.deliveryPeriod,
            region: app.region,
            minOrder: app.minOrder,
            taxIncluded: app.taxIncluded,
            freightIncluded: app.freightIncluded,
            status: 'ACTIVE',
            sourceApplicationId: applicationId,
          },
          update: { quotedPrice: finalPrice, status: 'ACTIVE' },
        });
      }

      const updated = await tx.supplierCatalogApplication.update({
        where: { id: applicationId },
        data: {
          status: 'APPROVED',
          reviewedBy: adminUserId,
          reviewedAt: now,
          catalogItemId,
          reviewerNote: body.reviewerNote?.trim() || null,
          approvedReferencePrice: app.type === 'NEW_ITEM' ? Number(body.referencePrice) : null,
          approvedPriceMin: app.type === 'NEW_ITEM' ? (body.priceMin != null ? Number(body.priceMin) : Number(body.referencePrice)) : null,
          approvedPriceMax: app.type === 'NEW_ITEM' ? (body.priceMax != null ? Number(body.priceMax) : Number(body.referencePrice)) : null,
          approvedValidUntil: app.type === 'NEW_ITEM' && body.validUntil ? new Date(body.validUntil) : null,
        },
      });

      return this.serializeApplication(updated);
    });

    const finalize = async (result: any) => {
      // 事务外发通知 + 审计（审计失败降级，不阻断主业务）
      await this.notify(app.supplier.userId, '供货申请已通过', `您的供货申请（${this.appTitle(app)}）已通过审核，最终报价 ¥${Number(result.quotedPrice)}。`, '/catalog-applications');
      await this.safeAudit({ userId: adminUserId, action: 'CATALOG_APPLICATION_APPROVED', resourceType: this.appTitle(app), details: { applicationId, type: app.type, finalPrice: Number(result.quotedPrice) } });
      return result;
    };

    try {
      return await finalize(await runApprove());
    } catch (err: any) {
      // genCatalogCode 依赖 count+1，并发下两个 NEW_ITEM 建档可能撞 code @unique（P2002）；重试一次（回滚后占坑复位 PENDING，count 重取）
      if (err?.code === 'P2002') {
        return await finalize(await runApprove());
      }
      throw err;
    }
  }

  /** 管理员查看某目录条目的准入供应商（含报价）。 */
  async listItemSuppliers(itemId: string) {
    const item = await this.prisma.catalogItem.findUnique({ where: { id: itemId } });
    if (!item) throw new BadRequestException({ error: '目录条目不存在', code: 'NOT_FOUND' });
    const rows = await this.prisma.catalogSupplier.findMany({
      where: { catalogItemId: itemId },
      orderBy: [{ status: 'asc' }, { quotedPrice: 'asc' }],
      include: { supplier: { select: { id: true, name: true, status: true } } },
    });
    return rows.map(r => ({ ...r, quotedPrice: Number(r.quotedPrice) }));
  }

  // ── 价格预警 ──

  async listAlertRules() { return this.prisma.priceAlertRule.findMany({ orderBy: { createdAt: 'desc' }, include: { category: { select: { id: true, name: true } } } }); }
  async createAlertRule(dto: any) { return this.prisma.priceAlertRule.create({ data: { name: dto.name.trim(), categoryId: dto.categoryId ?? null, alertType: dto.alertType, threshold: dto.threshold, enabled: dto.enabled ?? true, notifyRoles: dto.notifyRoles ?? ['admin', 'leader', 'staff'] } }); }
  async updateAlertRule(id: number, dto: any) { const data: any = {}; if (dto.name) data.name = dto.name.trim(); if (dto.alertType) data.alertType = dto.alertType; if (dto.threshold !== undefined) data.threshold = dto.threshold; if (dto.enabled !== undefined) data.enabled = dto.enabled; if (dto.notifyRoles) data.notifyRoles = dto.notifyRoles; return this.prisma.priceAlertRule.update({ where: { id }, data }); }
  async deleteAlertRule(id: number) { await this.prisma.priceAlertRule.delete({ where: { id } }); return { success: true }; }
  async toggleAlertRule(id: number) { const r = await this.prisma.priceAlertRule.findUnique({ where: { id } }); if (!r) throw new BadRequestException({ error: '规则不存在', code: 'NOT_FOUND' }); return this.prisma.priceAlertRule.update({ where: { id }, data: { enabled: !r.enabled } }); }
  async listAlerts(params: { isRead?: boolean; isResolved?: boolean }) { const where: any = {}; if (params.isRead !== undefined) where.isRead = params.isRead; if (params.isResolved !== undefined) where.isResolved = params.isResolved; return this.prisma.priceAlert.findMany({ where, orderBy: { createdAt: 'desc' }, take: 100, include: { catalogItem: { select: { id: true, code: true, name: true } }, rule: { select: { id: true, name: true } } } }); }
  async markAlertRead(id: number) { return this.prisma.priceAlert.update({ where: { id }, data: { isRead: true } }); }
  async markAlertResolved(id: number) { return this.prisma.priceAlert.update({ where: { id }, data: { isResolved: true } }); }

  // ── 预警生成引擎 ──
  // 此前仅有规则 CRUD + 前端处置 UI，没有任何产出 PriceAlert 的生产者 → 「预警记录」恒空。
  // 本方法按启用的 PriceAlertRule 周期评估目录项并产出记录：
  //   EXPIRING    : threshold=天数，validUntil 距今 ≤ threshold 天（且未过期）触发
  //   PRICE_SURGE : threshold=百分比，最近成交价较历史均价上涨 ≥ threshold% 触发
  //   PRICE_DROP  : threshold=百分比，最近成交价较历史均价下跌 ≥ threshold% 触发
  //   DEVIATION   : threshold=百分比，参考价偏离同品类（有效项）均价 ≥ threshold% 触发
  // 规则带 categoryId 时仅评估该品类，否则评估全部有效目录项。
  // 幂等去重：同一 (ruleId, catalogItemId) 已存在未解决告警则跳过，避免每轮刷屏。
  // 手动触发见控制器 POST admin/alerts/evaluate（便于验证与按需生成）。
  @Cron('0 25 * * * *')
  async evaluateAlertRules(): Promise<{ scanned: number; created: number }> {
    const [rules, items] = await Promise.all([
      this.prisma.priceAlertRule.findMany({ where: { enabled: true } }),
      this.prisma.catalogItem.findMany({
        where: { status: { notIn: ['下架', '停用'] } },
        select: { id: true, code: true, name: true, categoryId: true, referencePrice: true, lastDealPrice: true, averagePrice: true, validUntil: true },
      }),
    ]);
    if (rules.length === 0) return { scanned: items.length, created: 0 };

    // 各品类（有效项）参考价均值，供 DEVIATION 使用
    const meanByCat = new Map<number, number>();
    {
      const sumByCat = new Map<number, { sum: number; n: number }>();
      for (const it of items) {
        if (it.categoryId == null) continue;
        const p = Number(it.referencePrice);
        if (!(p > 0)) continue;
        const e = sumByCat.get(it.categoryId) ?? { sum: 0, n: 0 };
        e.sum += p; e.n += 1; sumByCat.set(it.categoryId, e);
      }
      for (const [cat, e] of sumByCat) meanByCat.set(cat, e.n ? e.sum / e.n : 0);
    }

    const now = Date.now();
    const candidates: { ruleId: number; catalogItemId: string; alertType: string; message: string; triggerValue: number }[] = [];
    for (const rule of rules) {
      const scoped = rule.categoryId != null ? items.filter(i => i.categoryId === rule.categoryId) : items;
      for (const it of scoped) {
        let hit: { message: string; triggerValue: number } | null = null;
        if (rule.alertType === 'EXPIRING') {
          if (!it.validUntil) continue;
          const days = Math.ceil((new Date(it.validUntil).getTime() - now) / 86400000);
          if (days >= 0 && days <= rule.threshold) hit = { message: `${it.name}（${it.code}）将于 ${days} 天后到期`, triggerValue: days };
        } else if (rule.alertType === 'PRICE_SURGE' || rule.alertType === 'PRICE_DROP') {
          const last = Number(it.lastDealPrice); const avg = Number(it.averagePrice);
          if (!(avg > 0) || !(last > 0)) continue;
          const pct = ((last - avg) / avg) * 100;
          if (rule.alertType === 'PRICE_SURGE' && pct >= rule.threshold) {
            hit = { message: `${it.name}（${it.code}）最近成交价较历史均价上涨 ${pct.toFixed(1)}%`, triggerValue: Math.round(pct * 100) / 100 };
          } else if (rule.alertType === 'PRICE_DROP' && pct <= -rule.threshold) {
            hit = { message: `${it.name}（${it.code}）最近成交价较历史均价下跌 ${Math.abs(pct).toFixed(1)}%`, triggerValue: Math.round(pct * 100) / 100 };
          }
        } else if (rule.alertType === 'DEVIATION') {
          const p = Number(it.referencePrice);
          if (it.categoryId == null || !(p > 0)) continue;
          const mean = meanByCat.get(it.categoryId) ?? 0;
          if (!(mean > 0)) continue;
          const dev = (Math.abs(p - mean) / mean) * 100;
          if (dev >= rule.threshold) hit = { message: `${it.name}（${it.code}）参考价偏离同品类均价 ${dev.toFixed(1)}%`, triggerValue: Math.round(dev * 100) / 100 };
        }
        if (hit) candidates.push({ ruleId: rule.id, catalogItemId: it.id, alertType: rule.alertType, message: hit.message, triggerValue: hit.triggerValue });
      }
    }

    let created = 0;
    const newAlerts: { message: string }[] = [];
    const notifyRoleSet = new Set<string>();
    for (const c of candidates) {
      const exists = await this.prisma.priceAlert.findFirst({ where: { ruleId: c.ruleId, catalogItemId: c.catalogItemId, isResolved: false } });
      if (exists) continue;
      try {
        const saved = await this.prisma.priceAlert.create({ data: c });
        created += 1;
        newAlerts.push({ message: saved.message });
      } catch (e: any) {
        // 并发进程已建（唯一索引冲突 P2002）→ skip，不重复计入、不重复通知
        if (e?.code === 'P2002') continue;
        throw e;
      }
      const rule = rules.find(r => r.id === c.ruleId);
      const roles = rule?.notifyRoles?.length ? rule.notifyRoles : ['admin', 'leader'];
      roles.forEach((r) => notifyRoleSet.add(r));
    }
    // 聚合通知：一次评估只发一条（按角色，content 含多条预警明细），避免 N×M 通知洪水
    if (newAlerts.length > 0) {
      await this.notifyAlertRolesAggregated([...notifyRoleSet], newAlerts);
    }
    return { scanned: items.length, created };
  }

  /** 按角色向活跃用户发聚合预警站内信（一次评估一条，含多条明细）；失败不阻塞预警记录 */
  private async notifyAlertRolesAggregated(roles: string[], alerts: { message: string }[]) {
    try {
      const users = await this.prisma.user.findMany({ where: { role: { in: roles }, isActive: true }, select: { id: true } });
      const lines = alerts.slice(0, 5).map((a) => `· ${a.message}`).join('\n');
      const more = alerts.length > 5 ? `\n…等 ${alerts.length} 项` : '';
      const content = `本次评估新增 ${alerts.length} 项预警：\n${lines}${more}`;
      for (const u of users) {
        await this.notification.create({
          userId: u.id,
          type: 'CATALOG_PRICE_ALERT',
          title: `目录价格预警 · ${alerts.length} 项待处理`,
          content,
          link: '/mall-management/catalog?tab=alerts',
        });
      }
    } catch { /* 通知失败不阻塞预警记录 */ }
  }

  // ── 目录版本 ──

  async listVersions() { return this.prisma.catalogVersion.findMany({ orderBy: { createdAt: 'desc' }, include: { user: { select: { username: true, displayName: true } } } }); }

  async createVersion(userId: string, dto: { name: string; version: string; effectiveAt: string; description?: string }) {
    const items = await this.prisma.catalogItem.findMany({ orderBy: { code: 'asc' }, include: { categoryRel: true } });
    const categories = await this.prisma.catalogCategory.findMany();
    const snapshot = { items: items.map((i: any) => ({ id: i.id, code: i.code, name: i.name, referencePrice: Number(i.referencePrice), status: i.status, categoryId: i.categoryId })), categories, capturedAt: new Date().toISOString() };
    return this.prisma.catalogVersion.create({ data: { name: dto.name.trim(), version: dto.version.trim(), effectiveAt: new Date(dto.effectiveAt), description: dto.description?.trim() || null, snapshot, createdBy: userId } });
  }

  async getVersion(id: number) { const v = await this.prisma.catalogVersion.findUnique({ where: { id }, include: { user: { select: { username: true, displayName: true } } } }); if (!v) throw new BadRequestException({ error: '版本不存在', code: 'NOT_FOUND' }); return v; }

  async changeVersionStatus(id: number, status: string) {
    // 同一时刻只允许一个 ACTIVE：生效前先把其他 ACTIVE 转 ARCHIVED（事务原子，避免双生效/回滚残留）
    return this.prisma.$transaction(async (tx) => {
      if (status === 'ACTIVE') {
        await tx.catalogVersion.updateMany({ where: { status: 'ACTIVE', NOT: { id } }, data: { status: 'ARCHIVED' } });
      }
      return tx.catalogVersion.update({ where: { id }, data: { status } });
    });
  }

  async compareVersions(idA: number, idB: number) {
    const [a, b] = await Promise.all([this.getVersion(idA), this.getVersion(idB)]);
    const itemsA: any[] = (a.snapshot as any).items || [];
    const itemsB: any[] = (b.snapshot as any).items || [];
    const mapA = new Map(itemsA.map((i: any) => [i.code, i]));
    const mapB = new Map(itemsB.map((i: any) => [i.code, i]));
    const added = itemsB.filter((i: any) => !mapA.has(i.code));
    const removed = itemsA.filter((i: any) => !mapB.has(i.code));
    const priceChanges = itemsB.filter((i: any) => { const o = mapA.get(i.code); return o && o.referencePrice !== i.referencePrice; }).map((i: any) => ({ ...i, oldPrice: mapA.get(i.code).referencePrice }));
    return { versionA: a.name, versionB: b.name, added, removed, priceChanges };
  }

  // ── 询价 ──

  async listInquiries() { return this.prisma.catalogInquiry.findMany({ orderBy: { createdAt: 'desc' }, include: { user: { select: { username: true, displayName: true } } } }); }

  async createInquiry(userId: string, dto: any) { return this.prisma.catalogInquiry.create({ data: { title: dto.title.trim(), items: dto.items, supplierIds: dto.supplierIds, deadlineAt: dto.deadlineAt ? new Date(dto.deadlineAt) : null, notes: dto.notes?.trim() || null, createdBy: userId } }); }

  // ── 合同价格 ──

  async listContractPrices(params: { catalogItemId?: string; supplierId?: string }) {
    const where: any = {};
    if (params.catalogItemId) where.catalogItemId = params.catalogItemId;
    if (params.supplierId) where.supplierId = params.supplierId;
    return this.prisma.contractPrice.findMany({ where, orderBy: { createdAt: 'desc' }, include: { catalogItem: { select: { id: true, code: true, name: true } }, supplier: { select: { id: true, name: true } } } });
  }

  async createContractPrice(dto: any) { return this.prisma.contractPrice.create({ data: { catalogItemId: dto.catalogItemId, supplierId: dto.supplierId, contractNo: dto.contractNo.trim(), agreedPrice: dto.agreedPrice, validFrom: new Date(dto.validFrom), validUntil: new Date(dto.validUntil) } }); }

  async updateContractPrice(id: number, dto: any) { const data: any = {}; if (dto.agreedPrice !== undefined) data.agreedPrice = dto.agreedPrice; if (dto.validUntil) data.validUntil = new Date(dto.validUntil); if (dto.status) data.status = dto.status; return this.prisma.contractPrice.update({ where: { id }, data }); }

  // ── 供应商维度 ──

  async supplierCoverage() {
    const items = await this.prisma.catalogItem.findMany({ where: { categoryId: { not: null } }, select: { categoryId: true, supplier: true, categoryRel: { select: { id: true, name: true } } } });
    const map = new Map<string, { supplier: string; categoryIds: Set<number>; categoryNames: string[] }>();
    for (const it of items) {
      if (!it.supplier) continue;
      let e = map.get(it.supplier);
      if (!e) { e = { supplier: it.supplier, categoryIds: new Set(), categoryNames: [] }; map.set(it.supplier, e); }
      if (it.categoryId) { e.categoryIds.add(it.categoryId); if (it.categoryRel) e.categoryNames.push(it.categoryRel.name); }
    }
    return Array.from(map.values()).map(e => ({ supplier: e.supplier, categoryCount: e.categoryIds.size, categories: [...new Set(e.categoryNames)] })).sort((a, b) => b.categoryCount - a.categoryCount);
  }

  async supplierPriceComparison(categoryId?: number) {
    const where: any = {};
    if (categoryId) where.categoryId = categoryId;
    const items = await this.prisma.catalogItem.findMany({ where, select: { id: true, code: true, name: true, referencePrice: true, supplier: true, categoryId: true } });
    const map = new Map<string, { supplier: string; items: any[]; avgPrice: number }>();
    for (const it of items) {
      if (!it.supplier) continue;
      let e = map.get(it.supplier);
      if (!e) { e = { supplier: it.supplier, items: [], avgPrice: 0 }; map.set(it.supplier, e); }
      e.items.push({ code: it.code, name: it.name, price: Number(it.referencePrice) });
    }
    for (const e of map.values()) { e.avgPrice = e.items.length ? Math.round(e.items.reduce((s: number, i: any) => s + i.price, 0) / e.items.length * 100) / 100 : 0; }
    return Array.from(map.values()).sort((a, b) => b.items.length - a.items.length);
  }

  // ── 目录项关联 ──

  async listItemRelations(itemId: string, viewerRole?: string) {
    const rows = await this.prisma.catalogItemRelation.findMany({ where: { catalogItemId: itemId }, include: { relatedItem: { select: { id: true, code: true, name: true, referencePrice: true } } } });
    // supplier 不得经关联关系侧信道拿到关联条目参考价（主列表/详情已脱敏，关联端点同样收口）
    if (viewerRole === 'supplier') {
      return rows.map((r: any) => ({ ...r, relatedItem: r.relatedItem ? { id: r.relatedItem.id, code: r.relatedItem.code, name: r.relatedItem.name } : r.relatedItem }));
    }
    return rows;
  }

  async createItemRelation(userId: string, itemId: string, dto: { relatedItemId: string; relationType: string }) {
    return this.prisma.catalogItemRelation.create({ data: { catalogItemId: itemId, relatedItemId: dto.relatedItemId, relationType: dto.relationType }, include: { relatedItem: { select: { id: true, code: true, name: true, referencePrice: true } } } });
  }

  async deleteItemRelation(id: number) { await this.prisma.catalogItemRelation.delete({ where: { id } }); return { success: true }; }

  // ── 仪表盘聚合 ──

  async dashboardStats() {
    const [total, active, priceSurge, expiring, inactive, categoryCount] = await Promise.all([
      this.prisma.catalogItem.count(),
      this.prisma.catalogItem.count({ where: { status: '有效' } }),
      this.prisma.catalogItem.count({ where: { status: '价格波动' } }),
      this.prisma.catalogItem.count({ where: { status: '即将过期' } }),
      this.prisma.catalogItem.count({ where: { status: { in: ['下架', '停用'] } } }),
      this.prisma.catalogCategory.count({ where: { isLeaf: true, status: 'ACTIVE' } }),
    ]);
    const healthScore = total > 0 ? Math.round((active / total) * 100 - (priceSurge + expiring) * 2) : 0;
    const categoryGapCount = await this.prisma.catalogCategory.count({ where: { isLeaf: true, status: 'ACTIVE', catalogItems: { none: {} } } });
    return { total, active, priceSurge, expiring, inactive, healthScore: Math.max(0, healthScore), categoryGapCount, categoryCount };
  }

  // ── 附件上传 ──

  async createAttachment(itemId: string, fileName: string, fileUrl: string, fileType: string, fileSize: number) {
    return this.prisma.catalogItemAttachment.create({ data: { catalogItemId: itemId, fileName, fileUrl, fileType, fileSize } });
  }

  async listAttachments(itemId: string) {
    return this.prisma.catalogItemAttachment.findMany({ where: { catalogItemId: itemId }, orderBy: { uploadedAt: 'desc' } });
  }

  async deleteAttachment(id: string) { await this.prisma.catalogItemAttachment.delete({ where: { id } }); return { success: true }; }

  // ── 搜索日志 + 洞察 ──

  async logSearch(keyword: string, userId?: string) {
    return this.prisma.catalogSearchLog.create({ data: { keyword: keyword.trim(), userId: userId || null } });
  }

  async searchInsights() {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000);
    const logs = await this.prisma.catalogSearchLog.findMany({ where: { createdAt: { gte: thirtyDaysAgo } }, select: { keyword: true } });
    const freq: Record<string, number> = {};
    for (const l of logs) { freq[l.keyword] = (freq[l.keyword] || 0) + 1; }
    // Find keywords that yielded no results — checked against catalog codes/names
    const items = await this.prisma.catalogItem.findMany({ select: { code: true, name: true } });
    const allNames = new Set(items.map(i => i.name.toLowerCase()));
    const gaps = Object.entries(freq).filter(([kw]) => !allNames.has(kw.toLowerCase()) && ![...allNames].some(n => n.includes(kw.toLowerCase()))).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([keyword, count]) => ({ keyword, count }));
    const topSearches = Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([keyword, count]) => ({ keyword, count }));
    return { gapKeywords: gaps, topSearches };
  }

  // ── 价格预测 ──

  async pricePrediction(itemId: string) {
    const history = await this.prisma.priceHistory.findMany({ where: { catalogItemId: itemId }, orderBy: { recordedAt: 'asc' }, select: { recordedAt: true, price: true } });
    if (history.length < 3) return { prediction: null, opportunity: null, trend: 'insufficient_data' };
    // Simple linear regression
    const n = history.length;
    const xValues = history.map((_, i) => i);
    const yValues = history.map(h => Number(h.price));
    const meanX = xValues.reduce((a, b) => a + b, 0) / n;
    const meanY = yValues.reduce((a, b) => a + b, 0) / n;
    let num = 0, den = 0;
    for (let i = 0; i < n; i++) { num += (xValues[i] - meanX) * (yValues[i] - meanY); den += (xValues[i] - meanX) ** 2; }
    const slope = den ? num / den : 0;
    const predictions: { month: number; price: number }[] = [];
    for (let i = 0; i < 6; i++) { const p = n + i; predictions.push({ month: p, price: Math.round((meanY + slope * (p - meanX)) * 100) / 100 }); }
    const lastPrice = yValues[n - 1];
    const predPrice = predictions[predictions.length - 1]?.price || lastPrice;
    const trend = slope > 0.01 ? 'up' : slope < -0.01 ? 'down' : 'stable';
    const isLow = lastPrice < meanY * 0.9;
    // 文案与实际计算对齐：isLow 判定基于「全历史均价 meanY」（非「近12个月低位」），故措辞改为历史均价口径
    return { predictions, opportunity: isLow ? '当前价格低于历史均价，可关注采购时机' : null, trend, lastPrice, meanPrice: Math.round(meanY * 100) / 100 };
  }

  // ── 订阅 ──

  async subscribe(userId: string, itemId: string) {
    await this.prisma.catalogSubscription.upsert({ where: { userId_catalogItemId: { userId, catalogItemId: itemId } }, create: { userId, catalogItemId: itemId }, update: {} });
    return { subscribed: true };
  }

  async unsubscribe(userId: string, itemId: string) {
    await this.prisma.catalogSubscription.deleteMany({ where: { userId, catalogItemId: itemId } });
    return { subscribed: false };
  }

  async listSubscriptions(userId: string) {
    return this.prisma.catalogSubscription.findMany({ where: { userId }, include: { catalogItem: { select: { id: true, code: true, name: true, referencePrice: true, status: true } } }, orderBy: { createdAt: 'desc' } });
  }

  // ── 比价雷达 ──

  async priceRadar(categoryId?: number) {
    const where: any = categoryId ? { categoryId } : {};
    const items = await this.prisma.catalogItem.findMany({ where, select: { id: true, code: true, name: true, referencePrice: true, supplier: true, categoryId: true, status: true } });
    const prices = items.filter(i => i.status === '有效' && i.supplier).map(i => Number(i.referencePrice));
    if (prices.length === 0) return { minPrice: null, avgPrice: null, outliers: [], items: [] };
    const mean = prices.reduce((a, b) => a + b, 0) / prices.length;
    const std = Math.sqrt(prices.map(p => (p - mean) ** 2).reduce((a, b) => a + b, 0) / prices.length);
    const minPrice = Math.min(...prices);
    const threshold = mean + 2 * std;
    const result = items.filter(i => i.status === '有效' && i.supplier).map(i => ({ ...i, referencePrice: Number(i.referencePrice), isLowest: Number(i.referencePrice) === minPrice, isOutlier: Number(i.referencePrice) > threshold }));
    return { minPrice, avgPrice: Math.round(mean * 100) / 100, stdDeviation: Math.round(std * 100) / 100, outliers: result.filter(i => i.isOutlier), items: result };
  }

  // ── AI：自动分类 + 属性预填 / 价格异常研判 ──
  // 治理：100% 走 LlmService / EmbeddingService / LlmOutputValidator（@Global LocalAiModule 注入）。
  //       所有 AI 调用包 try/catch，缺密钥 / LLM 挂 → 优雅降级（对应字段 null + backedByData:false），绝不抛 500。
  //       幻觉防护：categoryId 经 validateEnum 约束到真实叶子 id；属性值按模板 fieldKey/fieldType 经 validateObject/validateEnum 校验。
  //       这些端点只「返回建议」给前端，不写库。

  /** 余弦相似度 dot/(||a||·||b||)；维度不匹配或零向量返回 0。不引依赖。 */
  private cosineSimilarity(a: number[], b: number[]): number {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length === 0 || a.length !== b.length) return 0;
    let dot = 0, normA = 0, normB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    if (normA === 0 || normB === 0) return 0;
    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  /** 从品类树 flatten 出叶子节点（isLeaf===true 或 无 children）。 */
  private flattenLeaves(tree: any[]): { id: number; name: string; code: string | null; path: string }[] {
    const leaves: { id: number; name: string; code: string | null; path: string }[] = [];
    const walk = (nodes: any[], pathParts: string[]) => {
      for (const n of nodes) {
        if (!n) continue;
        const parts = [...pathParts, n.name];
        const children = Array.isArray(n.children) ? n.children : [];
        if (n.isLeaf === true || children.length === 0) {
          leaves.push({ id: n.id, name: n.name, code: n.code ?? null, path: parts.join(' / ') });
        } else {
          walk(children, parts);
        }
      }
    };
    walk(tree, []);
    return leaves;
  }

  /**
   * AI 自动分类 + 属性预填。
   * 1) 取品类树 flatten 叶子 → leafIds；叶子过多则 embedding 余弦预筛 top-K 候选。
   * 2) chatJson 从候选选 categoryId + 置信度 + 理由；validateEnum 约束到真实叶子 id。
   * 3) 选定后取该品类 AttributeTemplate，chatJson 抽属性值，按 fieldKey/fieldType 校验。
   * 任何环节失败 → 对应字段 null + backedByData:false。
   */
  async aiClassify(dto: { name: string; specification?: string; categoryIdHint?: number }) {
    const degraded = {
      categoryId: null as number | null,
      categoryName: null as string | null,
      confidence: null as number | null,
      reason: null as string | null,
      attributes: [] as Array<{ templateId: number; fieldKey: string; value: string }>,
      backedByData: false,
    };
    try {
      const tree = await this.getCategoryTree();
      const leaves = this.flattenLeaves(tree);
      if (leaves.length === 0) return degraded;
      const leafIds = leaves.map(l => l.id);
      const leafById = new Map(leaves.map(l => [l.id, l]));

      // ── 候选预筛 ──
      let candidates = leaves;
      if (leaves.length > EMBED_PRESCREEN_THRESHOLD) {
        try {
          const queryVec = await this.embedding.embedSingle(`${dto.name} ${dto.specification ?? ''}`.trim());
          const leafVecs = await this.embedding.embed(leaves.map(l => l.name));
          candidates = leaves
            .map((l, i) => ({ l, score: this.cosineSimilarity(queryVec, leafVecs[i]) }))
            .sort((x, y) => y.score - x.score)
            .slice(0, EMBED_TOP_K)
            .map(s => s.l);
        } catch {
          // embedding 不可用 → 退化为截断全部叶子（限制候选数），仍交给 LLM 尝试
          candidates = leaves.slice(0, 50);
        }
      }
      // hint 确保进入候选（即使被预筛淘汰或叶子数不多），让模型有机会采纳
      if (dto.categoryIdHint != null && !candidates.some(c => c.id === dto.categoryIdHint)) {
        const hinted = leafById.get(dto.categoryIdHint);
        if (hinted) candidates = [...candidates, hinted];
      }
      if (candidates.length === 0) return degraded;

      // ── LLM 选类 ──
      const systemPrompt = [
        '你是集中采购目录分类助手。根据物资名称与规格，从给定候选品类中选出最匹配的一个。',
        '严格要求：categoryId 只能从候选列表提供的 id 中选取，禁止编造任何不在候选中的 id。',
        '若候选中没有任何合适的品类，categoryId 返回 null。',
        '输出 JSON：{"categoryId": number|null, "confidence": number(0到1之间), "reason": string(简短中文理由，不超过60字)}',
      ].join('\n');
      const userPrompt = [
        `物资名称：${dto.name}`,
        dto.specification ? `规格型号：${dto.specification}` : '',
        dto.categoryIdHint != null ? `参考品类提示（仅供参考，可忽略）：categoryId=${dto.categoryIdHint}` : '',
        '候选品类（格式：id | 名称 | 全路径）：',
        ...candidates.map(c => `${c.id} | ${c.name} | ${c.path}`),
      ].filter(Boolean).join('\n');

      const parsed = await this.llm.chatJson<{ categoryId?: unknown; confidence?: unknown; reason?: unknown }>(
        systemPrompt,
        userPrompt,
        0,
        undefined,
        AI_SEED,
      );

      // 幻觉防护：categoryId 约束到真实叶子 id 集合，越界 → null
      const validatedId = this.validator.validateEnum(
        parsed?.categoryId != null ? String(parsed.categoryId) : null,
        leafIds.map(String),
        ENUM_INVALID,
      );
      const categoryId = validatedId !== ENUM_INVALID ? Number(validatedId) : null;
      const confRaw = Number(parsed?.confidence);
      const confidence = Number.isFinite(confRaw) ? Math.max(0, Math.min(1, confRaw)) : null;
      const reason = typeof parsed?.reason === 'string' ? parsed.reason.slice(0, 120) : null;

      if (categoryId == null) {
        // 模型判定无合适品类：保持 categoryId null，但仍回传理由/置信度供前端展示
        return { ...degraded, confidence, reason };
      }

      const leaf = leafById.get(categoryId)!;
      const attributes = await this.extractAttributes(dto, categoryId);

      return {
        categoryId,
        categoryName: leaf.name,
        confidence,
        reason,
        attributes,
        backedByData: true,
      };
    } catch (err) {
      // 缺密钥 / LLM 挂（ServiceUnavailableException）/ 其它异常 → 整体降级，不阻断
      console.error('[catalog] aiClassify 已降级:', err);
      return degraded;
    }
  }

  /**
   * 按选定品类的 AttributeTemplate 抽取属性值（仅返回建议，不写库）。
   * schema = 模板 fieldKey→fieldType；用 validateObject/validateEnum 校验，失败则该属性省略。
   */
  private async extractAttributes(
    dto: { name: string; specification?: string },
    categoryId: number,
  ): Promise<Array<{ templateId: number; fieldKey: string; value: string }>> {
    try {
      const category = await this.getCategory(categoryId);
      const templates: any[] = category.attributeTemplates ?? [];
      if (templates.length === 0) return [];

      const fieldDesc = templates
        .map(t => {
          const opts = Array.isArray(t.options) ? (t.options as unknown[]).map(String).join('/') : '';
          return `- ${t.fieldKey}（${t.name}，类型 ${t.fieldType}${opts ? `，可选值：${opts}` : ''}${t.unit ? `，单位 ${t.unit}` : ''}）`;
        })
        .join('\n');

      const systemPrompt = [
        '你是目录属性抽取助手。根据物资名称与规格，为给定的每个属性字段抽取合适的值。',
        '严格要求：只输出一个 JSON 对象，键为 fieldKey；无法从文本可靠推断的字段直接省略（不要该键），禁止编造。',
        'NUMBER 字段输出数字（JSON number）；SELECT 字段只能从给定可选值中选取；BOOLEAN 输出 true/false（JSON boolean）；DATE 输出 ISO 日期字符串；TEXT 输出字符串。',
      ].join('\n');
      const userPrompt = [
        `物资名称：${dto.name}`,
        dto.specification ? `规格型号：${dto.specification}` : '',
        '需要抽取的属性字段：',
        fieldDesc,
      ].filter(Boolean).join('\n');

      const raw = await this.llm.chatJson<Record<string, unknown>>(systemPrompt, userPrompt, 0, undefined, AI_SEED);
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [];

      const out: Array<{ templateId: number; fieldKey: string; value: string }> = [];
      for (const t of templates) {
        const value = this.coerceAttributeValue(raw[t.fieldKey], t);
        if (value != null) out.push({ templateId: t.id, fieldKey: t.fieldKey, value });
      }
      return out;
    } catch (err) {
      // 属性抽取失败不影响分类主结果 → 返回空建议
      console.error('[catalog] extractAttributes 已降级:', err);
      return [];
    }
  }

  /**
   * 把单个 AI 抽取值按模板 fieldType 校验/归一化为入库字符串；校验失败返回 null（该属性省略）。
   * 映射（按任务约定）：NUMBER→转数；SELECT→validateEnum 约束到 options；BOOLEAN/DATE/TEXT→按类型（BOOLEAN/TEXT 经 validateObject 复核）。
   */
  private coerceAttributeValue(rawVal: unknown, t: any): string | null {
    if (rawVal === undefined || rawVal === null || rawVal === '') return null;
    const key = t.fieldKey;
    switch (t.fieldType) {
      case 'NUMBER': {
        // NUMBER 转数：JSON number 或可解析数字串均接受；非有限数 → 省略
        const num = typeof rawVal === 'number' ? rawVal : Number(rawVal);
        return Number.isFinite(num) ? String(num) : null;
      }
      case 'SELECT': {
        // SELECT：validateEnum 约束到模板 options，越界 → 省略
        const options = Array.isArray(t.options) ? (t.options as unknown[]).map(String) : [];
        if (options.length === 0) return null;
        const v = this.validator.validateEnum(String(rawVal), options, ENUM_INVALID);
        return v === ENUM_INVALID ? null : v;
      }
      case 'BOOLEAN': {
        let b: boolean | null = null;
        if (rawVal === true || rawVal === 'true' || rawVal === 1 || rawVal === '1') b = true;
        else if (rawVal === false || rawVal === 'false' || rawVal === 0 || rawVal === '0') b = false;
        if (b === null) return null;
        // validateObject 复核「归一后的布尔」（strict：非布尔即失败），避免 "true" 字符串被误弃
        const ok = this.validator.validateObject({ [key]: b }, { [key]: { type: 'boolean', strict: true, required: true } }).valid;
        return ok ? String(b) : null;
      }
      case 'DATE': {
        const d = new Date(String(rawVal).trim());
        if (isNaN(d.getTime())) return null;
        return d.toISOString().slice(0, 10);
      }
      default: {
        // TEXT：先归一为非空字符串，再用 validateObject 复核字符串形态
        const s = String(rawVal).trim();
        if (!s) return null;
        const ok = this.validator.validateObject({ [key]: s }, { [key]: { type: 'string', required: true } }).valid;
        return ok ? s : null;
      }
    }
  }

  /**
   * 价格异常 AI 研判。
   * 上下文：条目 serialize 视图（参考价/区间/均价/变化率）+ 最近价格序列 + 该品类 priceRadar 离群标记。
   * chatJson 产出 {abnormal,severity,reasons,suggestion,confidence}，validateObject 校验（severity 用 validateEnum）。
   * LLM 挂 → {analysis:null, backedByData:false}（页面仍可显示原有统计/离群标记）。
   */
  async aiPriceAnalysis(id: string) {
    // 数据上下文非 AI：条目不存在时让 get() 的业务异常（NOT_FOUND）正常上抛，不吞成降级
    const item = await this.get(id);
    const history = await this.getHistory(id);

    let isOutlier = false;
    let radarAvg: number | null = null;
    try {
      if (item.categoryId != null) {
        const radar = await this.priceRadar(item.categoryId);
        radarAvg = radar.avgPrice ?? null;
        const me = (radar.items ?? []).find((x: any) => x.id === id);
        isOutlier = !!me?.isOutlier;
      }
    } catch {
      // 离群/雷达为辅助上下文，缺失不阻断 AI 研判
    }

    const recent = history.slice(-12);
    const prices = recent.map((h: any) => h.price);
    const histAvg = prices.length ? prices.reduce((a: number, b: number) => a + b, 0) / prices.length : null;
    const first = prices.length ? prices[0] : null;
    const last = prices.length ? prices[prices.length - 1] : null;
    const recentChange = first && first !== 0 && last != null ? (last - first) / first : null;

    const context = {
      name: item.name,
      specification: item.specification,
      referencePrice: item.referencePrice,
      priceMin: item.priceMin,
      priceMax: item.priceMax,
      averagePrice: item.averagePrice,
      lastDealPrice: item.lastDealPrice,
      changeRate: item.changeRate,
      recentHistoryAvg: histAvg != null ? Math.round(histAvg * 100) / 100 : null,
      recentChangeRate: recentChange != null ? Math.round(recentChange * 10000) / 10000 : null,
      isOutlier,
      categoryRadarAvg: radarAvg,
      recentPrices: recent.map((h: any) => ({ date: (h.recordedAt || '').slice(0, 10), price: h.price })),
    };

    const systemPrompt = [
      '你是采购价格分析专家。基于给定的目录条目价格上下文，研判当前价格是否异常，并给出严重等级、原因与处置建议。',
      '判断可参考：参考价是否超出价格下限/上限区间、相对历史均价与品类雷达均价的偏离幅度、是否被标记为统计离群(2σ)、最近价格走势。',
      '严格输出 JSON：{"abnormal": boolean, "severity": "low"|"medium"|"high", "reasons": string[](每条不超过40字，最多4条), "suggestion": string(不超过80字), "confidence": number(0到1之间)}',
    ].join('\n');
    const userPrompt = '价格上下文（JSON）：\n' + JSON.stringify(context, null, 2);

    try {
      const raw = await this.llm.chatJson<any>(systemPrompt, userPrompt, 0, undefined, AI_SEED);
      // abnormal 预归一为布尔，避免模型输出 "true" 字符串被 validateObject 误判为错误
      const abnormal =
        raw?.abnormal === true || raw?.abnormal === 'true' ? true
        : raw?.abnormal === false || raw?.abnormal === 'false' ? false
        : raw?.abnormal;
      const res = this.validator.validateObject(
        { ...raw, abnormal },
        {
          abnormal: { type: 'boolean', required: true },
          reasons: { type: 'array', items: { type: 'string' } },
          suggestion: { type: 'string' },
          confidence: { type: 'number', min: 0, max: 1 },
        },
      );
      // 关键字段 abnormal 缺失/非法 → 降级
      if (!res.valid || typeof (res.value as any).abnormal !== 'boolean') {
        return { analysis: null, backedByData: false };
      }
      const v: any = res.value;
      const analysis = {
        abnormal: v.abnormal,
        severity: this.validator.validateEnum(raw?.severity, ['low', 'medium', 'high'], 'low'),
        reasons: (Array.isArray(v.reasons) ? v.reasons : []).map((r: any) => String(r).slice(0, 60)).slice(0, 4),
        suggestion: typeof v.suggestion === 'string' ? v.suggestion.slice(0, 120) : '',
        confidence: Number.isFinite(Number(v.confidence)) ? Math.max(0, Math.min(1, Number(v.confidence))) : 0,
      };
      return { analysis, backedByData: true };
    } catch (err) {
      console.error('[catalog] aiPriceAnalysis LLM 已降级:', err);
      return { analysis: null, backedByData: false };
    }
  }

  private appTitle(app: any): string {
    if (app.type === 'NEW_ITEM') return `新增品类·${app.proposedName || '未命名'}`;
    return `${app.catalogItem?.name || '目录物资'}`;
  }

  private async notify(userId: string, title: string, content: string, link: string) {
    await this.prisma.notification.create({ data: { userId, type: 'CATALOG_APPLICATION', title, content, link } });
  }

  /**
   * 清零 :3005 工作台「目录/报价申请待审核」待办：按 type+link 全等匹配
   * （link 与 supplier-portal.notifyReviewer 下发的一致），将未 resolve 的标为已处理。
   * 直接用 prisma 更新，避免为此注入 NotificationService。
   */
  private async resolveCatalogReviewerTodo(applicationId: string) {
    const link = `/mall-management/catalog?tab=approval&appId=${applicationId}`;
    await this.prisma.notification.updateMany({
      where: { type: 'CATALOG_APPLICATION', link, resolvedAt: null },
      data: { resolvedAt: new Date() },
    });
  }

  /** 为新增品类生成唯一目录编码 CGML-NEW-{序号}。 */
  private async genCatalogCode(tx: any, hint: string): Promise<string> {
    const count = await tx.catalogItem.count({ where: { code: { startsWith: 'CGML-NEW-' } } });
    return `CGML-NEW-${String(count + 1).padStart(3, '0')}`;
  }
}
