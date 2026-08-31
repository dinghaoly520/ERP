/**
 * A-100：平台端接收列表按接收时间排序。
 * 组序：已递交(submittedAt 升序) → 未递交(名册序) → 已撤回(submittedAt 升序)。
 * Array.prototype.sort 在 V8 稳定——未递交组内名册顺序保持。
 */
export interface SubmissionOrderedRow {
  submitted: boolean;
  withdrawn: boolean;
  submission: { submittedAt: Date | string | null } | null;
}

export function sortSupplierRowsBySubmission<T extends SubmissionOrderedRow>(rows: T[]): T[] {
  // 撤回优先级高于递交（brief 原文 `r.submitted ? 0 : …` 与其测试/语义矛盾——夹具「戊」
  // submitted=true+withdrawn=true 期望殿后；已递交后撤回按已撤回归组）
  const group = (r: T) => (r.withdrawn ? 2 : r.submitted ? 0 : 1);
  const ts = (r: T) => (r.submission?.submittedAt ? new Date(r.submission.submittedAt).getTime() : 0);
  return rows.sort((a, b) => (group(a) - group(b)) || (ts(a) - ts(b)));
}
