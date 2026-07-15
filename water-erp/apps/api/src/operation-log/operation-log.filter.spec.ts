import { DEFAULT_EXCLUDE_PATHS, parseExcludePaths, shouldExclude } from './operation-log.filter';

describe('shouldExclude', () => {
  it('非 /api 前缀（静态资源）排除', () => {
    expect(shouldExclude('/_next/static/app.js', DEFAULT_EXCLUDE_PATHS)).toBe(true);
  });

  it('Swagger /api/docs 排除', () => {
    expect(shouldExclude('/api/docs', DEFAULT_EXCLUDE_PATHS)).toBe(true);
    expect(shouldExclude('/api/docs-json', DEFAULT_EXCLUDE_PATHS)).toBe(true);
  });

  it('socket.io 排除（正则）', () => {
    expect(shouldExclude('/socket.io/?EIO=4', DEFAULT_EXCLUDE_PATHS)).toBe(true);
  });

  it('健康检查排除', () => {
    expect(shouldExclude('/api/health', DEFAULT_EXCLUDE_PATHS)).toBe(true);
  });

  it('正常业务接口放行', () => {
    expect(shouldExclude('/api/bid/projects', DEFAULT_EXCLUDE_PATHS)).toBe(false);
    expect(shouldExclude('/api/auth/me', DEFAULT_EXCLUDE_PATHS)).toBe(false);
  });
});

describe('parseExcludePaths', () => {
  it('解析逗号分隔字符串前缀', () => {
    const r = parseExcludePaths('/api/bid/open/poll,/api/score/progress');
    expect(r).toEqual(['/api/bid/open/poll', '/api/score/progress']);
  });

  it('识别 /.../ 形式为正则', () => {
    const r = parseExcludePaths('/^\\/api\\/poll\\//');
    expect(r[0]).toBeInstanceOf(RegExp);
    expect((r[0] as RegExp).test('/api/poll/x')).toBe(true);
  });

  it('空/未定义 → []', () => {
    expect(parseExcludePaths(undefined)).toEqual([]);
    expect(parseExcludePaths('')).toEqual([]);
  });
});
