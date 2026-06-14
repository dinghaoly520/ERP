# Electronic Mall Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a complete electronic mall management loop in the 3004 procurement portal, backed by Catalog management APIs, with 3002 mall pages showing only active catalog data.

**Architecture:** Extend the existing `CatalogModule` instead of creating a separate mall product domain. `CatalogItem` remains the single source of truth, `PriceHistory` records price changes, and `AuditLog` records management actions. The 3004 web app gets four management pages; the 3002 mall continues reading `/api/catalog` but only receives effective items by default.

**Tech Stack:** NestJS 11, Prisma 6, Jest, ExcelJS, Next.js 16 App Router, React 19, Tailwind CSS v4, pnpm workspace.

---

## Scope and Existing Context

Run commands from `water-erp/`.

Relevant existing files:

- API catalog module:
  - `apps/api/src/catalog/catalog.controller.ts`
  - `apps/api/src/catalog/catalog.service.ts`
  - `apps/api/src/catalog/catalog.module.ts`
- Prisma models:
  - `apps/api/prisma/schema.prisma`
  - `CatalogItem.code` is already `@unique`.
  - `CatalogItem.status` defaults to `有效`.
  - `PriceHistory` already exists.
  - `AuditLog.detail` is JSON and can store import summaries.
- Audit module:
  - `apps/api/src/audit/audit.controller.ts`
  - `apps/api/src/audit/audit.service.ts`
- 3004 shell/navigation:
  - `apps/web/src/components/app-shell.tsx`
- 3002 mall page:
  - `apps/mall/src/app/page.tsx`
- Design spec:
  - `docs/superpowers/specs/2026-06-14-electronic-mall-management-design.md`

Key decisions from spec:

- Price approval is a management-style placeholder only.
- No supplier-side application entry.
- CSV/Excel import is real.
- Import uses `code` upsert: existing code updates, new code creates.
- Directory removal means status change to 下架 or 停用, not physical delete.
- 3002 mall shows only `status = 有效`.

---

## File Structure

### API files

- Create `apps/api/src/catalog/dto.ts`
  - DTOs and validators for admin create/update/status/import query shapes.
  - Keeps controller thin and prevents `catalog.service.ts` from accumulating request validation details.

- Create `apps/api/src/catalog/catalog-import.ts`
  - Pure parsing helpers for CSV/XLS/XLSX rows.
  - Pure validation/normalization helpers for catalog import rows.
  - Unit-testable without Nest or Prisma.

- Create `apps/api/src/catalog/catalog-import.spec.ts`
  - Tests parser/normalizer behavior and row-level validation.

- Create `apps/api/src/catalog/catalog.service.spec.ts`
  - Tests create/update/status/import business behavior with a mocked PrismaService.

- Modify `apps/api/src/catalog/catalog.controller.ts`
  - Add admin endpoints.
  - Add file upload endpoint using Nest `FileInterceptor` and memory storage.
  - Apply `@Roles('admin', 'procurement_staff')` to admin endpoints.

- Modify `apps/api/src/catalog/catalog.service.ts`
  - Add admin stats, create, update, status change, import template, import, and admin audit log methods.
  - Adjust `list()` so mall calls return only `有效` unless explicitly overridden for admin.

### 3004 web files

- Modify `apps/web/src/components/app-shell.tsx`
  - Add `电子商城管理` nav group.

- Create `apps/web/src/lib/api/catalog-admin.ts`
  - Typed wrappers for admin catalog APIs.
  - Keeps page files focused on UI.

- Create `apps/web/src/app/(dashboard)/mall-management/approval/page.tsx`
  - Management-style placeholder for future price approval.

- Create `apps/web/src/app/(dashboard)/mall-management/price-entry/page.tsx`
  - Manual create form and import workflow.

- Create `apps/web/src/app/(dashboard)/mall-management/catalog/page.tsx`
  - Directory management table, filters, edit dialog, status change controls.

- Create `apps/web/src/app/(dashboard)/mall-management/logs/page.tsx`
  - Electronic mall audit log list and detail display.

- Create `apps/web/src/app/(dashboard)/mall-management/page.tsx`
  - Redirect or landing page that routes to `/mall-management/catalog`.

### 3002 mall files

- Modify `apps/mall/src/app/page.tsx`
  - Keep client-side filtering intact.
  - Ensure fetch receives only effective rows from API; no mock fallback.
  - Optional defensive filter `item.status === '有效'` before display.

---

## Task 1: Add Catalog Admin DTOs and Import Helpers

**Files:**

- Create: `apps/api/src/catalog/dto.ts`
- Create: `apps/api/src/catalog/catalog-import.ts`
- Create: `apps/api/src/catalog/catalog-import.spec.ts`

- [ ] **Step 1: Create DTOs**

Create `apps/api/src/catalog/dto.ts`:

```ts
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateIf,
} from 'class-validator';

export const CATALOG_STATUSES = ['有效', '价格波动', '即将过期', '待复核', '下架', '停用'] as const;
export type CatalogStatus = (typeof CATALOG_STATUSES)[number];

export class CatalogAdminListQueryDto {
  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsString()
  region?: string;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  source?: string;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  includeInactive?: boolean;
}

export class CatalogItemAdminDto {
  @IsString()
  code!: string;

  @IsString()
  name!: string;

  @IsString()
  specification!: string;

  @IsString()
  category!: string;

  @IsString()
  group!: string;

  @IsString()
  unit!: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  referencePrice!: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  priceMin!: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  priceMax!: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  lastDealPrice!: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  averagePrice!: number;

  @IsString()
  supplier!: string;

  @IsString()
  supplierType!: string;

  @IsString()
  priceSource!: string;

  @IsString()
  region!: string;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  taxIncluded?: boolean;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  freightIncluded?: boolean;

  @Type(() => Number)
  @IsNumber()
  changeRate!: number;

  @IsString()
  minOrder!: string;

  @IsOptional()
  @IsString()
  remark?: string | null;

  @IsOptional()
  @IsIn(CATALOG_STATUSES)
  status?: CatalogStatus;

  @IsOptional()
  @ValidateIf(o => o.validUntil !== null && o.validUntil !== '')
  @IsDateString()
  validUntil?: string | null;
}

export class UpdateCatalogItemAdminDto extends CatalogItemAdminDto {}

export class CatalogStatusDto {
  @IsIn(['有效', '下架', '停用', '待复核'])
  status!: CatalogStatus;

  @IsOptional()
  @IsString()
  reason?: string;
}
```

- [ ] **Step 2: Create import helpers**

Create `apps/api/src/catalog/catalog-import.ts`:

