import * as fs from 'fs';
import * as path from 'path';
import { parseSignedP7, P7ParseError, OID_SIGNED_DATA } from './p7-parser';

const fx = (name: string) => fs.readFileSync(path.join(__dirname, '..', '..', '..', '..', 'test', 'fixtures', 'scca', name), 'utf-8').trim();
const SIGN_SERIAL = '4eb04e332bcf5e7e16cedf998cbd88eda62015e2'; // 真盾签名证 serial（E2 实测）
const SIGN_CERT_SHA256 = '8dcdbaca9c0fcfe8c56a312cdc0dbbeb9e5a05d49f5340cabf3557c13e60426e'; // 真盾签名证 DER sha256

describe('p7-parser（阶段1 Task3，真盾 P7 fixture 锁定）', () => {
  describe('① V1 attached（基线）', () => {
    const result = parseSignedP7(fx('V1.p7.b64'));
    const expected = fs.readFileSync(path.join(__dirname, '..', '..', '..', '..', 'test', 'fixtures', 'scca', 'V1.txt')).toString('utf-8');

    test('contentType = signedData', () => expect(result.contentTypeOid).toBe(OID_SIGNED_DATA));
    test('embeddedContent == UTF8(原文)（C-8 核心断言）', () => {
      expect(result.embeddedContent?.toString('utf8')).toBe(expected);
      expect(result.embeddedContent?.equals(Buffer.from(expected, 'utf8'))).toBe(true);
    });
    test('signer 恰 1 个，issuerAndSerial，serial=真盾签名证', () => {
      expect(result.signers).toHaveLength(1);
      expect(result.signers[0]!.sidKind).toBe('issuerAndSerial');
      expect(result.signers[0]!.serialHex).toBe(SIGN_SERIAL);
    });
    test('算法 = SM3(…401) + SM2(…301)', () => {
      expect(result.signers[0]!.digestAlgOid).toBe('1.2.156.10197.1.401');
      expect(result.signers[0]!.signatureAlgOid).toBe('1.2.156.10197.1.301');
    });
    test('signedAttrs 无（签名直接对 content）', () => expect(result.signers[0]!.hasSignedAttrs).toBe(false));
    test('embeddedCerts 含真盾签名证指纹', () => {
      expect(result.embeddedCerts.some((c) => c.sha256 === SIGN_CERT_SHA256)).toBe(true);
    });
  });

  describe('② V1d detached', () => {
    const result = parseSignedP7(fx('V1d.p7.b64'));
    test('embeddedContent = null（detached 形态）', () => expect(result.embeddedContent).toBeNull());
    test('signer 仍存在（可提取指纹）', () => expect(result.signers).toHaveLength(1));
  });

  describe('③ V7 attached（LOGONDATA 完整串 291B）', () => {
    const result = parseSignedP7(fx('V7.p7.b64'));
    const expected = fs.readFileSync(path.join(__dirname, '..', '..', '..', '..', 'test', 'fixtures', 'scca', 'V7.txt')).toString('utf-8');
    test('embeddedContent 逐字节等于 291B 原文', () => {
      expect(result.embeddedContent?.length).toBe(291);
      expect(result.embeddedContent?.toString('utf8')).toBe(expected);
    });
  });

  describe('④ v1-unknown-oid → NON_WHITELISTED', () => {
    test('拒收未知 contentType', () => {
      expect(() => parseSignedP7(fx('v1-unknown-oid.p7.b64'))).toThrow(P7ParseError);
      try { parseSignedP7(fx('v1-unknown-oid.p7.b64')); } catch (e) {
        expect((e as P7ParseError).reason).toBe('NON_WHITELISTED');
      }
    });
  });

  describe('⑤ illegal-encap → MALFORMED', () => {
    test('拒收非法 [1] 内容标签', () => {
      expect(() => parseSignedP7(fx('illegal-encap.p7.b64'))).toThrow(P7ParseError);
      try { parseSignedP7(fx('illegal-encap.p7.b64')); } catch (e) {
        expect((e as P7ParseError).reason).toBe('MALFORMED');
      }
    });
  });

  describe('接口（base64 string | Buffer 双入口）', () => {
    test('string 输入 = Buffer 输入（同结果）', () => {
      const fromStr = parseSignedP7(fx('V1.p7.b64'));
      const derBuf = Buffer.from(fx('V1.p7.b64'), 'base64');
      const fromBuf = parseSignedP7(derBuf);
      expect(fromStr.embeddedContent?.toString('hex')).toBe(fromBuf.embeddedContent?.toString('hex'));
    });
  });
});
