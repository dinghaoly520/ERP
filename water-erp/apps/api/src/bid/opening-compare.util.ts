/**
 * 唱标 vs 投递 一致性比对的纯函数（单一来源）：
 * - 报价：P1-13 万元/元归一 + ±0.5% 容差（与 assertPriceMatchesSealed 原内联逻辑同口径）
 * - 工期：自由文本去全部空白后精确比对（工期无单位体系，不做数值归一）
 * bid.service（唱标录入校验）与 supplier-portal.service（供应商确认页回显）共用，
 * 保证两端「不一致」判定永远同源。
 */

/** 投递价（万元或元）归一为元后返回；任一值不可解析 → null（调用方跳过校验）。 */
export function resolveExpectedInYuan(
  expectedStr?: string | number | null,
  enteredStr?: string | number | null,
): number | null {
  const rawExpected = expectedStr == null ? '' : String(expectedStr);
  const rawEntered = enteredStr == null ? '' : String(enteredStr);
  // 空/缺失视为不可解析（Number('') === 0，须显式短路才符合「不可解析 → null」契约）
  if (!rawExpected || !rawEntered) return null;
  const expected = Number(rawExpected.replace(/,/g, ''));
  const entered = Number(rawEntered.replace(/,/g, ''));
  if (!Number.isFinite(expected) || !Number.isFinite(entered)) return null;
  // P1-13：供应商投递表单单位「万元」（79.8），唱标录入单位「元」（798000）。
  // 金额比 >100 且 entered≈expected×10000（±0.5%）视为同一报价。
  if (Math.abs(expected - entered) > 0.005
      && entered > expected * 100
      && Math.abs(entered - expected * 10000) <= Math.max(entered, expected * 10000) * 0.005) {
    return expected * 10000;
  }
  return expected;
}

/** 唱标录入价与投递密封价（已解封、可能万元/元）是否实质不一致（±0.5% 容差）。 */
export function isPriceMismatch(expectedInYuan: number | null, enteredStr?: string | number | null): boolean {
  const entered = Number(String(enteredStr ?? '').replace(/,/g, ''));
  if (expectedInYuan == null || !Number.isFinite(entered)) return false;
  return Math.abs(expectedInYuan - entered) > Math.max(expectedInYuan, entered) * 0.005;
}

/** 工期不一致：去全部空白后精确比对；任一侧缺失/空白 → false（不校验，向后兼容）。 */
export function isPeriodMismatch(expectedStr?: string | null, enteredStr?: string | null): boolean {
  const expected = (expectedStr ?? '').replace(/\s+/g, '');
  const entered = (enteredStr ?? '').replace(/\s+/g, '');
  if (!expected || !entered) return false;
  return expected !== entered;
}