```ts
import { BadRequestException } from '@nestjs/common';
import { Workbook } from 'exceljs';
import type { CatalogItemAdminDto } from './dto';

export interface CatalogImportRowResult {
  rowNumber: number;
  code: string;
  data?: CatalogItemAdminDto;
  errors: string[];
}

export interface CatalogImportParseResult {
  rows: CatalogImportRowResult[];
}

const HEADER_ALIASES: Record<string, keyof CatalogItemAdminDto> = {
  目录编码: 'code',
  code: 'code',
  名称: 'name',
  物资名称: 'name',
  name: 'name',
  规格型号: 'specification',
  specification: 'specification',
  分类: 'category',
  category: 'category',
  分组: 'group',
  group: 'group',
  单位: 'unit',
  unit: 'unit',
  参考价: 'referencePrice',
  referencePrice: 'referencePrice',
  价格下限: 'priceMin',
  priceMin: 'priceMin',
  价格上限: 'priceMax',
  priceMax: 'priceMax',
  最近成交价: 'lastDealPrice',
  lastDealPrice: 'lastDealPrice',
  历史均价: 'averagePrice',
  averagePrice: 'averagePrice',
  供应商: 'supplier',
  supplier: 'supplier',
  供应商类型: 'supplierType',
  supplierType: 'supplierType',
  价格来源: 'priceSource',
  priceSource: 'priceSource',
  区域: 'region',
  region: 'region',
  含税: 'taxIncluded',
  taxIncluded: 'taxIncluded',
  含运费: 'freightIncluded',
  freightIncluded: 'freightIncluded',
  价格变化率: 'changeRate',
  changeRate: 'changeRate',
  最小起订量: 'minOrder',
  minOrder: 'minOrder',
  状态: 'status',
  status: 'status',
  有效期: 'validUntil',
  validUntil: 'validUntil',
  备注: 'remark',
  remark: 'remark',
};

const REQUIRED_FIELDS: Array<keyof CatalogItemAdminDto> = [
  'code',
  'name',
  'specification',
  'category',
  'group',
  'unit',
  'referencePrice',
  'supplier',
  'priceSource',
  'region',
];

const NUMBER_FIELDS: Array<keyof CatalogItemAdminDto> = [
  'referencePrice',
  'priceMin',
  'priceMax',
  'lastDealPrice',
  'averagePrice',
  'changeRate',
];

function cellText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object' && 'text' in (value as any)) return String((value as any).text ?? '').trim();
  if (typeof value === 'object' && 'result' in (value as any)) return String((value as any).result ?? '').trim();
  return String(value).trim();
}

export function parseBoolean(value: unknown): boolean {
  const text = cellText(value).toLowerCase();
  if (['是', 'true', '1', 'yes', 'y'].includes(text)) return true;
  if (['否', 'false', '0', 'no', 'n'].includes(text)) return false;
  return false;
}

function parseNumber(value: unknown): number | null {
  const text = cellText(value).replace(/,/g, '');
  if (!text) return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

function normalizeDate(value: unknown): string | null {
  const text = cellText(value);
  if (!text) return null;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? text : date.toISOString();
}

export function normalizeCatalogImportRow(rowNumber: number, raw: Record<string, unknown>): CatalogImportRowResult {
  const normalized: any = {};
  const errors: string[] = [];

  for (const [header, value] of Object.entries(raw)) {
    const key = HEADER_ALIASES[header.trim()];
    if (!key) continue;
    normalized[key] = value;
  }

  for (const field of REQUIRED_FIELDS) {
    if (cellText(normalized[field]) === '') errors.push(`${String(field)} 不能为空`);
  }

  for (const field of NUMBER_FIELDS) {
    const value = normalized[field];
    if (cellText(value) === '') {
      normalized[field] = field === 'changeRate' ? 0 : normalized.referencePrice;
      continue;
    }
    const parsed = parseNumber(value);
    if (parsed === null) errors.push(`${String(field)} 必须是数字`);
    else if (parsed < 0 && field !== 'changeRate') errors.push(`${String(field)} 不能为负数`);
    else normalized[field] = parsed;
  }

  normalized.taxIncluded = cellText(normalized.taxIncluded) === '' ? true : parseBoolean(normalized.taxIncluded);
  normalized.freightIncluded = cellText(normalized.freightIncluded) === '' ? false : parseBoolean(normalized.freightIncluded);
  normalized.status = cellText(normalized.status) || '有效';
  normalized.validUntil = normalizeDate(normalized.validUntil);
  normalized.remark = cellText(normalized.remark) || null;

  for (const field of ['code', 'name', 'specification', 'category', 'group', 'unit', 'supplier', 'supplierType', 'priceSource', 'region', 'minOrder'] as const) {
    normalized[field] = cellText(normalized[field]);
  }

  if (normalized.priceMin !== undefined && normalized.priceMax !== undefined && normalized.referencePrice !== undefined) {
    if (normalized.priceMin > normalized.referencePrice || normalized.referencePrice > normalized.priceMax) {
      errors.push('参考价必须位于价格下限和价格上限之间');
    }
  }

  return {
    rowNumber,
    code: cellText(normalized.code),
    data: errors.length ? undefined : (normalized as CatalogItemAdminDto),
    errors,
  };
}

export async function parseCatalogImport(buffer: Buffer, filename: string): Promise<CatalogImportParseResult> {
  const lower = filename.toLowerCase();
  if (!lower.endsWith('.xlsx') && !lower.endsWith('.xls') && !lower.endsWith('.csv')) {
    throw new BadRequestException({ error: '仅支持 .xlsx、.xls、.csv 文件', code: 'INVALID_FILE_TYPE' });
  }

  const workbook = new Workbook();
  if (lower.endsWith('.csv')) await workbook.csv.readBuffer(buffer);
  else await workbook.xlsx.load(buffer);

  const sheet = workbook.worksheets[0];
  if (!sheet) return { rows: [] };

  const headerRow = sheet.getRow(1);
  const headers = headerRow.values as unknown[];
  const rows: CatalogImportRowResult[] = [];

  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const raw: Record<string, unknown> = {};
    let hasValue = false;
    headers.forEach((header, index) => {
      if (!index) return;
      const headerText = cellText(header);
      if (!headerText) return;
      const value = row.getCell(index).value;
      if (cellText(value)) hasValue = true;
      raw[headerText] = value;
    });
    if (hasValue) rows.push(normalizeCatalogImportRow(rowNumber, raw));
  });

  return { rows };
}
```

- [ ] **Step 3: Write helper tests**

Create `apps/api/src/catalog/catalog-import.spec.ts`:

