export type XmlChunk =
  | { kind: 'p'; raw: string; inner: string; selfClosed: boolean }
  | { kind: 'other'; raw: string };

const OPEN_RE = /<w:p(\s[^>]*?)?>/g; // <w:p>, <w:p attr=...>; 自闭合 <w:p/> 不匹配（其后是 /）
const SELF_CLOSED_RE = /<w:p(\s[^>]*?)?\/>/g; // <w:p/>, <w:p attr/>

/**
 * 把 document.xml 切成有序 chunk。段落不嵌套（<w:p> 内不含 <w:p>），
 * 故"下一个 </w:p>"即当前段落的闭合。切片为连续无损分区：
 * chunks.map(c => c.raw).join('') === xml。
 */
export function segmentDocumentXml(xml: string): XmlChunk[] {
  type Span = { start: number; end: number; selfClosed: boolean; openTagEnd: number };
  const spans: Span[] = [];

  // 自闭合
  const sc = new RegExp(SELF_CLOSED_RE);
  let m: RegExpExecArray | null;
  while ((m = sc.exec(xml))) {
    spans.push({ start: m.index, end: m.index + m[0].length, selfClosed: true, openTagEnd: m.index + m[0].length });
  }

  // 开标签 → 配对到下一个 </w:p>
  const op = new RegExp(OPEN_RE);
  while ((m = op.exec(xml))) {
    const openTagEnd = m.index + m[0].length;
    const closeIdx = xml.indexOf('</w:p>', openTagEnd);
    if (closeIdx === -1) continue; // 残缺，按 other 处理
    const end = closeIdx + '</w:p>'.length;
    spans.push({ start: m.index, end, selfClosed: false, openTagEnd });
  }

  spans.sort((a, b) => a.start - b.start);

  const chunks: XmlChunk[] = [];
  let cursor = 0;
  for (const sp of spans) {
    // 跳过重叠（理论不发生，保险）
    if (sp.end <= cursor) continue;
    if (sp.start > cursor) chunks.push({ kind: 'other', raw: xml.slice(cursor, sp.start) });
    const raw = xml.slice(sp.start, sp.end);
    if (sp.selfClosed) {
      chunks.push({ kind: 'p', raw, inner: '', selfClosed: true });
    } else {
      const inner = xml.slice(sp.openTagEnd, sp.end - '</w:p>'.length);
      chunks.push({ kind: 'p', raw, inner, selfClosed: false });
    }
    cursor = sp.end;
  }
  if (cursor < xml.length) chunks.push({ kind: 'other', raw: xml.slice(cursor) });
  return chunks;
}
