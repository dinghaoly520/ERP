export type SuggestionOperation = 'replace' | 'insert' | 'delete' | 'manual';

export interface StructuredSuggestion {
  description: string;
  operation: SuggestionOperation;
  originalText?: string;
  replacementText?: string;
  anchor?: string;
}

export function isStructuredSuggestion(
  val: unknown,
): val is StructuredSuggestion {
  if (typeof val === 'object' && val !== null && 'operation' in val) {
    const op = (val as StructuredSuggestion).operation;
    return ['replace', 'insert', 'delete', 'manual'].includes(op);
  }
  return false;
}

export function toStructuredSuggestion(val: unknown): StructuredSuggestion {
  if (isStructuredSuggestion(val)) return val;
  return {
    description: typeof val === 'string' ? val : '',
    operation: 'manual',
  };
}

export function stripHtmlTags(text: string): string {
  return text
    .replace(/<del[^>]*>[\s\S]*?<\/del>/g, '')
    .replace(/<ins[^>]*>|<\/ins>/g, '')
    .replace(/<[^>]+>/g, '');
}

function mapVisibleIndexToRaw(
  visibleText: string,
  rawContent: string,
  visibleIdx: number,
  originalText: string,
): number {
  // Walk through raw content, counting only visible characters until we reach visibleIdx
  let visPos = 0;
  let rawPos = 0;
  let inTag = false;

  while (rawPos < rawContent.length && visPos < visibleIdx) {
    const ch = rawContent[rawPos];
    if (ch === '<') {
      inTag = true;
      rawPos++;
      continue;
    }
    if (inTag) {
      if (ch === '>') inTag = false;
      rawPos++;
      continue;
    }
    visPos++;
    rawPos++;
  }

  // Skip any remaining tags to get to actual text
  while (rawPos < rawContent.length && rawContent[rawPos] === '<') {
    const closeIdx = rawContent.indexOf('>', rawPos);
    if (closeIdx < 0) break;
    rawPos = closeIdx + 1;
  }

  return rawPos;
}

function editDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp = Array.from({ length: m + 1 }, () =>
    new Array<number>(n + 1).fill(0),
  );
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}
