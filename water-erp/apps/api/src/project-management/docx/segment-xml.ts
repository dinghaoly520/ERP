export type XmlChunk =
  | { kind: 'p'; raw: string; inner: string; selfClosed: boolean }
  | { kind: 'tbl'; raw: string; inner: string }
  | { kind: 'other'; raw: string };

const OPEN_RE = /<w:p(\s[^>]*?)?>/g; // <w:p>, <w:p attr=...>; 自闭合 <w:p/> 不匹配（其后是 /）
const SELF_CLOSED_RE = /<w:p(\s[^>]*?)?\/>/g; // <w:p/>, <w:p attr/>
const TBL_RE = /<w:tbl(\s[^>]*?)?>/g;   // <w:tbl>, <w:tbl attr=...>

/** 段落/表格 span：描述文档中一个结构化区域的位置信息 */
type Span = { start: number; end: number; kind: 'p' | 'tbl'; selfClosed?: boolean; openTagEnd: number };

/**
 * 把 document.xml 切成有序 chunk。段落不嵌套（<w:p> 内不含 <w:p>），
 * 表格可嵌段落但整表是一个块。切片为连续无损分区：
 * chunks.map(c => c.raw).join('') === xml。
 */
export function segmentDocumentXml(xml: string): XmlChunk[] {
  const spans: Span[] = [];

  // ── 表格 span：<w:tbl> 到最近的 </w:tbl> ──
  const tbl = new RegExp(TBL_RE);
  let tm: RegExpExecArray | null;
  while ((tm = tbl.exec(xml))) {
    const openTagEnd = tm.index + tm[0].length;
    const closeIdx = xml.indexOf('</w:tbl>', openTagEnd);
    if (closeIdx === -1) continue;
    spans.push({ start: tm.index, end: closeIdx + '</w:tbl>'.length, kind: 'tbl', openTagEnd });
  }

  // ── 自闭合段落 ──
  const sc = new RegExp(SELF_CLOSED_RE);
  let m: RegExpExecArray | null;
  while ((m = sc.exec(xml))) {
    spans.push({ start: m.index, end: m.index + m[0].length, kind: 'p', selfClosed: true, openTagEnd: m.index + m[0].length });
  }

  // ── 普通段落：开标签 → 配对到下一个 </w:p> ──
  const op = new RegExp(OPEN_RE);
  while ((m = op.exec(xml))) {
    const openTagEnd = m.index + m[0].length;
    const closeIdx = xml.indexOf('</w:p>', openTagEnd);
    if (closeIdx === -1) continue;
    const end = closeIdx + '</w:p>'.length;
    spans.push({ start: m.index, end, kind: 'p', selfClosed: false, openTagEnd });
  }

  // ── 剔除嵌套在表格内部的 <w:p> span ──
  const tableSpans = spans.filter((s) => s.kind === 'tbl');
  const filteredSpans = spans.filter((s) => {
    if (s.kind !== 'p') return true; // 保留表格本身
    // 若此段落位于任一表格内部则剔除
    return !tableSpans.some((t) => s.start >= t.start && s.end <= t.end);
  });

  filteredSpans.sort((a, b) => a.start - b.start);

  const chunks: XmlChunk[] = [];
  let cursor = 0;
  for (const sp of filteredSpans) {
    if (sp.end <= cursor) continue;
    if (sp.start > cursor) chunks.push({ kind: 'other', raw: xml.slice(cursor, sp.start) });

    const raw = xml.slice(sp.start, sp.end);

    if (sp.kind === 'tbl') {
      const inner = xml.slice(sp.openTagEnd, sp.end - '</w:tbl>'.length);
      chunks.push({ kind: 'tbl', raw, inner });
    } else if (sp.selfClosed) {
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
