/* =================================================================
   p7-parser — PKCS#7/CMS SignedData 结构化解析（World B 本地比对核心）

   职责：从 P7 签名中提取内嵌原文、签名者指纹与证书指纹——
   供 CaVerificationService 做 toSign↔P7 内嵌内容逐字节比对。

   依据：阶段0 实测（C-8 内嵌原文=原始 UTF-8 字节；C-9 SM3+SM2 国密；
   contentType 白名单策略）。
   ================================================================= */
import { createHash } from 'crypto';
import { DerNode, parseChildren, parseDer, readOid } from '../x509/der-parser';

export const OID_SIGNED_DATA = '1.2.840.113549.1.7.2';
export const OID_DATA = '1.2.840.113549.1.7.1';

/** 算法白名单（Global Constraints——阶段0 C-9 实测） */
export const ALG_WHITELIST = {
  digest: '1.2.156.10197.1.401',        // SM3
  signature: '1.2.156.10197.1.301',      // SM2
  spkiCurve: '1.2.156.10197.1.301',      // SM2 曲线
  certSigAlg: '1.2.156.10197.1.501',     // SM2-with-SM3
} as const;

export type P7ParseErrorReason = 'NON_WHITELISTED' | 'MALFORMED' | 'NO_CONTENT' | 'TOO_LARGE';

export class P7ParseError extends Error {
  constructor(msg: string, public readonly reason: P7ParseErrorReason) {
    super(msg);
    this.name = 'P7ParseError';
  }
}

export interface P7Signer {
  sidKind: 'issuerAndSerial' | 'ski';
  serialHex?: string; // issuerAndSerial 形态（小写去前导零）
  skiHex?: string;    // subjectKeyIdentifier 形态
  digestAlgOid: string;
  signatureAlgOid: string;
  hasSignedAttrs: boolean;
}

export interface P7EmbeddedCert {
  sha256: string;    // 证书 DER 全文 sha256（小写 hex）
  serialHex: string; // tbsCertificate 首个 INTEGER（小写去前导零）
}

export interface P7ParseResult {
  contentTypeOid: string;           // ContentInfo 顶层 OID
  eContentTypeOid: string | null;   // encapContentInfo 内层 OID
  /** 内嵌原文（attached=Buffer / detached=null）——CaVerificationService 与 toSign 比对的唯一依据 */
  embeddedContent: Buffer | null;
  signers: P7Signer[];
  embeddedCerts: P7EmbeddedCert[];
}

// ─── 内部工具 ───

function hex0(b: Buffer): string {
  const s = b.toString('hex').replace(/^0+(?=.)/, '');
  return (s.length % 2 ? '0' + s : s).toLowerCase();
}

