/* =================================================================
   x509-cert — X.509 v3 结构化解析 + SM2 证书签名验证（厂商无关地基）

   输入只认 DER（PEM 走 pemToDer）；证书字段一律以 DER 解析结果为唯一事实源，
   杜绝「前端声明字段」。
   验签：sm-crypto SM3-SM2（ZA 默认 userId=1234567812345678，与国密证书惯例及
   OpenSSL 默认对齐）；若互认失败回退 Node crypto.X509Certificate.verify
   （OpenSSL 原生验证，兼容厂商签名实现差异）——两路任一通过即通过。
   ================================================================= */
import { DerNode, parseChildren, parseDer, readIntegerHex, readOid, readTime, sigDerToRsHex } from './der-parser';

const sm2 = require('sm-crypto').sm2;

export const OID_SM2_ECC = '1.2.156.10197.1.301'; // SM2 椭圆曲线公钥
export const OID_SM3_WITH_SM2 = '1.2.156.10197.1.501'; // SM3withSM2 签名算法

/** X.509 Name 常用属性 OID → 短名（渲染 DN 用；未收录 OID 原样点分输出） */
const DN_ATTR: Record<string, string> = {
  '2.5.4.3': 'CN',
  '2.5.4.6': 'C',
  '2.5.4.7': 'L',
  '2.5.4.8': 'ST',
  '2.5.4.10': 'O',
  '2.5.4.11': 'OU',
  '2.5.4.5': 'serialNumber',
  '2.5.4.9': 'street',
  '1.2.840.113549.1.9.1': 'emailAddress',
};

export interface ParsedX509 {
  /** 完整 DER 原文 */
  raw: Buffer;
  /** tbsCertificate 原始字节（验签消息体） */
  tbs: Buffer;
  /** 序列号（大写最小 hex——与 openssl x509 -serial 口径一致） */
  serialHex: string;
  /** 证书签名算法 OID */
  sigAlgOid: string;
  /** 主体公钥算法 OID */
  spkiAlgOid: string;
  /** 颁发者 DN（openssl 顺序：C=…, O=…, CN=…） */
  issuerDn: string;
  subjectDn: string;
  /** 主体 CN（renderDn 后正则提取，与 supplier-portal extractDnCn 同口径） */
  cn: string | null;
  notBefore: Date;
  notAfter: Date;
  /** SM2 公钥（04‖X‖Y，130 位小写 hex——与 SupplierCert.publicKey 存储口径一致） */
  publicKeyHex: string;
  /** BasicConstraints cA */
  isCa: boolean;
}

/** PEM（单证书）→ DER */
export function pemToDer(pem: string): Buffer {
  const m = /-----BEGIN CERTIFICATE-----([\s\S]*?)-----END CERTIFICATE-----/.exec(pem);
  if (!m) throw new Error('PEM 中未找到 CERTIFICATE 块');
  return Buffer.from(m[1].replace(/\s+/g, ''), 'base64');
}

/** DN 属性值解码（UTF8String/PrintableString/IA5String/BMPString） */
function readDnValue(node: DerNode): string {
  switch (node.tag) {
    case 0x0c:
      return node.value.toString('utf8');
    case 0x13:
    case 0x16:
    case 0x14:
      return node.value.toString('ascii');
    case 0x1e:
      return node.value.toString('utf16le'); // BMPString（UCS-2 大端——罕见，尽力而为）
    default:
      return node.value.toString('utf8');
  }
}

/** Name(RDNSequence) → "C=CN, O=…, CN=…"（RDN 间逗号+空格，ATV 间 +） */
function renderDn(nameNode: DerNode): string {
  const parts: string[] = [];
  for (const rdn of parseChildren(nameNode)) {
    const atvs: string[] = [];
    for (const atv of parseChildren(rdn)) {
      const [typeOid, valueNode] = parseChildren(atv);
      atvs.push(`${DN_ATTR[readOid(typeOid)] ?? readOid(typeOid)}=${readDnValue(valueNode)}`);
    }
    parts.push(atvs.join('+'));
  }
  return parts.join(', ');
}

function findTbsChild(tbsChildren: DerNode[], tag: number): DerNode | undefined {
  return tbsChildren.find((n) => n.tag === tag);
}