```ts
import { normalizeCatalogImportRow, parseBoolean } from './catalog-import';

describe('catalog import helpers', () => {
  it('parses Chinese boolean values', () => {
    expect(parseBoolean('是')).toBe(true);
    expect(parseBoolean('否')).toBe(false);
    expect(parseBoolean('1')).toBe(true);
    expect(parseBoolean('0')).toBe(false);
  });

  it('normalizes a valid row', () => {
    const row = normalizeCatalogImportRow(2, {
      目录编码: 'CAT-001',
      物资名称: '球墨铸铁管',
      规格型号: 'DN300',
      分类: '管材',
      分组: '工程材料',
      单位: '米',
      参考价: '120.5',
      价格下限: '100',
      价格上限: '140',
      最近成交价: '118',
      历史均价: '119',
      供应商: '四川水利物资有限公司',
      供应商类型: '协议供应商',
      价格来源: '人工维护',
      区域: '全省',
      含税: '是',
      含运费: '否',
      价格变化率: '0',
      最小起订量: '10米',
    });

    expect(row.errors).toEqual([]);
    expect(row.data?.code).toBe('CAT-001');
    expect(row.data?.referencePrice).toBe(120.5);
    expect(row.data?.taxIncluded).toBe(true);
    expect(row.data?.freightIncluded).toBe(false);
    expect(row.data?.status).toBe('有效');
  });

  it('returns row errors for invalid prices', () => {
    const row = normalizeCatalogImportRow(3, {
      目录编码: 'CAT-002',
      物资名称: '水泥',
      规格型号: 'P.O 42.5',
      分类: '水泥',
      分组: '工程材料',
      单位: '吨',
      参考价: '200',
      价格下限: '250',
      价格上限: '300',
      供应商: '成都建材有限公司',
      价格来源: '人工维护',
      区域: '成都',
    });

    expect(row.data).toBeUndefined();
    expect(row.errors).toContain('参考价必须位于价格下限和价格上限之间');
  });
});
```

- [ ] **Step 4: Run helper tests and verify they fail before implementation is complete if files are missing**

Run:

```bash
pnpm --filter api test -- catalog-import.spec.ts
```

Expected after the files above exist: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/catalog/dto.ts apps/api/src/catalog/catalog-import.ts apps/api/src/catalog/catalog-import.spec.ts
git commit -m "feat(catalog): add admin import helpers" -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 2: Extend Catalog Service With Admin Operations

**Files:**

- Modify: `apps/api/src/catalog/catalog.service.ts`
- Create: `apps/api/src/catalog/catalog.service.spec.ts`

- [ ] **Step 1: Write service tests**

Create `apps/api/src/catalog/catalog.service.spec.ts`:

```ts
import { CatalogService } from './catalog.service';

const makePrisma = () => ({
  catalogItem: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    count: jest.fn(),
  },
  priceHistory: { create: jest.fn() },
  auditLog: { create: jest.fn(), findMany: jest.fn() },
  $transaction: jest.fn(async (fn: any) => fn(makePrisma())),
});

const item = {
  id: 'cat-1',
  code: 'CAT-001',
  name: '球墨铸铁管',
  specification: 'DN300',
  category: '管材',
  group: '工程材料',
  unit: '米',
  referencePrice: 120,
  priceMin: 100,
  priceMax: 140,
  lastDealPrice: 118,
  averagePrice: 119,
  supplier: '四川水利物资有限公司',
  supplierType: '协议供应商',
  priceSource: '人工维护',
  region: '全省',
  taxIncluded: true,
  freightIncluded: false,
  changeRate: 0,
  minOrder: '10米',
  remark: null,
  status: '有效',
  validUntil: null,
  createdAt: new Date('2026-06-01T00:00:00.000Z'),
  updatedAt: new Date('2026-06-01T00:00:00.000Z'),
};

describe('CatalogService admin operations', () => {
  it('filters mall list to active catalog items by default', async () => {
    const prisma = makePrisma();
    prisma.catalogItem.findMany.mockResolvedValue([item]);
    const service = new CatalogService(prisma as any);

    await service.list({});

    expect(prisma.catalogItem.findMany).toHaveBeenCalledWith({
      where: { AND: [{ status: '有效' }] },
      orderBy: { code: 'asc' },
    });
  });

  it('creates catalog item with price history and audit log', async () => {
    const prisma = makePrisma();
    prisma.catalogItem.create.mockResolvedValue(item);
    const service = new CatalogService(prisma as any);

    const result = await service.createAdminItem('user-1', item as any);

    expect(result.code).toBe('CAT-001');
    expect(prisma.catalogItem.create).toHaveBeenCalled();
    expect(prisma.priceHistory.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ catalogItemId: 'cat-1', note: '手动新增' }),
    }));
    expect(prisma.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: 'CATALOG_CREATED', userId: 'user-1' }),
    }));
  });

  it('adds price history when reference price changes', async () => {
    const prisma = makePrisma();
    prisma.catalogItem.findUnique.mockResolvedValue(item);
    prisma.catalogItem.update.mockResolvedValue({ ...item, referencePrice: 130 });
    const service = new CatalogService(prisma as any);

    await service.updateAdminItem('user-1', 'cat-1', { ...item, referencePrice: 130 } as any);

    expect(prisma.priceHistory.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ catalogItemId: 'cat-1', price: 130, note: '手动调价' }),
    }));
    expect(prisma.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: 'CATALOG_PRICE_CHANGED' }),
    }));
  });

  it('does not add price history when non-price fields change', async () => {
    const prisma = makePrisma();
    prisma.catalogItem.findUnique.mockResolvedValue(item);
    prisma.catalogItem.update.mockResolvedValue({ ...item, name: '新名称' });
    const service = new CatalogService(prisma as any);

    await service.updateAdminItem('user-1', 'cat-1', { ...item, name: '新名称' } as any);

    expect(prisma.priceHistory.create).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: 'CATALOG_UPDATED' }),
    }));
  });
});
```

- [ ] **Step 2: Run service tests and verify failure**

Run:

```bash
pnpm --filter api test -- catalog.service.spec.ts
```

Expected: FAIL because `createAdminItem()` and `updateAdminItem()` do not exist yet.

- [ ] **Step 3: Modify imports in `catalog.service.ts`**

At the top of `apps/api/src/catalog/catalog.service.ts`, replace imports with:

```ts
import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Workbook } from 'exceljs';
import type { CatalogItemAdminDto, CatalogStatusDto } from './dto';
import { parseCatalogImport } from './catalog-import';
```

- [ ] **Step 4: Update `list()` active filtering**

Replace the `list` signature and filter setup with:

```ts
  async list(params: {
    category?: string;
    region?: string;
    status?: string;
    source?: string;
    search?: string;
    includeInactive?: boolean;
  }) {
    const filters: any[] = [];
    if (!params.includeInactive && !params.status) filters.push({ status: '有效' });
```

Keep the existing category/region/status/source/search filter code after this block.

- [ ] **Step 5: Add admin service methods before `exportCatalog()`**

Insert these methods in `CatalogService` before `exportCatalog()`:

