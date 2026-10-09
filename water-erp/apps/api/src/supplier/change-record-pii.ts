/* =================================================================
   供应商变更申请 PII 密封/拆封/脱敏（SupplierChangeRecord.oldValue/newValue）

   变更记录的值有两类载体：
   - 简单字段（legalPersonIdCard / legalPersonPhone）：列值直接密封
   - 聚合 JSON（bankAccounts / convertToRegular）：只对 JSON 内 PII 键
     （accountNo / legalPersonIdCard / contacts[].phone|idCard|email）处理

   三种模式：
   - sealChangeValue：供应商门户提交时落库前密封
   - openChangeValue：本人自视 / 审批应用时拆封（无前缀值容错透传）
   - maskChangeValue：管理端展示时拆封后掩码（等保+密评出口脱敏）

   与 supplier.service 列级密封（sealPii 直写）互不替代：本文件只管
   变更记录字符串载荷的进出。
   ================================================================= */

import { sealPii, openPii, isSealedFieldSm } from '../common/crypto/sm-field-crypto';
import { maskPhone, maskIdNumber, maskEmail, maskBankAccount } from '../common/pii-mask';

type Masker = (v: string | null) => string | null;

/** 简单 PII 字段 → 掩码函数 */
const SIMPLE_PII: Record<string, Masker> = {
  legalPersonIdCard: maskIdNumber,
  legalPersonPhone: maskPhone,
};

function safeOpen(v: string): string {
  return isSealedFieldSm(v) ? (openPii(v) as string) : v;
}

function applyMode(mode: 'seal' | 'open' | 'mask', v: unknown, masker: Masker): unknown {
  if (v == null || typeof v !== 'string' || v === '') return v;
  if (mode === 'seal') return sealPii(v) ?? null;
  if (mode === 'open') return safeOpen(v);
  return masker(safeOpen(v));
}

/** 聚合 JSON 内 PII 键处理；解析失败原样返回（不因脱敏工具炸审批流） */
function transformJson(fieldName: string, value: string, mode: 'seal' | 'open' | 'mask'): string {
  let obj: unknown;
  try {
    obj = JSON.parse(value);
  } catch {
    return value;
  }
  if (obj == null || typeof obj !== 'object') return value;

  if (fieldName === 'bankAccounts' && Array.isArray(obj)) {
    for (const item of obj) {
      if (item && typeof item === 'object' && 'accountNo' in item) {
        (item as Record<string, unknown>).accountNo = applyMode(mode, (item as Record<string, unknown>).accountNo, maskBankAccount);
      }
    }
  }
  if (fieldName === 'convertToRegular') {
    const rec = obj as Record<string, unknown>;
    if ('legalPersonIdCard' in rec) {
      rec.legalPersonIdCard = applyMode(mode, rec.legalPersonIdCard, maskIdNumber);
    }
    if (Array.isArray(rec.contacts)) {
      for (const c of rec.contacts) {
        if (!c || typeof c !== 'object') continue;
        const contact = c as Record<string, unknown>;
        if ('phone' in contact) contact.phone = applyMode(mode, contact.phone, maskPhone);
        if ('idCard' in contact) contact.idCard = applyMode(mode, contact.idCard, maskIdNumber);
        if ('email' in contact) contact.email = applyMode(mode, contact.email, maskEmail);
      }
    }
  }
  return JSON.stringify(obj);
}

function transform(fieldName: string, value: string | null, mode: 'seal' | 'open' | 'mask'): string | null {
  if (value == null || value === '') return value;
  if (SIMPLE_PII[fieldName]) {
    const out = applyMode(mode, value, SIMPLE_PII[fieldName]);
    return (out == null ? null : String(out));
  }
  if (fieldName === 'bankAccounts' || fieldName === 'convertToRegular') {
    return transformJson(fieldName, value, mode);
  }
  return value;
}

/** 变更申请落库前密封 PII（非 PII 字段原样透传） */
export function sealChangeValue(fieldName: string, value: string | null): string | null {
  return transform(fieldName, value, 'seal');
}

/** 变更申请读取时拆封（本人自视 / 审批应用；无前缀值容错透传） */
export function openChangeValue(fieldName: string, value: string | null): string | null {
  return transform(fieldName, value, 'open');
}

/** 变更申请管理端展示脱敏（拆封后掩码；明文直接掩码） */
export function maskChangeValue(fieldName: string, value: string | null): string | null {
  return transform(fieldName, value, 'mask');
}
