import { convertDocxToHtml } from './docx-to-html.converter';
import { buildFixtureDocx } from './__fixtures__/docx-fixture.builder';
import { HeadingLevel } from 'docx';
import { createHash } from 'crypto';

describe('convertDocxToHtml', () => {
  it('emits <p data-pid> with stable increasing pids', async () => {
    const buf = await buildFixtureDocx({ paragraphs: [{ text: '甲' }, { text: '乙' }] });
    const { html } = await convertDocxToHtml(buf);
    expect(html).toMatch(/<p[^>]*data-pid="0"[^>]*>.*甲.*<\/p>/s);
    expect(html).toMatch(/<p[^>]*data-pid="1"[^>]*>.*乙.*<\/p>/s);
  });

  it('maps heading levels to h1..h6 with data-pid', async () => {
    const buf = await buildFixtureDocx({
      heading: { text: '大标题', level: HeadingLevel.HEADING_1 },
    });
    const { html } = await convertDocxToHtml(buf);
    expect(html).toMatch(/<h1[^>]*data-pid="\d+"[^>]*>.*大标题.*<\/h1>/s);
  });

  it('emits inline bold as <strong>', async () => {
    const buf = await buildFixtureDocx({ paragraphs: [{ text: '加粗文字', bold: true }] });
    const { html } = await convertDocxToHtml(buf);
    expect(html).toContain('<strong>加粗文字</strong>');
  });

  it('renders table cell paragraphs each with a data-pid', async () => {
    const buf = await buildFixtureDocx({ table: [['A1', 'B1'], ['A2', 'B2']] });
    const { html } = await convertDocxToHtml(buf);
    expect(html).toContain('A1');
    expect((html.match(/data-pid="\d+"/g) ?? []).length).toBeGreaterThanOrEqual(4);
  });

  it('originalHash = sha256(buffer)', async () => {
    const buf = await buildFixtureDocx({ paragraphs: [{ text: 'X' }] });
    const { originalHash } = await convertDocxToHtml(buf);
    expect(originalHash).toBe(createHash('sha256').update(buf).digest('hex'));
  });
});
