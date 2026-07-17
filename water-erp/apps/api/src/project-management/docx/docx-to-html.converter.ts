import { createHash } from 'crypto';
import JSZip = require('jszip');
import { segmentDocumentXml } from './segment-xml';
import { extractParagraphAtoms, Atom } from './paragraph-runs';

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** 把一个段落的 atoms 渲染为行内 HTML（加粗→strong、斜体→em、下划线→u；锚点略）。 */
function renderInline(atoms: Atom[]): string {
  let out = '';
  for (const a of atoms) {
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
