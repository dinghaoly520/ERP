/* env 数值解析收口:未设置 → 静默 fallback;设了但空串/非有限数 → fallback + warn。
   此前裸 Number():空串→0(TTL 立即全过期/端口随机)、非数字→NaN(TTL 永不过期)。 */
export function parseEnvInt(name, fallback) {
  const v = process.env[name];
  if (v === undefined) return fallback;
  const raw = v.trim();
  const n = Number(raw);
  if (raw !== '' && Number.isFinite(n)) return n;
  console.warn(`[ukey-mw] env ${name}="${raw}" 非有效整数,回退默认 ${fallback}`);
  return fallback;
}
