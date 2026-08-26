import { BadRequestException } from '@nestjs/common';
import {
  CLARIFY_ASK_MIN_DAYS_BEFORE_DEADLINE,
  CLARIFY_ISSUE_MIN_DAYS_BEFORE_DEADLINE,
} from '@water-erp/shared';

const DAY_MS = 24 * 3_600_000;

function latestAt(deadline: Date, days: number): Date {
  return new Date(deadline.getTime() - days * DAY_MS);
}

/** B-011：供应商澄清提问窗口（投标截止前 10 日，边界含等值）。 */
export function assertAskWithinWindow(deadline: Date, now: Date = new Date()): void {
  const latest = latestAt(deadline, CLARIFY_ASK_MIN_DAYS_BEFORE_DEADLINE);
  if (now.getTime() > latest.getTime()) {
    throw new BadRequestException({
      error: `澄清提问最迟须在投标截止前 ${CLARIFY_ASK_MIN_DAYS_BEFORE_DEADLINE} 日（${latest.toISOString()}）提出，现已逾期`,
      code: 'CLARIFY_ASK_LATE',
    });
  }
}

/** B-012：澄清与修改文件发布窗口（投标截止前 15 日，边界含等值）。 */
export function assertIssueWithinWindow(deadline: Date, now: Date = new Date()): void {
  const latest = latestAt(deadline, CLARIFY_ISSUE_MIN_DAYS_BEFORE_DEADLINE);
  if (now.getTime() > latest.getTime()) {
    throw new BadRequestException({
      error: `澄清与修改文件最迟须在投标截止前 ${CLARIFY_ISSUE_MIN_DAYS_BEFORE_DEADLINE} 日（${latest.toISOString()}）发布，现已逾期`,
      code: 'CLARIFY_ISSUE_LATE',
    });
  }
}
