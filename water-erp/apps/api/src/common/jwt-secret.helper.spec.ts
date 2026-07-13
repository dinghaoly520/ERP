import { getJwtSecret } from './jwt-secret.helper';

describe('getJwtSecret', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    // 逐个还原，避免 spread 覆盖掉 jest 自身注入的变量
    process.env.NODE_ENV = originalEnv.NODE_ENV;
    if (originalEnv.JWT_SECRET !== undefined) {
      process.env.JWT_SECRET = originalEnv.JWT_SECRET;
    } else {
      delete process.env.JWT_SECRET;
    }
  });

  describe('生产环境 (NODE_ENV=production)', () => {
    beforeEach(() => {
      process.env.NODE_ENV = 'production';
    });

    it('JWT_SECRET 缺失时拒绝启动', () => {
      delete process.env.JWT_SECRET;
      expect(() => getJwtSecret()).toThrow(/JWT_SECRET/);
    });

    it('JWT_SECRET 短于 32 字符时拒绝启动', () => {
      process.env.JWT_SECRET = 'short-secret-under-32-chars';
      expect(() => getJwtSecret()).toThrow(/32/);
    });

    it('JWT_SECRET 合法 (≥32 字符) 时返回原值', () => {
      const secret = 'a'.repeat(32);
      process.env.JWT_SECRET = secret;
      expect(getJwtSecret()).toBe(secret);
    });
  });

  describe('开发/测试环境', () => {
    beforeEach(() => {
      process.env.NODE_ENV = 'test';
    });

    it('JWT_SECRET 缺失时回退到固定弱值且不抛错', () => {
      delete process.env.JWT_SECRET;
      expect(() => getJwtSecret()).not.toThrow();
      expect(getJwtSecret()).toBe('water-erp-jwt-secret');
    });

    it('JWT_SECRET 已设置时返回该值', () => {
      process.env.JWT_SECRET = 'my-configured-dev-secret';
      expect(getJwtSecret()).toBe('my-configured-dev-secret');
    });

    it('JWT_SECRET 偏短时仅告警不抛错', () => {
      process.env.JWT_SECRET = 'short';
      expect(() => getJwtSecret()).not.toThrow();
      expect(getJwtSecret()).toBe('short');
    });
  });
});
