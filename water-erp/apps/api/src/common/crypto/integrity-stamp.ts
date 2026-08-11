import { createHmac, timingSafeEqual } from 'crypto';

export interface IntegrityStamp {
  ts: string;   // ISO timestamp
  sig: string;  // HMAC-SHA256(payload)
}

export function createIntegrityStamp(userId: string, action: string, resourceId: string): IntegrityStamp {
  const ts = new Date().toISOString();
  const secret = process.env.JWT_SECRET ?? 'fallback-dev-secret-32-chars-min!!!';
  const payload = `${userId}|${action}|${resourceId}|${ts}`;
  const sig = createHmac('sha256', secret).update(payload).digest('hex');
  return { ts, sig };
}

export function verifyIntegrityStamp(stamp: IntegrityStamp, userId: string, action: string, resourceId: string): boolean {
  try {
    const secret = process.env.JWT_SECRET ?? 'fallback-dev-secret-32-chars-min!!!';
    const payload = `${userId}|${action}|${resourceId}|${stamp.ts}`;
    const expected = createHmac('sha256', secret).update(payload).digest('hex');
    return timingSafeEqual(Buffer.from(stamp.sig), Buffer.from(expected));
  } catch {
    return false;
  }
}
