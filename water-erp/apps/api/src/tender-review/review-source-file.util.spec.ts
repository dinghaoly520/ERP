import {
  assertReviewObjectKey,
  buildReviewSourceKey,
  isReviewObjectKey,
  resolveReviewSourceType,
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

describe('resolveReviewSourceType / buildReviewSourceKey（审计第 3 处）', () => {
  const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

  it.each([
    ['application/pdf', '任意名字', 'application/pdf', 'pdf'],
    [DOCX, '任意名字', DOCX, 'docx'],
    ['application/msword', 'x.bin', 'application/msword', 'doc'],
    ['text/plain', 'x', 'text/plain', 'txt'],
    // 浏览器偶发把 Word 上报成通用类型或空串：按后缀推断
    ['application/octet-stream', '采购文件.DOCX', DOCX, 'docx'],
    ['', '旧件.doc', 'application/msword', 'doc'],
  ])('%s + %s → %s / .%s', (mime, name, wantMime, wantExt) => {
    expect(resolveReviewSourceType(mime, name)).toEqual({ mime: wantMime, ext: wantExt });
  });

  it.each([
    ['application/zip', 'a.zip'],
    ['application/octet-stream', 'a.exe'],
    ['image/png', 'a.png'],
    ['application/octet-stream', '没有后缀'],
  ])('%s + %s → null（四种之外）', (mime, name) => {
    expect(resolveReviewSourceType(mime, name)).toBeNull();
  });

  it('对象键：命名空间、日期、32 位随机、扩展名；连续两次不相等', () => {
    const key = buildReviewSourceKey('docx');
    expect(key).toMatch(/^review\/\d{4}-\d{2}-\d{2}\/[a-f0-9]{32}\.docx$/);
    // 随机部分每次不同：FileAsset.key 的唯一约束不会被撞到
    expect(buildReviewSourceKey('pdf')).not.toBe(key);
  });
});
