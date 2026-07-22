import { createHash } from 'crypto';
import JSZip = require('jszip');
import { segmentDocumentXml } from './segment-xml';
import { extractParagraphAtoms, Atom } from './paragraph-runs';

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** 把一个段落的 atoms 渲染为行内 HTML（加粗→strong、斜体→em、下划线→u、换行→<br/>）。 */
function renderInline(atoms: Atom[]): string {
  let out = '';
  for (const a of atoms) {
    if (a.kind === 'anchor' && a.anchorKind === 'break') {
      out += '<br/>'; // 行内换行（<w:br/>）
      continue;
    }
    if (a.kind === 'anchor') continue; // 图片/分页在 HTML 中省略（保存时以原 DOCX 为准）
    let frag = escapeHtml(a.text);
    if (/<w:b\/>/.test(a.rPrXml)) frag = `<strong>${frag}</strong>`;
    if (/<w:i\/>/.test(a.rPrXml)) frag = `<em>${frag}</em>`;
    if (/<w:u\s/.test(a.rPrXml) || /<w:u\/>/.test(a.rPrXml)) frag = `<u>${frag}</u>`;
    out += frag;
  }
  return out;
}

function headingLevelFromInner(inner: string): number | null {
  const m = inner.match(/<w:pStyle w:val="([^"]+)"/);
  if (!m) return null;
  const hm = m[1].match(/Heading(\d+)/i) ?? m[1].match(/^hd?(\d)/i);
  return hm ? Math.min(6, Math.max(1, Number(hm[1]))) : null;
}

/** 提取 <w:tcPr> 中的 gridSpan（水平合并）与 vMerge（垂直合并）。 */
function parseTcPr(tcOpen: string, tcInner: string): { gridSpan: number; vMerge: 'restart' | 'continue' | null } {
  // <w:tcPr> 是 <w:tc> 的子元素，在 tcInner 中（紧跟开标签），不在 tc 属性中
  const tcPrM = tcInner.match(/<w:tcPr>([\s\S]*?)<\/w:tcPr>/);
  if (!tcPrM) return { gridSpan: 1, vMerge: null };
  const tcPr = tcPrM[1];
  const gridSpanM = tcPr.match(/<w:gridSpan\s[^>]*w:val="(\d+)"[^>]*\/>/);
  const vMergeM = tcPr.match(/<w:vMerge(\s[^>]*?)?\/>/);
  let vMerge: 'restart' | 'continue' | null = null;
  if (vMergeM) {
    const valM = vMergeM[0].match(/w:val="(restart|continue)"/);
    vMerge = valM ? valM[1] as 'restart' | 'continue' : 'continue'; // 无 val 默认 continue
  }
  return { gridSpan: gridSpanM ? Number(gridSpanM[1]) : 1, vMerge };
}

/** 提取某段 inner 中所有 <w:p> 的内容渲染为 HTML（用于表格单元格）。
 *  换行保留、多段落用 <br/> 拼接、空段落不丢弃。 */
function renderParagraphsInCell(pInner: string): string {
  const pRegex = /<w:p(\s[^>]*?)?>([\s\S]*?)<\/w:p>/g;
  const lines: string[] = [];
  let pm: RegExpExecArray | null;
  while ((pm = pRegex.exec(pInner))) {
    const { atoms } = extractParagraphAtoms(pm[2]);
    const inline = renderInline(atoms).trim();
    // 空段落保留为 <br/>（视觉效果=空行），不舍弃
    lines.push(inline || '<br/>');
  }
  return lines.join('<br/>');
}

export interface ConvertedDoc {
  html: string;
  originalHash: string;
}

