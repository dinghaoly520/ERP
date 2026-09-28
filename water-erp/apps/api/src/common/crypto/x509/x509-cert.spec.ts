/* =================================================================
   x509-cert 单测 — 对 OpenSSL 3 真实生成的 SM2 证书夹具做结构化解析与验签。
   期望值取自 `openssl x509 -noout -serial -dates` 与 Node crypto.X509Certificate
   交叉断言（Ubuntu OpenSSL3 可解析 SM2 证书，作为第三方裁判）。
   ================================================================= */
import * as fs from 'fs';
import * as path from 'path';
import { X509Certificate } from 'crypto';
import { parseCertificate, pemToDer, verifyCertSignature } from './x509-cert';
import { parseChildren, parseDer } from './der-parser';

const FIXTURES = path.resolve(__dirname, '../../../../test/fixtures/ca-chain');
const readDer = (name: string) => fs.readFileSync(path.join(FIXTURES, `${name}.der`));

const leaf = parseCertificate(readDer('leaf'));
const inter = parseCertificate(readDer('inter'));
const root = parseCertificate(readDer('root'));
const wrongLeaf = parseCertificate(readDer('wrong-leaf'));

describe('pemToDer', () => {
  it('PEM → DER（与 openssl 落盘的 .der 逐字节一致）', () => {
    const pem = fs.readFileSync(path.join(FIXTURES, 'leaf.pem'), 'utf8');
    expect(pemToDer(pem).equals(readDer('leaf'))).toBe(true);
  });
});

describe('parseCertificate — leaf', () => {
  it('序列号（与 openssl -serial 一致，大写最小 hex）', () => {
    expect(leaf.serialHex).toBe('0203353CDC74A158C4F14A57FB9400A4DDD0A3D0'); // 当前夹具 openssl -serial 真值（夹具重生成须同步）
  });

  it('算法 OID：签名 SM3withSM2 / 公钥 SM2 曲线', () => {
    expect(leaf.sigAlgOid).toBe('1.2.156.10197.1.501');
    expect(leaf.spkiAlgOid).toBe('1.2.156.10197.1.301');
  });

  it('主体 DN：openssl 顺序渲染，CN 可被 extractDnCn 口径提取', () => {
    expect(leaf.subjectDn).toBe('C=CN, O=蜀水云采测试企业, CN=四川水发建设有限公司');
    expect(leaf.cn).toBe('四川水发建设有限公司');
    expect(leaf.issuerDn).toBe('C=CN, O=ShuiFa Cloud Test CA, CN=蜀水云采测试中间CA');
  });

  it('有效期（与 Node X509Certificate 交叉一致）', () => {
    const nx = new X509Certificate(leaf.raw);
    expect(leaf.notBefore.toISOString()).toBe(new Date(nx.validFrom).toISOString());
    expect(leaf.notAfter.toISOString()).toBe(new Date(nx.validTo).toISOString());
  });

  it('SM2 公钥：04 开头 130 位 hex，与 Node SPKI 序列化的公钥点一致', () => {
    expect(leaf.publicKeyHex).toMatch(/^04[0-9a-f]{128}$/);
    // JWK 不支持 SM2 曲线；改走 SPKI DER 交叉（Node 序列化 + der-parser 原语）
    const spki = new X509Certificate(leaf.raw).publicKey.export({ format: 'der', type: 'spki' });
    const bits = parseChildren(parseDer(spki))[1];
    expect(leaf.publicKeyHex).toBe(bits.value.subarray(1).toString('hex'));
  });

  it('CA 标志：leaf=否；root/inter=是且 root 自签（issuer==subject）', () => {
    expect(leaf.isCa).toBe(false);
    expect(inter.isCa).toBe(true);
    expect(root.isCa).toBe(true);
    expect(root.issuerDn).toBe(root.subjectDn);
  });
});

describe('verifyCertSignature — sm-crypto 对 OpenSSL 签名的互认', () => {
  it('leaf 由 inter 签发 → true', () => {
    expect(verifyCertSignature(leaf, inter)).toBe(true);
  });

  it('inter 由 root 签发 → true；root 自签 → true', () => {
    expect(verifyCertSignature(inter, root)).toBe(true);
    expect(verifyCertSignature(root, root)).toBe(true);
  });

  it('issuer 不匹配（leaf×root）→ false', () => {
    expect(verifyCertSignature(leaf, root)).toBe(false);
  });

  it('tbs 篡改（改 subject CN 字节）→ false', () => {
    const raw = Buffer.from(leaf.raw); // 拷贝
    // 定位 subject CN 的 UTF8 字节「四」的首字节并改动（保持 DER 长度不变）
    const idx = raw.indexOf(Buffer.from('四川水发建设有限公司', 'utf8'));
    expect(idx).toBeGreaterThan(0);
    raw[idx] ^= 0x01;
    const tampered = parseCertificate(raw);
    expect(verifyCertSignature(tampered, inter)).toBe(false);
  });
});

describe('错误处理', () => {
  it('非证书字节 → 抛错', () => {
    expect(() => parseCertificate(Buffer.from([0x30, 0x03, 0x02, 0x01, 0x05]))).toThrow();
  });

  it('wrong-leaf 可解析且 CN 正确（负例夹具自检）', () => {
    expect(wrongLeaf.cn).toBe('错误链企业');
  });
});
