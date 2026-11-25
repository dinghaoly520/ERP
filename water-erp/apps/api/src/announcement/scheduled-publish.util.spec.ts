import { normalizeScheduledPublishDate, parseScheduledPublishDate, normalizeScheduledPublishMetadata, isPendingScheduledDraft, scheduledDuplicateKey, formatScheduledPublishDate } from './scheduled-publish.util';

describe('待发定时草稿互斥键（2026-11-24 生产实录：同项目两条定时草稿到点各发一条）', () => {
  it('互斥键 = 项目编号 + 公告类型', () => {
    expect(scheduledDuplicateKey({ type: 'BID_NOTICE', relatedProjectCode: 'SWHI-XB-2026112302', metadata: {} })).toBe('SWHI-XB-2026112302|BID_NOTICE');
  });

  it('项目编号首尾空白不产生第二个键（否则同项目两条草稿被当成不冲突）', () => {
    expect(scheduledDuplicateKey({ type: 'BID_NOTICE', relatedProjectCode: '  SWHI-XB-2026112302 ' })).toBe('SWHI-XB-2026112302|BID_NOTICE');
  });

  it('变更/补遗带轮次：同项目不同轮次的变更公告合法并存，不得互斥', () => {
    expect(scheduledDuplicateKey({ type: 'CHANGE_NOTICE', relatedProjectCode: 'P1', metadata: { changeRound: '1' } })).toBe('P1|CHANGE_NOTICE|r1');
    expect(scheduledDuplicateKey({ type: 'CHANGE_NOTICE', relatedProjectCode: 'P1', metadata: { changeRound: 2 } })).toBe('P1|CHANGE_NOTICE|r2');
    expect(scheduledDuplicateKey({ type: 'ADDENDUM', relatedProjectCode: 'P1', metadata: { changeRound: '3' } })).toBe('P1|ADDENDUM|r3');
  });

  it('变更/补遗无轮次或轮次非法 → 空轮次键（同项目两条无轮次变更草稿仍互斥）', () => {
    expect(scheduledDuplicateKey({ type: 'CHANGE_NOTICE', relatedProjectCode: 'P1', metadata: { changeRound: 'x' } })).toBe('P1|CHANGE_NOTICE|');
    expect(scheduledDuplicateKey({ type: 'CHANGE_NOTICE', relatedProjectCode: 'P1' })).toBe('P1|CHANGE_NOTICE|');
  });

  it('非变更/补遗类型不看 changeRound（采购公告携带无关键不改变互斥键）', () => {
    expect(scheduledDuplicateKey({ type: 'BID_NOTICE', relatedProjectCode: 'P1', metadata: { changeRound: '2' } })).toBe('P1|BID_NOTICE');
  });

  it('无项目编号（手工公告）→ null：不参与互斥', () => {
    expect(scheduledDuplicateKey({ type: 'POLICY', relatedProjectCode: null })).toBeNull();
    expect(scheduledDuplicateKey({ type: 'BID_NOTICE', relatedProjectCode: '   ' })).toBeNull();
  });
});

describe('待发定时草稿判定', () => {
  it('DRAFT + 可解析定时时刻 → 待发（ISO 与无时区 datetime-local 同口径）', () => {
    expect(isPendingScheduledDraft({ status: 'DRAFT', metadata: { scheduledPublishDate: '2099-01-01T09:00' } })).toBe(true);
    expect(isPendingScheduledDraft({ status: 'DRAFT', metadata: { scheduledPublishDate: '2099-01-01T01:00:00.000Z' } })).toBe(true);
  });

  it('无定时键 / 非法定时值 / 非 DRAFT → 不是待发（普通草稿与已发布公告不参与互斥）', () => {
    expect(isPendingScheduledDraft({ status: 'DRAFT', metadata: {} })).toBe(false);
    expect(isPendingScheduledDraft({ status: 'DRAFT', metadata: null })).toBe(false);
    expect(isPendingScheduledDraft({ status: 'DRAFT', metadata: { scheduledPublishDate: 'garbage' } })).toBe(false);
    expect(isPendingScheduledDraft({ status: 'PUBLISHED', metadata: { scheduledPublishDate: '2099-01-01T09:00' } })).toBe(false);
    expect(isPendingScheduledDraft({ status: 'HIDDEN', metadata: { scheduledPublishDate: '2099-01-01T09:00' } })).toBe(false);
  });
});

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

describe('定时时刻回显（拒绝/查重提示用）', () => {
  it('按东八区回显为「月-日 时:分」——无时区值与 UTC 值同口径（按服务器时区格式化会在 UTC 容器里晚 8 小时）', () => {
    expect(formatScheduledPublishDate('2026-11-24T09:00+08:00')).toBe('11-24 09:00');
    expect(formatScheduledPublishDate('2026-11-24T09:00')).toBe('11-24 09:00');
    expect(formatScheduledPublishDate('2026-11-24T01:00:00.000Z')).toBe('11-24 09:00');
  });

  it('缺失/非法 → null', () => {
    expect(formatScheduledPublishDate('garbage')).toBeNull();
    expect(formatScheduledPublishDate(undefined)).toBeNull();
  });
});