export async function convertDocxToHtml(buffer: Buffer): Promise<ConvertedDoc> {
  const zip = await JSZip.loadAsync(buffer);
  const docFile = zip.file('word/document.xml');
  if (!docFile) throw new Error('DOCX 缺少 word/document.xml');
  const xml = await docFile.async('string');

  const chunks = segmentDocumentXml(xml);
  const parts: string[] = [];
  let pid = 0;

  for (const c of chunks) {
    if (c.kind === 'other') continue;

    if (c.kind === 'tbl') {
      // ── 表格渲染：逐行逐格，含 gridSpan/vMerge 合并单元格 + 行内换行 ──
      const trRegex = /<w:tr(\s[^>]*?)?>([\s\S]*?)<\/w:tr>/g;
      const rows: string[] = [];
      // 垂直合并追踪：col → { rowspan: 当前行开始后已计数的行数（含 restart 行），restartRowIdx: 起始行号 }
      const vMergeTracker: Map<number, { count: number; restartRowIdx: number }> = new Map();
      let rowIdx = 0;
      let trm: RegExpExecArray | null;

      while ((trm = trRegex.exec(c.inner))) {
        const tcRegex = /<w:tc(\s[^>]*?)?>([\s\S]*?)<\/w:tc>/g;
        const cells: string[] = [];
        let colIdx = 0;
        let tcm: RegExpExecArray | null;

        while ((tcm = tcRegex.exec(trm[2]))) {
          const tcOpen = tcm[1] ?? '';
          const tcInner = tcm[2];
          const { gridSpan, vMerge } = parseTcPr(tcOpen, tcInner);
          const colspan = gridSpan > 1 ? gridSpan : 0; // 1=省略

          if (vMerge === 'continue') {
            // 垂直合并的后续行 → 跳过渲染，递增上方 restart 格的 rowspan
            for (const [c, info] of vMergeTracker) {
              if (info.restartRowIdx + info.count === rowIdx) {
                // 该列等待此行的 continue：递增计数器
                vMergeTracker.set(c, { ...info, count: info.count + 1 });
                break;
              }
            }
            // vMerge continue 单元格没有 PID（不出现在 HTML 中），不渲染
            colIdx += Math.max(gridSpan, 1);
            continue;
          }

          const cellHtml = renderParagraphsInCell(tcInner);
          let attrs = `data-pid="${pid}"`;
          if (colspan > 0) attrs += ` colspan="${colspan}"`;
          if (vMerge === 'restart') {
            // 暂存 rowspan=1，后续 continue 行会递增
            vMergeTracker.set(colIdx, { count: 1, restartRowIdx: rowIdx });
          }
          cells.push(`<td ${attrs}>${cellHtml}</td>`);
          pid++;
          colIdx += Math.max(gridSpan, 1);
        }

        if (cells.length > 0) rows.push(`<tr>${cells.join('')}</tr>`);

        // 本轮 vMerge 闭合：仅当 count > 1（至少有一个 continue 行）且已过最后一个 continue 行时才补 rowspan
        const rowspanAttrs: Array<{ col: number; rowspan: number; restartCellIdx: number }> = [];
        for (const [c, info] of vMergeTracker) {
          // restart 行自身不算"已完成"：需等至少一个 continue 行被处理过
          if (info.count > 1 && info.restartRowIdx + info.count === rowIdx + 1) {
            rowspanAttrs.push({ col: c, rowspan: info.count, restartCellIdx: info.restartRowIdx });
          }
        }
        for (const ra of rowspanAttrs) {
          const restartRow = rows[ra.restartCellIdx];
          const updated = restartRow.replace(/(data-pid="\d+")/, `$1 rowspan="${ra.rowspan}"`);
          rows[ra.restartCellIdx] = updated;
        }
        for (const ra of rowspanAttrs) vMergeTracker.delete(ra.col);
        rowIdx++;
      }
      if (rows.length > 0) {
        parts.push(`<table><tbody>${rows.join('')}</tbody></table>`);
      }
      continue;
    }

    // 段落
    const { atoms } = extractParagraphAtoms(c.inner);
    const inline = renderInline(atoms);
    const level = headingLevelFromInner(c.inner);
    const tag = level ? `h${level}` : 'p';
    parts.push(`<${tag} data-pid="${pid}">${inline}</${tag}>`);
    pid++;
  }

  return {
    html: parts.join('\n'),
    originalHash: createHash('sha256').update(buffer).digest('hex'),
  };
}
