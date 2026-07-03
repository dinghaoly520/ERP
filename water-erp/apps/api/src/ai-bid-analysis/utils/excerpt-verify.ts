// apps/api/src/ai-bid-analysis/utils/excerpt-verify.ts
// 校验 LLM 自报的 excerpt 是否真出现在标书指定页 —— 防「页码/摘录幻觉」。
// 用 bigram 覆盖率（excerpt 的字符 bigram 有多少能在页面文本找到）衡量，
// 对「excerpt 远短于页面」的场景比 Jaccard 稳健（逐字摘录 ≈ 1）。
export interface VerifyPageInput {
  file: string;
  page: number;
  text: string;
}

export interface VerifyResult {
  verified: boolean;
  /** 最高相似度（0–1） */
  score: number;
  /** 目标页未命中、但别页命中时给出真实页码 */
  correctedPage?: number;
}

export interface VerifyOptions {
  /** 覆盖率阈值，默认 0.55（需用真实数据实测校准） */
  threshold?: number;
}

/** 默认阈值；matcher 运行时从 process.env.AI_EXCERPT_VERIFY_THRESHOLD 覆盖 */
export const DEFAULT_VERIFY_THRESHOLD = 0.55;

function toHalfWidth(s: string): string {
  return s
    .replace(/[！-～]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0))
    .replace(/　/g, ' ');
}

/** 小写 + 全角转半角 + 去掉所有标点/空白（只留字母数字，\p{L} 含 CJK） */
function normalize(s: string): string {
  return toHalfWidth(s || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, '');
}

function bigrams(s: string): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i < s.length - 1; i++) out.add(s.slice(i, i + 2));
  return out;
}

/** excerpt 的 bigram 有多少出现在 page 文本中 */
function coverage(excerptBigrams: Set<string>, pageBigrams: Set<string>): number {
  if (excerptBigrams.size === 0) return 0;
  let hit = 0;
  for (const b of excerptBigrams) if (pageBigrams.has(b)) hit++;
  return hit / excerptBigrams.size;
}

export function verifyExcerpt(
  excerpt: string,
  targetFile: string | null,
  targetPage: number | null,
  pages: VerifyPageInput[],
  options?: VerifyOptions,
): VerifyResult {
  const threshold = options?.threshold ?? DEFAULT_VERIFY_THRESHOLD;
  const excerptBg = bigrams(normalize(excerpt));
  if (excerptBg.size === 0) return { verified: false, score: 0 }; // 空/极短 excerpt 无从校验

  const normed = pages.map((p) => ({ file: p.file, page: p.page, bg: bigrams(normalize(p.text)) }));

  // 1. 目标页命中
  if (targetFile && typeof targetPage === 'number') {
    const tgt = normed.find((p) => p.file === targetFile && p.page === targetPage);
    if (tgt) {
      const s = coverage(excerptBg, tgt.bg);
      if (s >= threshold) return { verified: true, score: round(s) };
    }
  }

  // 2. 全标书找最高
  let best: { page: number; score: number } | null = null;
  for (const p of normed) {
    const s = coverage(excerptBg, p.bg);
    if (!best || s > best.score) best = { page: p.page, score: s };
  }
  if (best && best.score >= threshold) {
    return { verified: true, score: round(best.score), correctedPage: best.page };
  }
  return { verified: false, score: best ? round(best.score) : 0 };
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
