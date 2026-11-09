/**
 * parseFlexibleDate 时区确定性：业务墙上时间（中文日期、"2026-11-20 10:30" 等）的
 * 语义恒为北京时间，解析结果是与宿主时区无关的绝对时刻——断言 ISO 串而非本地分量，
 * 本组用例在 TZ=UTC / TZ=Asia/Shanghai 下跑必须同样成立（2026-11-09 生产 +8h 实录：
 * UTC 服务器上组件构造 new Date(y,m,d,h,min) 把 10:30 做成 10:30Z，时间轴全端 +8h）。
 */
import { parseFlexibleDate } from './parse-date.util';

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
