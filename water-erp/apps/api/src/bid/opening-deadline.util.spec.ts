import {
  assertOpeningDeadlineRelation, deriveDeadlineFromOpenTime, deriveOpenTimeFromDeadline, modeFor,
} from './opening-deadline.util';
import { BID_DEADLINE_BEFORE_OPENING_MS } from '@water-erp/shared';

describe('opening-deadline.util', () => {
  const base = new Date('2026-09-01T10:00:00Z');

  it('align：合规（deadline = openTime − 24h）不抛', () => {
    expect(() => assertOpeningDeadlineRelation({
      openTime: base, deadline: new Date(base.getTime() - BID_DEADLINE_BEFORE_OPENING_MS), mode: 'align',
    })).not.toThrow();
  });
  it('align：差 23h → DEADLINE_OPENING_GAP_INVALID 且 error 含期望值', () => {
    expect(() => assertOpeningDeadlineRelation({
      openTime: base, deadline: new Date(base.getTime() - 23 * 3_600_000), mode: 'align',
    })).toThrow(expect.objectContaining({ response: expect.objectContaining({ code: 'DEADLINE_OPENING_GAP_INVALID' }) }));
  });
  it('align：差 25h → 同码', () => {
    expect(() => assertOpeningDeadlineRelation({
      openTime: base, deadline: new Date(base.getTime() - 25 * 3_600_000), mode: 'align',
    })).toThrow(expect.objectContaining({ response: expect.objectContaining({ code: 'DEADLINE_OPENING_GAP_INVALID' }) }));
  });
  it('align：±1min 容差边界（差 24h+50s → 合规；差 24h+70s → 400）', () => {
    const ok = new Date(base.getTime() - BID_DEADLINE_BEFORE_OPENING_MS - 50_000);
    const bad = new Date(base.getTime() - BID_DEADLINE_BEFORE_OPENING_MS - 70_000);
    expect(() => assertOpeningDeadlineRelation({ openTime: base, deadline: ok, mode: 'align' })).not.toThrow();
    expect(() => assertOpeningDeadlineRelation({ openTime: base, deadline: bad, mode: 'align' })).toThrow();
  });
  it('derive 双向：roundtrip（deriveDeadlineFromOpenTime → deriveOpenTimeFromDeadline 回原值）', () => {
    expect(deriveOpenTimeFromDeadline(deriveDeadlineFromOpenTime(base)).getTime()).toBe(base.getTime());
  });
  it('frozen：deadline 传值与 prev 不同 → DEADLINE_FROZEN', () => {
    const prev = { openTime: base, deadline: new Date(base.getTime() - BID_DEADLINE_BEFORE_OPENING_MS) };
    expect(() => assertOpeningDeadlineRelation({
      openTime: base, deadline: new Date(prev.deadline.getTime() + 1), prev, mode: 'frozen',
    })).toThrow(expect.objectContaining({ response: expect.objectContaining({ code: 'DEADLINE_FROZEN' }) }));
  });
  it('frozen：openTime < deadline + 24h → DEADLINE_OPENING_GAP_INVALID；openTime 延后合规', () => {
    const prev = { openTime: base, deadline: new Date(base.getTime() - BID_DEADLINE_BEFORE_OPENING_MS) };
    expect(() => assertOpeningDeadlineRelation({
      openTime: new Date(base.getTime() - 3_600_000), deadline: prev.deadline, prev, mode: 'frozen',
    })).toThrow(expect.objectContaining({ response: expect.objectContaining({ code: 'DEADLINE_OPENING_GAP_INVALID' }) }));
    expect(() => assertOpeningDeadlineRelation({
      openTime: new Date(base.getTime() + 2 * BID_DEADLINE_BEFORE_OPENING_MS), deadline: prev.deadline, prev, mode: 'frozen',
    })).not.toThrow();
  });
  it('modeFor：prev.deadline 已过 → frozen；未过/无 prev → align', () => {
    const past = new Date(Date.now() - 3_600_000);
    const future = new Date(Date.now() + 3_600_000);
    expect(modeFor(past)).toBe('frozen');
    expect(modeFor(future)).toBe('align');
    expect(modeFor(undefined)).toBe('align');
  });
});
