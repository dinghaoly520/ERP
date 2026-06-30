import { Injectable } from '@nestjs/common';

export interface Clause {
  clauseNumber: string;
  title: string | null;
  content: string;
  startOffset: number;
  endOffset: number;
  parentSection: string | null;
}

export interface ParsedDocument {
  title: string;
  clauses: Clause[];
  rawText: string;
}

@Injectable()
export class ClauseParserService {
  // Match "第X条" patterns with Chinese numerals
  private readonly clausePattern =
    /第[一二三四五六七八九十百零〇]+\s*条[ 　]*(?:（[^）]*）)?[ 　]*([^\n]*)/g;

  // Match "一、" style numbered sections
  private readonly numberedSectionPattern = /^[一二三四五六七八九十]+、/m;

  // Match "（一）" style sub-sections
  private readonly subSectionPattern = /^[（(][一二三四五六七八九十]+[）)]/m;

  // Match real chapter headers: "第X章" at start of line (with optional leading whitespace),
  // NOT in-text references like "第四章《采购需求》中★号条款"
  private readonly chapterHeaderPattern =
    /^[ \t　]*第[一二三四五六七八九十百零〇]+\s*章[ 　]+[^\n《》]{1,50}$/gm;

  parse(text: string): ParsedDocument {
    const title = this.extractTitle(text);

    // Parse both formats and merge by offset
    const clauseSections = this.extractClauseSections(text);
    const numberedSections = this.extractNumberedSections(text);
    const clauses = this.mergeByOffset(clauseSections, numberedSections);

    if (clauses.length === 0) {
      return { title, clauses: this.parseByParagraph(text), rawText: text };
    }

    // Fill gaps between sections with paragraph-based content
    this.fillGaps(clauses, text);

    // Truncate content after appendix section headers
    this.truncateAtAppendix(clauses, text);

    // Filter out noise clauses (short headers, TOC entries, page numbers)
    this.filterNoise(clauses);

    // Assign parent sections based on chapter headers
    const chapters = this.detectChapters(text);
    this.assignParentSections(clauses, chapters);

    return { title, clauses, rawText: text };
  }

  private extractTitle(text: string): string {
    const firstLine = text.split('\n')[0]?.trim() ?? '';
    return firstLine.length <= 100
      ? firstLine
      : firstLine.slice(0, 100) + '...';
  }

  private extractClauseSections(text: string): Clause[] {
    const clauses: Clause[] = [];
    const matches: Array<{
      number: string;
      offset: number;
      title: string | null;
    }> = [];

    let match: RegExpExecArray | null;
    const pattern = new RegExp(this.clausePattern.source, 'g');
    while ((match = pattern.exec(text)) !== null) {
      const headerText = match[0].trim();
      const numberPart = headerText
        .replace(/\s+/g, '')
        .match(/第[一二三四五六七八九十百零〇]+条/)?.[0];
      matches.push({
        number: numberPart ?? `第${matches.length + 1}条`,
        offset: match.index,
        title: match[1]?.trim() || null,
      });
    }

    for (let i = 0; i < matches.length; i++) {
      const start = matches[i].offset;
      const end = i + 1 < matches.length ? matches[i + 1].offset : text.length;
      const content = text.slice(start, end).trim();

      clauses.push({
        clauseNumber: matches[i].number,
        title: matches[i].title,
        content,
        startOffset: start,
        endOffset: end,
        parentSection: null,
      });
    }

    return clauses;
  }

  private extractNumberedSections(text: string): Clause[] {
    const lines = text.split('\n');
    const clauses: Clause[] = [];
    let current: Clause | null = null;
    let offset = 0;

    for (const line of lines) {
      const sectionMatch = line.match(/^([一二三四五六七八九十]+、)\s*(.*)/);

      if (sectionMatch) {
        if (current) {
          current.endOffset = offset;
          clauses.push(current);
        }
        current = {
          clauseNumber: sectionMatch[1].replace('、', ''),
          title: sectionMatch[2]?.trim() || null,
          content: line,
          startOffset: offset,
          endOffset: offset,
          parentSection: null,
        };
      } else if (current) {
        current.content += '\n' + line;
      }

      offset += line.length + 1;
    }

    if (current) {
      current.endOffset = offset;
      clauses.push(current);
    }

    return clauses;
  }

