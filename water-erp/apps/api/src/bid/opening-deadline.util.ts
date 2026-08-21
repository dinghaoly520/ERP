import { BadRequestException } from '@nestjs/common';
import { BID_DEADLINE_BEFORE_OPENING_MS, BID_OPENING_GAP_TOLERANCE_MS } from '@water-erp/shared';

export type DeadlineOpenMode = 'align' | 'frozen';

export function deriveDeadlineFromOpenTime(openTime: Date): Date {
  return new Date(openTime.getTime() - BID_DEADLINE_BEFORE_OPENING_MS);
}
export function deriveOpenTimeFromDeadline(deadline: Date): Date {
  return new Date(deadline.getTime() + BID_DEADLINE_BEFORE_OPENING_MS);
}
export function modeFor(prevDeadline: Date | undefined, now: Date = new Date()): DeadlineOpenMode {
  return prevDeadline && prevDeadline.getTime() < now.getTime() ? 'frozen' : 'align';
}

export function assertOpeningDeadlineRelation(opts: {
  openTime: Date; deadline: Date; prev?: { openTime: Date; deadline: Date }; mode: DeadlineOpenMode;
}): void {
  const { openTime, deadline, prev, mode } = opts;
  if (mode === 'frozen') {
    if (prev && deadline.getTime() !== prev.deadline.getTime()) {
      throw new BadRequestException({ error: '截标时间已固化，不得变更', code: 'DEADLINE_FROZEN' });
    }
    if (openTime.getTime() < deadline.getTime() + BID_DEADLINE_BEFORE_OPENING_MS) {
      throw new BadRequestException({
        error: `开标时间须不早于截标后 24 小时（期望 ≥ ${deriveOpenTimeFromDeadline(deadline).toISOString()}）`,
        code: 'DEADLINE_OPENING_GAP_INVALID',
      });
    }
    return;
  }
  const expected = deriveDeadlineFromOpenTime(openTime).getTime();
  if (Math.abs(deadline.getTime() - expected) > BID_OPENING_GAP_TOLERANCE_MS) {
    throw new BadRequestException({
      error: `截标须为开标前 24 小时（期望 deadline = ${new Date(expected).toISOString()}）`,
      code: 'DEADLINE_OPENING_GAP_INVALID',
    });
  }
}