```ts
  private catalogData(dto: CatalogItemAdminDto) {
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

  private validatePriceRange(dto: CatalogItemAdminDto) {
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

  async createAdminItem(userId: string, dto: CatalogItemAdminDto) {
    this.validatePriceRange(dto);
    const data = this.catalogData(dto);
    const created = await this.prisma.catalogItem.create({ data });
    await this.prisma.priceHistory.create({ data: { catalogItemId: created.id, price: data.referencePrice, recordedAt: new Date(), note: '手动新增' } });
    await this.prisma.auditLog.create({ data: { userId, action: 'CATALOG_CREATED', target: created.code, detail: { itemId: created.id, name: created.name } } });
    return serialize(created);
  }

  async updateAdminItem(userId: string, id: string, dto: CatalogItemAdminDto) {
    this.validatePriceRange(dto);
    const existing = await this.prisma.catalogItem.findUnique({ where: { id } });
    if (!existing) throw new BadRequestException({ error: '目录条目不存在', code: 'NOT_FOUND' });
    const data = this.catalogData(dto);
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

  async changeStatus(userId: string, id: string, dto: CatalogStatusDto) {
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
    return rows.map(r => ({
      id: r.id,
      action: r.action,
      target: r.target,
      detail: r.detail,
      user: r.user,
      createdAt: r.createdAt.toISOString(),
    }));
  }
```

- [ ] **Step 6: Add template and import methods after `exportCatalog()`**

Add these methods near the end of `CatalogService`:

```ts
  async importTemplate(userId: string): Promise<Buffer> {
    const wb = new Workbook();
    const ws = wb.addWorksheet('电子商城目录导入模板');
    ws.columns = [
      '目录编码', '物资名称', '规格型号', '分类', '分组', '单位', '参考价', '价格下限', '价格上限',
      '最近成交价', '历史均价', '供应商', '供应商类型', '价格来源', '区域', '含税', '含运费',
      '价格变化率', '最小起订量', '状态', '有效期', '备注',
    ].map(header => ({ header, key: header, width: 18 }));
    ws.addRow({
      目录编码: 'CAT-DEMO-001',
      物资名称: '示例物资',
      规格型号: 'DN300',
      分类: '管材',
      分组: '工程材料',
      单位: '米',
      参考价: 120,
      价格下限: 100,
      价格上限: 140,
      最近成交价: 118,
      历史均价: 119,
      供应商: '示例供应商',
      供应商类型: '协议供应商',
      价格来源: '人工维护',
      区域: '全省',
      含税: '是',
      含运费: '否',
      价格变化率: 0,
      最小起订量: '10米',
      状态: '有效',
      有效期: '2026-12-31',
      备注: '示例行，导入前请删除',
    });
    ws.getRow(1).font = { bold: true };
    await this.prisma.auditLog.create({ data: { userId, action: 'CATALOG_TEMPLATE_DOWNLOADED', target: '电子商城导入模板', detail: {} } });
    return Buffer.from(await wb.xlsx.writeBuffer() as ArrayBuffer);
  }

  async importItems(userId: string, file: Express.Multer.File) {
    if (!file) throw new BadRequestException({ error: '请选择导入文件', code: 'FILE_REQUIRED' });
    if (file.size > 5 * 1024 * 1024) throw new BadRequestException({ error: '文件大小不能超过 5MB', code: 'FILE_TOO_LARGE' });

    const parsed = await parseCatalogImport(file.buffer, file.originalname);
    let created = 0;
    let updated = 0;
    const failedRows = parsed.rows.filter(r => r.errors.length).map(r => ({ rowNumber: r.rowNumber, code: r.code, errors: r.errors }));

    for (const row of parsed.rows.filter(r => r.data)) {
      const dto = row.data!;
      const existing = await this.prisma.catalogItem.findUnique({ where: { code: dto.code } });
      const data = this.catalogData(dto);
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
```

- [ ] **Step 7: Run service tests**

Run:

```bash
pnpm --filter api test -- catalog.service.spec.ts catalog-import.spec.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/catalog/catalog.service.ts apps/api/src/catalog/catalog.service.spec.ts
git commit -m "feat(catalog): add admin catalog service operations" -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 3: Add Catalog Admin Controller Endpoints

**Files:**

- Modify: `apps/api/src/catalog/catalog.controller.ts`

- [ ] **Step 1: Update controller imports**

Replace imports in `apps/api/src/catalog/catalog.controller.ts` with:

```ts
import { Body, Controller, Get, Param, Patch, Post, Query, Request, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { Roles } from '../common/decorators/roles.decorator';
import { CatalogService } from './catalog.service';
import { CatalogAdminListQueryDto, CatalogItemAdminDto, CatalogStatusDto, UpdateCatalogItemAdminDto } from './dto';
```

- [ ] **Step 2: Update list endpoint query**

Change the existing list method to:

```ts
  @Get()
  @ApiOperation({ summary: '采购目录列表' })
  async list(@Query() query: CatalogAdminListQueryDto) {
    return this.catalogService.list({
      category: query.category,
      region: query.region,
      status: query.status,
      source: query.source,
      search: query.search,
      includeInactive: query.includeInactive,
    });
  }
```

- [ ] **Step 3: Add admin endpoints before `@Get(':id')`**

Insert before the dynamic `@Get(':id')` route so static admin routes do not get captured by `:id`:

```ts
  @Get('admin/stats')
  @Roles('admin', 'procurement_staff')
  @ApiOperation({ summary: '电子商城目录管理统计' })
  async adminStats() {
    return this.catalogService.stats();
  }

  @Post('admin/items')
  @Roles('admin', 'procurement_staff')
  @ApiOperation({ summary: '管理端新增目录' })
  async createAdminItem(@Request() req: any, @Body() dto: CatalogItemAdminDto) {
    return this.catalogService.createAdminItem(req.user.sub, dto);
  }

  @Patch('admin/items/:id')
  @Roles('admin', 'procurement_staff')
  @ApiOperation({ summary: '管理端编辑目录' })
  async updateAdminItem(@Request() req: any, @Param('id') id: string, @Body() dto: UpdateCatalogItemAdminDto) {
    return this.catalogService.updateAdminItem(req.user.sub, id, dto);
  }

  @Patch('admin/items/:id/status')
  @Roles('admin', 'procurement_staff')
  @ApiOperation({ summary: '管理端变更目录状态' })
  async changeStatus(@Request() req: any, @Param('id') id: string, @Body() dto: CatalogStatusDto) {
    return this.catalogService.changeStatus(req.user.sub, id, dto);
  }

  @Get('admin/import-template')
  @Roles('admin', 'procurement_staff')
  @ApiOperation({ summary: '下载电子商城目录导入模板' })
  async importTemplate(@Request() req: any, @Res() res: Response) {
    const buf = await this.catalogService.importTemplate(req.user.sub);
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent('电子商城目录导入模板.xlsx')}`,
    });
    res.end(buf);
  }

  @Post('admin/import')
  @Roles('admin', 'procurement_staff')
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } } })
  @ApiOperation({ summary: '导入电子商城目录' })
  async importItems(@Request() req: any, @UploadedFile() file: Express.Multer.File) {
    return this.catalogService.importItems(req.user.sub, file);
  }

  @Get('admin/audit-logs')
  @Roles('admin', 'procurement_staff')
  @ApiOperation({ summary: '电子商城管理操作日志' })
  async adminAuditLogs() {
    return this.catalogService.adminAuditLogs();
  }
```

- [ ] **Step 4: Run API tests**

Run:

```bash
pnpm --filter api test -- catalog.service.spec.ts catalog-import.spec.ts
```

Expected: PASS.

- [ ] **Step 5: Build API**

Run:

```bash
pnpm --filter api build
```

Expected: build succeeds with no TypeScript errors.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/catalog/catalog.controller.ts
git commit -m "feat(catalog): expose admin catalog endpoints" -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 4: Add 3004 Catalog Admin API Client

**Files:**

- Create: `apps/web/src/lib/api/catalog-admin.ts`

- [ ] **Step 1: Create typed API client**

Create `apps/web/src/lib/api/catalog-admin.ts`:

```ts
export interface CatalogItem {
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

export type CatalogItemInput = Omit<CatalogItem, 'id' | 'updatedAt' | 'createdAt'>;

export interface CatalogStats {
  total: number;
  active: number;
  inactive: number;
  review: number;
  updatedThisMonth: number;
}

export interface ImportResult {
  totalRows: number;
  created: number;
  updated: number;
  failed: number;
  failedRows: Array<{ rowNumber: number; code: string; errors: string[] }>;
}

export interface CatalogAuditLog {
  id: string;
  action: string;
  target: string;
  detail: unknown;
  user?: { username: string; displayName: string };
  createdAt: string;
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    credentials: 'include',
    headers: init?.body instanceof FormData ? undefined : { 'Content-Type': 'application/json' },
    ...init,
  });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(data?.error || data?.message || '请求失败');
  }
  return res.json() as Promise<T>;
}

export function listCatalogItems(params: Record<string, string | undefined> = {}) {
  const sp = new URLSearchParams();
  sp.set('includeInactive', 'true');
  Object.entries(params).forEach(([key, value]) => {
    if (value && value !== '全部') sp.set(key, value);
  });
  return request<CatalogItem[]>(`/api/catalog?${sp.toString()}`);
}

export function getCatalogStats() {
  return request<CatalogStats>('/api/catalog/admin/stats');
}

export function createCatalogItem(input: CatalogItemInput) {
  return request<CatalogItem>('/api/catalog/admin/items', { method: 'POST', body: JSON.stringify(input) });
}

export function updateCatalogItem(id: string, input: CatalogItemInput) {
  return request<CatalogItem>(`/api/catalog/admin/items/${id}`, { method: 'PATCH', body: JSON.stringify(input) });
}

export function changeCatalogStatus(id: string, status: string, reason?: string) {
  return request<CatalogItem>(`/api/catalog/admin/items/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status, reason }) });
}

