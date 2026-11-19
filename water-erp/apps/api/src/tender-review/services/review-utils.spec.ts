import { decodeFileName, pickManualCommentAnchor } from './review-utils';

/** §五.4-2（2026-11-18）：decodeFileName 已委身 multipart 铁律 util（条件式安全版）——
 *  钉住与旧无条件版的分叉点：正确 UTF-8 名透传（旧版毁成 '???'+扩展名）。 */
describe('decodeFileName（multipart 文件名归一化）', () => {
  it('mojibake 名（latin1 误读形态）→ 还原 UTF-8', () => {
    const mojibake = Buffer.from('技术要求.docx', 'utf8').toString('latin1');
    expect(decodeFileName(mojibake)).toBe('技术要求.docx');
  });

  it('正确 UTF-8 名（filename* 扩展参数来源）→ 原样透传（旧无条件版毁成 ???）', () => {
    expect(decodeFileName('技术要求.docx')).toBe('技术要求.docx');
  });

  it('纯 ASCII 名 → 原样透传', () => {
    expect(decodeFileName('tender-v2.pdf')).toBe('tender-v2.pdf');
  });
});

describe('pickManualCommentAnchor', () => {
  it('prefers documentLocation.excerpt when available (most reliable source)', () => {
    expect(
      pickManualCommentAnchor({
        documentLocation: { excerpt: '  评分标准中关于类似业绩的设定  ' },
        documentExcerpt: 'LLM生成的摘要文本可能不够精确',
        evidence: '第三十五条：类似业绩定义应当体现公平竞争',
      }),
    ).toBe('评分标准中关于类似业绩的设定');
  });

  it('falls back to documentExcerpt when documentLocation is missing', () => {
    expect(
      pickManualCommentAnchor({
        documentExcerpt: '  类似业绩定义应当体现公平竞争  ',
        evidence: '第三十五条：类似业绩定义应当体现公平竞争',
      }),
    ).toBe('类似业绩定义应当体现公平竞争');
  });

  it('falls back to evidence text after the clause prefix', () => {
    expect(
      pickManualCommentAnchor({
        evidence: '第三十五条：音频大地电磁法',
      }),
    ).toBe('音频大地电磁法');
  });

  it('returns undefined when neither source yields a usable anchor', () => {
    expect(
      pickManualCommentAnchor({
        documentExcerpt: '  ',
        evidence: '条款：短',
      }),
    ).toBeUndefined();
  });

  it('returns undefined when all sources are empty', () => {
    expect(pickManualCommentAnchor({})).toBeUndefined();
  });

  it('skips documentLocation.excerpt when too short', () => {
    expect(
      pickManualCommentAnchor({
        documentLocation: { excerpt: '短' },
        documentExcerpt: '这是足够长的文档摘要文本',
      }),
    ).toBe('这是足够长的文档摘要文本');
  });
});
