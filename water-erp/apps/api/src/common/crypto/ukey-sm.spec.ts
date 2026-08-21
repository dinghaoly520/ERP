import {
  sm2EncryptHex,
  sm2DecryptHex,
  sm4Encrypt,
  sm4Decrypt,
  randomHex,
  signEnvelopeMsg,
  verifyEnvelopeMsg,
  wrapDekJson,
  unwrapDekJson,
} from '@water-erp/ukey';
const sm2 = require('sm-crypto').sm2;

describe('ukey sm-crypto layer', () => {
  it('SM2 hex 包裹/解包 roundtrip（cipherMode 1）', () => {
    const kp = sm2.generateKeyPairHex();
    const dek = randomHex(16 + 16); // key+iv 十六进制拼接
    const cipher = sm2EncryptHex(kp.publicKey, dek);
    expect(sm2DecryptHex(kp.privateKey, cipher)).toBe(dek);
  });
  it('SM4 cbc roundtrip（utf8 经 hex 透传）', () => {
    const key = randomHex(16),
      iv = randomHex(16);
    const dataHex = Buffer.from('智慧水发·蜀水云采', 'utf8').toString('hex');
    expect(Buffer.from(sm4Decrypt(key, iv, sm4Encrypt(key, iv, dataHex)), 'hex').toString('utf8')).toBe('智慧水发·蜀水云采');
  });
  it('签名与既有 SignatureService 同参互验', () => {
    const kp = sm2.generateKeyPairHex();
    const sig = signEnvelopeMsg('abc123', kp.privateKey);
    expect(sm2.doVerifySignature('abc123', sig, kp.publicKey, { hash: true })).toBe(true);
    expect(verifyEnvelopeMsg('abc123', sig, kp.publicKey)).toBe(true);
    expect(verifyEnvelopeMsg('other', sig, kp.publicKey)).toBe(false);
  });

  // ── 补充：锁定 hex 进 hex 出的字节精确性（sm-crypto 字符串通道对无效 utf8 序列有损：U+FFFD 替换）──
  it('SM2 对无效 utf8 字节序列精确透传（hex 通道，非 utf8 通道）', () => {
    const kp = sm2.generateKeyPairHex();
    const bad = 'ff804142' + randomHex(16); // 混入无效 utf8 引导字节
    expect(sm2DecryptHex(kp.privateKey, sm2EncryptHex(kp.publicKey, bad))).toBe(bad);
  });
  it('SM2 密文为 C1C3C2（cipherMode=1）：C1C2C3 模式解不出原文', () => {
    const kp = sm2.generateKeyPairHex();
    const dek = randomHex(32);
    const cipher = sm2EncryptHex(kp.publicKey, dek);
    expect(sm2.doDecrypt(cipher, kp.privateKey, 0)).not.toBe(Buffer.from(dek, 'hex').toString('utf8'));
  });
  it('SM4 加密的是 dataHex 解码后的字节（非 hex 文本），高位字节无损', () => {
    const key = randomHex(16),
      iv = randomHex(16);
    const dataHex = randomHex(37); // 非 16 对齐 + 含任意高位字节
    expect(sm4Decrypt(key, iv, sm4Encrypt(key, iv, dataHex))).toBe(dataHex);
  });
  it('wrapDekJson 输出 {"k","iv"} 紧凑格式且 unwrap 往返', () => {
    const dek = { keyHex: randomHex(16), ivHex: randomHex(16) };
    const json = wrapDekJson(dek);
    expect(JSON.parse(json)).toEqual({ k: dek.keyHex, iv: dek.ivHex });
    expect(unwrapDekJson(json)).toEqual(dek);
  });
  it('randomHex：长度 bytes*2 的小写 hex', () => {
    expect(randomHex(16)).toMatch(/^[0-9a-f]{32}$/);
    expect(randomHex(1)).toMatch(/^[0-9a-f]{2}$/);
  });
});
