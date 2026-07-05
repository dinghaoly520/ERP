import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  Table,
  TableRow,
  TableCell,
} from 'docx';
import * as JSZip from 'jszip';
import { addDocxCommentBuffer, modifyDocxBuffer } from './docx-generator';

describe('modifyDocxBuffer', () => {
  async function createDocxBuffer(
    textParts: string | string[],
  ): Promise<Buffer> {
    const parts = Array.isArray(textParts) ? textParts : [textParts];
    const doc = new Document({
      sections: [
        {
          children: [
            new Paragraph({
              children: parts.map((part) => new TextRun(part)),
            }),
          ],
        },
      ],
    });

    return Packer.toBuffer(doc);
  }

  it('writes tracked revision markup as run-level nodes instead of nesting under w:t', async () => {
    const original = '原始内容';
    const buffer = await createDocxBuffer(original);

    const modified = await modifyDocxBuffer(
      buffer,
      original,
      '修订内容',
      'replace',
    );

    const zip = await JSZip.loadAsync(modified);
    const documentXml = await zip.file('word/document.xml')!.async('string');
    const settingsXml = await zip.file('word/settings.xml')!.async('string');

    expect(documentXml).toContain('<w:del ');
    expect(documentXml).toContain('<w:ins ');
    expect(documentXml).not.toContain('<w:t><w:del');
    expect(settingsXml).toContain('<w:trackRevisions');
  });

  it('writes tracked revisions when the original text spans multiple runs', async () => {
    const original = '2025 年 2月 31日至 2025 年4月31 日';
    const buffer = await createDocxBuffer([
      '时间： ',
      '2025 ',
      '年 ',
      '2',
      '月 ',
      '31',
      '日至 ',
      '2025 ',
      '年',
      '4',
      '月',
      '31',
      ' 日',
    ]);

    const modified = await modifyDocxBuffer(
      buffer,
      original,
      '2025 年 2月 28日至 2025 年 4月 30 日',
      'replace',
    );

    const zip = await JSZip.loadAsync(modified);
    const documentXml = await zip.file('word/document.xml')!.async('string');

    expect(documentXml).toContain('<w:del ');
    expect(documentXml).toContain('<w:ins ');
  });
});

