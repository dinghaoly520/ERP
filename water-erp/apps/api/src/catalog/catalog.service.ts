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
