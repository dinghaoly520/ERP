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
