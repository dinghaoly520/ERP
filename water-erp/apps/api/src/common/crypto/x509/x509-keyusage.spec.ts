import * as fs from 'fs';
import * as path from 'path';
import { parseCertificate, pemToDer } from './x509-cert';

const fixtureDir = path.join(__dirname, '..', '..', '..', '..', 'test', 'fixtures', 'scca');
const signPem = fs.readFileSync(path.join(fixtureDir, 'S2-sign-cert.b64'), 'utf-8');
const encPem = fs.readFileSync(path.join(fixtureDir, 'S2-enc-cert.b64'), 'utf-8');

describe('x509-cert KeyUsage/EKU/曲线扩展（阶段1 Task2，真证 fixture 锁定）', () => {
  describe('签名证（S2-sign-cert）', () => {
    const cert = parseCertificate(pemToDer(signPem));

    test('keyUsage 含 DigitalSignature + NonRepudiation', () => {
      expect(cert.keyUsage).toContain('DigitalSignature');
      expect(cert.keyUsage).toContain('NonRepudiation');
    });

    test('curveOid = SM2 曲线 1.2.156.10197.1.301', () => {
      expect(cert.curveOid).toBe('1.2.156.10197.1.301');
    });

    test('serialHex 以 4eb0 开头（真证）', () => {
      expect(cert.serialHex?.toLowerCase().startsWith('4eb0')).toBe(true);
    });

    test('subjectDN 含 OU=PN:01@XM20250916（项目绑定字段）', () => {
      expect(cert.subjectDn).toContain('OU=PN:01@XM20250916');
    });
  });

  describe('加密证（S2-enc-cert）', () => {
    const cert = parseCertificate(pemToDer(encPem));

    test('keyUsage 含 KeyEncipherment + DataEncipherment + KeyAgreement', () => {
      expect(cert.keyUsage).toContain('KeyEncipherment');
      expect(cert.keyUsage).toContain('DataEncipherment');
      expect(cert.keyUsage).toContain('KeyAgreement');
    });

    test('curveOid = SM2 曲线', () => {
      expect(cert.curveOid).toBe('1.2.156.10197.1.301');
    });

    test('unknownExtensionOids 含 2.16.156.1.6.10.2（ITRUSKMC 私有扩展——非 EKU）', () => {
      expect(cert.unknownExtensionOids).toContain('2.16.156.1.6.10.2');
      expect(cert.extendedKeyUsage).not.toContain('2.16.156.1.6.10.2'); // 不得混入 EKU
    });
  });

  describe('兼容性（存量 mock 证书不回归）', () => {
    test('parseCertificate 仍返回既有字段', () => {
      const cert = parseCertificate(pemToDer(signPem));
      // 既有字段全部存在
      expect(cert).toHaveProperty('serialHex');
      expect(cert).toHaveProperty('subjectDn');
      expect(cert).toHaveProperty('notBefore');
      expect(cert).toHaveProperty('notAfter');
      expect(cert).toHaveProperty('publicKeyHex');
      expect(cert).toHaveProperty('issuerDn');
    });
  });
});
