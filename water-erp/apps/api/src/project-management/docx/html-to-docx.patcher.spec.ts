import { patchDocx, ConcurrentEditError } from './html-to-docx.patcher';
import { convertDocxToHtml } from './docx-to-html.converter';
import { buildFixtureDocx, readDocumentXml } from './__fixtures__/docx-fixture.builder';
import { HeadingLevel } from 'docx';

function replaceTextInHtml(html: string, from: string, to: string): string {
  return html.replace(from, to);
}

function extractParagraphRaw(xml: string, needle: string): string {
  const idx = xml.indexOf(needle);
  const open = xml.lastIndexOf('<w:p', idx);
  const close = xml.indexOf('</w:p>', idx) + '</w:p>'.length;
  return xml.slice(open, close);
}

describe('patchDocx', () => {
  it('BYTE-FIDELITY: unchanged HTML round-trips to identical document.xml', async () => {
    const orig = await buildFixtureDocx({
      heading: { text: '标题一', level: HeadingLevel.HEADING_1 },
      paragraphs: [{ text: '第一段正文。', bold: true }, { text: '第二段正文。' }],
    });
    const { html, originalHash } = await convertDocxToHtml(orig);
    const patched = await patchDocx(orig, html, originalHash);
    const origXml = await readDocumentXml(orig);
    const newXml = await readDocumentXml(patched);
    expect(newXml).toBe(origXml);
  });

  it('changes only the edited paragraph; others byte-identical', async () => {
    const orig = await buildFixtureDocx({
      paragraphs: [{ text: 'AAA' }, { text: 'BBB' }, { text: 'CCC' }],
    });
    const { html, originalHash } = await convertDocxToHtml(orig);
    const edited = replaceTextInHtml(html, 'BBB', 'BBB已改');
    const patched = await patchDocx(orig, edited, originalHash);
    const newXml = await readDocumentXml(patched);
    const origXml = await readDocumentXml(orig);

    expect(newXml).toContain('BBB已改');
    expect(newXml).toContain('AAA');
    expect(newXml).toContain('CCC');
    // AAA / CCC 段保留原字节
    expect(newXml).toContain(extractParagraphRaw(origXml, 'AAA'));
    expect(newXml).toContain(extractParagraphRaw(origXml, 'CCC'));
  });

  it('throws ConcurrentEditError when clientHash mismatches', async () => {
    const orig = await buildFixtureDocx({ paragraphs: [{ text: 'X' }] });
    const { html } = await convertDocxToHtml(orig);
    await expect(patchDocx(orig, html, 'wrong-hash')).rejects.toBeInstanceOf(
      ConcurrentEditError,
    );
  });

  it('preserves bold formatting on an edited paragraph', async () => {
    const orig = await buildFixtureDocx({
      paragraphs: [{ text: '招标范围', bold: true }],
    });
    const { html, originalHash } = await convertDocxToHtml(orig);
    const edited = replaceTextInHtml(html, '招标范围', '招标内容');
    const patched = await patchDocx(orig, edited, originalHash);
    const newXml = await readDocumentXml(patched);
    // 改后段落仍应包含 <w:b/>
    const idx = newXml.indexOf('招标内容');
    const open = newXml.lastIndexOf('<w:p', idx);
    const close = newXml.indexOf('</w:p>', idx) + '</w:p>'.length;
    const paraXml = newXml.slice(open, close);
    expect(paraXml).toContain('<w:b/>');
    expect(paraXml).toContain('招标内容');
  });
});
