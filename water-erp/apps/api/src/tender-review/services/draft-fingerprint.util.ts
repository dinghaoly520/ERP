import { createHash } from 'crypto';

/** 键排序的规范 JSON 序列化（对象键递归排序，数组保序）。 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const keys = Object.keys(value as Record<string, unknown>).sort();
  return `{${keys
    .map((k) => `${JSON.stringify(k)}:${canonicalJson((value as Record<string, unknown>)[k])}`)
    .join(',')}}`;
}

/**
 * 草稿指纹：sha256(canonicalJSON({ documentType, answers }))，hex。
 * 仅用于「审查结果是否过期」判定，不作安全凭据（spec §5）。
 */
export function computeDraftFingerprint(documentType: string, answers: unknown): string {
  return createHash('sha256').update(canonicalJson({ documentType, answers })).digest('hex');
}
