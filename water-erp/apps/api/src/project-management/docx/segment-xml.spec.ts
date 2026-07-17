import { segmentDocumentXml } from './segment-xml';
import { buildFixtureDocx, readDocumentXml } from './__fixtures__/docx-fixture.builder';

const XML = `<?xml version="1.0"?>
<w:document xmlns:w="w">
  <w:body>
    <w:p><w:r><w:t>AAA</w:t></w:r></w:p>
    <w:p w:rsidR="00"><w:r><w:t>BBB</w:t></w:r></w:p>
    <!-- filler -->
    <w:p/>
  </w:body>
</w:document>`;

describe('segmentDocumentXml', () => {
  it('partitions losslessly: raw concatenation === original', () => {
    const chunks = segmentDocumentXml(XML);
    expect(chunks.map((c) => c.raw).join('')).toBe(XML);
  });

  it('extracts paragraph chunks with inner text region', () => {
    const ps = segmentDocumentXml(XML).filter((c) => c.kind === 'p') as Array<{
      kind: 'p';
      raw: string;
      inner: string;
      selfClosed: boolean;
    }>;
    expect(ps).toHaveLength(3);
    expect(ps[0].inner).toContain('<w:r><w:t>AAA</w:t></w:r>');
    expect(ps[0].selfClosed).toBe(false);
    expect(ps[2].selfClosed).toBe(true);
    expect(ps[2].inner).toBe('');
  });

  it('preserves inter-paragraph filler as "other" chunks', () => {
    const others = segmentDocumentXml(XML)
      .filter((c) => c.kind === 'other')
      .map((c) => (c as { raw: string }).raw)
      .join('');
    expect(others).toContain('<!-- filler -->');
    expect(others).toContain('<w:body>');
    expect(others).toContain('</w:document>');
  });

  it('never splits a <w:p> across chunks (paragraphs do not nest)', () => {
    const chunks = segmentDocumentXml(XML);
    for (const c of chunks) {
      if (c.kind === 'p') {
        const opens = (c.raw.match(/<w:p[ >]/g) ?? []).length;
        const selfClosed = (c.raw.match(/<w:p\/>/g) ?? []).length;
        expect(opens + selfClosed).toBe(1);
      }
    }
  });

  it('segments real Word-generated document.xml losslessly', async () => {
    const buf = await buildFixtureDocx({
      paragraphs: [{ text: '第一段' }, { text: '第二段' }],
    });
    const xml = await readDocumentXml(buf);
    const chunks = segmentDocumentXml(xml);
    expect(chunks.map((c) => c.raw).join('')).toBe(xml);
    const ps = chunks.filter((c) => c.kind === 'p');
    expect(ps.length).toBeGreaterThanOrEqual(2);
  });
});
