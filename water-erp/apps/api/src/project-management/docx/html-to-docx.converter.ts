import {
  Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType, BorderStyle,
} from 'docx';

/**
 * HTML → DOCX 转换器（纯函数，无 Nest 依赖）。
 *
 * 从 project-management.service.ts 抽离（2026-08 审计 P1：拆上帝服务）。
 * 将富文本编辑器产出的 HTML 片段解析为 docx 库的 Paragraph/Table 数组，
 * 供 saveAttachmentHtml 回写 DOCX 附件时使用。
 *
 * 只依赖 `docx` 包；内部函数互相调用（原为 this.xxx 私有方法，现为模块内函数）。
 * 入口 `htmlToDocxChildren(html)`。
 */

/* ══════════ HTML → DOCX 解析器 ══════════ */

/** 提取 <tag>...</tag> 内部内容（处理嵌套）。返回 null 表示未匹配。 */
function extractTagInner(html: string, tag: string): string | null {
  const openMatch = html.match(new RegExp(`<${tag}[^>]*>`, 'i'));
  if (!openMatch) return null;
  let depth = 1;
  const pos = (openMatch.index || 0) + openMatch[0].length;
  const tagRegex = new RegExp(`<(/?)${tag}([\\s>])`, 'gi');
  tagRegex.lastIndex = pos;
  let m: RegExpExecArray | null;
  while ((m = tagRegex.exec(html)) !== null) {
    if (m[1] === '/') { depth--; } else { depth++; }
    if (depth === 0) return html.slice(pos, m.index);
  }
  return null;
}

/** 提取所有 <tag> 的内部内容（用于 li 等）。 */
function extractAllTagInners(html: string, tag: string): string[] {
  const results: string[] = [];
  const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'gi');
  let m: RegExpExecArray | null;
  while ((m = regex.exec(html)) !== null) results.push(m[1]);
  return results;
}

/** 跳过整个 <tag>...</tag>，返回后续内容。 */
function skipTag(html: string, tag: string): string {
  const openMatch = html.match(new RegExp(`<${tag}[^>]*>`, 'i'));
  if (!openMatch) return html;
  let depth = 1;
  const pos = (openMatch.index || 0) + openMatch[0].length;
  const tagRegex = new RegExp(`<(/?)${tag}([\\s>])`, 'gi');
  tagRegex.lastIndex = pos;
  let m: RegExpExecArray | null;
  while ((m = tagRegex.exec(html)) !== null) {
    if (m[1] === '/') depth--; else depth++;
    if (depth === 0) return html.slice(m.index + m[0].length + 1); // +1 for >
  }
  return html.slice(pos); // 未找到闭合标签，跳过剩余
}

/** 将 h1-h6 映射为 docx HeadingLevel。 */
function parseHeadingLevel(tag: string) {
  const map: Record<string, any> = {
    h1: HeadingLevel.HEADING_1, h2: HeadingLevel.HEADING_2, h3: HeadingLevel.HEADING_3,
    h4: HeadingLevel.HEADING_4, h5: HeadingLevel.HEADING_5, h6: HeadingLevel.HEADING_6,
  };
  return map[tag];
}

/** 将内联 HTML 解析为 TextRun 数组。处理：<strong>/<b>、<em>/<i>、<u>、<br>。 */
function parseInlineRuns(html: string): TextRun[] {
  const runs: TextRun[] = [];
  let remaining = html;
  let bold = false, italic = false, underline = false;

  while (remaining.length > 0) {
    if (remaining.startsWith('<br')) {
      runs.push(new TextRun({ break: 1 }));
      const end = remaining.indexOf('>') + 1;
      remaining = remaining.slice(end > 0 ? end : 4);
      continue;
    }

    // 检查开关标签
    const tagMatch = remaining.match(/^<\s*\/?\s*(\w+)[^>]*>/);
    if (tagMatch) {
      const fullTag = tagMatch[0];
      const tag = tagMatch[1].toLowerCase();
      const isClose = fullTag.startsWith('</');

      if (tag === 'strong' || tag === 'b') { bold = !isClose; remaining = remaining.slice(fullTag.length); continue; }
      if (tag === 'em' || tag === 'i') { italic = !isClose; remaining = remaining.slice(fullTag.length); continue; }
      if (tag === 'u') { underline = !isClose; remaining = remaining.slice(fullTag.length); continue; }
      if (tag === 'span' || tag === 'a' || tag === 'sub' || tag === 'sup') {
        // 保留文本内容，忽略样式标签
        remaining = remaining.slice(fullTag.length);
        continue;
      }
      // 未知标签 → 当作文本处理
    }

    // 提取直到下一个 < 的纯文本
    const lt = remaining.indexOf('<');
    const chunk = lt === -1 ? remaining : remaining.slice(0, lt);
    remaining = lt === -1 ? '' : remaining.slice(lt);

    if (chunk) {
      const lines = chunk.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (i > 0) runs.push(new TextRun({ break: 1 }));
        if (lines[i]) {
          runs.push(new TextRun({
            text: lines[i],
            bold: bold || undefined,
            italics: italic || undefined,
            underline: underline ? { type: 'single' as any } : undefined,
            size: 21,
          }));
        }
      }
    }
  }

  return runs;
}

