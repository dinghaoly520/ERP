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
    const pid = pidCounter++;
    seenPids.add(pid);

    if (!htmlMap.has(pid)) {
      // 该段在 HTML 中被删除 → 跳过
      continue;
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
