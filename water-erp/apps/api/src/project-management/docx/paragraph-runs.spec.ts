import { extractParagraphAtoms } from './paragraph-runs';

describe('extractParagraphAtoms', () => {
  it('extracts text atoms with rPr preserved', () => {
    const inner = `<w:r><w:rPr><w:b/></w:rPr><w:t>加粗</w:t></w:r><w:r><w:t>普通</w:t></w:r>`;
    const { atoms, fullText } = extractParagraphAtoms(inner);
    expect(fullText).toBe('加粗普通');
    expect(atoms[0]).toMatchObject({ kind: 'text', text: '加粗' });
    expect(atoms[0].rPrXml).toContain('<w:b/>');
    expect(atoms[1].rPrXml).toBe('');
  });

  it('treats <w:br> and <w:drawing> as anchors (not text)', () => {
    const inner = `<w:r><w:t>前</w:t></w:r><w:r><w:br/></w:r><w:r><w:drawing><wp:a/></w:drawing></w:r><w:r><w:t>后</w:t></w:r>`;
    const { atoms, fullText } = extractParagraphAtoms(inner);
    expect(fullText).toBe('前后');
    const anchors = atoms.filter((a) => a.kind === 'anchor') as Array<{
      kind: 'anchor';
      raw: string;
      anchorKind: 'break' | 'image';
    }>;
    expect(anchors).toHaveLength(2);
    expect(anchors[0].anchorKind).toBe('break');
    expect(anchors[1].anchorKind).toBe('image');
    expect(anchors[1].raw).toContain('<w:drawing>');
  });

  it('preserves run order: text and anchors interleaved', () => {
    const inner = `<w:r><w:t>A</w:t></w:r><w:r><w:br/></w:r><w:r><w:t>B</w:t></w:r>`;
    const { atoms } = extractParagraphAtoms(inner);
    expect(atoms.map((a) => a.kind)).toEqual(['text', 'anchor', 'text']);
  });

  it('unescapes XML entities in text', () => {
    const inner = `<w:r><w:t>a &amp; b &lt; c</w:t></w:r>`;
    const { fullText } = extractParagraphAtoms(inner);
    expect(fullText).toBe('a & b < c');
  });
});
