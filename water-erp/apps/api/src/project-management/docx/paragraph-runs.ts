export type Atom =
  | { kind: 'text'; rPrXml: string; text: string }
  | { kind: 'anchor'; rPrXml: string; raw: string; anchorKind: 'break' | 'image' };

const RUN_RE = /<w:r(\s[^>]*?)?>([\s\S]*?)<\/w:r>/g;

function unescapeXml(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

/**
 * 从段落 inner 解析出有序 atom 序列：text atom（带 rPr）与 anchor atom（图片/分页）。
 * fullText = text atom 文字拼接（不含锚点），供补丁器与原文比对。
 */
export function extractParagraphAtoms(pInner: string): { atoms: Atom[]; fullText: string } {
  const atoms: Atom[] = [];
  const re = new RegExp(RUN_RE);
  let m: RegExpExecArray | null;
  while ((m = re.exec(pInner))) {
    const body = m[2] ?? '';
    const rPrMatch = body.match(/<w:rPr>([\s\S]*?)<\/w:rPr>/);
    const rPrXml = rPrMatch ? `<w:rPr>${rPrMatch[1]}</w:rPr>` : '';

    // 顺序遍历 run 内的 <w:t> / <w:br> / <w:drawing>，保持原序
    const childRe =
      /<w:t(\s[^>]*?)?>([\s\S]*?)<\/w:t>|<w:br(\s[^>]*?)?\/>|<w:drawing>([\s\S]*?)<\/w:drawing>/g;
    let c: RegExpExecArray | null;
    while ((c = childRe.exec(body))) {
      const tag = c[0];
      if (tag.startsWith('<w:t')) {
        atoms.push({ kind: 'text', rPrXml, text: unescapeXml(c[2] ?? '') });
      } else if (tag.startsWith('<w:br')) {
        atoms.push({ kind: 'anchor', rPrXml, raw: tag, anchorKind: 'break' });
      } else if (tag.startsWith('<w:drawing')) {
        atoms.push({ kind: 'anchor', rPrXml, raw: tag, anchorKind: 'image' });
      }
    }
  }
  const fullText = atoms
    .filter((a) => a.kind === 'text')
    .map((a) => (a as { text: string }).text)
    .join('');
  return { atoms, fullText };
}