  private mergeByOffset(a: Clause[], b: Clause[]): Clause[] {
    const merged = [...a, ...b].sort((x, y) => x.startOffset - y.startOffset);

    const result: Clause[] = [];
    for (const clause of merged) {
      if (result.length === 0) {
        result.push(clause);
        continue;
      }
      const prev = result[result.length - 1];

      // No overlap
      if (clause.startOffset >= prev.endOffset) {
        result.push(clause);
        continue;
      }

      // Clause is entirely inside previous — split previous around it
      if (clause.endOffset <= prev.endOffset) {
        const prevEnd = prev.endOffset;
        prev.endOffset = clause.startOffset;
        prev.content = prev.content
          .slice(0, Math.max(0, clause.startOffset - prev.startOffset))
          .trim();
        result.push(clause);
        // Add remainder of prev after clause
        if (prevEnd - clause.endOffset > 50) {
          result.push({
            clauseNumber: prev.clauseNumber,
            title: null,
            content: '',
            startOffset: clause.endOffset,
            endOffset: prevEnd,
            parentSection: prev.parentSection,
          });
        }
        continue;
      }

      // Partial overlap — trim previous
      prev.endOffset = clause.startOffset;
      prev.content = prev.content
        .slice(0, Math.max(0, clause.startOffset - prev.startOffset))
        .trim();
      result.push(clause);
    }

    return result;
  }

  private fillGaps(clauses: Clause[], text: string): void {
    const minGapSize = 100;
    const gaps: Clause[] = [];

    // Gap before first clause
    if (clauses.length > 0 && clauses[0].startOffset > minGapSize) {
      const gapText = text.slice(0, clauses[0].startOffset).trim();
      if (gapText.length > minGapSize) {
        gaps.push(
          ...this.parseByParagraph(gapText).map((c) => ({
            ...c,
            startOffset: c.startOffset,
            endOffset: c.endOffset,
          })),
        );
      }
    }

    // Gaps between clauses
    for (let i = 0; i < clauses.length - 1; i++) {
      const gapStart = clauses[i].endOffset;
      const gapEnd = clauses[i + 1].startOffset;
      if (gapEnd - gapStart > minGapSize) {
        const gapText = text.slice(gapStart, gapEnd).trim();
        if (gapText.length > minGapSize) {
          const paras = this.parseByParagraph(gapText).map((c) => ({
            ...c,
            startOffset: c.startOffset + gapStart,
            endOffset: c.endOffset + gapStart,
          }));
          gaps.push(...paras);
        }
      }
    }

    // Gap after last clause
    if (
      clauses.length > 0 &&
      text.length - clauses[clauses.length - 1].endOffset > minGapSize
    ) {
      const gapStart = clauses[clauses.length - 1].endOffset;
      const gapText = text.slice(gapStart).trim();
      if (gapText.length > minGapSize) {
        gaps.push(
          ...this.parseByParagraph(gapText).map((c) => ({
            ...c,
            startOffset: c.startOffset + gapStart,
            endOffset: c.endOffset + gapStart,
          })),
        );
      }
    }

    if (gaps.length > 0) {
      clauses.push(...gaps);
      clauses.sort((a, b) => a.startOffset - b.startOffset);
    }
  }

  public detectChapters(text: string): Array<{ name: string; offset: number }> {
    // Strategy 1: parse TOC to find chapter titles, then locate them in the body
    const tocResult = this.detectChaptersFromToc(text);
    if (tocResult.length > 0) return tocResult;

    // Strategy 2: find "第X章 + title" headers directly (for docs without separate TOC)
    return this.detectChaptersFromHeaders(text);
  }

  private detectChaptersFromToc(
    text: string,
  ): Array<{ name: string; offset: number }> {
    // Find TOC entries: "第X章  title \t pageNum"
    const tocPattern =
      /第[一二三四五六七八九十百零〇]+\s*章[ \t　]+([^\t\n]+?)[\t ]+\d+/g;
    const tocEntries: Array<{ name: string; title: string }> = [];
    let tocEnd = 0;
    let m: RegExpExecArray | null;
    while ((m = tocPattern.exec(text)) !== null) {
      const chNumber = m[0]
        .replace(/\s+/g, '')
        .match(/第[一二三四五六七八九十百零〇]+章/)?.[0];
      const chTitle = m[1]?.trim();
      if (chNumber && chTitle) {
        tocEntries.push({ name: `${chNumber} ${chTitle}`, title: chTitle });
      }
      tocEnd = m.index + m[0].length;
    }
    if (tocEntries.length === 0) return [];

    // Build a set of titles for fast lookup
    const titleSet = new Map<string, string>();
    for (const entry of tocEntries) {
      titleSet.set(entry.title, entry.name);
    }

    // Scan lines after the TOC for standalone title matches
    const bodyText = text.slice(tocEnd);
    const lines = bodyText.split('\n');
    const chapters: Array<{ name: string; offset: number }> = [];
    let offset = tocEnd;
    const foundTitles = new Set<string>();

    for (const line of lines) {
      const trimmed = line.trim();
      const name = titleSet.get(trimmed);
      if (name && !foundTitles.has(trimmed)) {
        chapters.push({ name, offset });
        foundTitles.add(trimmed);
      }
      offset += line.length + 1;
    }

    return chapters;
  }

