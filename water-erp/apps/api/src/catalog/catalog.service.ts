import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Workbook } from 'exceljs';

export interface CatalogItemView {
  id: string;
  code: string;
  name: string;
  specification: string;
  category: string;
  group: string;
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
  }) {
    const filters: any[] = [];
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
    const items = await this.prisma.catalogItem.findMany({ where, orderBy: { code: 'asc' } });
    return items.map(serialize);
  }

  async get(id: string) {
    const item = await this.prisma.catalogItem.findUnique({ where: { id } });
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
    const [total, active, inactive, review, updatedThisMonth] = await Promise.all([
      this.prisma.catalogItem.count(),
      this.prisma.catalogItem.count({ where: { status: '有效' } }),
      this.prisma.catalogItem.count({ where: { status: { in: ['下架', '停用'] } } }),
      this.prisma.catalogItem.count({ where: { status: { in: ['待复核', '价格波动', '即将过期'] } } }),
      this.prisma.catalogItem.count({ where: { updatedAt: { gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1) } } }),
    ]);
    return { total, active, inactive, review, updatedThisMonth };
  }

  async createAdminItem(userId: string, dto: any) {
    this.validatePriceRangeDto(dto);
    const data = this.catalogDataDto(dto);
    const created = await this.prisma.catalogItem.create({ data });
    await this.prisma.priceHistory.create({ data: { catalogItemId: created.id, price: data.referencePrice, recordedAt: new Date(), note: '手动新增' } });
    await this.prisma.auditLog.create({ data: { userId, action: 'CATALOG_CREATED', target: created.code, detail: { itemId: created.id, name: created.name } } });
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
        target: updated.code,
        detail: { itemId: id, oldPrice, newPrice, changedFields: Object.keys(data) },
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
        target: updated.code,
        detail: { itemId: id, from: existing.status, to: dto.status, reason: dto.reason || null },
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
      target: r.target,
      detail: r.detail,
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
    await this.prisma.auditLog.create({ data: { userId, action: 'CATALOG_TEMPLATE_DOWNLOADED', target: '电子商城导入模板', detail: {} } });
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
    await this.prisma.auditLog.create({ data: { userId, action: 'CATALOG_IMPORTED', target: file.originalname, detail: result } });
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
    await this.prisma.auditLog.create({ data: { userId, action: 'CATALOG_EXPORTED', target: '采购目录', detail: { filters: params, itemCount: items.length } } });
    return Buffer.from(await wb.xlsx.writeBuffer() as ArrayBuffer);
  }
}