export async function downloadImportTemplate() {
  const res = await fetch('/api/catalog/admin/import-template', { credentials: 'include' });
  if (!res.ok) throw new Error('模板下载失败');
  return res.blob();
}

export function importCatalogFile(file: File) {
  const form = new FormData();
  form.append('file', file);
  return request<ImportResult>('/api/catalog/admin/import', { method: 'POST', body: form });
}

export function listCatalogAuditLogs() {
  return request<CatalogAuditLog[]>('/api/catalog/admin/audit-logs');
}
```

- [ ] **Step 2: Build web app**

Run:

```bash
pnpm --filter web build
```

Expected: may fail later if pages are not created yet, but this file alone should have no syntax errors. If existing unrelated app build issues appear, record them in the task notes and continue.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/lib/api/catalog-admin.ts
git commit -m "feat(web): add catalog admin api client" -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 5: Add Electronic Mall Management Navigation and Landing

**Files:**

- Modify: `apps/web/src/components/app-shell.tsx`
- Create: `apps/web/src/app/(dashboard)/mall-management/page.tsx`

- [ ] **Step 1: Update icon imports**

In `apps/web/src/components/app-shell.tsx`, add `ShoppingCart` to the lucide import:

```ts
import {
  LayoutDashboard, Building2, Megaphone, UsersRound,
  PanelLeftClose, PanelLeft, ChevronDown, ShoppingCart,
} from 'lucide-react';
```

- [ ] **Step 2: Add navigation group**

Append this object to `navItems` after the expert group:

```ts
  {
    label: '电子商城管理', path: '/mall-management', icon: ShoppingCart,
    children: [
      { label: '价格审批', path: '/mall-management/approval' },
      { label: '价格录入', path: '/mall-management/price-entry' },
      { label: '集中采购目录管理', path: '/mall-management/catalog' },
      { label: '同步与操作日志', path: '/mall-management/logs' },
    ],
  },
```

- [ ] **Step 3: Create landing redirect page**

Create `apps/web/src/app/(dashboard)/mall-management/page.tsx`:

```tsx
import { redirect } from 'next/navigation';

export default function MallManagementPage() {
  redirect('/mall-management/catalog');
}
```

- [ ] **Step 4: Run lint/build check**

Run:

```bash
pnpm --filter web build
```

Expected: build succeeds unless unrelated existing pages have build issues. Record exact output if it fails.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/app-shell.tsx 'apps/web/src/app/(dashboard)/mall-management/page.tsx'
git commit -m "feat(web): add electronic mall management navigation" -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 6: Add Price Approval Placeholder Page

**Files:**

- Create: `apps/web/src/app/(dashboard)/mall-management/approval/page.tsx`

- [ ] **Step 1: Create approval placeholder page**

Create `apps/web/src/app/(dashboard)/mall-management/approval/page.tsx`:

```tsx
'use client';

const stats = [
  { label: '待审批申请', value: '0', note: '供应商入口未开放' },
  { label: '本月通过', value: '0', note: '未来审批流统计' },
  { label: '本月驳回', value: '0', note: '未来审批流统计' },
  { label: '平均处理时长', value: '--', note: '功能建设中' },
];

