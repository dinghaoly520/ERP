import { stripMojibake, stripMojibakeDeep } from './text-clean.util';

/** 替换符剔除（2026-10-15 公告「重大税���违法失信主体」实录的根修工具） */
describe('text-clean.util', () => {
  it('剔除连续替换符，其余内容原样保留', () => {
    expect(stripMojibake('重大税���违法失信主体')).toBe('重大税违法失信主体');
    expect(stripMojibake('��调试��正常��')).toBe('调试正常');
  });

  it('无替换符即原样返回（含空串，零拷贝语义）', () => {
    expect(stripMojibake('正常文本')).toBe('正常文本');
    expect(stripMojibake('')).toBe('');
  });

  it('递归清洗对象/数组内的字符串值，非字符串类型不动', () => {
    const out = stripMojibakeDeep({
      a: '税���违法',
      b: [{ c: '正常' }, { d: '���' }],
      n: 42,
      ok: null,
    });
    expect(out).toEqual({ a: '税违法', b: [{ c: '正常' }, { d: '' }], n: 42, ok: null });
  });
});

/** 软换行合并（2026-10-20 公告词中断行根修）：PDF 解析字段里的句中硬换行（「勘察设\n计」）合并复原 */
describe('joinSoftWrappedLines', () => {
  const { joinSoftWrappedLines } = require('./text-clean.util');

  it('合并 CJK 词中软换行（无空格）', () => {
    expect(joinSoftWrappedLines('熟悉规范，勘察设\n计资料采购，具备资质。')).toBe('熟悉规范，勘察设计资料采购，具备资质。');
    expect(joinSoftWrappedLines('委托乙方提供培\n训服务。\n按课程结算。')).toBe('委托乙方提供培训服务。\n按课程结算。');
  });

  it('句末标点后的换行保留（合法段落/句子边界）', () => {
    const text = '服务期两年。\n包含水电维修。；分号后；\n下一句';
    expect(joinSoftWrappedLines(text)).toBe(text.replace('；\n', '；\n')); // 全保留
    expect(joinSoftWrappedLines('第一段。\n第二段。')).toBe('第一段。\n第二段。');
  });

  it('行首为序号/项目符号的换行保留（列表结构）', () => {
    expect(joinSoftWrappedLines('要求如下：\n1、具备资质\n2、近5年业绩')).toBe('要求如下：\n1、具备资质\n2、近5年业绩');
    expect(joinSoftWrappedLines('包括：\n（一）事项一\n（二）事项二')).toBe('包括：\n（一）事项一\n（二）事项二');
  });

  it('ASCII 词中断行合并（补空格），ASCII↔CJK 合并无空格', () => {
    expect(joinSoftWrappedLines('符合 GB/T 33870-20\n17 要求')).toBe('符合 GB/T 33870-2017 要求');
    expect(joinSoftWrappedLines('技术规范GB\n/T 33870')).toBe('技术规范GB/T 33870');
    expect(joinSoftWrappedLines('使用 water\nerp 系统')).toBe('使用 water erp 系统');
  });

  it('空行（段落边界）保留', () => {
    expect(joinSoftWrappedLines('段落一。\n\n段落二。')).toBe('段落一。\n\n段落二。');
  });

  it('无换行文本原样返回', () => {
    expect(joinSoftWrappedLines('正常文本。')).toBe('正常文本。');
  });
});
