/* =================================================================
   der-parser — 最小 ASN.1/DER TLV 解析原语

   为 X.509/SM2 证书链校验定制（零第三方依赖）：
   - 只支持确定性原语（DER）的定长编码；
   - 只覆盖 X.509 用到的结构：SEQUENCE/SET/INTEGER/OID/BIT STRING/
     UTCTime/GeneralizedTime/上下文标签 [0]/[3]；
   - 不做 BER 宽容（不定长 0x80 抛错）——证书是 DER，宽容=攻击面。
   ================================================================= */

export interface DerNode {
  /** 单字节标签（不支持高位标签形式，X.509 不用） */
  tag: number;
  /** 内容字节（切片，零拷贝语义） */
  value: Buffer;
  /** 整个 TLV 的字节数 */
  totalLength: number;
  /** tag 字节在源 buffer 中的偏移 */
  offset: number;
}

class DerError extends Error {
  constructor(msg: string) {
    super(`DER 解析失败：${msg}`);
  }
}

/** 从 offset 起解析一个 TLV，返回节点与下一个 TLV 的偏移 */
function parseAt(buf: Buffer, offset: number): { node: DerNode; next: number } {
  if (offset + 2 > buf.length) throw new DerError('输入截断（不足最小 TLV）');
  const tag = buf[offset];
  const firstLen = buf[offset + 1];
  let headerLen = 2;
  let len: number;
  if (firstLen < 0x80) {
    len = firstLen;
  } else if (firstLen === 0x80) {
    throw new DerError('不定长编码（0x80）非 DER');
  } else {
    const count = firstLen & 0x7f;
    if (count === 0 || count > 4) throw new DerError(`长度字节数非法（${count}）`);
    if (offset + 2 + count > buf.length) throw new DerError('长度字段截断');
    len = 0;
    for (let i = 0; i < count; i++) len = len * 256 + buf[offset + 2 + i];
    headerLen = 2 + count;
  }
  const start = offset + headerLen;
  if (start + len > buf.length) throw new DerError('内容截断');
  return {
    node: { tag, value: buf.subarray(start, start + len), totalLength: headerLen + len, offset },
    next: start + len,
  };
}

/** 解析恰好一个顶层 TLV；尾部多余字节抛错（证书文件必须只有一个顶层结构） */
export function parseDer(buf: Buffer): DerNode {
  const { node, next } = parseAt(buf, 0);
  if (next !== buf.length) throw new DerError(`尾部多余 ${buf.length - next} 字节`);
  return node;
}

/** 展开 constructed 节点（SEQUENCE/SET/上下文标签）的子元素；原始类型抛错 */
export function parseChildren(node: DerNode): DerNode[] {
  if (!(node.tag & 0x20)) throw new DerError(`tag 0x${node.tag.toString(16)} 非constructed，无子元素`);
  const kids: DerNode[] = [];
  let off = 0;
  while (off < node.value.length) {
    const { node: kid, next } = parseAt(node.value, off);
    kids.push({ ...kid, offset: kid.offset + (node.offset + 2 + (node.totalLength - node.value.length)) });
    off = next;
  }
  return kids;
}

/** INTEGER → 最小正整数 hex（剥离 DER 前导零） */
export function readIntegerHex(node: DerNode): string {
  if (node.tag !== 0x02) throw new DerError(`期望 INTEGER，实际 0x${node.tag.toString(16)}`);
  let i = 0;
  while (i < node.value.length - 1 && node.value[i] === 0x00) i++;
  const v = node.value.subarray(i);
  return v.length === 0 ? '0' : v.toString('hex');
}

/** OBJECT IDENTIFIER → 点分十进制（首弧按 X.690 40 分解） */
export function readOid(node: DerNode): string {
  if (node.tag !== 0x06) throw new DerError(`期望 OID，实际 0x${node.tag.toString(16)}`);
  const arcs: number[] = [];
  let val = 0;
  for (const b of node.value) {
    val = val * 128 + (b & 0x7f);
    if (!(b & 0x80)) {
      arcs.push(val);
      val = 0;
    }
  }
  if (arcs.length === 0) throw new DerError('OID 内容为空');
  const [first] = arcs;
  const arc1 = first < 40 ? 0 : first < 80 ? 1 : 2;
  const arc2 = first - arc1 * 40;
  return [arc1, arc2, ...arcs.slice(1)].join('.');
}

/** ECDSA/SM2 签名值 SEQUENCE{r,s}（DER）→ r||s（128 位 hex，各 32 字节左补零） */
export function sigDerToRsHex(node: DerNode): string {
  if (node.tag !== 0x30) throw new DerError(`期望 SEQUENCE 签名值，实际 0x${node.tag.toString(16)}`);
  const kids = parseChildren(node);
  if (kids.length !== 2) throw new DerError(`签名值应有 2 个 INTEGER，实际 ${kids.length}`);
  const part = (k: DerNode) => {
    if (k.tag !== 0x02) throw new DerError('签名分量非 INTEGER');
    return readIntegerHex(k).padStart(64, '0');
  };
  return part(kids[0]) + part(kids[1]);
}

/** UTCTime(0x17)/GeneralizedTime(0x18) → UTC Date（UTCTime 按 RFC 5280 50 年枢轴） */
export function readTime(node: DerNode): Date {
  const s = node.value.toString('ascii');
  const m = node.tag === 0x17 ? /^(\d{2})(\d{10})Z$/.exec(s) : node.tag === 0x18 ? /^(\d{4})(\d{10})Z$/.exec(s) : null;
  if (!m) throw new DerError(`非支持的时间编码（tag 0x${node.tag.toString(16)}，"${s}"）`);
  const yy = node.tag === 0x17 ? (Number(m[1]) >= 50 ? 1900 + Number(m[1]) : 2000 + Number(m[1])) : Number(m[1]);
  const rest = m[2];
  return new Date(
    Date.UTC(yy, Number(rest.slice(0, 2)) - 1, Number(rest.slice(2, 4)), Number(rest.slice(4, 6)), Number(rest.slice(6, 8)), Number(rest.slice(8, 10))),
  );
}
