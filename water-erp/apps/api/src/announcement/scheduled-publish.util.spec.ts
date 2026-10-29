import { normalizeScheduledPublishDate, parseScheduledPublishDate, normalizeScheduledPublishMetadata } from './scheduled-publish.util';

describe('scheduled-publish 时区归一（2026-10-29 审计 C）', () => {
  it('无时区 datetime-local 值补 +08:00', () => {
    expect(normalizeScheduledPublishDate('2026-10-29T09:45')).toBe('2026-10-29T09:45+08:00');
    expect(normalizeScheduledPublishDate('2026-10-29T09:45:30')).toBe('2026-10-29T09:45:30+08:00');
    expect(normalizeScheduledPublishDate('2026-10-29T09:45:30.123')).toBe('2026-10-29T09:45:30.123+08:00');
  });

  it('已带偏移/Z/纯日期/非法值原样放行', () => {
    expect(normalizeScheduledPublishDate('2026-10-29T09:45+08:00')).toBe('2026-10-29T09:45+08:00');
    expect(normalizeScheduledPublishDate('2026-10-29T01:45:00.000Z')).toBe('2026-10-29T01:45:00.000Z');
    expect(normalizeScheduledPublishDate('2026-10-29')).toBe('2026-10-29');
    expect(normalizeScheduledPublishDate(undefined)).toBeUndefined();
    expect(normalizeScheduledPublishDate(123)).toBe(123);
  });

  it('解析：无时区值按东八区（与 UTC 值等价换算），非法/缺失返回 null', () => {
    // 09:45+08:00 == 01:45Z
    expect(parseScheduledPublishDate('2026-10-29T09:45')?.toISOString()).toBe('2026-10-29T01:45:00.000Z');
    expect(parseScheduledPublishDate('2026-10-29T01:45:00.000Z')?.toISOString()).toBe('2026-10-29T01:45:00.000Z');
    expect(parseScheduledPublishDate('garbage')).toBeNull();
    expect(parseScheduledPublishDate('')).toBeNull();
    expect(parseScheduledPublishDate(undefined)).toBeNull();
    expect(parseScheduledPublishDate(null)).toBeNull();
  });

  it('metadata 整体归一：只动 scheduledPublishDate，其余键与无定时对象原样', () => {
    const meta = { visibility: 'PUBLIC', scheduledPublishDate: '2026-10-29T09:45', changes: 'x' };
    expect(normalizeScheduledPublishMetadata(meta)).toEqual({ visibility: 'PUBLIC', scheduledPublishDate: '2026-10-29T09:45+08:00', changes: 'x' });
    const untouched = { visibility: 'PUBLIC' };
    expect(normalizeScheduledPublishMetadata(untouched)).toBe(untouched); // 无定时键不复制
    const zForm = { scheduledPublishDate: '2026-10-29T01:45:00.000Z' };
    expect(normalizeScheduledPublishMetadata(zForm)).toEqual({ scheduledPublishDate: '2026-10-29T01:45:00.000Z' });
  });
});