function sha256(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

/** 从 tag+value 确定性重编码 DER TLV（不依赖 offset——parseChildren 嵌套层 offset 修正有偏移） */
function derTlv(tag: number, value: Buffer): Buffer {
  const len = value.length;
  if (len < 0x80) return Buffer.concat([Buffer.from([tag, len]), value]);
  const lenBytes: number[] = [];
  let l = len;
  while (l > 0) { lenBytes.unshift(l & 0xff); l >>= 8; }
  return Buffer.concat([Buffer.from([tag, 0x80 | lenBytes.length]), Buffer.from(lenBytes), value]);
}

/** 从 tbsCertificate 提取序列号（首个 INTEGER 元素） */
function extractCertSerial(certNode: DerNode): string | null {
  const certChildren = parseChildren(certNode);
  if (!certChildren.length || certChildren[0]!.tag !== 0x30) return null;
  const tbsChildren = parseChildren(certChildren[0]!);
  // [0] version 可选；首个 0x02 INTEGER = serialNumber
  const idx = tbsChildren[0]?.tag === 0xa0 ? 1 : 0;
  const serial = tbsChildren[idx];
  if (!serial || serial.tag !== 0x02) return null;
  return hex0(serial.value);
}

/** 解析 SignerInfo（RFC 5652 §5.3） */
function parseSignerInfo(signerNode: DerNode): P7Signer {
  const si = parseChildren(signerNode);
  if (si.length < 5) throw new P7ParseError('SignerInfo 字段不足', 'MALFORMED');
  const vi = si.findIndex((c) => c.tag === 0x02); // version
  if (vi < 0) throw new P7ParseError('SignerInfo 缺 version', 'MALFORMED');
  const rest = si.slice(vi + 1);

  // sid: [0] version 后第一个元素
  let sidKind: 'issuerAndSerial' | 'ski';
  let serialHex: string | undefined;
  let skiHex: string | undefined;
  if (rest[0]!.tag === 0x30) {
    // issuerAndSerialNumber SEQUENCE { Name, INTEGER }
    const ias = parseChildren(rest[0]!);
    const serial = ias.find((n) => n.tag === 0x02);
    if (serial) serialHex = hex0(serial.value);
    else throw new P7ParseError('sid issuerAndSerial 缺 serial', 'MALFORMED');
    sidKind = 'issuerAndSerial';
  } else if (rest[0]!.tag === 0xa0 || rest[0]!.tag === 0x80) {
    // subjectKeyIdentifier [0] IMPLICIT OCTET STRING（0xa0=显式 / 0x80=隐式）
    const inner = rest[0]!.tag === 0xa0
      ? parseChildren(rest[0]!).find((n) => n.tag === 0x04)
      : rest[0]!;
    skiHex = inner ? inner.value.toString('hex') : undefined;
    sidKind = 'ski';
  } else {
    throw new P7ParseError(`sid 形态未知 tag=0x${rest[0]!.tag.toString(16)}`, 'MALFORMED');
  }

  // 后续 0x30 SEQUENCE = digestAlgorithm / signatureAlgorithm
  const algOids: string[] = [];
  for (const q of rest.slice(1)) {
    if (q.tag === 0x30) {
      const o = parseChildren(q).find((c) => c.tag === 0x06);
      if (o) algOids.push(readOid(o));
    }
  }

  return {
    sidKind,
    serialHex,
    skiHex,
    digestAlgOid: algOids[0] ?? '',
    signatureAlgOid: algOids[algOids.length - 1] ?? '',
    hasSignedAttrs: si.some((c) => c.tag === 0xa0),
  };
}

// ─── 主入口 ───

export function parseSignedP7(input: string | Buffer): P7ParseResult {
  const der = typeof input === 'string'
    ? Buffer.from(input.replace(/\s+/g, ''), 'base64')
    : input;
  if (der.length > 2 * 1024 * 1024) throw new P7ParseError('DER 超过 2MiB', 'TOO_LARGE');

  // ContentInfo SEQUENCE { contentType OID, content [0] EXPLICIT }
  const root = parseDer(der);
  if (root.tag !== 0x30) throw new P7ParseError('顶层非 SEQUENCE', 'MALFORMED');
  const ci = parseChildren(root);
  const typeNode = ci.find((c) => c.tag === 0x06);
  const ctxNode = ci.find((c) => c.tag === 0xa0);
  if (!typeNode) throw new P7ParseError('无 contentType OID', 'MALFORMED');
  const typeOid = readOid(typeNode);
  if (typeOid !== OID_SIGNED_DATA) {
    throw new P7ParseError(`contentType ${typeOid} 不在白名单（PKCS#7 signedData）`, 'NON_WHITELISTED');
  }
  if (!ctxNode) throw new P7ParseError('无 [0] content', 'MALFORMED');

  // [0] → SignedData SEQUENCE
  const sdChildren = parseChildren(parseChildren(ctxNode)[0]!);
  const versionNode = sdChildren.find((c) => c.tag === 0x02);
  const sets = sdChildren.filter((c) => c.tag === 0x31);
  const seqs = sdChildren.filter((c) => c.tag === 0x30);
  if (!versionNode || sets.length < 2 || !seqs[0]) {
    throw new P7ParseError('SignedData 形状不符（需 version + 2×SET + encapContentInfo）', 'MALFORMED');
  }

  // encapContentInfo = 首个以 OID 开头的 SEQUENCE
  const encap = seqs[0]!;
  const ec = parseChildren(encap);
  const ecOid = ec.find((c) => c.tag === 0x06);
  const ecCtx = ec.find((c) => c.tag === 0xa0);
  const ecOther = ec.filter((c) => c.tag !== 0x06 && c.tag !== 0xa0);
  if (!ecOid) throw new P7ParseError('encapContentInfo 无 eContentType', 'MALFORMED');
  if (ecOther.length > 0) {
    throw new P7ParseError(`encapContentInfo 含非法标签 ${ecOther.map((c) => `0x${c.tag.toString(16)}`).join(',')}`, 'MALFORMED');
  }

  let embeddedContent: Buffer | null = null;
  if (!ecCtx) {
    // 仅 [OID] → detached
    embeddedContent = null;
  } else {
    // [OID, [0]] → eContent OCTET STRING
    const inner = parseChildren(ecCtx);
    if (inner.length !== 1 || inner[0]!.tag !== 0x04) {
      throw new P7ParseError('eContent [0] 内非单一 OCTET STRING', 'MALFORMED');
    }
    embeddedContent = inner[0]!.value;
  }

  // [0] 证书集（IMPLICIT SET OF Certificate）——证书指纹提取
  const embeddedCerts: P7EmbeddedCert[] = [];
  const certsNode = sdChildren.find((c) => c.tag === 0xa0 && c !== ctxNode);
  if (certsNode) {
    for (const cc of parseChildren(certsNode)) {
      if (cc.tag !== 0x30) continue; // 只取 Certificate SEQUENCE
      const serialHex = extractCertSerial(cc);
      const certDer = derTlv(cc.tag, cc.value); // 确定性重编码——DER 规范形唯一
      embeddedCerts.push({ sha256: sha256(certDer), serialHex: serialHex ?? '?' });
    }
  }

  // signerInfos = 最后一个 SET
  const signerSet = sets[sets.length - 1]!;
  const signers = parseChildren(signerSet).map(parseSignerInfo);

  return {
    contentTypeOid: typeOid,
    eContentTypeOid: ecOid ? readOid(ecOid) : null,
    embeddedContent,
    signers,
    embeddedCerts,
  };
}
