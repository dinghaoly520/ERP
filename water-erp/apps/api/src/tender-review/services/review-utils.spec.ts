import { pickManualCommentAnchor } from './review-utils';

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
