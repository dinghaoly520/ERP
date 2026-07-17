import { rewriteParagraphInner } from './paragraph-rewriter';
import { extractParagraphAtoms } from './paragraph-runs';

describe('rewriteParagraphInner', () => {
  it('preserves untouched run bytes when text unchanged (idempotent)', () => {
    const inner = `<w:r><w:rPr><w:b/></w:rPr><w:t>加粗</w:t></w:r><w:r><w:t>普通</w:t></w:r>`;
    expect(rewriteParagraphInner(inner, '加粗普通')).toBe(inner);
  });

  it('keeps bold rPr on unchanged chars; new chars inherit neighbor rPr', () => {
    const inner = `<w:r><w:rPr><w:b/></w:rPr><w:t>加粗</w:t></w:r>`;
    const out = rewriteParagraphInner(inner, '加粗内容');
    const { atoms } = extractParagraphAtoms(out);
    for (const a of atoms) expect(a.rPrXml).toContain('<w:b/>');
    expect(atoms.map((a) => (a as { text: string }).text ?? '').join('')).toBe('加粗内容');
  });

  it('preserves <w:drawing> anchor position when surrounding text changes', () => {
    const inner = `<w:r><w:t>前文</w:t></w:r><w:r><w:drawing><wp:x/></w:drawing></w:r><w:r><w:t>后文</w:t></w:r>`;
    const out = rewriteParagraphInner(inner, '前文字 后文字');
    expect(out).toContain('<w:drawing><wp:x/></w:drawing>');
    const { atoms } = extractParagraphAtoms(out);
    expect(atoms.some((a) => a.kind === 'anchor' && a.anchorKind === 'image')).toBe(true);
    expect(atoms.map((a) => (a as { text: string }).text ?? '').join('')).toBe('前文字 后文字');
  });

  it('preserves <w:br> page-break anchor', () => {
    const inner = `<w:r><w:t>A</w:t></w:r><w:r><w:br/></w:r><w:r><w:t>B</w:t></w:r>`;
    const out = rewriteParagraphInner(inner, 'A B');
    expect(out).toContain('<w:br/>');
  });

  it('handles full text replacement by inheriting first run rPr', () => {
    const inner = `<w:r><w:rPr><w:b/></w:rPr><w:t>旧文</w:t></w:r>`;
    const out = rewriteParagraphInner(inner, '全新内容');
    expect(extractParagraphAtoms(out).atoms.every((a) => a.rPrXml.includes('<w:b/>'))).toBe(true);
  });

  it('escapes XML special chars in output text', () => {
    const inner = `<w:r><w:t>x</w:t></w:r>`;
    const out = rewriteParagraphInner(inner, 'a & b < c');
    expect(out).toContain('a &amp; b &lt; c');
  });
});
