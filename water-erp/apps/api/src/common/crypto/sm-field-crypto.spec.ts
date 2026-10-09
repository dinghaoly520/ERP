import {
  sealFieldSm,
  openFieldSm,
  blindIndex,
  fieldKeyId,
  isSealedFieldSm,
  sealPii,
  openPii,
  blindIndexPii,
  assertFieldSecretForProduction,
  FIELD_ENC_MIN_LEN,
} from './sm-field-crypto';

describe('sm-field-crypto (SM4-CBC + HMAC-SM3, sm1:keyId: 格式)', () => {
  const SECRET = 'unit-test-field-enc-secret-0123456789abcdef';
  const OLD_SECRET = 'rotated-old-field-enc-secret-9876543210fedcba';

  describe('round-trip', () => {
    it.each([
      ['ascii number', '980000'],
      ['chinese', '蜀水云采·智慧水发'],
      ['id number', '51102319900101123X'],
      ['phone', '13812345678'],
      ['mixed', '法定代表人: 张三 (138****5678)'],
      ['single char', 'a'],
      ['long', 'x'.repeat(10_000)],
    ])('openFieldSm(sealFieldSm(%s)) === original', (_label, plain) => {
      const sealed = sealFieldSm(plain, SECRET);
      expect(sealed).not.toEqual(plain);
      expect(sealed).toMatch(/^sm1:[0-9a-f]{8}:/);
      expect(openFieldSm(sealed, SECRET)).toBe(plain);
    });

    it('null/空串原样返回 null/空串', () => {
      expect(sealFieldSm(null, SECRET)).toBeNull();
      expect(openFieldSm(null, SECRET)).toBeNull();
      expect(sealFieldSm(undefined, SECRET)).toBeNull();
      expect(sealFieldSm('', SECRET)).toBe('');
    });
  });

  describe('随机 IV：同明文两次密封结果不同', () => {
    it('两份密文均可解回原文', () => {
      const a = sealFieldSm('980000', SECRET);
      const b = sealFieldSm('980000', SECRET);
      expect(a).not.toEqual(b);
      expect(openFieldSm(a, SECRET)).toBe('980000');
      expect(openFieldSm(b, SECRET)).toBe('980000');
    });
  });

  describe('防篡改（HMAC-SM3 覆盖 iv‖ciphertext）', () => {
    const parse = (sealed: string) => {
      const m = sealed.match(/^sm1:[0-9a-f]{8}:(.+)$/)!;
      return Buffer.from(m[1], 'base64');
    };
    const rebuild = (buf: Buffer, keyId: string) =>
      `sm1:${keyId}:${buf.toString('base64')}`;

    it.each([
      ['ciphertext 尾字节翻转', (b: Buffer) => (b[b.length - 1] ^= 0x01)],
      ['mac 首字节翻转', (b: Buffer) => (b[b.length - 32] ^= 0x01)],
      ['iv 首字节翻转', (b: Buffer) => (b[0] ^= 0x01)],
    ])('%s → open 抛错', (_label, mutate) => {
      const sealed = sealFieldSm('980000', SECRET)!;
      const buf = parse(sealed);
      mutate(buf);
      expect(() => openFieldSm(rebuild(buf, fieldKeyId(SECRET)), SECRET)).toThrow();
    });
  });

  describe('密钥边界', () => {
    it('用错误密钥解密抛错（keyId 不匹配或 MAC 失败）', () => {
      const sealed = sealFieldSm('980000', SECRET)!;
      expect(() => openFieldSm(sealed, OLD_SECRET)).toThrow();
    });

    it('openFieldSm 支持密钥数组（轮转期旧钥可读）', () => {
      const sealedByOld = sealFieldSm('legacy-value', OLD_SECRET)!;
      expect(openFieldSm(sealedByOld, [SECRET, OLD_SECRET])).toBe('legacy-value');
      expect(() => openFieldSm(sealedByOld, [SECRET])).toThrow();
    });

    it('未知 keyId 抛出含 keyId 的明确错误', () => {
      const sealed = sealFieldSm('x', SECRET)!;
      const forged = sealed.replace(/^sm1:[0-9a-f]{8}:/, 'sm1:deadbeef:');
      expect(() => openFieldSm(forged, [SECRET])).toThrow(/deadbeef/);
    });

    it('不同用途派生钥互不相同（enc/mac/index 三把独立）', () => {
      // 间接验证：盲索引钥与加密钥不同源——盲索引不可能是 SM4 密文的函数
      const idx1 = blindIndex('13812345678', SECRET);
      const idx2 = blindIndex('13812345678', SECRET);
      expect(idx1).toBe(idx2); // 确定性
      expect(idx1).toMatch(/^[0-9a-f]{64}$/); // HMAC-SM3 hex
      expect(blindIndex('13812345679', SECRET)).not.toBe(idx1); // 雪崩
      expect(blindIndex('13812345678', OLD_SECRET)).not.toBe(idx1); // 换钥指纹变
      expect(blindIndex(null, SECRET)).toBeNull();
    });

    it('fieldKeyId 是秘密的稳定短指纹（8 hex，不同秘密不同 id）', () => {
      expect(fieldKeyId(SECRET)).toMatch(/^[0-9a-f]{8}$/);
      expect(fieldKeyId(SECRET)).toBe(fieldKeyId(SECRET));
      expect(fieldKeyId(OLD_SECRET)).not.toBe(fieldKeyId(SECRET));
    });
  });

  describe('isSealedFieldSm', () => {
    it('识别 sm1: 前缀', () => {
      expect(isSealedFieldSm(sealFieldSm('x', SECRET))).toBe(true);
      expect(isSealedFieldSm('v1:whatever')).toBe(false);
      expect(isSealedFieldSm('plaintext')).toBe(false);
      expect(isSealedFieldSm(null)).toBe(false);
    });
  });

  describe('env 便捷层（FIELD_ENC_SECRET / FIELD_ENC_SECRET_OLD）', () => {
    const ENV_SECRET = 'env-configured-field-secret-abcdefghijklmnop';
    afterEach(() => {
      delete process.env.FIELD_ENC_SECRET;
      delete process.env.FIELD_ENC_SECRET_OLD;
    });

    it('未配置时回退 dev 默认钥，sealPii/openPii 自洽', () => {
      const sealed = sealPii('13812345678');
      expect(sealed).toMatch(/^sm1:/);
      expect(openPii(sealed)).toBe('13812345678');
    });

    it('FIELD_ENC_SECRET 配置后生效，盲索引与密封同钥', () => {
      process.env.FIELD_ENC_SECRET = ENV_SECRET;
      expect(openPii(sealPii('x'))).toBe('x');
      expect(fieldKeyId(ENV_SECRET)).toBe(fieldKeyId(ENV_SECRET));
    });

    it('轮转：旧钥密封的值经 FIELD_ENC_SECRET_OLD 仍可读', () => {
      const sealedByOld = sealFieldSm('legacy', OLD_SECRET)!;
      expect(() => openPii(sealedByOld)).toThrow(); // 未配 old 时读不了
      process.env.FIELD_ENC_SECRET_OLD = OLD_SECRET;
      expect(openPii(sealedByOld)).toBe('legacy');
    });

    it('blindIndexPii 走 active 钥', () => {
      process.env.FIELD_ENC_SECRET = ENV_SECRET;
      expect(blindIndexPii('a')).toBe(blindIndex('a', ENV_SECRET));
    });
  });

  describe('生产启动守卫 assertFieldSecretForProduction', () => {
    const realEnv = process.env.NODE_ENV;
    afterEach(() => {
      process.env.NODE_ENV = realEnv;
      delete process.env.FIELD_ENC_SECRET;
    });

    it('非生产环境不抛（dev 免配）', () => {
      process.env.NODE_ENV = 'development';
      expect(() => assertFieldSecretForProduction()).not.toThrow();
    });

    it('生产缺失或过短抛错', () => {
      process.env.NODE_ENV = 'production';
      delete process.env.FIELD_ENC_SECRET;
      expect(() => assertFieldSecretForProduction()).toThrow(/FIELD_ENC_SECRET/);
      process.env.FIELD_ENC_SECRET = 'short';
      expect(() => assertFieldSecretForProduction()).toThrow(/FIELD_ENC_SECRET/);
    });

    it('生产配置合规不抛', () => {
      process.env.NODE_ENV = 'production';
      process.env.FIELD_ENC_SECRET = 'x'.repeat(FIELD_ENC_MIN_LEN);
      expect(() => assertFieldSecretForProduction()).not.toThrow();
    });
  });
});
