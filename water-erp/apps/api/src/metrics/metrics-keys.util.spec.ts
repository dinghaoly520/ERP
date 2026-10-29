import { dayKey, minuteKey } from './metrics-keys.util';

describe('metrics-keys', () => {
  it('minuteKey 补零到分钟（本地时间）', () => {
    expect(minuteKey(new Date(2026, 9, 28, 8, 5))).toBe('202610280805');
  });
  it('dayKey 是 minuteKey 前 8 位', () => {
    const d = new Date(2026, 9, 28, 8, 5);
    expect(dayKey(d)).toBe(minuteKey(d).slice(0, 8));
  });
});
