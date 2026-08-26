import { BadRequestException } from '@nestjs/common';
import { assertAskWithinWindow, assertIssueWithinWindow } from './clarification-timing.util';

const DAY = 24 * 3_600_000;
const deadline = new Date('2026-09-30T10:00:00.000Z');

describe('clarification-timing.util（CTS-EBS01 B-011/B-012）', () => {
  const expectReject = (fn: () => void, code: string) => {
    try {
      fn();
      fail(`应当抛 ${code}`);
    } catch (e) {
      expect(e).toBeInstanceOf(BadRequestException);
      expect((e as BadRequestException).getResponse()).toMatchObject({ code });
    }
  };

  it('B-011：截止前 11 日提问放行', () => {
    expect(() => assertAskWithinWindow(deadline, new Date(deadline.getTime() - 11 * DAY))).not.toThrow();
  });

  it('B-011：截止前 10 日整点为边界放行', () => {
    expect(() => assertAskWithinWindow(deadline, new Date(deadline.getTime() - 10 * DAY))).not.toThrow();
  });

  it('B-011：截止前 9 日提问拒绝 CLARIFY_ASK_LATE', () => {
    expectReject(() => assertAskWithinWindow(deadline, new Date(deadline.getTime() - 9 * DAY)), 'CLARIFY_ASK_LATE');
  });

  it('B-012：截止前 16 日发布放行', () => {
    expect(() => assertIssueWithinWindow(deadline, new Date(deadline.getTime() - 16 * DAY))).not.toThrow();
  });

  it('B-012：截止前 15 日整点为边界放行', () => {
    expect(() => assertIssueWithinWindow(deadline, new Date(deadline.getTime() - 15 * DAY))).not.toThrow();
  });

  it('B-012：截止前 14 日发布拒绝 CLARIFY_ISSUE_LATE', () => {
    expectReject(() => assertIssueWithinWindow(deadline, new Date(deadline.getTime() - 14 * DAY)), 'CLARIFY_ISSUE_LATE');
  });
});
