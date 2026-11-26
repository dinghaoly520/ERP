import { renderTemplateXml } from './tender-write.template';

/**
 * wrapCheckboxCharsInSymbolFont 边角状态穷举（2026-11-26 稳健性收口）：
 * 修复（3fb6303fd）把 run 重建改为逐 token 遍历后，穷举 ☐/☑ 所在 run 的各种形状——
 * 单段（旧经典形态回归锁）、多段+<w:br/>（层级文本形态）、glyph 开头/结尾/交错、
 * 无 rPr run、多 glyph、无 glyph 不受扰动。全部经 renderTemplateXml 真实入口驱动。
 */

const P = (inner: string) => `<w:p><w:r>${inner}</w:r></w:p>`;
const RPR = '<w:rPr><w:sz w:val="24"/></w:rPr>';

/** 层级替换驱动（与公告/采购文件填充同一路径：isHierarchicalText → \n 转 <w:br/>） */
function renderWith(value: string, runInner = `${RPR}<w:t>{{MARK}}</w:t>`): string {
  return renderTemplateXml(P(runInner), [
    { targetText: 'MARK', replacementText: value, highlight: false, isHierarchicalText: true },
  ]);
}

const strip = (xml: string) => xml.replace(/<[^>]+>/g, '');

describe('wrapCheckboxCharsInSymbolFont — ☐/☑ run 重建边角穷举（2026-11-26 稳健性）', () => {
  it('经典单段：单 <w:t> 含 ☑ → 文本保留、☑ 独立符号字体 run（旧行为回归锁）', () => {
    const out = renderWith('前☑后');
    expect(strip(out)).toContain('前');
    expect(strip(out)).toContain('后');
    expect(out).toContain('Segoe UI Symbol');
    expect(out).toContain('☑');
  });

  it('多段+br（生产形态）：首 <w:t> 之后各行与 <w:br/> 全保留', () => {
    const out = renderWith('行一内容甲\n行二内容乙\n行三内容☑丙');
    const text = strip(out);
    expect(text).toContain('行一内容甲');
    expect(text).toContain('行二内容乙');
    expect(text).toContain('行三内容');
    expect(text).toContain('丙');
    expect((out.match(/<w:br\/>/g) ?? []).length).toBe(2);
    expect(out).toContain('Segoe UI Symbol');
  });

  it('glyph 开头：run 重建不产生空前缀 run，后续行齐全', () => {
    const out = renderWith('☑起始\n次行内容');
    const text = strip(out);
    expect(text).toContain('起始');
    expect(text).toContain('次行内容');
    expect(out).not.toMatch(/<w:r>(?:<w:rPr>[\s\S]*?<\/w:rPr>)?<\/w:r>/); // 无空 run
    expect(out).toContain('Segoe UI Symbol');
  });

  it('glyph 结尾：尾段文本保留、无悬空丢弃', () => {
    const out = renderWith('首行内容\n尾段文☑本尾');
    const text = strip(out);
    expect(text).toContain('首行内容');
    expect(text).toContain('尾段文');
    expect(text).toContain('本尾');
    expect(out).toContain('Segoe UI Symbol');
  });

  it('多 glyph 与 br 交错：两个符号 run、四段文本、两处 br', () => {
    const out = renderWith('甲☑乙\n丙☑丁');
    const text = strip(out);
    for (const t of ['甲', '乙', '丙', '丁']) expect(text).toContain(t);
    expect((out.match(/<w:br\/>/g) ?? []).length).toBe(1);
    // 每个符号 run 的 rPr 含 4 处字体名（ascii/hAnsi/eastAsia/cs）——按 run 数计 2
    expect((out.match(/Segoe UI Symbol/g) ?? []).length).toBe(8);
  });

  it('无 rPr run：rPr 缺失时 body 解析不吞内容', () => {
    const out = renderWith('行一\n行二☑尾', '<w:t>{{MARK}}</w:t>');
    const text = strip(out);
    expect(text).toContain('行一');
    expect(text).toContain('行二');
    expect(text).toContain('尾');
    expect(out).toContain('Segoe UI Symbol');
  });

  it('无 glyph 的多段层级文本：输出零扰动（不注入符号 run）', () => {
    const out = renderWith('甲段\n乙段');
    const text = strip(out);
    expect(text).toContain('甲段');
    expect(text).toContain('乙段');
    expect(out).not.toContain('Segoe UI Symbol');
    expect((out.match(/<w:br\/>/g) ?? []).length).toBe(1);
  });

  it('xml:space 属性保留：含前后空格的多段文本不丢空格标记', () => {
    const out = renderWith('  行一  \n  行二☑  ', `${RPR}<w:t xml:space="preserve">{{MARK}}</w:t>`);
    expect(out).toContain('行一');
    expect(out).toContain('行二');
    // 重建的文本 run 保留原 <w:t> 开标（含 xml:space）
    expect(out).toContain('xml:space="preserve"');
  });
});
