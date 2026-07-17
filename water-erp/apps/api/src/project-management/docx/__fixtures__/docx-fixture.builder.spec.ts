import { buildFixtureDocx, readDocumentXml } from './docx-fixture.builder';
import { HeadingLevel } from 'docx';

describe('docx fixture builder', () => {
  it('builds a valid docx with document.xml', async () => {
    const buf = await buildFixtureDocx({ paragraphs: [{ text: '你好世界' }] });
    const xml = await readDocumentXml(buf);
    expect(xml).toContain('<w:body');
    expect(xml).toContain('你好世界');
  });

  it('builds a heading paragraph', async () => {
    const buf = await buildFixtureDocx({
      heading: { text: '标题', level: HeadingLevel.HEADING_1 },
    });
    const xml = await readDocumentXml(buf);
    expect(xml).toContain('Heading1');
    expect(xml).toContain('标题');
  });
});
