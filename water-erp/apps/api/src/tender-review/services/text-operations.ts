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

export function findOriginalTextIndex(
  originalText: string,
  documentContent: string,
  clauseNumber?: string,
): number {
  // 1. Exact match on visible text (strip tags first for partial matching)
  const visibleText = stripHtmlTags(documentContent);
  const idx = visibleText.indexOf(originalText);
  if (idx >= 0) {
    return mapVisibleIndexToRaw(
      visibleText,
      documentContent,
      idx,
      originalText,
    );
  }

  // 2. Exact match on raw content
  const rawIdx = documentContent.indexOf(originalText);
  if (rawIdx >= 0) return rawIdx;

  // 3. Fuzzy: find best substring match within edit distance ≤ 20%
  const threshold = Math.floor(originalText.length * 0.2);
  const snippetLen = originalText.length + threshold * 2;
  let bestIdx = -1;
  let bestDist = Infinity;

  for (let i = 0; i < visibleText.length; i++) {
    const end = Math.min(i + snippetLen, visibleText.length);
    const candidate = visibleText.slice(i, end);
    if (candidate.length < originalText.length * 0.8) continue;

    const d = editDistance(
      originalText,
      candidate.slice(0, originalText.length),
    );
    if (d < bestDist && d <= threshold) {
      bestDist = d;
      bestIdx = i;
    }
  }

  if (bestIdx >= 0) {
    return mapVisibleIndexToRaw(
      visibleText,
      documentContent,
      bestIdx,
      originalText,
    );
  }

  return -1;
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

export function findAnchorIndex(
  anchor: string,
  documentContent: string,
): number {
  const visibleText = stripHtmlTags(documentContent);
  const idx = visibleText.indexOf(anchor);
  if (idx >= 0) {
    const rawIdx = mapVisibleIndexToRaw(
      visibleText,
      documentContent,
      idx,
      anchor,
    );
    return rawIdx + anchor.length;
  }
  const rawIdx = documentContent.indexOf(anchor);
  if (rawIdx >= 0) return rawIdx + anchor.length;
  return -1;
}

export function applyTextChange(
  documentContent: string,
  suggestion: StructuredSuggestion,
): { content: string; success: boolean } {
  const { operation } = suggestion;

  if (operation === 'manual') {
    return { content: documentContent, success: false };
  }

  if (operation === 'replace') {
    const { originalText, replacementText } = suggestion;
    if (!originalText) return { content: documentContent, success: false };

    const idx = findOriginalTextIndex(originalText, documentContent);
    if (idx < 0) return { content: documentContent, success: false };

    const before = documentContent.slice(0, idx);
    const after = documentContent.slice(idx + originalText.length);
    const content = `${before}<del>${originalText}</del><ins style="color:red">${replacementText || ''}</ins>${after}`;
    return { content, success: true };
  }

  if (operation === 'delete') {
    const { originalText } = suggestion;
    if (!originalText) return { content: documentContent, success: false };

    const idx = findOriginalTextIndex(originalText, documentContent);
    if (idx < 0) return { content: documentContent, success: false };

    const before = documentContent.slice(0, idx);
    const after = documentContent.slice(idx + originalText.length);
    const content = `${before}<del>${originalText}</del>${after}`;
    return { content, success: true };
  }

  if (operation === 'insert') {
    const { anchor, replacementText } = suggestion;
    if (!replacementText) return { content: documentContent, success: false };

    if (anchor) {
      const idx = findAnchorIndex(anchor, documentContent);
      if (idx < 0) return { content: documentContent, success: false };

      const before = documentContent.slice(0, idx);
      const after = documentContent.slice(idx);
      const content = `${before}<ins style="color:red">${replacementText}</ins>${after}`;
      return { content, success: true };
    }

    return {
      content:
        documentContent + `<ins style="color:red">${replacementText}</ins>`,
      success: true,
    };
  }

  return { content: documentContent, success: false };
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
