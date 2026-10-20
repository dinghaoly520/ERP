import { PROCUREMENT_EVALUATION_MAP } from './evaluation-method.config';

/** none（直接采购族）项目免评分标准——:3005 03 闸与 :3007 G9 唯一口径来源（spec 2026-10-19 §4.1） */
export function isNoneEvaluation(
  evaluationMethod: string | null | undefined,
  procurementMethod?: string | null,
): boolean {
  const m = evaluationMethod ?? (procurementMethod ? PROCUREMENT_EVALUATION_MAP[procurementMethod]?.evaluationMethod : undefined);
  return m === 'none';
}
