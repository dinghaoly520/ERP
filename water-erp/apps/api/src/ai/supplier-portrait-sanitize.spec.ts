import { stripFieldEchoes } from './supplier-portrait-analysis.service';

/** 综合分析报告英文字段名清洗（2026-11-16 用户裁定：同进度洞察禁英文字符串） */
describe('stripFieldEchoes（画像报告文案清洗）', () => {
  it('camelCase 字段名剥除（含后随连接词），ALLCAPS/纯小写/等级字母不误伤', () => {
    expect(stripFieldEchoes('该供应商finalGrade为A，表现稳定', [])).toBe('该供应商A，表现稳定');
    expect(stripFieldEchoes('finalGrade: A、complianceGrade 是 B', []).trim()).toBe('A、 B');
    // 数据值形态天然不命中（小写开头+大写驼峰才是字段名）
    expect(stripFieldEchoes('信用代码 91510100MA6AK54X9 有效', [])).toBe('信用代码 91510100MA6AK54X9 有效');
    expect(stripFieldEchoes('经营范围含 water pump 设备销售', [])).toBe('经营范围含 water pump 设备销售');
    expect(stripFieldEchoes('评价等级 A 级占比 60%', [])).toBe('评价等级 A 级占比 60%');
  });

  it('已知数据值占位保护——供应商名/信用代码含驼峰片段也不清洗', () => {
    expect(
      stripFieldEchoes('供应商 AIoT Solutions 公司资质齐全', ['AIoT Solutions']),
    ).toBe('供应商 AIoT Solutions 公司资质齐全');
  });

  it('纯中文零改动', () => {
    expect(stripFieldEchoes('资质总数 12 项，其中有效 9 项、即将到期 2 项。', [])).toBe('资质总数 12 项，其中有效 9 项、即将到期 2 项。');
  });
});
