import { DEFAULT_EXCLUDE_PATHS, parseExcludePaths, shouldExclude } from './operation-log.filter';

describe('shouldExclude', () => {
  it('非 /api 前缀（静态资源）排除', () => {
    expect(shouldExclude('GET', '/_next/static/app.js', DEFAULT_EXCLUDE_PATHS)).toBe(true);
  });

  it('Swagger /api/docs 排除', () => {
    expect(shouldExclude('GET', '/api/docs', DEFAULT_EXCLUDE_PATHS)).toBe(true);
    expect(shouldExclude('GET', '/api/docs-json', DEFAULT_EXCLUDE_PATHS)).toBe(true);
  });

  it('socket.io 排除（正则）', () => {
    expect(shouldExclude('GET', '/socket.io/?EIO=4', DEFAULT_EXCLUDE_PATHS)).toBe(true);
  });

  it('健康检查排除', () => {
    expect(shouldExclude('GET', '/api/health', DEFAULT_EXCLUDE_PATHS)).toBe(true);
  });

  it('正常业务接口放行', () => {
    expect(shouldExclude('GET', '/api/bid/projects', DEFAULT_EXCLUDE_PATHS)).toBe(false);
    expect(shouldExclude('GET', '/api/auth/me', DEFAULT_EXCLUDE_PATHS)).toBe(false);
  });

  it('高频轮询 GET 排除（通知角标/驾驶舱统计/审查任务轮询）', () => {
    expect(shouldExclude('GET', '/api/notifications/unread-count', DEFAULT_EXCLUDE_PATHS)).toBe(true);
    expect(shouldExclude('GET', '/api/supplier/stats', DEFAULT_EXCLUDE_PATHS)).toBe(true);
    expect(shouldExclude('GET', '/api/catalog/admin/stats', DEFAULT_EXCLUDE_PATHS)).toBe(true);
    expect(shouldExclude('GET', '/api/alerts/overview', DEFAULT_EXCLUDE_PATHS)).toBe(true);
    expect(shouldExclude('GET', '/api/tender-review/review/tasks/abc123', DEFAULT_EXCLUDE_PATHS)).toBe(true);
    expect(shouldExclude('GET', '/api/tender-review/rules/extract/tasks/t1', DEFAULT_EXCLUDE_PATHS)).toBe(true);
    expect(shouldExclude('GET', '/api/expert-admin/invitations/p1', DEFAULT_EXCLUDE_PATHS)).toBe(true);
  });

  it('方法限定：写操作仍被记录（GET-only 模式不吞写审计）', () => {
    // review/tasks 前缀下的 DELETE/stop/resolve
    expect(shouldExclude('DELETE', '/api/tender-review/review/tasks/x', DEFAULT_EXCLUDE_PATHS)).toBe(false);
    expect(shouldExclude('POST', '/api/tender-review/review/tasks/x/stop', DEFAULT_EXCLUDE_PATHS)).toBe(false);
    expect(shouldExclude('PATCH', '/api/tender-review/review/tasks/x/issues/resolve', DEFAULT_EXCLUDE_PATHS)).toBe(false);
    // invitations 前缀下的 confirm/decline
    expect(shouldExclude('POST', '/api/expert-admin/invitations/p1/u1/confirm', DEFAULT_EXCLUDE_PATHS)).toBe(false);
    expect(shouldExclude('POST', '/api/expert-admin/invitations/p1/u1/decline', DEFAULT_EXCLUDE_PATHS)).toBe(false);
    // 同路径 GET 仍排除
    expect(shouldExclude('GET', '/api/expert-admin/invitations/p1/u1/confirm', DEFAULT_EXCLUDE_PATHS)).toBe(true);
  });

  it('字符串前缀模式仍匹配任意方法（向后兼容）', () => {
    expect(shouldExclude('POST', '/api/notifications/unread-count', DEFAULT_EXCLUDE_PATHS)).toBe(true);
    expect(shouldExclude('GET', '/api/docs', DEFAULT_EXCLUDE_PATHS)).toBe(true);
    expect(shouldExclude('POST', '/api/docs', DEFAULT_EXCLUDE_PATHS)).toBe(true);
  });

  it('对象模式：method 大小写不敏感', () => {
    expect(shouldExclude('get', '/api/tender-review/review/tasks/x', DEFAULT_EXCLUDE_PATHS)).toBe(true);
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
