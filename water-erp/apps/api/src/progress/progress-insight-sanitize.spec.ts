import { stripEnglishFieldLeaks } from './progress.service';

/** 洞察正文英文字段名清洗（2026-11-16 用户裁定：进度洞察禁英文字符串） */
describe('stripEnglishFieldLeaks（进度洞察文案清洗）', () => {
  it('daysSinceUpdate 专项改写：为 0 → 今天有更新；为 N → N天未更新', () => {
    expect(stripEnglishFieldLeaks('近3天16个项目均有更新（daysSinceUpdate为0）', [])).toBe('近3天16个项目均有更新（今天有更新）');
    expect(stripEnglishFieldLeaks('daysSinceUpdate为 3，需关注', [])).toBe('3天未更新，需关注');
    expect(stripEnglishFieldLeaks('daysSinceUpdate=12', [])).toBe('12天未更新');
  });

  it('其余英文字段名/代码标识直接剥除，中文语义保留', () => {
    expect(stripEnglishFieldLeaks('本月 totalActive 4 个、monthlyCompleted 为 0', [])).toBe('本月 4 个、0');
    expect(stripEnglishFieldLeaks('camelCase 与 snake_case 字段都不出现', [])).toBe(' 与 字段都不出现');
  });

  it('真实项目名内的英文受保护不清洗（项目名是用户数据）', () => {
    expect(
      stripEnglishFieldLeaks('AI辅助的XYZ系统采购项目推进中（daysSinceUpdate为0）', ['AI辅助的XYZ系统采购项目']),
    ).toBe('AI辅助的XYZ系统采购项目推进中（今天有更新）');
  });

  it('纯中文文本零改动', () => {
    expect(stripEnglishFieldLeaks('开标评标阶段聚集7个项目占44%', [])).toBe('开标评标阶段聚集7个项目占44%');
  });
});
