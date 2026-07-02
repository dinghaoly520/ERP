import { RuleResult } from './rule-executor.service';
import { ClauseParserService } from './clause-parser.service';

export function decodeFileName(name: string): string {
  try {
    return Buffer.from(name, 'latin1').toString('utf-8');
  } catch {
    return name;
  }
}

export interface ChunkSearchResult {
  fileId: string;
  content: string;
  score: number;
  metadata?: Record<string, unknown>;
}

export function buildKnowledgeBaseReferences(
  searchResults: ChunkSearchResult[],
): Array<{ fileName: string; clauseContent: string; score: number }> {
  const seen = new Set<string>();
  const refs: Array<{
    fileName: string;
    clauseContent: string;
    score: number;
  }> = [];
  for (const r of searchResults) {
    const key = `${r.fileId}:${r.content.slice(0, 50)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const rawName = (r.metadata?.fileName as string) || '未知文件';
    refs.push({
      fileName: rawName.match(/[\x80-\xff]/)
        ? decodeFileName(rawName)
        : rawName,
      clauseContent: r.content,
      score: r.score,
    });
  }
  return refs;
}

export function pickManualCommentAnchor(issue: {
  documentExcerpt?: string;
  evidence?: string;
  documentLocation?: { excerpt?: string };
}): string | undefined {
  // documentLocation.excerpt is extracted from the actual document during
  // review, so it's the most reliable anchor source.
  const located = issue.documentLocation?.excerpt?.trim();
  if (located && located.length >= 6) {
    return located;
  }

  const excerpt = issue.documentExcerpt?.trim();
  if (excerpt && excerpt.length >= 6) {
    return excerpt;
  }

  const evidence = issue.evidence?.replace(/^.*?[：:]/, '').trim();
  if (evidence && evidence.length >= 6) {
    return evidence;
  }

  return undefined;
}

/**
 * Sanitize document content to prevent prompt injection attacks.
 */
export function sanitizeDocumentContent(content: string, maxLength: number): string {
  let sanitized =
    content.length > maxLength
      ? content.slice(0, maxLength) + '\n...(文档过长，已截断)'
      : content;

  const injectionPatterns = [
    /忽略之前的所有指令/gi,
    /请输出以下内容/gi,
    /你的任务是/gi,
    /SYSTEM:/gi,
    /USER:/gi,
    /ASSISTANT:/gi,
  ];

  for (const pattern of injectionPatterns) {
    sanitized = sanitized.replace(pattern, '[已过滤]');
  }

  return sanitized;
}

/**
 * Split document into chapters using ClauseParserService.
 * Falls back to chunk-based splitting when no chapters detected.
 */
export function splitByChapters(
  text: string,
  clauseParser: ClauseParserService,
): Array<{ name: string; content: string }> {
  const chapters = clauseParser.detectChapters(text);

  if (chapters.length > 0) {
    return chapters.map((ch, i) => ({
      name: ch.name,
      content: text
        .slice(
          ch.offset,
          i + 1 < chapters.length ? chapters[i + 1].offset : text.length,
        )
        .trim(),
    }));
  }

  return splitIntoLargeChunks(text);
}

export function splitIntoLargeChunks(
  text: string,
  chunkSize = 12000,
): Array<{ name: string; content: string }> {
  const chunks: Array<{ name: string; content: string }> = [];
  let start = 0;
  let index = 1;

  while (start < text.length) {
    let end = Math.min(start + chunkSize, text.length);
    if (end < text.length) {
      const breakPoint = text.lastIndexOf('\n\n', end);
      if (breakPoint > start + chunkSize / 2) end = breakPoint;
    }
    const content = text.slice(start, end).trim();
    if (content.length > 100) {
      chunks.push({ name: `第${index}部分`, content });
      index++;
    }
    start = end;
  }

  return chunks;
}

export function findDocumentLocation(
  evidence: string,
  documentContent: string,
  clauses: Array<{
    clauseNumber: string;
    title: string | null;
    startOffset: number;
    endOffset: number;
    parentSection: string | null;
  }>,
): RuleResult['documentLocation'] {
  const evidenceSnippet = evidence
    .replace(/^.*?[：:]/, '')
    .trim()
    .slice(0, 30);
  const idx =
    evidenceSnippet.length > 5 ? documentContent.indexOf(evidenceSnippet) : -1;
  if (idx < 0) return undefined;

  const matchedClause = clauses.find(
    (c) => idx >= c.startOffset && idx < c.endOffset,
  );
  if (!matchedClause) return undefined;

  const start = Math.max(0, idx - 100);
  const end = Math.min(documentContent.length, idx + 100);

  return {
    clauseNumber: matchedClause.clauseNumber,
    sectionName:
      [matchedClause.parentSection, matchedClause.title]
        .filter(Boolean)
        .join(' > ') || '',
    excerpt: documentContent.slice(start, end).trim(),
  };
}
