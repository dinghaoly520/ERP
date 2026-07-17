export type AlignOp =
  | { op: 'keep'; ch: string; a: number }
  | { op: 'del'; ch: string; a: number }
  | { op: 'ins'; ch: string; b: number };

/** 按码点拆分，正确处理 CJK / emoji。 */
function toChars(s: string): string[] {
  return Array.from(s);
}

/** 字符级 LCS 对齐，输出 keep/del/ins 操作序列。 */
export function lcsAlign(a: string, b: string): AlignOp[] {
  const A = toChars(a);
  const B = toChars(b);
  const n = A.length;
  const m = B.length;
  // dp[i][j] = A[i..] 与 B[j..] 的 LCS 长度
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] =
        A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const ops: AlignOp[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (A[i] === B[j]) {
      ops.push({ op: 'keep', ch: A[i], a: i });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      ops.push({ op: 'del', ch: A[i], a: i });
      i++;
    } else {
      ops.push({ op: 'ins', ch: B[j], b: j });
      j++;
    }
  }
  while (i < n) {
    ops.push({ op: 'del', ch: A[i], a: i });
    i++;
  }
  while (j < m) {
    ops.push({ op: 'ins', ch: B[j], b: j });
    j++;
  }
  return ops;
}
