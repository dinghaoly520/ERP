import { MockUKeyAdapter, sm2EncryptHex, verifyEnvelopeMsg } from '@water-erp/ukey';

describe('MockUKeyAdapter（口令加密软件介质）', () => {
  const mkStorage = () => {
    const m = new Map<string, string>();
    const storage = {
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => {
        m.set(k, v);
      },
      removeItem: (k: string) => {
        m.delete(k);
      },
    };
    return { storage, map: m };
  };

  it('生成证书→sign→跨实例 import 后仍可 sign/decrypt（介质可携带语义）', async () => {
    const { storage, map } = mkStorage();
    const uk = await MockUKeyAdapter.open({ storage, password: 'p@ss' });
    const cert = await uk.createCertificate('四川水发建设有限公司');
    expect(cert.certDn).toBe('CN=四川水发建设有限公司');
    expect(cert.certSn).toMatch(/^MOCK-[0-9A-F]{16}$/);
    const sig = await uk.sign(cert.certSn, 'msg-1');
    expect(verifyEnvelopeMsg('msg-1', sig, cert.publicKey)).toBe(true);

    // storage 里只有 AES-GCM 密文信封：无明文私钥、无明文证书表
    const ks = JSON.parse(map.get('mock-ukey-keystore')!);
    expect(Object.keys(ks).sort()).toEqual(['ciphertext', 'nonce', 'salt', 'version']);
    expect(map.get('mock-ukey-keystore')!).not.toMatch(/[0-9a-f]{120,}/);

    // 导出（新口令）→ 另一浏览器导入 → 同证书可用
    const blob = await uk.exportFile('p@ss2');
    const dst = mkStorage();
    const uk2 = await MockUKeyAdapter.importFile(blob, 'p@ss2', dst.storage);
    expect((await uk2.listCertificates()).map((c) => c.certSn)).toContain(cert.certSn);
    const sig2 = await uk2.sign(cert.certSn, 'msg-1');
    expect(verifyEnvelopeMsg('msg-1', sig2, cert.publicKey)).toBe(true);
    expect(await uk2.decrypt(cert.certSn, sm2EncryptHex(cert.publicKey, 'deadbeef'))).toBe('deadbeef');

    // 导入须落库：凭口令重开目标介质仍能读到该证书
    const uk3 = await MockUKeyAdapter.open({ storage: dst.storage, password: 'p@ss2' });
    expect((await uk3.listCertificates()).map((c) => c.certSn)).toContain(cert.certSn);
  });

  it('错误口令 import 拒绝', async () => {
    const src = mkStorage();
    const uk = await MockUKeyAdapter.open({ storage: src.storage, password: 'right' });
    await uk.createCertificate('甲');
    const blob = await uk.exportFile('right');
    const dst = mkStorage();
    await expect(MockUKeyAdapter.importFile(blob, 'wrong', dst.storage)).rejects.toThrow();
    expect(dst.map.size).toBe(0); // 失败零残留：不得留半初始化状态
  });

  it('decrypt roundtrip（用 sm2EncryptHex 包的 DEK）', async () => {
    const { storage } = mkStorage();
    const uk = await MockUKeyAdapter.open({ storage, password: 'x' });
    const cert = await uk.createCertificate('乙');
    expect(await uk.decrypt(cert.certSn, sm2EncryptHex(cert.publicKey, 'deadbeef'.repeat(4)))).toBe(
      'deadbeef'.repeat(4),
    );
  });

  // ── 补充：Task 2 接口语义收口（sm-crypto 解密失败返回 ''、从不抛错 → 适配层必须转为抛错）──
  it('decrypt 密文损坏抛错（不返回空串）', async () => {
    const { storage } = mkStorage();
    const uk = await MockUKeyAdapter.open({ storage, password: 'x' });
    const cert = await uk.createCertificate('丙');
    const cipher = sm2EncryptHex(cert.publicKey, 'deadbeef');
    const broken = cipher.slice(0, -8) + '00000000'; // 破坏 C3 摘要区
    await expect(uk.decrypt(cert.certSn, broken)).rejects.toThrow('解密失败');
  });

  it('open 已有介质口令不符抛错', async () => {
    const { storage } = mkStorage();
    const uk = await MockUKeyAdapter.open({ storage, password: 'right' });
    await uk.createCertificate('丁');
    await expect(MockUKeyAdapter.open({ storage, password: 'nope' })).rejects.toThrow();
  });
});
