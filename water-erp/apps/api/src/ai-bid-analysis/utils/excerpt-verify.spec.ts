// apps/api/src/ai-bid-analysis/utils/excerpt-verify.spec.ts
import { verifyExcerpt } from './excerpt-verify';

const P = (file: string, page: number, text: string) => ({ file, page, text });

describe('verifyExcerpt', () => {
  it('excerpt 逐字出现在目标页 → verified true / score≈1', () => {
    const r = verifyExcerpt(
      '项目经理需具备一级建造师',
      'technical', 3,
      [P('technical', 3, '资格要求：项目经理需具备一级建造师，且近五年主持过同类工程。')],
    );
    expect(r.verified).toBe(true);
    expect(r.score).toBe(1);
    expect(r.correctedPage).toBeUndefined();
  });

  it('excerpt 轻度改写（漏字）仍高于阈值 → verified true', () => {
    const r = verifyExcerpt(
      '工期不超过365天',
      'technical', 1,
      [P('technical', 1, '本工程要求工期不超过365个日历天，自合同签订之日起算。')],
    );
    expect(r.verified).toBe(true);
    expect(r.score).toBeGreaterThanOrEqual(0.55);
  });

  it('excerpt 不在目标页但在别页 → verified true + correctedPage', () => {
    const r = verifyExcerpt(
      '项目经理需具备一级建造师',
      'technical', 3,
      [
        P('technical', 3, '施工组织设计应包含进度计划与人员配备。'),
        P('technical', 5, '资格要求：项目经理需具备一级建造师。'),
      ],
    );
    expect(r.verified).toBe(true);
    expect(r.correctedPage).toBe(5);
  });

  it('excerpt 与所有页都无关 → verified false', () => {
    const r = verifyExcerpt(
      '资质等级为特种工程一级',
      'technical', 1,
      [P('technical', 1, '本方案采用钻孔灌注桩基础，桩径 1.2 米。')],
    );
    expect(r.verified).toBe(false);
  });

  it('空 excerpt → verified false / score 0（无从校验）', () => {
    expect(verifyExcerpt('', 'technical', 1, [P('technical', 1, '任意文本')])).toEqual(
      expect.objectContaining({ verified: false, score: 0 }),
    );
    expect(verifyExcerpt('   ', 'technical', 1, [P('technical', 1, '任意文本')])).toEqual(
      expect.objectContaining({ verified: false, score: 0 }),
    );
  });

  it('targetPage 为 null 但别页命中 → verified true + correctedPage', () => {
    const r = verifyExcerpt(
      '项目经理需具备一级建造师',
      null, null,
      [P('technical', 7, '资格要求：项目经理需具备一级建造师。')],
    );
    expect(r.verified).toBe(true);
    expect(r.correctedPage).toBe(7);
  });

  it('标点/全角/空白差异不影响判定（归一化）', () => {
    const r = verifyExcerpt(
      '项目经理，需具备！（一级建造师）',
      'technical', 2,
      [P('technical', 2, '项目经理需具备一级建造师')],
    );
    expect(r.verified).toBe(true);
    expect(r.score).toBe(1);
  });

  it('默认阈值 0.55 不达标时 false，调低阈值后 true', () => {
    // 字母构造精确 coverage：excerpt=ABCDE(bigrams AB/BC/CD/DE)，page=ABCXYZ(AB/BC/CX/XY/YZ)
    // 命中 AB/BC → coverage = 2/4 = 0.5
    const pages = [P('technical', 1, 'ABCXYZ')];
    const excerpt = 'ABCDE';
    expect(verifyExcerpt(excerpt, 'technical', 1, pages).verified).toBe(false); // 0.5 < 0.55
    expect(verifyExcerpt(excerpt, 'technical', 1, pages, { threshold: 0.4 }).verified).toBe(true); // 0.5 >= 0.4
  });

  it('pages 为空 → verified false', () => {
    expect(verifyExcerpt('项目经理需具备一级建造师', 'technical', 1, [])).toEqual(
      expect.objectContaining({ verified: false }),
    );
  });
});
