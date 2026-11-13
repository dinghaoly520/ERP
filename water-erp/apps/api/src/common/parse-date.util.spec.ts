/**
 * parseFlexibleDate 时区确定性：业务墙上时间（中文日期、"2026-11-20 10:30" 等）的
 * 语义恒为北京时间，解析结果是与宿主时区无关的绝对时刻——断言 ISO 串而非本地分量，
 * 本组用例在 TZ=UTC / TZ=Asia/Shanghai 下跑必须同样成立（2026-11-09 生产 +8h 实录：
 * UTC 服务器上组件构造 new Date(y,m,d,h,min) 把 10:30 做成 10:30Z，时间轴全端 +8h）。
 */
import { parseFlexibleDate, parseFlexibleRangeEnd } from './parse-date.util';

describe('parseFlexibleRangeEnd 区间取止点（2026-11-13 实录）', () => {
  // 实录根因：PMI 懒建取下载截止 split('至') 不识别时间段选择器的连字符区间，
  // 整串落入 parseFlexibleDate 抓到区间【起点】被当成截止落列 → 详情页「下载时间已截止」误报
  it('连字符中文区间取止点（此前误取起点）', () => {
    expect(parseFlexibleRangeEnd('2026年3月20日9:00-2026年11月25日15:00')?.toISOString())
      .toBe('2026-11-25T07:00:00.000Z');
  });

  it('中文「至」区间取止点', () => {
    expect(parseFlexibleRangeEnd('2026年11月20日9:00 至 2026年11月25日15:00')?.toISOString())
      .toBe('2026-11-25T07:00:00.000Z');
  });

  it('ISO 斜杠区间不误切（内部连字符非区间分隔）', () => {
    expect(parseFlexibleRangeEnd('2026/11/20 09:00-2026/11/25 15:00')?.toISOString())
      .toBe('2026-11-25T07:00:00.000Z');
    expect(parseFlexibleRangeEnd('2026-11-20 09:00 - 2026-11-25 15:00')?.toISOString())
      .toBe('2026-11-25T07:00:00.000Z');
  });

  it('ISO 单值日期不因内部连字符被切坏', () => {
    // 关键回归防线：裸 ISO 日期含 '-'，若误切会碎成 "25 15:00" 解析失败
    expect(parseFlexibleRangeEnd('2026-11-25 15:00')?.toISOString()).toBe('2026-11-25T07:00:00.000Z');
    expect(parseFlexibleRangeEnd('2026年11月25日 15:00')?.toISOString()).toBe('2026-11-25T07:00:00.000Z');
  });

  it('空/不可解析返回 null', () => {
    expect(parseFlexibleRangeEnd(null)).toBeNull();
    expect(parseFlexibleRangeEnd('')).toBeNull();
    expect(parseFlexibleRangeEnd('随时')).toBeNull();
  });
});

describe('parseFlexibleDate 北京时间确定性', () => {
  const cases: Array<[string, string]> = [
    ['2026年11月20日 10:30', '2026-11-20T02:30:00.000Z'],
    ['2026年03月23日14:00', '2026-03-23T06:00:00.000Z'],
    ['2026年3月23日 09:00', '2026-03-23T01:00:00.000Z'],
    // 公告模板长格式 "14时00分00秒"——时分分隔符「时…分」
    ['2026年03月23日14时00分00秒', '2026-03-23T06:00:00.000Z'],
    // 无时区数字格式：new Date() 按宿主本地时区解析的陷阱形态
    ['2026-11-20 10:30', '2026-11-20T02:30:00.000Z'],
    ['2026/3/23 10:00', '2026-03-23T02:00:00.000Z'],
    ['2026-03-26T15:00', '2026-03-26T07:00:00.000Z'],
    // 纯日期 = 北京午夜（日期展示面在 +8 浏览器下同日不变）
    ['2026-11-20', '2026-11-19T16:00:00.000Z'],
    // 区间文本取首段（documentAcquireTime 常态）
    ['2026年03月23日09:00至2026年03月26日15:00', '2026-03-23T01:00:00.000Z'],
  ];

  it.each(cases)('%s → %s', (input, expected) => {
    expect(parseFlexibleDate(input)?.toISOString()).toBe(expected);
  });

  it('带显式时区的 ISO 串保留原始绝对语义', () => {
    expect(parseFlexibleDate('2026-11-20T10:30:00Z')?.toISOString()).toBe('2026-11-20T10:30:00.000Z');
    expect(parseFlexibleDate('2026-11-20T10:30:00+08:00')?.toISOString()).toBe('2026-11-20T02:30:00.000Z');
  });

  it('不可解析返回 null', () => {
    expect(parseFlexibleDate(null)).toBeNull();
    expect(parseFlexibleDate('')).toBeNull();
    expect(parseFlexibleDate('另行通知')).toBeNull();
  });
});