describe('addDocxCommentBuffer', () => {
  async function createDocxBuffer(
    textParts: string | string[],
  ): Promise<Buffer> {
    const parts = Array.isArray(textParts) ? textParts : [textParts];
    const doc = new Document({
      sections: [
        {
          children: [
            new Paragraph({
              children: parts.map((part) => new TextRun(part)),
            }),
          ],
        },
      ],
    });

    return Packer.toBuffer(doc);
  }

  /** Helper: create a multi-paragraph DOCX */
  async function createMultiParagraphDocx(
    paragraphs: string[],
  ): Promise<Buffer> {
    const doc = new Document({
      sections: [
        {
          children: paragraphs.map(
            (text) => new Paragraph({ children: [new TextRun(text)] }),
          ),
        },
      ],
    });
    return Packer.toBuffer(doc);
  }

  /** Helper: extract comment text from comments.xml */
  async function getCommentText(buffer: Buffer): Promise<string> {
    const zip = await JSZip.loadAsync(buffer);
    const commentsXml = await zip.file('word/comments.xml')?.async('string');
    if (!commentsXml) return '';
    const match = commentsXml.match(/<w:t[^>]*>([\s\S]*?)<\/w:t>/);
    return match ? match[1] : '';
  }

  /** Helper: check if comment is anchored (has commentRangeStart) in document.xml */
  async function hasCommentAnchored(buffer: Buffer): Promise<boolean> {
    const zip = await JSZip.loadAsync(buffer);
    const docXml = await zip.file('word/document.xml')?.async('string');
    return docXml?.includes('<w:commentRangeStart') ?? false;
  }

  /** Helper: check if the italic fallback marker "(审查批注)" exists */
  async function hasFallbackMarker(buffer: Buffer): Promise<boolean> {
    const zip = await JSZip.loadAsync(buffer);
    const docXml = await zip.file('word/document.xml')?.async('string');
    return docXml?.includes('（审查批注）') ?? false;
  }

  // ── Exact match tests ──

  it('anchors comment to exact text match', async () => {
    const anchor = '类似业绩定义应当体现公平竞争';
    const comment = '建议放宽类似业绩定义。';
    const buffer = await createDocxBuffer(`本项目要求：${anchor}，不得排斥。`);

    const modified = await addDocxCommentBuffer(buffer, comment, anchor);

    expect(await hasCommentAnchored(modified)).toBe(true);
    expect(await hasFallbackMarker(modified)).toBe(false);
    expect(await getCommentText(modified)).toBe(comment);
  });

  it('anchors comment when text spans multiple runs', async () => {
    const anchor = '音频大地电磁法';
    const comment = '建议不限定特定勘探方法。';
    const buffer = await createDocxBuffer([
      '勘探方法可采用',
      '音频',
      '大地',
      '电磁法',
      '等方式。',
    ]);

    const modified = await addDocxCommentBuffer(buffer, comment, anchor);

    expect(await hasCommentAnchored(modified)).toBe(true);
    expect(await hasFallbackMarker(modified)).toBe(false);
  });

  // ── Whitespace fuzzy match tests ──

  it('fuzzy matches when document has extra spaces vs anchor (mammoth normalized)', async () => {
    // Document XML has extra spaces from run splitting, mammoth normalizes them
    const buffer = await createDocxBuffer([
      '评分标准要求：',
      '埋深1000米以上 ',
      ' 深埋长隧洞',
      '音频大地电磁法',
      '勘探业绩。',
    ]);
    const anchor = '埋深1000米以上 深埋长隧洞音频大地电磁法勘探';
    const comment = '该业绩要求具有排他性。';

    const modified = await addDocxCommentBuffer(buffer, comment, anchor);

    expect(await hasCommentAnchored(modified)).toBe(true);
    expect(await hasFallbackMarker(modified)).toBe(false);
  });

  it('fuzzy matches when anchor has different whitespace (tab vs space)', async () => {
    const buffer = await createDocxBuffer(
      '投标保证金为合同金额的5% 且不超过80万元。',
    );
    const anchor = '投标保证金为合同金额的5%\t且不超过80万元';
    const comment = '保证金比例需复核。';

    const modified = await addDocxCommentBuffer(buffer, comment, anchor);

    expect(await hasCommentAnchored(modified)).toBe(true);
    expect(await hasFallbackMarker(modified)).toBe(false);
  });

  it('fuzzy matches when document has no spaces but anchor does (mammoth inserts spaces)', async () => {
    // Real scenario: mammoth sometimes inserts spaces between CJK characters
    const buffer = await createDocxBuffer(
      '资格审查要求投标人具备类似工程勘察业绩。',
    );
    const anchor = '资格审查要求 投标人具备 类似工程勘察业绩';
    const comment = '建议放宽业绩要求。';

    const modified = await addDocxCommentBuffer(buffer, comment, anchor);

    expect(await hasCommentAnchored(modified)).toBe(true);
    expect(await hasFallbackMarker(modified)).toBe(false);
  });

  // ── No anchor fallback tests ──

  it('falls back to last paragraph when anchor is undefined', async () => {
    const buffer = await createDocxBuffer('这是文档正文内容。');
    const comment = '审查意见：需要补充相关条款。';

    const modified = await addDocxCommentBuffer(buffer, comment, undefined);

    expect(await hasCommentAnchored(modified)).toBe(true);
    expect(await hasFallbackMarker(modified)).toBe(true);
    expect(await getCommentText(modified)).toBe(comment);
  });

  it('falls back to last paragraph when anchor text is not in document', async () => {
    const buffer = await createDocxBuffer('正文没有目标片段');
    const comment = '审查意见：需要修改。';

    const modified = await addDocxCommentBuffer(
      buffer,
      comment,
      '完全不存在的锚点文本',
    );

    expect(await hasCommentAnchored(modified)).toBe(true);
    expect(await hasFallbackMarker(modified)).toBe(true);
  });

  // ── Multi-paragraph tests ──

  it('anchors to text in the second paragraph', async () => {
    const buffer = await createMultiParagraphDocx([
      '第一章 招标公告',
      '本项目要求投标人具备埋深1000米以上深埋长隧洞勘察业绩。',
      '第三条 评分标准',
    ]);
    const anchor = '埋深1000米以上深埋长隧洞勘察业绩';
    const comment = '业绩要求过于具体，建议放宽。';

    const modified = await addDocxCommentBuffer(buffer, comment, anchor);

    expect(await hasCommentAnchored(modified)).toBe(true);
    expect(await hasFallbackMarker(modified)).toBe(false);
  });

  // ── Match precision tests ──

  it('precise match: comment wraps only the anchor text, not surrounding whitespace', async () => {
    // Document: "第一章 要求投标人具备 类似业绩 定义如下"
    // Anchor: "类似业绩" (no spaces)
    // Expected: comment wraps exactly "类似业绩", not " 类似业绩 " or "具备 类似业绩 定义"
    const buffer = await createDocxBuffer(
      '第一章 要求投标人具备 类似业绩 定义如下',
    );
    const anchor = '类似业绩';
    const comment = '建议放宽定义。';

    const modified = await addDocxCommentBuffer(buffer, comment, anchor);

    const zip = await JSZip.loadAsync(modified);
    const docXml = await zip.file('word/document.xml')!.async('string');

    // The comment range should contain exactly the anchor text
    const rangeStart = docXml.indexOf('commentRangeStart');
    const rangeEnd = docXml.indexOf('commentRangeEnd');
    expect(rangeStart).toBeGreaterThan(0);
    expect(rangeEnd).toBeGreaterThan(rangeStart);

    // Extract the text between commentRangeStart and commentRangeEnd
    const rangeContent = docXml.slice(rangeStart, rangeEnd);
    // Should contain the anchor text
    expect(rangeContent).toContain('类似业绩');
    // Should NOT contain surrounding text
    expect(rangeContent).not.toContain('具备');
    expect(rangeContent).not.toContain('定义');
  });

  it('precise match: fuzzy match stops at word boundaries', async () => {
    // Document has extra spaces: "类似  业绩  的设定"
    // Anchor: "类似业绩的设定" (no spaces)
    // Expected: match includes the spaces between words but NOT extra surrounding text
    const buffer = await createDocxBuffer(
      '要求 投标人具备类似  业绩  的设定 具有排他性',
    );
    const anchor = '类似业绩的设定';
    const comment = '该定义过于狭窄。';

    const modified = await addDocxCommentBuffer(buffer, comment, anchor);

    const zip = await JSZip.loadAsync(modified);
    const docXml = await zip.file('word/document.xml')!.async('string');

    const rangeStart = docXml.indexOf('commentRangeStart');
    const rangeEnd = docXml.indexOf('commentRangeEnd');
    const rangeContent = docXml.slice(rangeStart, rangeEnd);

    // Should contain the anchor text (with internal spaces)
    expect(rangeContent).toContain('类似');
    expect(rangeContent).toContain('业绩');
    expect(rangeContent).toContain('设定');
    // Should NOT contain surrounding text
    expect(rangeContent).not.toContain('具备');
    expect(rangeContent).not.toContain('排他');
  });

  it('global fuzzy: skips field code runs and anchors to visible text', async () => {
    // Create a DOCX with a TOC field that contains the anchor text as field code
    const buffer = await createDocxBuffer(
      '评分标准中关于类似业绩的设定具有排他性',
    );
    const anchor = '评分标准中关于类似业绩的设定具有排他性';
    const comment = '建议放宽定义。';

    // Manually inject a field code run before the visible text in the XML
    const zip = await JSZip.loadAsync(buffer);
    let docXml = await zip.file('word/document.xml')!.async('string');
    // Insert a field code run that contains the same text (should be skipped)
    const fieldRun =
      '<w:r><w:instrText xml:space="preserve">评分标准中关于类似业绩的设定具有排他性</w:instrText></w:r>';
    docXml = docXml.replace(/(<w:p\b)/, `$1${fieldRun}`);
    zip.file('word/document.xml', docXml);
    const modifiedBuffer = await zip.generateAsync({
      type: 'nodebuffer',
    });

    const modified = await addDocxCommentBuffer(
      modifiedBuffer,
      comment,
      anchor,
    );

    expect(await hasCommentAnchored(modified)).toBe(true);
    // Verify the comment is NOT in the field code run
    const modZip = await JSZip.loadAsync(modified);
    const modXml = await modZip.file('word/document.xml')!.async('string');
    // The field code run should not contain comment markers
    const fieldCodeSection = modXml.slice(0, modXml.indexOf('</w:instrText>'));
    expect(fieldCodeSection).not.toContain('commentRangeStart');
  });

  it('global fuzzy: skips deleted text runs', async () => {
    const buffer = await createDocxBuffer(
      '评分标准中关于类似业绩的设定具有排他性',
    );
    const anchor = '评分标准中关于类似业绩的设定具有排他性';
    const comment = '建议放宽定义。';

    // Inject a <w:del> run before the visible text
    const zip = await JSZip.loadAsync(buffer);
    let docXml = await zip.file('word/document.xml')!.async('string');
    const delRun =
      '<w:del w:id="1" w:author="test" w:date="2024-01-01T00:00:00Z"><w:r><w:delText xml:space="preserve">评分标准中关于类似业绩的设定具有排他性</w:delText></w:r></w:del>';
    docXml = docXml.replace(/(<w:p\b)/, `$1${delRun}`);
    zip.file('word/document.xml', docXml);
    const modifiedBuffer = await zip.generateAsync({
      type: 'nodebuffer',
    });

    const modified = await addDocxCommentBuffer(
      modifiedBuffer,
      comment,
      anchor,
    );

    expect(await hasCommentAnchored(modified)).toBe(true);
    const modZip = await JSZip.loadAsync(modified);
    const modXml = await modZip.file('word/document.xml')!.async('string');
    // The <w:del> block should NOT contain any comment markers
    const delBlock = modXml.match(/<w:del\b[^>]*>[\s\S]*?<\/w:del>/)?.[0] ?? '';
    expect(delBlock).not.toContain('commentRangeStart');
    expect(delBlock).not.toContain('commentRangeEnd');
  });

  it('global fuzzy: anchors when text spans across XML table cells', async () => {
    // Simulate a table: the anchor text spans two paragraphs (as mammoth would extract)
    const doc = new Document({
      sections: [
        {
          children: [
            new Paragraph({ children: [new TextRun('第一章 招标公告')] }),
            new Table({
              rows: [
                new TableRow({
                  children: [
                    new TableCell({
                      children: [
                        new Paragraph({
                          children: [new TextRun('项目名称：')],
                        }),
                      ],
                    }),
                    new TableCell({
                      children: [
                        new Paragraph({
                          children: [new TextRun('深埋长隧洞勘察')],
                        }),
                      ],
                    }),
                  ],
                }),
                new TableRow({
                  children: [
                    new TableCell({
                      children: [
                        new Paragraph({
                          children: [new TextRun('业绩要求：')],
                        }),
                      ],
                    }),
                    new TableCell({
                      children: [
                        new Paragraph({
                          children: [
                            new TextRun('埋深1000米以上音频大地电磁法勘探'),
                          ],
                        }),
                      ],
                    }),
                  ],
                }),
              ],
            }),
            new Paragraph({ children: [new TextRun('第三条 评分标准')] }),
          ],
        },
      ],
    });
    const buffer = await Packer.toBuffer(doc);
    // Anchor text is what mammoth would extract from the table
    const anchor = '埋深1000米以上音频大地电磁法勘探';
    const comment = '业绩要求具有排他性。';

    const modified = await addDocxCommentBuffer(buffer, comment, anchor);

    expect(await hasCommentAnchored(modified)).toBe(true);
    expect(await hasFallbackMarker(modified)).toBe(false);
  });

  it('global fuzzy: anchors when text is in a textbox-like nested structure', async () => {
    // Simulate text deep inside nested XML elements
    const doc = new Document({
      sections: [
        {
          children: [
            new Paragraph({ children: [new TextRun('招标文件')] }),
            new Paragraph({
              children: [new TextRun('投标人须知前附表')],
              numbering: { reference: 'default-numbering', level: 0 },
            }),
            new Paragraph({
              children: [
                new TextRun(
                  '评分标准中关于类似业绩的设定具有排他性，建议修改为通用的类似工程业绩。',
                ),
              ],
            }),
            new Paragraph({ children: [new TextRun('第四条 投标文件')] }),
          ],
        },
      ],
    });
    const buffer = await Packer.toBuffer(doc);
    const anchor = '评分标准中关于类似业绩的设定具有排他性';
    const comment = '建议放宽业绩定义。';

    const modified = await addDocxCommentBuffer(buffer, comment, anchor);

    expect(await hasCommentAnchored(modified)).toBe(true);
    expect(await hasFallbackMarker(modified)).toBe(false);
  });

  it('global fuzzy: anchors long text that likely crosses paragraph boundaries', async () => {
    const doc = new Document({
      sections: [
        {
          children: [
            new Paragraph({ children: [new TextRun('第一条 总则')] }),
            new Paragraph({
              children: [
                new TextRun('本招标文件根据《中华人民共和国招标投标法》'),
              ],
            }),
            new Paragraph({
              children: [
                new TextRun('及其实施条例编制，旨在规范招标投标活动。'),
              ],
            }),
            new Paragraph({ children: [new TextRun('第二条 项目概况')] }),
          ],
        },
      ],
    });
    const buffer = await Packer.toBuffer(doc);
    // This text spans two paragraphs as mammoth would extract
    const anchor = '及其实施条例编制，旨在规范招标投标活动';
    const comment = '需补充具体法规引用。';

    const modified = await addDocxCommentBuffer(buffer, comment, anchor);

    expect(await hasCommentAnchored(modified)).toBe(true);
    // Should find in second paragraph (global search matches within one paragraph)
    expect(await hasFallbackMarker(modified)).toBe(false);
  });

  // ── Statistics: run multiple scenarios and count anchor success rate ──

  describe('anchor success rate simulation', () => {
    /** Simulate mammoth extraction: normalize whitespace */
    function mammothNormalize(text: string): string {
      return text.replace(/\s+/g, ' ').trim();
    }

    const scenarios = [
      {
        name: 'exact match',
        docText: '评分标准中关于类似业绩的设定具有排他性',
        getAnchor: (t: string) => t,
      },
      {
        name: 'mammoth normalized (extra spaces removed)',
        docText: '评分标准中关于  类似业绩的设定  具有排他性',
        getAnchor: mammothNormalize,
      },
      {
        name: 'mammoth normalized (tabs replaced)',
        docText: '评分标准中关于\t类似业绩的设定\t具有排他性',
        getAnchor: mammothNormalize,
      },
      {
        name: 'mammoth normalized (newlines collapsed)',
        docText: '评分标准中关于\n类似业绩的设定\n具有排他性',
        getAnchor: mammothNormalize,
      },
      {
        name: 'multi-run with spaces (common in DOCX)',
        docText: '要求投标人具备 埋深1000米以上 深埋长隧洞 勘察业绩',
        getAnchor: (t: string) => t.replace(/\s+/g, ''),
      },
      {
        name: 'partial text (first 50 chars from LLM excerpt)',
        docText:
          '评分标准中关于类似业绩的设定具有明显的排他性和指向性，涉嫌以不合理的条件限制或者排斥潜在投标人',
        getAnchor: (t: string) => t.slice(0, 50),
      },
      {
        name: 'evidence with clause prefix stripped',
        docText: '第三十五条 评分标准中关于类似业绩的设定具有排他性',
        getAnchor: (t: string) => '第三十五条：' + t.slice(4),
      },
      {
        name: 'completely different text (should fallback)',
        docText: '这是文档正文',
        getAnchor: () => '完全不存在的文本内容用于测试回退',
      },
      {
        name: 'very short anchor (< 6 chars, should skip)',
        docText: '正文内容',
        getAnchor: () => '短文本',
      },
      {
        name: 'anchor with mixed whitespace differences',
        docText: '投标保证金为合同金额的5%且不超过80万元',
        getAnchor: (t: string) =>
          '投标保证金为  合同金额的  5%且不  超过80万元',
      },
    ];

    it('reports anchor success rate across scenarios', async () => {
      let exactAnchored = 0;
      let fuzzyAnchored = 0;
      let fallback = 0;
      const details: string[] = [];

      for (const scenario of scenarios) {
        const buffer = await createDocxBuffer(scenario.docText);
        const anchor = scenario.getAnchor(scenario.docText);
        const comment = `审查意见：${scenario.name}`;

        const modified = await addDocxCommentBuffer(buffer, comment, anchor);
        const anchored = await hasCommentAnchored(modified);
        const hasMarker = await hasFallbackMarker(modified);

        if (anchored && !hasMarker) {
          // Check if it was exact or fuzzy by trying exact match separately
          const exactMatch = scenario.docText.includes(anchor);
          if (exactMatch) {
            exactAnchored++;
            details.push(`  ✓ ${scenario.name} → 精确锚定`);
          } else {
            fuzzyAnchored++;
            details.push(`  ✓ ${scenario.name} → 模糊锚定`);
          }
        } else if (anchored && hasMarker) {
          fallback++;
          details.push(`  ↳ ${scenario.name} → 文末回退`);
        } else {
          fallback++;
          details.push(`  ✗ ${scenario.name} → 批注丢失`);
        }
      }

      const total = scenarios.length;
      const anchored = exactAnchored + fuzzyAnchored;
      const successRate = ((anchored / total) * 100).toFixed(1);

      console.log('\n── 批注锚定成功率测试 ──');
      console.log(`总场景数: ${total}`);
      console.log(`精确锚定: ${exactAnchored}`);
      console.log(`模糊锚定: ${fuzzyAnchored}`);
      console.log(`文末回退: ${fallback}`);
      console.log(`锚定成功率: ${successRate}%`);
      console.log('\n详细结果:');
      details.forEach((d) => console.log(d));

      // Fallback is expected for: "completely different text", "very short anchor",
      // and "evidence with clause prefix stripped" (colon not in document)
      expect(anchored).toBeGreaterThanOrEqual(total - 3);
    });
  });
});
