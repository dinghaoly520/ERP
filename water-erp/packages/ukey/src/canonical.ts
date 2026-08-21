import type { DualEnvelope, SealedFields } from './types';

/** 规范化 JSON：键字典序递归排序、无空白；undefined 值剔除。前后端唯一实现。 */
export function canonicalJson(value: unknown): string {
  const norm = (v: unknown): unknown => {
    if (v === null || typeof v !== 'object') return v === undefined ? undefined : v;
    if (Array.isArray(v)) return v.map(norm);
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as Record<string, unknown>).sort()) {
      const n = norm((v as Record<string, unknown>)[k]);
      if (n !== undefined) out[k] = n;
    }
    return out;
  };
  return JSON.stringify(norm(value));
}

export async function sha256Hex(input: string | Uint8Array): Promise<string> {
  const data = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  const digest = await crypto.subtle.digest('SHA-256', data as BufferSource);
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
}

export const canonicalEnvelopeHash = (envelope: DualEnvelope): Promise<string> =>
  sha256Hex(canonicalJson(envelope));

export const computeFieldsCommit = (fields: SealedFields, nonce: string): Promise<string> =>
  sha256Hex(`${canonicalJson(fields)}:${nonce}`);