/** 解析带内联格式的 HTML 片段 → Paragraph（含粗体/斜体/下划线/换行）。 */
function inlineHtmlToParagraph(innerHtml: string, heading?: any): Paragraph | null {
  const runs = parseInlineRuns(innerHtml);
  if (runs.length === 0) return null;
  return new Paragraph(heading ? { heading, children: runs } : { children: runs });
}

/** 解析 <table> 内部 HTML → docx Table（含框线）。 */
function parseTable(innerHtml: string): Table | null {
  const rows: TableRow[] = [];
  const trRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let trMatch: RegExpExecArray | null;

  const cellBorder = {
    style: BorderStyle.SINGLE,
    size: 4,
    color: '000000',
  };
  const cb = { top: cellBorder, bottom: cellBorder, left: cellBorder, right: cellBorder };

  while ((trMatch = trRegex.exec(innerHtml)) !== null) {
    const cells: TableCell[] = [];
    const tdRegex = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
    let tdMatch: RegExpExecArray | null;

    while ((tdMatch = tdRegex.exec(trMatch[1])) !== null) {
      const p = inlineHtmlToParagraph(tdMatch[1]);
      cells.push(new TableCell({
        borders: cb,
        width: { size: 4680, type: WidthType.DXA },
        children: p ? [p] : [new Paragraph({ children: [] })],
      }));
    }

    if (cells.length > 0) {
      rows.push(new TableRow({ children: cells }));
    }
  }

  if (rows.length === 0) return null;
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows,
  });
}

/** 将编辑后的 HTML 解析为 docx Paragraph/Table 数组。 */
export function htmlToDocxChildren(html: string): (Paragraph | Table)[] {
  const result: (Paragraph | Table)[] = [];
  let remaining = html
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"');

  while (remaining.length > 0) {
    remaining = remaining.trimStart();
    if (remaining.length === 0) break;

    // 1) 表格
    if (/^<table[\s>]/i.test(remaining)) {
      const inner = extractTagInner(remaining, 'table');
      if (inner !== null) {
        const table = parseTable(inner);
        if (table) result.push(table);
        remaining = skipTag(remaining, 'table');
        continue;
      }
    }

    // 2) 列表
    if (/^<(ul|ol)[\s>]/i.test(remaining)) {
      const tag = remaining.match(/^<(ul|ol)/i)![1];
      const inner = extractTagInner(remaining, tag);
      if (inner !== null) {
        const items = extractAllTagInners(inner, 'li');
        for (const liHtml of items) {
          const p = inlineHtmlToParagraph(liHtml);
          if (p) result.push(p);
        }
        remaining = skipTag(remaining, tag);
        continue;
      }
    }

    // 3) 块级元素
    const blockMatch = remaining.match(/^<(h[1-6]|p|div|li|blockquote|th|td)([\s>])/i);
    if (blockMatch) {
      const tag = blockMatch[1].toLowerCase();
      const inner = extractTagInner(remaining, tag);
      if (inner !== null) {
        const heading = parseHeadingLevel(tag);
        const p = inlineHtmlToParagraph(inner, heading);
        if (p) result.push(p);
        remaining = skipTag(remaining, tag);
        continue;
      }
    }

    // 4) <br/> 独立换行
    if (/^<br[\s/>]/i.test(remaining)) {
      result.push(new Paragraph({ children: [] }));
      const end = remaining.indexOf('>') + 1;
      remaining = remaining.slice(end);
      continue;
    }

    // 5) 独立 <img> → 跳过（base64 图片回写 DOCX 需原始数据）
    if (/^<img[\s>]/i.test(remaining)) {
      const end = remaining.indexOf('>') + 1;
      remaining = remaining.slice(end);
      continue;
    }

    // 6) HTML 注释
    if (remaining.startsWith('<!--')) {
      const end = remaining.indexOf('-->') + 3;
      remaining = remaining.slice(end);
      continue;
    }

    // 7) 未知标签或裸文本 — 跳过标签，提取文本
    if (remaining.startsWith('<')) {
      const end = remaining.indexOf('>');
      if (end !== -1) { remaining = remaining.slice(end + 1); continue; }
    }

    // 裸文本（无标签包裹）
    const nextTag = remaining.indexOf('<');
    if (nextTag === -1) {
      const text = remaining.trim();
      if (text) result.push(new Paragraph({ children: [new TextRun({ text, size: 21 })] }));
      break;
    }
    const text = remaining.slice(0, nextTag).trim();
    if (text) result.push(new Paragraph({ children: [new TextRun({ text, size: 21 })] }));
    remaining = remaining.slice(nextTag);
  }

  return result;
}
