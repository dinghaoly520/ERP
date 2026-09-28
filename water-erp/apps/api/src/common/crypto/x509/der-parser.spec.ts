/* =================================================================
   der-parser 单测 — 最小 ASN.1/DER 解析原语（X.509/SM2 链校验的地基）
   用例字节手工构造（RFC 5280 DER 编码规则），不依赖夹具文件。
   ================================================================= */
import {
  parseDer,
  parseChildren,
  readIntegerHex,
  readOid,
  sigDerToRsHex,
  readTime,
} from './der-parser';

describe('parseDer', () => {
  it('解析短格式长度的 INTEGER（02 01 05 → value=05）', () => {
    const node = parseDer(Buffer.from([0x02, 0x01, 0x05]));
    expect(node.tag).toBe(0x02);
    expect(node.value).toEqual(Buffer.from([0x05]));
  });

  it('解析长格式长度（0x82 两字节长度，占位数据）', () => {
    const payload = Buffer.alloc(300, 0xab);
    const der = Buffer.concat([Buffer.from([0x30, 0x82, 0x01, 0x2c]), payload]);
    const node = parseDer(der);
    expect(node.tag).toBe(0x30);
    expect(node.value.length).toBe(300);
    expect(node.totalLength).toBe(304);
  });

  it('尾部多余字节 → 抛错（证书必须恰好一个顶层 TLV）', () => {
    expect(() => parseDer(Buffer.from([0x02, 0x01, 0x05, 0x00]))).toThrow();
  });

  it('截断输入 → 抛错', () => {
    expect(() => parseDer(Buffer.from([0x30, 0x82, 0x01]))).toThrow();
  });
});

describe('parseChildren', () => {
  it('展开 SEQUENCE 的子元素（INTEGER+OID）', () => {
    // SEQUENCE { INTEGER 5, OID 2.5.4.3 }
    const der = Buffer.from([0x30, 0x06, 0x02, 0x01, 0x05, 0x06, 0x01, 0x2a]);
    const kids = parseChildren(parseDer(der));
    expect(kids.length).toBe(2);
    expect(kids[0].tag).toBe(0x02);
    expect(kids[1].tag).toBe(0x06);
  });

  it('原始类型节点（INTEGER）取子元素 → 抛错', () => {
    expect(() => parseChildren(parseDer(Buffer.from([0x02, 0x01, 0x05])))).toThrow();
  });
});

describe('readIntegerHex', () => {
  it('正整数（无前导零）→ 最小 hex', () => {
    expect(readIntegerHex(parseDer(Buffer.from([0x02, 0x02, 0x01, 0x00])))).toBe('0100');
  });

  it('带 DER 前导零字节（正数补位）→ 剥离后输出', () => {
    // INTEGER 0x00FF 的 DER 编码是 02 02 00 FF
    expect(readIntegerHex(parseDer(Buffer.from([0x02, 0x02, 0x00, 0xff])))).toBe('ff');
  });
});

describe('readOid', () => {
  it('2.5.4.3（CN 属性）', () => {
    expect(readOid(parseDer(Buffer.from([0x06, 0x03, 0x55, 0x04, 0x03])))).toBe('2.5.4.3');
  });

  it('1.2.840.10045.2.1（EC 公钥）', () => {
    expect(readOid(parseDer(Buffer.from([0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01])))).toBe(
      '1.2.840.10045.2.1',
    );
  });

  it('1.2.156.10197.1.301（SM2 椭圆曲线，多字节弧）', () => {
    // 1.2→0x2A；156≥128→0x81 0x1C；10197=79*128+85→0xCF 0x55；1→0x01；301→0x82 0x2D
    expect(readOid(parseDer(Buffer.from([0x06, 0x08, 0x2a, 0x81, 0x1c, 0xcf, 0x55, 0x01, 0x82, 0x2d])))).toBe(
      '1.2.156.10197.1.301',
    );
  });
});

describe('sigDerToRsHex', () => {
  it('SEQUENCE{r,s} → 128 位 hex（短分量左补零）', () => {
    // r=0x05（1 字节），s=0x2AF3（2 字节）→ 各补齐 32 字节
    const der = Buffer.from([
      0x30, 0x07, //
      0x02, 0x01, 0x05, //
      0x02, 0x02, 0x2a, 0xf3,
    ]);
    const rs = sigDerToRsHex(parseDer(der));
    expect(rs.length).toBe(128);
    expect(rs.slice(0, 64)).toBe('00'.repeat(31) + '05');
    expect(rs.slice(64)).toBe('00'.repeat(30) + '2af3');
  });

  it('r/s 含 DER 前导零字节 → 剥离后正确补齐', () => {
    // s = 0x00 0xFF（前导零表示正数）
    const der = Buffer.from([0x30, 0x06, 0x02, 0x01, 0x05, 0x02, 0x01, 0xff]);
    const rs = sigDerToRsHex(parseDer(der));
    expect(rs.slice(64)).toBe('00'.repeat(31) + 'ff');
  });
});

describe('readTime', () => {
  it('UTCTime（YYMMDDHHMMSSZ）', () => {
    const t = readTime(parseDer(Buffer.concat([Buffer.from([0x17, 0x0d]), Buffer.from('260928120000Z')])));
    expect(t.toISOString()).toBe('2026-09-28T12:00:00.000Z');
  });

  it('GeneralizedTime（YYYYMMDDHHMMSSZ）', () => {
    const t = readTime(parseDer(Buffer.concat([Buffer.from([0x18, 0x0f]), Buffer.from('20460928120000Z')])));
    expect(t.toISOString()).toBe('2046-09-28T12:00:00.000Z');
  });

  it('未知时间标签 → 抛错', () => {
    expect(() => readTime(parseDer(Buffer.from([0x02, 0x01, 0x05])))).toThrow();
  });
});
