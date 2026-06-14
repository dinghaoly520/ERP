import { BadRequestException } from '@nestjs/common';
import { Readable } from 'stream';
import { Workbook } from 'exceljs';

import { CatalogStatus } from './dto';

export interface CatalogImportRowResult {
  rowNumber: number;
  code: string;
  data?: Record<string, unknown>;
  errors: string[];
}

export interface CatalogImportParseResult {
  rows: CatalogImportRowResult[];
}

const HEADER_ALIASES: Record<string, string> = {
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

const REQUIRED_FIELDS = [
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

const NUMBER_FIELDS = [
  'referencePrice',
  'priceMin',
  'priceMax',
  'lastDealPrice',
  'averagePrice',
  'changeRate',
];

const STRING_FIELDS = [
  'code',
  'name',
  'specification',
  'category',
  'group',
  'unit',
  'supplier',
  'supplierType',
  'priceSource',
  'region',
  'minOrder',
];

function cellText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') {
    const cellValue = value as { text?: unknown; result?: unknown };
    if (cellValue.text !== undefined) return cellText(cellValue.text);
    if (cellValue.result !== undefined) return cellText(cellValue.result);
  }
  return String(value).trim();
}

export function parseBoolean(value: unknown): boolean {
  const normalized = cellText(value).toLowerCase();
  if (['是', 'true', '1', 'yes', 'y'].includes(normalized)) return true;
  if (['否', 'false', '0', 'no', 'n'].includes(normalized)) return false;
  return false;
}

function normalizeHeader(header: string): string | undefined {
  return HEADER_ALIASES[header] ?? HEADER_ALIASES[header.trim()];
}

function normalizeDate(value: unknown): string | null {
  const text = cellText(value);
  if (!text) return null;
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? text : parsed.toISOString();
}

function parseNumber(value: unknown, fallback: number, field: string, errors: string[]): number {
  const text = cellText(value);
  if (!text) return field === 'changeRate' ? 0 : fallback;
  const parsed = Number(text);
  if (Number.isNaN(parsed)) {
    errors.push(`${field}必须是数字`);
    return field === 'changeRate' ? 0 : fallback;
  }
  if (field !== 'changeRate' && parsed < 0) {
    errors.push(`${field}不能为负数`);
  }
  return parsed;
}

export function normalizeCatalogImportRow(
  rowNumber: number,
  raw: Record<string, unknown>,
): CatalogImportRowResult {
  const normalized: Record<string, unknown> = {};

  for (const [header, value] of Object.entries(raw)) {
    const field = normalizeHeader(header);
    if (field) normalized[field] = value;
  }

  const errors: string[] = [];

  for (const field of REQUIRED_FIELDS) {
    if (!cellText(normalized[field])) {
      errors.push(`${field}不能为空`);
    }
  }

  const referenceText = cellText(normalized.referencePrice);
  const referencePrice = referenceText ? Number(referenceText) : 0;
  if (referenceText && Number.isNaN(referencePrice)) {
    errors.push('referencePrice必须是数字');
  }

  const data: Record<string, unknown> = {};

  for (const field of STRING_FIELDS) {
    data[field] = cellText(normalized[field]);
  }

  for (const field of NUMBER_FIELDS) {
    data[field] = parseNumber(normalized[field], referencePrice, field, errors);
  }

  data.taxIncluded = normalized.taxIncluded === undefined || cellText(normalized.taxIncluded) === ''
    ? true
    : parseBoolean(normalized.taxIncluded);
  data.freightIncluded = normalized.freightIncluded === undefined || cellText(normalized.freightIncluded) === ''
    ? false
    : parseBoolean(normalized.freightIncluded);
  data.status = (cellText(normalized.status) || '有效') as CatalogStatus;
  data.validUntil = normalizeDate(normalized.validUntil);
  data.remark = cellText(normalized.remark) || null;

  if (
    typeof data.priceMin === 'number' &&
    typeof data.priceMax === 'number' &&
    typeof data.referencePrice === 'number' &&
    (data.priceMin > data.referencePrice || data.referencePrice > data.priceMax)
  ) {
    errors.push('参考价必须位于价格下限和价格上限之间');
  }

  return {
    rowNumber,
    code: String(data.code ?? ''),
    data: errors.length === 0 ? data : undefined,
    errors,
  };
}

function rowIsEmpty(values: unknown[]): boolean {
  return values.every((value) => !cellText(value));
}

export async function parseCatalogImport(
  buffer: Buffer,
  filename: string,
): Promise<CatalogImportParseResult> {
  if (!/\.(xlsx|xls|csv)$/i.test(filename)) {
    throw new BadRequestException({ error: '仅支持 .xlsx、.xls、.csv 文件', code: 'INVALID_FILE_TYPE' });
  }

  const workbook = new Workbook();
  if (/\.csv$/i.test(filename)) {
    const stream = Readable.from(buffer.toString('utf8'));
    await workbook.csv.read(stream);
  } else {
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  }

  const worksheet = workbook.worksheets[0];
  if (!worksheet) return { rows: [] };

  const headerRow = worksheet.getRow(1);
  const headers = (headerRow.values as unknown[]).slice(1).map(cellText);
  const rows: CatalogImportRowResult[] = [];

  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const values = (row.values as unknown[]).slice(1);
    if (rowIsEmpty(values)) return;

    const raw: Record<string, unknown> = {};
    headers.forEach((header, index) => {
      raw[header] = values[index];
    });
    rows.push(normalizeCatalogImportRow(rowNumber, raw));
  });

  return { rows };
}