export default function PriceApprovalPage() {
  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm font-semibold text-[#064ea2]">电子商城管理</p>
        <h1 className="mt-1 text-2xl font-black text-[#18243a]">价格审批</h1>
        <p className="mt-2 text-sm text-[#5a6d8a]">供应商报价调整和新增名录申请的未来审批入口。本轮先展示管理型占位，不接入真实申请数据。</p>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        {stats.map(item => (
          <div key={item.label} className="rounded-2xl border border-[#dce6f3] bg-white p-5 shadow-sm">
            <div className="text-sm font-semibold text-[#5a6d8a]">{item.label}</div>
            <div className="mt-3 text-3xl font-black text-[#123a6e]">{item.value}</div>
            <div className="mt-2 text-xs text-[#8a99ad]">{item.note}</div>
          </div>
        ))}
      </div>

      <div className="rounded-2xl border border-[#dce6f3] bg-white p-5 shadow-sm">
        <div className="grid gap-3 md:grid-cols-4">
          <select disabled className="rounded-xl border border-[#d5e0ef] bg-[#f8fafc] px-3 py-2 text-sm text-[#8a99ad]"><option>全部申请类型</option></select>
          <select disabled className="rounded-xl border border-[#d5e0ef] bg-[#f8fafc] px-3 py-2 text-sm text-[#8a99ad]"><option>全部状态</option></select>
          <input disabled placeholder="搜索供应商/目录" className="rounded-xl border border-[#d5e0ef] bg-[#f8fafc] px-3 py-2 text-sm" />
          <button disabled className="rounded-xl bg-[#d5e0ef] px-4 py-2 text-sm font-bold text-[#8a99ad]">查询</button>
        </div>
      </div>

      <div className="rounded-2xl border border-dashed border-[#b8c7dc] bg-white p-10 text-center shadow-sm">
        <div className="text-lg font-black text-[#18243a]">供应商端申请入口尚未开放</div>
        <p className="mt-2 text-sm text-[#5a6d8a]">未来流程：供应商提交 → 采购中心初审 → 价格生效 → 商城同步。</p>
        <div className="mt-6 grid gap-3 md:grid-cols-4">
          {['供应商提交', '采购中心初审', '价格生效', '商城同步'].map((step, index) => (
            <div key={step} className="rounded-xl bg-[#f3f7fc] p-4 text-sm font-bold text-[#123a6e]">
              {index + 1}. {step}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Build web app**

Run:

```bash
pnpm --filter web build
```

Expected: build succeeds unless unrelated existing issues appear.

- [ ] **Step 3: Commit**

```bash
git add 'apps/web/src/app/(dashboard)/mall-management/approval/page.tsx'
git commit -m "feat(web): add price approval placeholder" -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 7: Add Catalog Management Page

**Files:**

- Create: `apps/web/src/app/(dashboard)/mall-management/catalog/page.tsx`

- [ ] **Step 1: Create catalog management page**

Create `apps/web/src/app/(dashboard)/mall-management/catalog/page.tsx`:

```tsx
'use client';

import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { changeCatalogStatus, getCatalogStats, listCatalogItems, type CatalogItem, type CatalogStats } from '@/lib/api/catalog-admin';

const statuses = ['全部', '有效', '价格波动', '即将过期', '待复核', '下架', '停用'];

export default function CatalogManagementPage() {
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [stats, setStats] = useState<CatalogStats | null>(null);
  const [status, setStatus] = useState('全部');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const [list, s] = await Promise.all([listCatalogItems({ status }), getCatalogStats()]);
      setItems(list);
      setStats(s);
    } catch (err: any) {
      toast.error(err.message || '加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [status]);

  const filtered = useMemo(() => {
    const kw = search.trim();
    return items.filter(item => !kw || [item.code, item.name, item.specification, item.category, item.supplier].some(v => v.includes(kw)));
  }, [items, search]);

  const setItemStatus = async (item: CatalogItem, nextStatus: string) => {
    const ok = window.confirm(`确认将 ${item.name} 状态改为「${nextStatus}」？`);
    if (!ok) return;
    try {
      await changeCatalogStatus(item.id, nextStatus, `管理端${nextStatus}`);
      toast.success('状态已更新');
      await load();
    } catch (err: any) {
      toast.error(err.message || '状态更新失败');
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm font-semibold text-[#064ea2]">电子商城管理</p>
        <h1 className="mt-1 text-2xl font-black text-[#18243a]">集中采购目录管理</h1>
        <p className="mt-2 text-sm text-[#5a6d8a]">维护商城目录，支持筛选、查看、启用和下架。下架不会删除历史数据。</p>
      </div>

      <div className="grid gap-4 md:grid-cols-5">
        {[
          ['目录总数', stats?.total ?? '--'],
          ['有效目录', stats?.active ?? '--'],
          ['下架/停用', stats?.inactive ?? '--'],
          ['待复核/预警', stats?.review ?? '--'],
          ['本月更新', stats?.updatedThisMonth ?? '--'],
        ].map(([label, value]) => (
          <div key={label} className="rounded-2xl border border-[#dce6f3] bg-white p-5 shadow-sm">
            <div className="text-sm font-semibold text-[#5a6d8a]">{label}</div>
            <div className="mt-3 text-2xl font-black text-[#123a6e]">{value}</div>
          </div>
        ))}
      </div>

      <div className="rounded-2xl border border-[#dce6f3] bg-white p-5 shadow-sm">
        <div className="grid gap-3 md:grid-cols-[180px_1fr_auto]">
          <select value={status} onChange={e => setStatus(e.target.value)} className="rounded-xl border border-[#d5e0ef] px-3 py-2 text-sm">
            {statuses.map(s => <option key={s}>{s}</option>)}
          </select>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="搜索编码、名称、规格、分类、供应商" className="rounded-xl border border-[#d5e0ef] px-3 py-2 text-sm" />
          <button onClick={load} className="rounded-xl bg-[#064ea2] px-4 py-2 text-sm font-bold text-white">刷新</button>
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-[#dce6f3] bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="bg-[#f3f7fc] text-[#5a6d8a]">
            <tr>
              <th className="px-4 py-3">目录编码</th>
              <th className="px-4 py-3">名称/规格</th>
              <th className="px-4 py-3">分类</th>
              <th className="px-4 py-3">参考价</th>
              <th className="px-4 py-3">供应商</th>
              <th className="px-4 py-3">状态</th>
              <th className="px-4 py-3">操作</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} className="px-4 py-10 text-center text-[#8a99ad]">加载中...</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-10 text-center text-[#8a99ad]">暂无目录</td></tr>
            ) : filtered.map(item => (
              <tr key={item.id} className="border-t border-[#edf2f7]">
                <td className="px-4 py-3 font-mono text-xs text-[#123a6e]">{item.code}</td>
                <td className="px-4 py-3"><div className="font-bold text-[#18243a]">{item.name}</div><div className="text-xs text-[#8a99ad]">{item.specification}</div></td>
                <td className="px-4 py-3">{item.category}</td>
                <td className="px-4 py-3 font-bold">¥{item.referencePrice.toLocaleString('zh-CN')}</td>
                <td className="px-4 py-3">{item.supplier}</td>
                <td className="px-4 py-3"><span className="rounded-full bg-[#f3f7fc] px-2 py-1 text-xs font-bold text-[#123a6e]">{item.status}</span></td>
                <td className="px-4 py-3">
                  <div className="flex gap-2">
                    {item.status === '有效' ? (
                      <button onClick={() => setItemStatus(item, '下架')} className="rounded-lg border border-orange-200 px-2 py-1 text-xs font-bold text-orange-700">下架</button>
                    ) : (
                      <button onClick={() => setItemStatus(item, '有效')} className="rounded-lg border border-emerald-200 px-2 py-1 text-xs font-bold text-emerald-700">启用</button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Build web app**

Run:

```bash
pnpm --filter web build
```

Expected: PASS unless unrelated existing issues appear.

- [ ] **Step 3: Commit**

```bash
git add 'apps/web/src/app/(dashboard)/mall-management/catalog/page.tsx'
git commit -m "feat(web): add catalog management page" -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 8: Add Price Entry Page With Manual Create and Import

**Files:**

- Create: `apps/web/src/app/(dashboard)/mall-management/price-entry/page.tsx`

- [ ] **Step 1: Create price entry page**

Create `apps/web/src/app/(dashboard)/mall-management/price-entry/page.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { createCatalogItem, downloadImportTemplate, importCatalogFile, type CatalogItemInput, type ImportResult } from '@/lib/api/catalog-admin';

const emptyForm: CatalogItemInput = {
  code: '', name: '', specification: '', category: '', group: '', unit: '', referencePrice: 0, priceMin: 0, priceMax: 0,
  lastDealPrice: 0, averagePrice: 0, supplier: '', supplierType: '协议供应商', priceSource: '人工维护', region: '全省',
  taxIncluded: true, freightIncluded: false, changeRate: 0, minOrder: '', remark: null, status: '有效', validUntil: null,
};

export default function PriceEntryPage() {
  const [form, setForm] = useState<CatalogItemInput>(emptyForm);
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [saving, setSaving] = useState(false);

  const setField = (key: keyof CatalogItemInput, value: string | number | boolean | null) => setForm(prev => ({ ...prev, [key]: value }));

  const submit = async () => {
    setSaving(true);
    try {
      await createCatalogItem(form);
      toast.success('目录已新增');
      setForm(emptyForm);
    } catch (err: any) {
      toast.error(err.message || '新增失败');
    } finally {
      setSaving(false);
    }
  };

  const downloadTemplate = async () => {
    try {
      const blob = await downloadImportTemplate();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = '电子商城目录导入模板.xlsx';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      toast.error(err.message || '模板下载失败');
    }
  };

  const upload = async () => {
    if (!file) { toast.error('请选择文件'); return; }
    try {
      const res = await importCatalogFile(file);
      setResult(res);
      toast.success(res.failed ? '导入部分成功' : '导入成功');
    } catch (err: any) {
      toast.error(err.message || '导入失败');
    }
  };

  const numberInput = (key: keyof CatalogItemInput, label: string) => (
    <label className="space-y-1 text-sm font-semibold text-[#5a6d8a]">
      <span>{label}</span>
      <input type="number" value={Number(form[key] || 0)} onChange={e => setField(key, Number(e.target.value))} className="w-full rounded-xl border border-[#d5e0ef] px-3 py-2" />
    </label>
  );

  const textInput = (key: keyof CatalogItemInput, label: string) => (
    <label className="space-y-1 text-sm font-semibold text-[#5a6d8a]">
      <span>{label}</span>
      <input value={String(form[key] ?? '')} onChange={e => setField(key, e.target.value)} className="w-full rounded-xl border border-[#d5e0ef] px-3 py-2" />
    </label>
  );

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm font-semibold text-[#064ea2]">电子商城管理</p>
        <h1 className="mt-1 text-2xl font-black text-[#18243a]">价格录入</h1>
        <p className="mt-2 text-sm text-[#5a6d8a]">支持手动新增目录和 CSV/Excel 批量导入。导入时目录编码存在则更新，不存在则新增。</p>
      </div>

      <div className="rounded-2xl border border-[#dce6f3] bg-white p-5 shadow-sm">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-black text-[#18243a]">批量导入</h2>
          <button onClick={downloadTemplate} className="rounded-xl border border-[#064ea2] px-4 py-2 text-sm font-bold text-[#064ea2]">下载模板</button>
        </div>
        <div className="flex flex-wrap gap-3">
          <input type="file" accept=".xlsx,.xls,.csv" onChange={e => setFile(e.target.files?.[0] || null)} className="rounded-xl border border-[#d5e0ef] px-3 py-2 text-sm" />
          <button onClick={upload} className="rounded-xl bg-[#064ea2] px-4 py-2 text-sm font-bold text-white">开始导入</button>
        </div>
        {result && (
          <div className="mt-4 rounded-xl bg-[#f3f7fc] p-4 text-sm text-[#18243a]">
            <div className="font-bold">总行数 {result.totalRows}，新增 {result.created}，更新 {result.updated}，失败 {result.failed}</div>
            {result.failedRows.length > 0 && <ul className="mt-2 list-disc pl-5 text-orange-700">{result.failedRows.map(row => <li key={row.rowNumber}>第 {row.rowNumber} 行（{row.code || '无编码'}）：{row.errors.join('；')}</li>)}</ul>}
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-[#dce6f3] bg-white p-5 shadow-sm">
        <h2 className="mb-4 text-lg font-black text-[#18243a]">手动新增目录</h2>
        <div className="grid gap-4 md:grid-cols-3">
          {textInput('code', '目录编码')}{textInput('name', '名称')}{textInput('specification', '规格型号')}
          {textInput('category', '分类')}{textInput('group', '分组')}{textInput('unit', '单位')}
          {numberInput('referencePrice', '参考价')}{numberInput('priceMin', '价格下限')}{numberInput('priceMax', '价格上限')}
          {numberInput('lastDealPrice', '最近成交价')}{numberInput('averagePrice', '历史均价')}{numberInput('changeRate', '价格变化率')}
          {textInput('supplier', '供应商')}{textInput('supplierType', '供应商类型')}{textInput('priceSource', '价格来源')}
          {textInput('region', '区域')}{textInput('minOrder', '最小起订量')}{textInput('validUntil', '有效期 YYYY-MM-DD')}
        </div>
        <label className="mt-4 block space-y-1 text-sm font-semibold text-[#5a6d8a]">
          <span>备注</span>
          <textarea value={form.remark || ''} onChange={e => setField('remark', e.target.value || null)} className="w-full rounded-xl border border-[#d5e0ef] px-3 py-2" rows={3} />
        </label>
        <button disabled={saving} onClick={submit} className="mt-5 rounded-xl bg-[#064ea2] px-5 py-2.5 text-sm font-bold text-white disabled:opacity-60">{saving ? '保存中...' : '新增目录'}</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Build web app**

Run:

```bash
pnpm --filter web build
```

Expected: PASS unless unrelated existing issues appear.

- [ ] **Step 3: Commit**

```bash
git add 'apps/web/src/app/(dashboard)/mall-management/price-entry/page.tsx'
git commit -m "feat(web): add price entry page" -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 9: Add Sync and Operation Logs Page

**Files:**

- Create: `apps/web/src/app/(dashboard)/mall-management/logs/page.tsx`

- [ ] **Step 1: Create logs page**

Create `apps/web/src/app/(dashboard)/mall-management/logs/page.tsx`:

```tsx
'use client';

import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { listCatalogAuditLogs, type CatalogAuditLog } from '@/lib/api/catalog-admin';

const labels: Record<string, string> = {
  CATALOG_CREATED: '新增目录',
  CATALOG_UPDATED: '编辑目录',
  CATALOG_PRICE_CHANGED: '价格调整',
  CATALOG_STATUS_CHANGED: '状态变更',
  CATALOG_IMPORTED: '批量导入',
  CATALOG_TEMPLATE_DOWNLOADED: '模板下载',
  CATALOG_EXPORTED: '目录导出',
};

export default function MallManagementLogsPage() {
  const [logs, setLogs] = useState<CatalogAuditLog[]>([]);
  const [action, setAction] = useState('全部');
  const [search, setSearch] = useState('');

  useEffect(() => {
    listCatalogAuditLogs().then(setLogs).catch((err: any) => toast.error(err.message || '日志加载失败'));
  }, []);

  const filtered = useMemo(() => logs.filter(log => {
    const matchAction = action === '全部' || log.action === action;
    const kw = search.trim();
    const matchSearch = !kw || log.target.includes(kw) || JSON.stringify(log.detail || {}).includes(kw);
    return matchAction && matchSearch;
  }), [logs, action, search]);

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm font-semibold text-[#064ea2]">电子商城管理</p>
        <h1 className="mt-1 text-2xl font-black text-[#18243a]">同步与操作日志</h1>
        <p className="mt-2 text-sm text-[#5a6d8a]">商城读取同一套目录数据，无独立同步队列。这里展示目录导入、改价、下架和导出等操作记录。</p>
      </div>

      <div className="rounded-2xl border border-[#dce6f3] bg-white p-5 shadow-sm">
        <div className="grid gap-3 md:grid-cols-[220px_1fr]">
          <select value={action} onChange={e => setAction(e.target.value)} className="rounded-xl border border-[#d5e0ef] px-3 py-2 text-sm">
            <option>全部</option>
            {Object.keys(labels).map(key => <option key={key} value={key}>{labels[key]}</option>)}
          </select>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="搜索操作对象或详情" className="rounded-xl border border-[#d5e0ef] px-3 py-2 text-sm" />
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-[#dce6f3] bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="bg-[#f3f7fc] text-[#5a6d8a]"><tr><th className="px-4 py-3">时间</th><th className="px-4 py-3">操作人</th><th className="px-4 py-3">类型</th><th className="px-4 py-3">对象</th><th className="px-4 py-3">详情</th></tr></thead>
          <tbody>
            {filtered.length === 0 ? <tr><td colSpan={5} className="px-4 py-10 text-center text-[#8a99ad]">暂无日志</td></tr> : filtered.map(log => (
              <tr key={log.id} className="border-t border-[#edf2f7] align-top">
                <td className="px-4 py-3 text-xs text-[#5a6d8a]">{log.createdAt.slice(0, 19).replace('T', ' ')}</td>
                <td className="px-4 py-3">{log.user?.displayName || log.user?.username || '-'}</td>
                <td className="px-4 py-3"><span className="rounded-full bg-[#f3f7fc] px-2 py-1 text-xs font-bold text-[#123a6e]">{labels[log.action] || log.action}</span></td>
                <td className="px-4 py-3 font-mono text-xs">{log.target}</td>
                <td className="px-4 py-3"><pre className="max-w-xl whitespace-pre-wrap rounded-xl bg-[#f8fafc] p-3 text-xs text-[#5a6d8a]">{JSON.stringify(log.detail || {}, null, 2)}</pre></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Build web app**

Run:

```bash
pnpm --filter web build
```

Expected: PASS unless unrelated existing issues appear.

- [ ] **Step 3: Commit**

```bash
git add 'apps/web/src/app/(dashboard)/mall-management/logs/page.tsx'
git commit -m "feat(web): add mall management logs page" -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 10: Harden 3002 Mall Active-Only Display

**Files:**

- Modify: `apps/mall/src/app/page.tsx`

- [ ] **Step 1: Add defensive active filter on fetch result**

In `apps/mall/src/app/page.tsx`, find:

```ts
setItems(Array.isArray(data) ? (data as CatalogItem[]) : []);
```

Replace with:

```ts
const nextItems = Array.isArray(data) ? (data as CatalogItem[]) : [];
setItems(nextItems.filter(item => item.status === '有效'));
```

This is defensive. The API should already filter non-effective items for mall calls.

- [ ] **Step 2: Build mall app**

Run:

```bash
pnpm --filter mall build
```

Expected: PASS unless unrelated existing issues appear.

- [ ] **Step 3: Commit**

```bash
git add apps/mall/src/app/page.tsx
git commit -m "feat(mall): show only active catalog items" -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 11: Final Verification

**Files:**

- No new files unless fixes are needed.

- [ ] **Step 1: Run API tests**

Run:

```bash
pnpm --filter api test -- catalog.service.spec.ts catalog-import.spec.ts
```

Expected: PASS.

- [ ] **Step 2: Build API**

Run:

```bash
pnpm --filter api build
```

Expected: PASS.

- [ ] **Step 3: Build web and mall**

Run:

```bash
pnpm --filter web build
pnpm --filter mall build
```

Expected: PASS. If unrelated existing build errors occur, capture the exact output and identify whether they are caused by this feature.

- [ ] **Step 4: Manual browser verification**

Have the user run dev servers if they are not already running:

```bash
pnpm dev
```

Manual checks:

1. Log in to 3004 with `caigou / caigou@2026`.
2. Confirm left nav shows `电子商城管理` with four child pages.
3. Open `价格审批`; confirm it is a management-style placeholder and does not imply real supplier submissions exist.
4. Open `价格录入`; download the template.
5. Manually create an item with status `有效` and a unique code such as `CAT-MANUAL-20260614`.
6. Open `集中采购目录管理`; confirm the item appears.
7. Open 3002 mall as the mall user and confirm the new active item appears after refresh.
8. Back in 3004, set the item to `下架`.
9. Refresh 3002 mall and confirm the item no longer appears.
10. Open `同步与操作日志`; confirm create/status-change/template-download logs appear.

- [ ] **Step 5: Final commit if verification fixes were needed**

If verification required fixes:

```bash
git add <changed-files>
git commit -m "fix: complete electronic mall management verification" -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

If no fixes were needed, do not create an empty commit.

---

## Self-Review

Spec coverage:

- Backend admin Catalog API: Tasks 1-3.
- CSV/Excel import with `code` upsert: Tasks 1-3.
- Price history on new item and price change: Task 2.
- Audit logs: Tasks 2, 3, 9.
- 3004 four pages: Tasks 5-9.
- Price approval placeholder: Task 6.
- Catalog down/suspend instead of delete: Tasks 2, 7.
- 3002 active-only display: Tasks 2, 10.
- Tests and verification: Tasks 1, 2, 11.

Placeholder scan:

- No implementation steps use forbidden placeholder markers.
- Code examples provide concrete function names, file paths, and commands.

Type consistency:

- `CatalogItemAdminDto`, `UpdateCatalogItemAdminDto`, and `CatalogStatusDto` are defined in Task 1 and used in Tasks 2-3.
- `CatalogItemInput`, `ImportResult`, and `CatalogAuditLog` are defined in Task 4 and used in Tasks 7-9.
- Service method names used by controller match Task 2 definitions.
