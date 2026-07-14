import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Workbook } from 'exceljs';

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

@Injectable()
export class CatalogService {
  constructor(private prisma: PrismaService) {}

  async list(params: {
    category?: string;
    region?: string;
    status?: string;
    source?: string;
    search?: string;
    includeInactive?: boolean;
    categoryId?: number;
  }) {
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
    return items.map(serialize);
  }

  async get(id: string) {
    const item = await this.prisma.catalogItem.findUnique({
      where: { id },
      include: { attributes: { include: { template: true } }, categoryRel: true },
    });
    if (!item) throw new BadRequestException({ error: '目录条目不存在', code: 'NOT_FOUND' });
    return serialize(item);
  }

  async getHistory(id: string) {
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
  async listSuppliers() {
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
      .sort((a, b) => b.itemCount - a.itemCount);
  }

  async toggleFavorite(userId: string, itemId: string) {
    const key = { userId_catalogItemId: { userId, catalogItemId: itemId } };
    const existing = await this.prisma.userFavorite.findUnique({ where: key });
    if (existing) {
      await this.prisma.userFavorite.delete({ where: key });
      return { favorited: false };
    }
    await this.prisma.userFavorite.create({ data: { userId, catalogItemId: itemId } });
    return { favorited: true };
  }

  async listFavorites(userId: string) {
    const favs = await this.prisma.userFavorite.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      include: { catalogItem: true },
    });
    return favs.map(f => serialize(f.catalogItem)).filter(Boolean);
  }

  // ── Admin operations ──

  private catalogDataDto(dto: any) {
    return {
      code: dto.code.trim(),
      name: dto.name.trim(),
      specification: dto.specification.trim(),
      category: dto.category.trim(),
      group: dto.group.trim(),
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
    const created = await this.prisma.catalogItem.create({ data });
    await this.prisma.priceHistory.create({ data: { catalogItemId: created.id, price: data.referencePrice, recordedAt: new Date(), note: '手动新增' } });
    await this.prisma.auditLog.create({ data: { userId, action: 'CATALOG_CREATED', resourceType: created.code, details: { itemId: created.id, name: created.name } } });
    return serialize(created);
  }

  async updateAdminItem(userId: string, id: string, dto: any) {
    this.validatePriceRangeDto(dto);
    const existing = await this.prisma.catalogItem.findUnique({ where: { id } });
    if (!existing) throw new BadRequestException({ error: '目录条目不存在', code: 'NOT_FOUND' });
    const data = this.catalogDataDto(dto);
    const oldPrice = Number(existing.referencePrice);
    const newPrice = Number(data.referencePrice);
    const updated = await this.prisma.catalogItem.update({ where: { id }, data });
    const priceChanged = oldPrice !== newPrice;
    if (priceChanged) {
      await this.prisma.priceHistory.create({ data: { catalogItemId: id, price: newPrice, recordedAt: new Date(), note: '手动调价' } });
    }
    await this.prisma.auditLog.create({
      data: {
        userId,
        action: priceChanged ? 'CATALOG_PRICE_CHANGED' : 'CATALOG_UPDATED',
        resourceType: updated.code,
        details: { itemId: id, oldPrice, newPrice, changedFields: Object.keys(data) },
      },
    });
    return serialize(updated);
  }

  async changeStatus(userId: string, id: string, dto: { status: string; reason?: string }) {
    const existing = await this.prisma.catalogItem.findUnique({ where: { id } });
    if (!existing) throw new BadRequestException({ error: '目录条目不存在', code: 'NOT_FOUND' });
    const updated = await this.prisma.catalogItem.update({ where: { id }, data: { status: dto.status } });
    await this.prisma.auditLog.create({
      data: {
        userId,
        action: 'CATALOG_STATUS_CHANGED',
        resourceType: updated.code,
        details: { itemId: id, from: existing.status, to: dto.status, reason: dto.reason || null },
      },
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
      const existing = await this.prisma.catalogItem.findUnique({ where: { code: dto.code } });
      const data = this.catalogDataDto(dto);
      if (existing) {
        const oldPrice = Number(existing.referencePrice);
        const saved = await this.prisma.catalogItem.update({ where: { id: existing.id }, data });
        updated += 1;
        if (oldPrice !== Number(data.referencePrice)) {
          await this.prisma.priceHistory.create({ data: { catalogItemId: saved.id, price: data.referencePrice, recordedAt: new Date(), note: '批量导入更新' } });
        }
      } else {
        const saved = await this.prisma.catalogItem.create({ data });
        created += 1;
        await this.prisma.priceHistory.create({ data: { catalogItemId: saved.id, price: data.referencePrice, recordedAt: new Date(), note: '批量导入新增' } });
      }
    }
    const result = { totalRows: parsed.rows.length, created, updated, failed: failedRows.length, failedRows };
    await this.prisma.auditLog.create({ data: { userId, action: 'CATALOG_IMPORTED', resourceType: file.originalname, details: result } });
    return result;
  }

  async exportCatalog(userId: string, params: { category?: string; region?: string; status?: string; source?: string; search?: string }): Promise<Buffer> {
    const items = await this.list(params);
    const wb = new Workbook();
    const ws = wb.addWorksheet('采购目录');
    ws.columns = [
      { header: '目录编码', key: 'code', width: 22 },
      { header: '物资名称', key: 'name', width: 24 },
      { header: '规格型号', key: 'specification', width: 30 },
      { header: '分类', key: 'category', width: 12 },
      { header: '组别', key: 'group', width: 12 },
      { header: '单位', key: 'unit', width: 8 },
      { header: '参考价', key: 'referencePrice', width: 12 },
      { header: '价格下限', key: 'priceMin', width: 12 },
      { header: '价格上限', key: 'priceMax', width: 12 },
      { header: '最近成交价', key: 'lastDealPrice', width: 12 },
      { header: '历史均价', key: 'averagePrice', width: 12 },
      { header: '价格变化(%)', key: 'changeRate', width: 12 },
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
    ws.addRows(items.map(it => ({
      code: it.code, name: it.name, specification: it.specification, category: it.category, group: it.group,
      unit: it.unit, referencePrice: it.referencePrice, priceMin: it.priceMin, priceMax: it.priceMax,
      lastDealPrice: it.lastDealPrice, averagePrice: it.averagePrice, changeRate: it.changeRate,
      priceSource: it.priceSource, status: it.status, supplier: it.supplier, supplierType: it.supplierType,
      region: it.region, taxIncluded: it.taxIncluded ? '是' : '否', freightIncluded: it.freightIncluded ? '是' : '否',
      minOrder: it.minOrder, updatedAt: it.updatedAt.slice(0, 10), validUntil: it.validUntil ? it.validUntil.slice(0, 10) : '',
      remark: it.remark ?? '',
    })));
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
    await this.prisma.auditLog.create({ data: { userId, action: 'CATEGORY_CREATED', resourceType: created.name, details: { categoryId: created.id, parentId: created.parentId } } });
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
    await this.prisma.auditLog.create({ data: { userId, action: 'CATEGORY_UPDATED', resourceType: updated.name, details: { categoryId: id, changedFields: Object.keys(data) } } });
    return updated;
  }

  async deleteCategory(userId: string, id: number) {
    const existing = await this.prisma.catalogCategory.findUnique({
      where: { id },
      include: { children: true, catalogItems: { take: 1 } },
    });
    if (!existing) throw new BadRequestException({ error: '品类不存在', code: 'NOT_FOUND' });
    if (existing.children.length > 0) throw new BadRequestException({ error: '该品类下有子节点，请先删除子节点', code: 'HAS_CHILDREN' });
    if (existing.catalogItems.length > 0) throw new BadRequestException({ error: '该品类下有目录项，请先迁移目录项', code: 'HAS_ITEMS' });
    await this.prisma.catalogCategory.delete({ where: { id } });
    await this.prisma.auditLog.create({ data: { userId, action: 'CATEGORY_DELETED', resourceType: existing.name, details: { categoryId: id } } });
    return { success: true };
  }

  async moveCategory(userId: string, id: number, dto: { newSortOrder: number; newParentId?: number | null }) {
    const existing = await this.prisma.catalogCategory.findUnique({ where: { id } });
    if (!existing) throw new BadRequestException({ error: '品类不存在', code: 'NOT_FOUND' });
    if (dto.newParentId != null) {
      if (dto.newParentId === id) throw new BadRequestException({ error: '不能将节点移动到自身下', code: 'INVALID_PARENT' });
      const parent = await this.prisma.catalogCategory.findUnique({ where: { id: dto.newParentId } });
      if (!parent) throw new BadRequestException({ error: '目标父节点不存在', code: 'NOT_FOUND' });
    }
    const updated = await this.prisma.catalogCategory.update({
      where: { id },
      data: { sortOrder: dto.newSortOrder, parentId: dto.newParentId != null ? dto.newParentId : existing.parentId },
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
    const existing = await this.prisma.categoryAttributeTemplate.findUnique({ where: { id } });
    if (!existing) throw new BadRequestException({ error: '属性模板不存在', code: 'NOT_FOUND' });
    await this.prisma.categoryAttributeTemplate.delete({ where: { id } });
    await this.prisma.auditLog.create({ data: { userId, action: 'ATTR_TEMPLATE_DELETED', resourceType: existing.name, details: { templateId: id, fieldKey: existing.fieldKey } } });
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

    return this.prisma.$transaction(async (tx) => {
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
    }).then(async (result) => {
      // 事务外发通知 + 审计
      await this.notify(app.supplier.userId, '供货申请已通过', `您的供货申请（${this.appTitle(app)}）已通过审核，最终报价 ¥${Number(result.quotedPrice)}。`, '/catalog-applications');
      await this.prisma.auditLog.create({ data: { userId: adminUserId, action: 'CATALOG_APPLICATION_APPROVED', resourceType: this.appTitle(app), details: { applicationId, type: app.type, finalPrice: Number(result.quotedPrice) } } });
      return result;
    });
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
  async createAlertRule(dto: any) { return this.prisma.priceAlertRule.create({ data: { name: dto.name.trim(), categoryId: dto.categoryId ?? null, alertType: dto.alertType, threshold: dto.threshold, enabled: dto.enabled ?? true, notifyRoles: dto.notifyRoles ?? ['admin', 'procurement_staff'] } }); }
  async updateAlertRule(id: number, dto: any) { const data: any = {}; if (dto.name) data.name = dto.name.trim(); if (dto.alertType) data.alertType = dto.alertType; if (dto.threshold !== undefined) data.threshold = dto.threshold; if (dto.enabled !== undefined) data.enabled = dto.enabled; if (dto.notifyRoles) data.notifyRoles = dto.notifyRoles; return this.prisma.priceAlertRule.update({ where: { id }, data }); }
  async deleteAlertRule(id: number) { await this.prisma.priceAlertRule.delete({ where: { id } }); return { success: true }; }
  async toggleAlertRule(id: number) { const r = await this.prisma.priceAlertRule.findUnique({ where: { id } }); if (!r) throw new BadRequestException({ error: '规则不存在', code: 'NOT_FOUND' }); return this.prisma.priceAlertRule.update({ where: { id }, data: { enabled: !r.enabled } }); }
  async listAlerts(params: { isRead?: boolean; isResolved?: boolean }) { const where: any = {}; if (params.isRead !== undefined) where.isRead = params.isRead; if (params.isResolved !== undefined) where.isResolved = params.isResolved; return this.prisma.priceAlert.findMany({ where, orderBy: { createdAt: 'desc' }, take: 100, include: { catalogItem: { select: { id: true, code: true, name: true } }, rule: { select: { id: true, name: true } } } }); }
  async markAlertRead(id: number) { return this.prisma.priceAlert.update({ where: { id }, data: { isRead: true } }); }
  async markAlertResolved(id: number) { return this.prisma.priceAlert.update({ where: { id }, data: { isResolved: true } }); }

  // ── 目录版本 ──

  async listVersions() { return this.prisma.catalogVersion.findMany({ orderBy: { createdAt: 'desc' }, include: { user: { select: { username: true, displayName: true } } } }); }

  async createVersion(userId: string, dto: { name: string; version: string; effectiveAt: string; description?: string }) {
    const items = await this.prisma.catalogItem.findMany({ orderBy: { code: 'asc' }, include: { categoryRel: true } });
    const categories = await this.prisma.catalogCategory.findMany();
    const snapshot = { items: items.map((i: any) => ({ id: i.id, code: i.code, name: i.name, referencePrice: Number(i.referencePrice), status: i.status, categoryId: i.categoryId })), categories, capturedAt: new Date().toISOString() };
    return this.prisma.catalogVersion.create({ data: { name: dto.name.trim(), version: dto.version.trim(), effectiveAt: new Date(dto.effectiveAt), description: dto.description?.trim() || null, snapshot, createdBy: userId } });
  }

  async getVersion(id: number) { const v = await this.prisma.catalogVersion.findUnique({ where: { id }, include: { user: { select: { username: true, displayName: true } } } }); if (!v) throw new BadRequestException({ error: '版本不存在', code: 'NOT_FOUND' }); return v; }

  async changeVersionStatus(id: number, status: string) { return this.prisma.catalogVersion.update({ where: { id }, data: { status } }); }

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

  async listItemRelations(itemId: string) {
    return this.prisma.catalogItemRelation.findMany({ where: { catalogItemId: itemId }, include: { relatedItem: { select: { id: true, code: true, name: true, referencePrice: true } } } });
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
    const predictions = [];
    for (let i = 0; i < 6; i++) { const p = n + i; predictions.push({ month: p, price: Math.round((meanY + slope * (p - meanX)) * 100) / 100 }); }
    const lastPrice = yValues[n - 1];
    const predPrice = predictions[predictions.length - 1]?.price || lastPrice;
    const trend = slope > 0.01 ? 'up' : slope < -0.01 ? 'down' : 'stable';
    const isLow = lastPrice < meanY * 0.9;
    return { predictions, opportunity: isLow ? '当前价格处于近12个月低位，建议关注采购时机' : null, trend, lastPrice, meanPrice: Math.round(meanY * 100) / 100 };
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

  private appTitle(app: any): string {
    if (app.type === 'NEW_ITEM') return `新增品类·${app.proposedName || '未命名'}`;
    return `${app.catalogItem?.name || '目录物资'}`;
  }

  private async notify(userId: string, title: string, content: string, link: string) {
    await this.prisma.notification.create({ data: { userId, type: 'CATALOG_APPLICATION', title, content, link } });
  }

  /** 为新增品类生成唯一目录编码 CGML-NEW-{序号}。 */
  private async genCatalogCode(tx: any, hint: string): Promise<string> {
    const count = await tx.catalogItem.count({ where: { code: { startsWith: 'CGML-NEW-' } } });
    return `CGML-NEW-${String(count + 1).padStart(3, '0')}`;
  }
}
