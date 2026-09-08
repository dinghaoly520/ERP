import { BadRequestException } from '@nestjs/common';
import { BOND_STATUS_OPTIONS } from './bid-bond-status';

/**
 * 唱标字段动态配置（A-113，P2）——BidProject.openingFieldConfig 的解析与形状校验。
 * 形状单一权威定义（前后端共用注释引用，2026-09-08 计划「字段配置形状」）：
 *   { fields: Array<{ key, label, type: 'text'|'number'|'select', options?, required?, prefillFrom? }> }
 * 法定不变量：amount/period/qualityTarget/bondStatus 四法定键不可删、type 不可改（配置只能增列/调序/改标签）；
 * 四法定键的值仍落 BidOpeningRecord 专属列（密封校验/价格链路零改动），动态键落 customFields。
 */

export type OpeningFieldType = 'text' | 'number' | 'select';

/** 法定四键：amount 报价 / period 工期 / qualityTarget 质量承诺 / bondStatus 保证金 */
export type StatutoryOpeningKey = 'amount' | 'period' | 'qualityTarget' | 'bondStatus';

export const STATUTORY_OPENING_KEYS: readonly StatutoryOpeningKey[] = ['amount', 'period', 'qualityTarget', 'bondStatus'];

export interface OpeningFieldDef {
  /** 唯一键；法定四键不可删、type 固定 */
  key: string;
  /** 列/表单标签（非空，≤20 字） */
  label: string;
  type: OpeningFieldType;
  /** type=select 必填（非空选项集） */
  options?: string[];
  /** 默认 false；法定四字段恒 true */
  required?: boolean;
  /** 复用既有解密封预填（仅法定键——动态键无密封源） */
  prefillFrom?: StatutoryOpeningKey;
}

export interface OpeningFieldConfig {
  fields: OpeningFieldDef[];
}

/** 内置默认四字段（openingFieldConfig=null 时使用——null 配置全量向后兼容） */
export const DEFAULT_OPENING_FIELDS: readonly OpeningFieldDef[] = [
  { key: 'amount', label: '报价', type: 'text', required: true, prefillFrom: 'amount' },
  { key: 'period', label: '工期', type: 'text', required: true, prefillFrom: 'period' },
  { key: 'qualityTarget', label: '质量承诺', type: 'text', required: true, prefillFrom: 'qualityTarget' },
  { key: 'bondStatus', label: '保证金', type: 'select', options: [...BOND_STATUS_OPTIONS], required: true, prefillFrom: 'bondStatus' },
];

/**
 * 项目级配置解析：openingFieldConfig.fields 非空数组 → 用之，否则默认四字段。
 * 写入端（PUT opening-field-config / WorkTemplate apply）已过 assertValidOpeningFieldConfig，
 * 此处不做重复校验——脏数据防御性回退默认，保开标现场可用。
 */
export function resolveOpeningFieldConfig(
  project: { openingFieldConfig?: unknown } | null | undefined,
): OpeningFieldConfig {
  const raw = project?.openingFieldConfig as { fields?: unknown } | null | undefined;
  const fields =
    Array.isArray(raw?.fields) && raw.fields.length > 0 ? (raw.fields as OpeningFieldDef[]) : DEFAULT_OPENING_FIELDS;
  return { fields: [...fields] };
}

/**
 * 配置形状校验（写入端调用——PUT /bid/projects/:id/opening-field-config 与 WorkTemplate apply 复用）。
 * 拒绝：key 空/重复、法定四键缺失或 type 与默认不一致、select 无非空 options、
 * prefillFrom 非法定键、label 空/超 20 字、type 非 text/number/select。
 */
export function assertValidOpeningFieldConfig(fields: OpeningFieldDef[]): void {
  if (!Array.isArray(fields) || fields.length === 0) {
    throw new BadRequestException({ error: '唱标字段配置不能为空', code: 'OPENING_FIELD_CONFIG_INVALID' });
  }
  const seen = new Set<string>();
  const defaultsByKey = new Map(DEFAULT_OPENING_FIELDS.map((f) => [f.key, f]));
  for (const f of fields) {
    if (typeof f?.key !== 'string' || !f.key.trim()) {
      throw new BadRequestException({ error: `字段「${f?.label ?? '?'}」key 不能为空`, code: 'OPENING_FIELD_CONFIG_INVALID' });
    }
    if (seen.has(f.key)) {
      throw new BadRequestException({ error: `字段 key「${f.key}」重复`, code: 'OPENING_FIELD_CONFIG_INVALID' });
    }
    seen.add(f.key);
    if (typeof f.label !== 'string' || !f.label.trim()) {
      throw new BadRequestException({ error: `字段「${f.key}」label 不能为空`, code: 'OPENING_FIELD_CONFIG_INVALID' });
    }
    if (f.label.length > 20) {
      throw new BadRequestException({ error: `字段「${f.key}」label 不能超过 20 字`, code: 'OPENING_FIELD_CONFIG_INVALID' });
    }
    if (f.type !== 'text' && f.type !== 'number' && f.type !== 'select') {
      throw new BadRequestException({ error: `字段「${f.key}」type 须为 text/number/select`, code: 'OPENING_FIELD_CONFIG_INVALID' });
    }
    const statutory = defaultsByKey.get(f.key);
    if (statutory && f.type !== statutory.type) {
      throw new BadRequestException({
        error: `法定字段「${f.key}」type 不可修改（须为 ${statutory.type}）`,
        code: 'OPENING_FIELD_CONFIG_INVALID',
      });
    }
    if (f.type === 'select' && (!Array.isArray(f.options) || f.options.length === 0)) {
      throw new BadRequestException({ error: `字段「${f.key}」为下拉选择，须提供非空 options`, code: 'OPENING_FIELD_CONFIG_INVALID' });
    }
    if (f.prefillFrom !== undefined && !STATUTORY_OPENING_KEYS.includes(f.prefillFrom)) {
      throw new BadRequestException({
        error: `字段「${f.key}」prefillFrom 仅允许法定键（amount/period/qualityTarget/bondStatus）`,
        code: 'OPENING_FIELD_CONFIG_INVALID',
      });
    }
  }
  for (const key of STATUTORY_OPENING_KEYS) {
    if (!seen.has(key)) {
      throw new BadRequestException({ error: `法定字段「${key}」不可从配置中删除`, code: 'OPENING_FIELD_CONFIG_INVALID' });
    }
  }
}