/** 解析 X.509 v3 证书（DER） */
export function parseCertificate(der: Buffer): ParsedX509 {
  const cert = parseDer(der);
  if (cert.tag !== 0x30) throw new Error(`证书顶层应为 SEQUENCE，实际 0x${cert.tag.toString(16)}`);
  const [tbsNode, sigAlgNode, sigValNode] = parseChildren(cert);
  if (!tbsNode || !sigAlgNode || !sigValNode) throw new Error('证书结构不完整（缺 tbs/signatureAlgorithm/signatureValue）');
  const tbs = der.subarray(tbsNode.offset, tbsNode.offset + tbsNode.totalLength);

  const tbsChildren = parseChildren(tbsNode);
  // [0] EXPLICIT version 可选（v3 必有，兼容缺失的 v1）
  let idx = 0;
  if (tbsChildren[0]?.tag === 0xa0) idx = 1;
  const serialNode = tbsChildren[idx++];
  const sigAlgInner = tbsChildren[idx++];
  const issuerNode = tbsChildren[idx++];
  const validityNode = tbsChildren[idx++];
  const subjectNode = tbsChildren[idx++];
  const spkiNode = tbsChildren[idx++];
  if (!serialNode || !sigAlgInner || !issuerNode || !validityNode || !subjectNode || !spkiNode) {
    throw new Error('TBSCertificate 字段缺失');
  }

  const sigAlgOid = readOid(parseChildren(sigAlgNode)[0]);

  const [nb, na] = parseChildren(validityNode);
  if (!nb || !na) throw new Error('Validity 字段缺失');

  const [spkiAlg, spkiBits] = parseChildren(spkiNode);
  if (!spkiAlg || !spkiBits || spkiBits.tag !== 0x03) throw new Error('SPKI 结构非法');
  const spkiAlgOid = readOid(parseChildren(spkiAlg)[0]);
  const keyBytes = spkiBits.value.subarray(1); // 首字节=unused bits（须 0）
  if (spkiBits.value[0] !== 0x00 || keyBytes.length !== 65 || keyBytes[0] !== 0x04) {
    throw new Error(`SM2 公钥点非法（unusedBits=${spkiBits.value[0]}，len=${keyBytes.length}）`);
  }

  const subjectDn = renderDn(subjectNode);
  const cnMatch = /(?:^|,)\s*cn\s*=\s*([^,]*)/i.exec(subjectDn);

  // extensions [3]（可选）→ BasicConstraints(2.5.29.19) cA
  let isCa = false;
  const extNode = findTbsChild(tbsChildren, 0xa3);
  if (extNode) {
    for (const ext of parseChildren(parseChildren(extNode)[0])) {
      const fields = parseChildren(ext);
      if (readOid(fields[0]) !== '2.5.29.19') continue;
      // fields: extnID, [critical], extnValue(OCTET STRING，内容=DER BasicConstraints)
      const octet = fields.find((f) => f.tag === 0x04);
      if (!octet) break;
      const bc = parseChildren(parseDer(octet.value));
      if (bc[0]?.tag === 0x01 && bc[0].value.length === 1 && bc[0].value[0] !== 0x00) isCa = true;
      break;
    }
  }

  void sigValNode; // 验签时经 verifyCertSignature 读取（此处不预解析）

  return {
    raw: der,
    tbs,
    serialHex: readIntegerHex(serialNode).toUpperCase(),
    sigAlgOid,
    spkiAlgOid,
    issuerDn: renderDn(issuerNode),
    subjectDn,
    cn: cnMatch ? cnMatch[1].trim() : null,
    notBefore: readTime(nb),
    notAfter: readTime(na),
    publicKeyHex: keyBytes.toString('hex'),
    isCa,
  };
}

/**
 * 证书签名验证：child.tbs 经 issuer 公钥 SM2 验签（SM3-SM2，默认 userId）。
 * 仅验数学关系，不校验 DN 匹配/有效期/CA 标志（链校验器职责）。
 */
export function verifyCertSignature(child: ParsedX509, issuer: ParsedX509): boolean {
  try {
    const cert = parseDer(child.raw);
    const sigVal = parseChildren(cert)[2];
    if (!sigVal || sigVal.tag !== 0x03) return false;
    const rsHex = sigDerToRsHex(parseDer(sigVal.value.subarray(1)));
    const tbsHex = child.tbs.toString('hex');
    // 主路：sm-crypto（与代码库密码栈同源；OpenSSL 默认 SM2 ID 恰为该值）
    if (sm2.doVerify(tbsHex, rsHex, issuer.publicKeyHex, { hash: true, userId: '1234567812345678' })) return true;
  } catch {
    /* 解析/验签异常 → 落到回退路 */
  }
  try {
    // 回退：Node/OpenSSL 原生验证（厂商签名实现差异兜底）。注意 verify() 收
    // KeyObject（issuer.publicKey），不是证书本身——传证书会 TypeError 被吞成 false。
    const { X509Certificate } = require('crypto');
    return new X509Certificate(child.raw).verify(new X509Certificate(issuer.raw).publicKey);
  } catch {
    return false;
  }
}