  private detectChaptersFromHeaders(
    text: string,
  ): Array<{ name: string; offset: number }> {
    const raw: Array<{ name: string; offset: number; number: string }> = [];
    let match: RegExpExecArray | null;
    const pattern = new RegExp(this.chapterHeaderPattern.source, 'gm');
    while ((match = pattern.exec(text)) !== null) {
      const line = match[0].trim();
      const chNumber = line
        .replace(/\s+/g, '')
        .match(/第[一二三四五六七八九十百零〇]+章/)?.[0];
      const chTitle = line
        .replace(/第[一二三四五六七八九十百零〇]+\s*章\s*/, '')
        .replace(/[\t ]+\d+\s*$/, '')
        .trim();
      raw.push({
        name: chTitle ? `${chNumber} ${chTitle}` : (chNumber ?? '章节'),
        offset: match.index,
        number: chNumber ?? '',
      });
    }

    const seen = new Map<string, { name: string; offset: number }>();
    for (const ch of raw) {
      seen.set(ch.number, { name: ch.name, offset: ch.offset });
    }

    return [...seen.values()].sort((a, b) => a.offset - b.offset);
  }

  private assignParentSections(
    clauses: Clause[],
    chapters: Array<{ name: string; offset: number }>,
  ): void {
    if (chapters.length === 0) return;

    for (const clause of clauses) {
      let parent: string | null = null;
      for (const ch of chapters) {
        if (ch.offset <= clause.startOffset) parent = ch.name;
        else break;
      }
      clause.parentSection = parent;
    }
  }

  private truncateAtAppendix(clauses: Clause[], text: string): void {
    // Match "附录N：title" or "附录N\t" as a standalone section header
    const regex = /^附\s*录\s*[1-9一二三四五六七八九十\d]+\s*[：:]/gm;
    let match;
    let appendixOffset = -1;

    while ((match = regex.exec(text)) !== null) {
      const pos = match.index;
      const hasClausesBefore = clauses.some(
        (c) => c.startOffset < pos && c.content.length > 50,
      );
      if (hasClausesBefore) {
        appendixOffset = pos;
        break;
      }
    }

    if (appendixOffset < 0) return;

    for (const clause of clauses) {
      if (clause.startOffset >= appendixOffset) {
        clause.content = '';
        continue;
      }
      if (clause.endOffset > appendixOffset) {
        clause.content = text.slice(clause.startOffset, appendixOffset).trim();
        clause.endOffset = appendixOffset;
      }
    }
  }

  private filterNoise(clauses: Clause[]): void {
    for (let i = clauses.length - 1; i >= 0; i--) {
      const c = clauses[i];
      const trimmed = c.content.trim();

      // Skip empty or very short content that isn't a real clause
      if (
        trimmed.length < 20 &&
        !trimmed.match(/第[一二三四五六七八九十百零〇]+条/)
      ) {
        clauses.splice(i, 1);
        continue;
      }

      // Skip pure TOC lines like "第一章  总则\t1"
      if (
        /^第[一二三四五六七八九十百零〇]+\s*章\s+\S+\s+\d+\s*$/.test(trimmed)
      ) {
        clauses.splice(i, 1);
        continue;
      }

      // Skip appendix TOC lines like "附录1\t25"
      if (/^附录\s*\d+\s*$/.test(trimmed)) {
        clauses.splice(i, 1);
        continue;
      }

      // Skip standalone page numbers
      if (/^\s*\d{1,3}\s*$/.test(trimmed)) {
        clauses.splice(i, 1);
        continue;
      }
    }
  }

  private parseByParagraph(text: string): Clause[] {
    const paragraphs = text.split(/\n{2,}/);
    let offset = 0;

    return paragraphs
      .filter((p) => p.trim())
      .map((p, i) => {
        const start = text.indexOf(p, offset);
        const clause: Clause = {
          clauseNumber: `段落${i + 1}`,
          title: null,
          content: p.trim(),
          startOffset: start >= 0 ? start : offset,
          endOffset: (start >= 0 ? start : offset) + p.length,
          parentSection: null,
        };
        offset = clause.endOffset;
        return clause;
      });
  }
}
