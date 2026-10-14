/* assertAllowedOrigin 回归锁（2026-10-14）：
   I5 首版把 /^http:\/\/192\.168\./.source 塞进「字符串转义+全串锚定」管线，双重转义后
   LAN origin（http://192.168.1.111:3004）必拒——实测复现于 :3004 LAN 演示场景。
   本 spec 锁定：dev 默认放行局域网段、env 配置后精确匹配覆盖默认。 */
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { assertAllowedOrigin } from './ca-auth.controller';
import { loadCaConfig } from './ca.module';

const ENV_KEY = 'CA_ALLOWED_ORIGINS';

/** Nest 异常传对象时 message 为空串——toThrow(子串) 匹配不到，须按类 + getResponse 断言 */
function catchOriginError(fn: () => void): unknown {
  try { fn(); } catch (e) { return e; }
  throw new Error('expected assertAllowedOrigin to throw');
}

describe('assertAllowedOrigin（CA 认证 Origin 闸）', () => {
  const saved = process.env[ENV_KEY];

  afterEach(() => {
    if (saved === undefined) delete process.env[ENV_KEY];
    else process.env[ENV_KEY] = saved;
  });

  const reqWith = (origin?: string) =>
    ({ headers: origin ? { origin } : {} }) as never;

  describe('默认白名单（CA_ALLOWED_ORIGINS 未配置）', () => {
    beforeEach(() => delete process.env[ENV_KEY]);

    it('放行局域网 origin——192.168.x.x 任意端口（首版双重转义 bug 的回归项）', () => {
      expect(() => assertAllowedOrigin(reqWith('http://192.168.1.111:3004'))).not.toThrow();
      expect(() => assertAllowedOrigin(reqWith('http://192.168.0.10:3006'))).not.toThrow();
      expect(() => assertAllowedOrigin(reqWith('http://192.168.1.111'))).not.toThrow();
    });

    it('放行 localhost / 127.0.0.1（:3004）', () => {
      expect(() => assertAllowedOrigin(reqWith('http://localhost:3004'))).not.toThrow();
      expect(() => assertAllowedOrigin(reqWith('http://127.0.0.1:3004'))).not.toThrow();
    });

    it('拒绝外部 origin', () => {
      for (const origin of ['https://evil.example.com', 'http://10.0.0.5:3004']) {
        const err = catchOriginError(() => assertAllowedOrigin(reqWith(origin))) as ForbiddenException;
        expect(err).toBeInstanceOf(ForbiddenException);
        expect(err.getResponse()).toMatchObject({ code: 'ORIGIN_DENIED' });
      }
    });

    it('缺失 Origin 头拒绝', () => {
      const err = catchOriginError(() => assertAllowedOrigin(reqWith())) as UnauthorizedException;
      expect(err).toBeInstanceOf(UnauthorizedException);
      expect(err.getResponse()).toMatchObject({ code: 'ORIGIN_REQUIRED' });
    });
  });

  describe('CA_ALLOWED_ORIGINS 已配置', () => {
    it('按精确匹配放行，且覆盖默认段（未列出的 192.168.x 不再隐式放行）', () => {
      process.env[ENV_KEY] = 'http://192.168.1.111:3004, http://localhost:3004';
      expect(() => assertAllowedOrigin(reqWith('http://192.168.1.111:3004'))).not.toThrow();
      expect(() => assertAllowedOrigin(reqWith('http://localhost:3004'))).not.toThrow();
      for (const origin of ['http://192.168.1.5:3004', 'http://127.0.0.1:3004']) {
        const err = catchOriginError(() => assertAllowedOrigin(reqWith(origin))) as ForbiddenException;
        expect(err).toBeInstanceOf(ForbiddenException);
        expect(err.getResponse()).toMatchObject({ code: 'ORIGIN_DENIED' });
      }
    });

    it('生产环境按列表精确放行（NODE_ENV=production 语义不变）', () => {
      const savedEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      process.env[ENV_KEY] = 'https://supplier.example.com';
      try {
        expect(() => assertAllowedOrigin(reqWith('https://supplier.example.com'))).not.toThrow();
        const err = catchOriginError(() => assertAllowedOrigin(reqWith('http://192.168.1.111:3004'))) as ForbiddenException;
        expect(err.getResponse()).toMatchObject({ code: 'ORIGIN_DENIED' });
      } finally {
        if (savedEnv === undefined) delete process.env.NODE_ENV;
        else process.env.NODE_ENV = savedEnv;
      }
    });
  });

  describe('生产 fail-closed（NODE_ENV=production 且未配置白名单）', () => {
    it('运行时全拒——含 localhost/192.168 段（纵深防御，常态下先被启动守卫拦住）', () => {
      const savedEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      delete process.env[ENV_KEY];
      try {
        for (const origin of ['http://localhost:3004', 'http://192.168.1.111:3004', 'https://supplier.example.com']) {
          const err = catchOriginError(() => assertAllowedOrigin(reqWith(origin))) as ForbiddenException;
          expect(err).toBeInstanceOf(ForbiddenException);
          expect(err.getResponse()).toMatchObject({ code: 'ORIGIN_NOT_CONFIGURED' });
        }
      } finally {
        if (savedEnv === undefined) delete process.env.NODE_ENV;
        else process.env.NODE_ENV = savedEnv;
      }
    });

    it('启动守卫：CA 登录开启 + 未配白名单 → loadCaConfig 拒绝启动', () => {
      const saved = { nodeEnv: process.env.NODE_ENV, login: process.env.CA_LOGIN_ENABLED };
      process.env.NODE_ENV = 'production';
      process.env.CA_LOGIN_ENABLED = 'true';
      delete process.env[ENV_KEY];
      try {
        expect(() => loadCaConfig()).toThrow('CA_ALLOWED_ORIGINS');
      } finally {
        if (saved.nodeEnv === undefined) delete process.env.NODE_ENV;
        else process.env.NODE_ENV = saved.nodeEnv;
        if (saved.login === undefined) delete process.env.CA_LOGIN_ENABLED;
        else process.env.CA_LOGIN_ENABLED = saved.login;
      }
    });

    it('启动守卫：dev 环境（NODE_ENV=development）不触发——dev 默认段照常可用', () => {
      const saved = { nodeEnv: process.env.NODE_ENV, login: process.env.CA_LOGIN_ENABLED };
      process.env.NODE_ENV = 'development';
      process.env.CA_LOGIN_ENABLED = 'true';
      delete process.env[ENV_KEY];
      try {
        expect(() => loadCaConfig()).not.toThrow();
      } finally {
        if (saved.nodeEnv === undefined) delete process.env.NODE_ENV;
        else process.env.NODE_ENV = saved.nodeEnv;
        if (saved.login === undefined) delete process.env.CA_LOGIN_ENABLED;
        else process.env.CA_LOGIN_ENABLED = saved.login;
      }
    });
  });
});
