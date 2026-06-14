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
      await this.prisma.auditLog.create({ data: { userId: adminUserId, action: 'CATALOG_APPLICATION_REJECTED', target: this.appTitle(app), detail: { applicationId, reason: body.reason.trim() } } });
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
      await this.prisma.auditLog.create({ data: { userId: adminUserId, action: 'CATALOG_APPLICATION_RETURNED', target: this.appTitle(app), detail: { applicationId, reason: body.reason.trim() } } });
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
      await this.prisma.auditLog.create({ data: { userId: adminUserId, action: 'CATALOG_APPLICATION_COUNTERED', target: this.appTitle(app), detail: { applicationId, counterPrice: cp } } });
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
      await this.prisma.auditLog.create({ data: { userId: adminUserId, action: 'CATALOG_APPLICATION_APPROVED', target: this.appTitle(app), detail: { applicationId, type: app.type, finalPrice: Number(result.quotedPrice) } } });
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
