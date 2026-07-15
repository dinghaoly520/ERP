import { sanitizeBody, sanitizeQueryString, truncateString } from './sanitize.util';

describe('sanitizeBody', () => {
  it('凭证类字段 → ***（password/token/secret/key 等）', () => {
    expect(sanitizeBody({ password: 'abc', token: 'xyz', apiKey: 'k', kmsSecret: 'm' })).toEqual({
      password: '***', token: '***', apiKey: '***', kmsSecret: '***',
    });
  });

  it('手机号 → 前3后4 掩码', () => {
    expect(sanitizeBody({ phone: '13812341234', mobile: '15800001111' })).toEqual({
      phone: '138****1234', mobile: '158****1111',
    });
  });

  it('身份证 → 前6后4 掩码', () => {
    expect(sanitizeBody({ idCard: '510102199001011234' })).toEqual({
      idCard: '510102********1234',
    });
  });

  it('银行卡 → 前4后4 掩码', () => {
    expect(sanitizeBody({ bankCard: '6222020200012345678' })).toEqual({
      bankCard: '6222****5678',
    });
  });

  it('长度不足掩码时回退 ***', () => {
    expect(sanitizeBody({ phone: '123' })).toEqual({ phone: '***' });
  });

  it('递归脱敏嵌套对象与数组', () => {
    const out = sanitizeBody({ user: { password: 'p', contact: { mobile: '13812341234' } }, list: [{ token: 't' }] });
    expect(out).toEqual({
      user: { password: '***', contact: { mobile: '138****1234' } },
      list: [{ token: '***' }],
    });
  });

  it('非敏感字段原样保留', () => {
    expect(sanitizeBody({ name: '张三', score: 90 })).toEqual({ name: '张三', score: 90 });
  });

  it('超 maxBytes → { _truncated, preview }', () => {
    const big = { data: 'x'.repeat(5000) };
    const out = sanitizeBody(big, 1024) as any;
    expect(out._truncated).toBe(true);
    expect(typeof out.preview).toBe('string');
    expect(out.preview.length).toBeLessThanOrEqual(1024);
  });

  it('null/undefined → null', () => {
    expect(sanitizeBody(null)).toBeNull();
    expect(sanitizeBody(undefined)).toBeNull();
  });

  it('循环引用 → null', () => {
    const o: any = { a: 1 }; o.self = o;
    expect(sanitizeBody(o)).toBeNull();
  });

  it('BigInt 不可序列化 → null', () => {
    expect(sanitizeBody({ x: 1n })).toBeNull();
  });
});

describe('truncateString', () => {
  it('未超长原样返回', () => {
    expect(truncateString('abc', 10)).toBe('abc');
  });
  it('超长截断并加标记', () => {
    expect(truncateString('abcdefghij', 5)).toBe('abcde…[截断]');
  });
});

describe('sanitizeQueryString', () => {
  it('token 被脱敏，keyword 保留', () => {
    expect(sanitizeQueryString('token=secret&keyword=foo')).toBe('token=***&keyword=foo');
  });

  it('多个凭证类 key 全部脱敏（password/apiKey/refresh_token）', () => {
    expect(sanitizeQueryString('password=p&apiKey=k&refresh_token=r')).toBe('password=***&apiKey=***&refresh_token=***');
  });

  it('无凭证 key 时原样返回', () => {
    expect(sanitizeQueryString('page=1&size=20')).toBe('page=1&size=20');
  });

  it('URL 编码的 key 也能识别（%74oken → token）', () => {
    expect(sanitizeQueryString('%74oken=x')).toBe('%74oken=***');
  });

  it('截断仍然生效', () => {
    const q = 'keyword=' + 'x'.repeat(3000);
    const out = sanitizeQueryString(q, 100);
    expect(out.length).toBeLessThanOrEqual(120); // 含截断标记
    expect(out).toContain('…[截断]');
  });
});
