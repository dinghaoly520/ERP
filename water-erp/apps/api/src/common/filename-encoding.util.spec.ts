import { normalizeMultipartFilename } from './filename-encoding.util';

describe('normalizeMultipartFilename（multipart 文件名 latin1 误读修复）', () => {
  it('busboy latin1 误读的中文文件名 → 还原为正确 UTF-8', () => {
    // 实录形态（2026-11-13 生产/dev 端到端复现）：技术标文件.pdf.outer 的 UTF-8 字节被按 latin1 读出
    const mojibake = Buffer.from('技术标文件.pdf.outer', 'utf8').toString('latin1');
    expect(mojibake).not.toContain('技');
    expect(normalizeMultipartFilename(mojibake)).toBe('技术标文件.pdf.outer');
  });

  it('混合中文+数字+字母的 .outer 密文名（dual-v3 投递真实形态）→ 完整还原', () => {
    const raw = '1、采购需求申请表-2026-03-03.pdf.outer';
    const mojibake = Buffer.from(raw, 'utf8').toString('latin1');
    expect(normalizeMultipartFilename(mojibake)).toBe(raw);
  });

  it('已是正确 UTF-8 的中文名（filename* 扩展参数/程序直写来源）→ 原样保留，绝不二次转码', () => {
    expect(normalizeMultipartFilename('技术标文件.pdf.outer')).toBe('技术标文件.pdf.outer');
  });

  it('纯 ASCII 文件名 → 原样（数字/字母无恙）', () => {
    expect(normalizeMultipartFilename('technical.inner')).toBe('technical.inner');
    expect(normalizeMultipartFilename('a2')).toBe('a2');
  });

  it('合法 UTF-8 的西文名（非 ASCII、无 CJK）→ 原样保留', () => {
    // café 以正确 UTF-8 字符串到达（busboy filename* 轨）——不得被再编码
    expect(normalizeMultipartFilename('café.pdf')).toBe('café.pdf');
  });

  it('café 被 latin1 误读（cafÃ©）→ 还原为 café', () => {
    const mojibake = Buffer.from('café.pdf', 'utf8').toString('latin1');
    expect(normalizeMultipartFilename(mojibake)).toBe('café.pdf');
  });

  it('高位字节但非合法 UTF-8 序列（解码出 U+FFFD）→ 原样保留不硬修', () => {
    // 孤立 0x80 字节不是合法 UTF-8——硬转会产生替换符，宁可保留原样
    const invalid = '\u0080abc.pdf';
    expect(normalizeMultipartFilename(invalid)).toBe(invalid);
  });

  it('空串/null 安全 → 原样返回', () => {
    expect(normalizeMultipartFilename('')).toBe('');
  });

  it('C1 控制符占位的 mojibake（UTF-8 连续字节 0x80-0xBF 段）→ 正常还原', () => {
    // 「开」= E5 BC 80 → latin1 = å¼\u0080（含 C1 控制符，是 mojibake 的正常形态而非非法）
    const mojibake = Buffer.from('开标文件包.json', 'utf8').toString('latin1');
    expect(mojibake).toMatch(/[\u0080-\u009F]/);
    expect(normalizeMultipartFilename(mojibake)).toBe('开标文件包.json');
  });

  it('全角标点/顿号（、）混合形态 → 还原', () => {
    const raw = '15、钻机购销合同（E202604062）.pdf.outer';
    const mojibake = Buffer.from(raw, 'utf8').toString('latin1');
    expect(normalizeMultipartFilename(mojibake)).toBe(raw);
  });
});
