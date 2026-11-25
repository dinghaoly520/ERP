import {
  assertReviewObjectKey,
  isReviewObjectKey,
  REVIEW_SOURCE_CATEGORY,
} from './review-source-file.util';

describe('isReviewObjectKey / assertReviewObjectKey（审计第 3 处）', () => {
  it('审查命名空间下的相对键通过——含新格式与存量格式', () => {
    expect(isReviewObjectKey('review/2026-11-25/0123456789abcdef0123456789abcdef.docx')).toBe(true);
    // 存量任务的键带用户原始文件名：中文、空格、括号、# 都有
    expect(isReviewObjectKey('review/1732452000000_采购文件（终版） #2.docx')).toBe(true);
    expect(isReviewObjectKey('review/e2e-test')).toBe(true);
    expect(isReviewObjectKey('review/e2e-test.original')).toBe(true);
  });

  it.each([
    ['../.env', '路径穿越'],
    ['/etc/passwd', '绝对路径'],
    ['knowledge/abc/规则.docx', '别的模块的命名空间'],
    ['sealed-backup/k', '密封备份'],
    ['review/../x', '命名空间内的 .. 段'],
    ['review/./x', '. 段'],
    ['review//x', '空段'],
    ['review/x/', '以斜杠结尾'],
    ['review/a\\b', '反斜杠'],
    ['review/a\nb', '控制字符'],
    ['review', '没有命名空间后的部分'],
    ['', '空串'],
    [null, 'null'],
    [123, '非字符串'],
  ])('%s 不通过（%s）', (bad, _reason) => {
    expect(isReviewObjectKey(bad)).toBe(false);
  });

  it('assertReviewObjectKey：合法键原样返回，非法键抛 400 INVALID_REVIEW_OBJECT_KEY', () => {
    expect(assertReviewObjectKey('review/e2e-test')).toBe('review/e2e-test');
    let thrown: unknown;
    try {
      assertReviewObjectKey('../.env');
    } catch (err) {
      thrown = err;
    }
    // jest 的 toThrow 只比对消息或类名，比对响应体要接住异常再看
    expect(thrown).toMatchObject({ status: 400, response: { code: 'INVALID_REVIEW_OBJECT_KEY' } });
  });

  it('类目名是固定常量', () => {
    expect(REVIEW_SOURCE_CATEGORY).toBe('tender_review_source');
  });
});
