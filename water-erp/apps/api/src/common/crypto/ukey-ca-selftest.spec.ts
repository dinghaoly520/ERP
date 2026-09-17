import {
  MockUKeyAdapter,
  runCaSelfTest,
  type CaSelfTestItemResult,
  type UKeyAdapter,
} from '@water-erp/ukey';

/* =================================================================
   CA及签章测试 · 加解密自检（六项）— runCaSelfTest 契约

   六项对应大平台「CA加解密测试」清单：数据签名 / 验签 / 公钥加密 /
   私钥解密 / 文件对称加密 / 文件对称解密。私钥侧运算必须走 adapter
   （介质内私钥），公钥/对称侧为浏览器本地 sm-crypto 层。
   ================================================================= */

const mkStorage = () => {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => {
      m.set(k, v);
    },
    removeItem: (k: string) => {
      m.delete(k);
    },
  };
};

const KEY_ORDER: CaSelfTestItemResult['key'][] = [
  'sign',
  'verify',
  'pubEncrypt',
  'privDecrypt',
  'sm4Encrypt',
  'sm4Decrypt',
];

describe('runCaSelfTest（CA加解密六项自检）', () => {
  it('Mock 介质全项通过：六项齐、次序对、耗时有值', async () => {
    const uk = await MockUKeyAdapter.open({ storage: mkStorage(), password: 'p' });
    const cert = await uk.createCertificate('四川水发建设有限公司');

    const results = await runCaSelfTest(uk, cert);

    expect(results.map((r) => r.key)).toEqual(KEY_ORDER);
    expect(results.every((r) => r.status === 'pass')).toBe(true);
    results.forEach((r) => {
      expect(r.ms).toBeGreaterThanOrEqual(0);
      expect(r.detail).toBeTruthy();
    });
  });

  it('私钥运算走介质：stub 掉 adapter.sign 后签名项失败、验签项跳过', async () => {
    const uk = await MockUKeyAdapter.open({ storage: mkStorage(), password: 'p' });
    const cert = await uk.createCertificate('甲');

    const broken: UKeyAdapter = {
      name: 'broken',
      listCertificates: uk.listCertificates.bind(uk),
      sign: async () => {
        throw new Error('PIN_REQUIRED');
      },
      decrypt: uk.decrypt.bind(uk),
    };
    const results = await runCaSelfTest(broken, cert);
    const by = Object.fromEntries(results.map((r) => [r.key, r]));

    expect(by.sign.status).toBe('fail');
    expect(by.sign.detail).toContain('PIN_REQUIRED');
    expect(by.verify.status).toBe('skipped'); // 依赖签名产物
    expect(by.pubEncrypt.status).toBe('pass'); // 与介质无关，不受牵连
    expect(by.privDecrypt.status).toBe('pass');
    expect(by.sm4Encrypt.status).toBe('pass');
    expect(by.sm4Decrypt.status).toBe('pass');
  });

  it('签名值与证书不匹配（伪签名）→ 验签项失败', async () => {
    const uk = await MockUKeyAdapter.open({ storage: mkStorage(), password: 'p' });
    const cert = await uk.createCertificate('乙');
    const other = await MockUKeyAdapter.open({ storage: mkStorage(), password: 'p' });
    const otherCert = await other.createCertificate('丙');

    const forged: UKeyAdapter = {
      name: 'forged',
      listCertificates: uk.listCertificates.bind(uk),
      // 用「别人的私钥」对同一段测试串签名 → 验签必不过
      sign: (certSn, msg) => other.sign(otherCert.certSn, msg),
      decrypt: uk.decrypt.bind(uk),
    };
    const results = await runCaSelfTest(forged, cert);
    const by = Object.fromEntries(results.map((r) => [r.key, r]));

    expect(by.sign.status).toBe('pass'); // 运算本身成功
    expect(by.verify.status).toBe('fail');
  });

  it('私钥解密失败/不一致 → 该项失败，SM4 项不受影响', async () => {
    const uk = await MockUKeyAdapter.open({ storage: mkStorage(), password: 'p' });
    const cert = await uk.createCertificate('丁');

    const mismatch: UKeyAdapter = {
      name: 'mismatch',
      listCertificates: uk.listCertificates.bind(uk),
      sign: uk.sign.bind(uk),
      decrypt: async () => '0000', // 解出来对不上原文
    };
    const results = await runCaSelfTest(mismatch, cert);
    const by = Object.fromEntries(results.map((r) => [r.key, r]));

    expect(by.privDecrypt.status).toBe('fail');
    expect(by.sm4Encrypt.status).toBe('pass');
    expect(by.sm4Decrypt.status).toBe('pass');
  });

  it('onResult 逐项回调：六次、与最终结果一致', async () => {
    const uk = await MockUKeyAdapter.open({ storage: mkStorage(), password: 'p' });
    const cert = await uk.createCertificate('戊');

    const seen: CaSelfTestItemResult['key'][] = [];
    const results = await runCaSelfTest(uk, cert, (r) => seen.push(r.key));

    expect(seen).toEqual(KEY_ORDER);
    expect(results.every((r) => r.status === 'pass')).toBe(true);
  });
});
