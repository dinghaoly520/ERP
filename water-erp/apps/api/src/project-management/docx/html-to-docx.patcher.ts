import { createHash } from 'crypto';
import JSZip = require('jszip');
import { segmentDocumentXml } from './segment-xml';
import { extractParagraphAtoms } from './paragraph-runs';
import { rewriteParagraphInner } from './paragraph-rewriter';

export class ConcurrentEditError extends Error {
  constructor() {
    super('文件已被他人修改，请刷新重载');
    this.name = 'ConcurrentEditError';
  }
}

/** 从编辑后 HTML 抽取 pid → 文字（textContent，忽略可视化 span/标签）。 */
export function extractHtmlParagraphMap(html: string): Map<number, string> {
  const map = new Map<number, string>();
  const blockRe = /<(p|h[1-6]|li|td|th|div)([^>]*)>([\s\S]*?)<\/\1>/g;
  let m: RegExpExecArray | null;
  while ((m = blockRe.exec(html))) {
    const attrs = m[2] ?? '';
    const pidMatch = attrs.match(/data-pid="(\d+)"/);
    if (!pidMatch) continue;
    const pid = Number(pidMatch[1]);
    const text = (m[3] ?? '')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .trim();
    map.set(pid, text);
  }
  return map;
}

function escapeXmlText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export async function patchDocx(
  originalBuffer: Buffer,
  editedHtml: string,
  clientHash: string,
): Promise<Buffer> {
  const actualHash = createHash('sha256').update(originalBuffer).digest('hex');
  if (actualHash !== clientHash) throw new ConcurrentEditError();

  const zip = await JSZip.loadAsync(originalBuffer);
  const docFile = zip.file('word/document.xml');
  if (!docFile) throw new Error('DOCX 缺少 word/document.xml');
  const xml = await docFile.async('string');

  const htmlMap = extractHtmlParagraphMap(editedHtml);
  const chunks = segmentDocumentXml(xml);

  let pidCounter = 0;
  const seenPids = new Set<number>();
  const outChunks: string[] = [];

  for (const c of chunks) {
    if (c.kind === 'other') {
      outChunks.push(c.raw);
      continue;
    }

    if (c.kind === 'tbl') {
      // ── 表格：逐行逐格分配 PID（与 convertDocxToHtml 渲染顺序一致），
      //     vMerge=continue 单元格不出现在 HTML 中，不分配 PID ──
      const trRegex = /<w:tr(\s[^>]*?)?>([\s\S]*?)<\/w:tr>/g;
      let tblXml = c.raw;
      let trm: RegExpExecArray | null;
      while ((trm = trRegex.exec(c.inner))) {
        const tcRegex = /<w:tc(\s[^>]*?)?>([\s\S]*?)<\/w:tc>/g;
        let tcm: RegExpExecArray | null;
        while ((tcm = tcRegex.exec(trm[2]))) {
          const tcFull = tcm[0];
          const tcInner = tcm[2];

          // vMerge=continue 格不出现在 HTML，跳过分 PID 直接保原样
          const tcPrM = tcInner.match(/<w:tcPr>([\s\S]*?)<\/w:tcPr>/);
          const isVMergeContinue = tcPrM && /<w:vMerge/.test(tcPrM[1]) && !/w:val="restart"/.test(tcPrM[1]);
          if (isVMergeContinue) {
            continue;
          }

          const pid = pidCounter++;
          seenPids.add(pid);

          if (!htmlMap.has(pid)) continue; // 未编辑 — 保留原文

          const newText = htmlMap.get(pid)!;
          // 取单元格内所有 <w:p>；多于 1 个段落时跳过逐段重写（避免段落边界重构失真）
          const allParas = [...tcInner.matchAll(/<w:p(\s[^>]*?)?>/g)];
          if (allParas.length > 1) continue;

          const pM = tcInner.match(/<w:p(\s[^>]*?)?>([\s\S]*?)<\/w:p>/);
          if (!pM) continue;
          const pFull = pM[0];
          const pAttrs = pM[1] ?? '';
          const pInner = pM[2];
          const { fullText } = extractParagraphAtoms(pInner);
          if (fullText.trim() === newText) continue; // 文字未变

          const rewrittenP = `<w:p${pAttrs}>${rewriteParagraphInner(pInner, newText)}</w:p>`;
          tblXml = tblXml.replace(tcFull, tcFull.replace(pFull, rewrittenP));
        }
      }
      outChunks.push(tblXml);
      continue;
    }

    // ── 段落 ──
    const pid = pidCounter++;
    seenPids.add(pid);

    if (!htmlMap.has(pid)) {
      continue; // 该段在 HTML 中被删除 → 跳过
    }
    const newText = htmlMap.get(pid)!;
    const { fullText } = extractParagraphAtoms(c.inner);
    if (fullText.trim() === newText) {
      outChunks.push(c.raw); // 字节保留
    } else {
      const openTagEnd = c.raw.indexOf('>') + 1;
      const openTag = c.raw.slice(0, openTagEnd);
      outChunks.push(openTag + rewriteParagraphInner(c.inner, newText) + '</w:p>');
    }
  }

  // HTML 中存在但原文没有的 pid → 用户新增段落，附加到 body 末尾
  const newParas = [...htmlMap.entries()]
    .filter(([pid]) => !seenPids.has(pid))
    .sort((a, b) => a[0] - b[0]);
  let nextDocXml = outChunks.join('');
  if (newParas.length) {
    const insert = newParas
      .map(
        ([, text]) =>
          `<w:p><w:r><w:t xml:space="preserve">${escapeXmlText(text)}</w:t></w:r></w:p>`,
      )
      .join('');
    const bodyClose = nextDocXml.lastIndexOf('</w:body>');
    nextDocXml = bodyClose >= 0
      ? nextDocXml.slice(0, bodyClose) + insert + nextDocXml.slice(bodyClose)
      : nextDocXml + insert;
  }
  zip.file('word/document.xml', nextDocXml);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }) as Promise<Buffer>;
}
