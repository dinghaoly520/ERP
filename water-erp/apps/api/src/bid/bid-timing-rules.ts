import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { DOC_SALE_MIN_DAYS, SALE_TO_OPENING_MIN_DAYS } from '@water-erp/shared';

/**
 * W2 招投标时间规则引擎（CTS-EBS01 附录B）：
 * - B-004：招标文件出售开始→开标 ≥20 日；最后一天为法定节假日的，顺延至节后首个工作日
 * - B-009：招标文件发售期 ≥5 日
 * 规则仅对「依法必招」项目强制（legalMandatory），非依法必招项目放行并在实际偏离时
 * 返回 deviated 供调用方写监督日志留痕（延续 24h 规则的偏离留痕先例）。
 */

/** 中国法定节假日（调休放假日，不含普通周末）——2026~2028，逐年维护 */
const CN_STATUTORY_HOLIDAYS: ReadonlySet<string> = new Set([
  // 2026
  '2026-01-01', '2026-01-02',
  '2026-02-16', '2026-02-17', '2026-02-18', '2026-02-19', '2026-02-20', '2026-02-21', '2026-02-22',
  '2026-04-04', '2026-04-05', '2026-04-06',
  '2026-05-01', '2026-05-02', '2026-05-03',
  '2026-06-19', '2026-06-20', '2026-06-21',
  '2026-09-25', '2026-09-26', '2026-09-27',
  '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07',
  // 2027（按惯例预置，国务院通知下发后校正）
  '2027-01-01', '2027-01-02', '2027-01-03',
  '2027-02-15', '2027-02-16', '2027-02-17', '2027-02-18', '2027-02-19', '2027-02-20', '2027-02-21',
  '2027-04-04', '2027-04-05', '2027-04-06',
  '2027-05-01', '2027-05-02', '2027-05-03',
  '2027-06-18', '2027-06-19', '2027-06-20',
  '2027-09-24', '2027-09-25', '2027-09-26',
  '2027-10-01', '2027-10-02', '2027-10-03', '2027-10-04', '2027-10-05', '2027-10-06', '2027-10-07',
  // 2028
  '2028-01-01', '2028-01-02', '2028-01-03',
  '2028-02-11', '2028-02-12', '2028-02-13', '2028-02-14', '2028-02-15', '2028-02-16', '2028-02-17',
  '2028-04-03', '2028-04-04', '2028-04-05',
  '2028-05-01', '2028-05-02', '2028-05-03',
  '2028-06-16', '2028-06-17', '2028-06-18',
  '2028-09-22', '2028-09-23', '2028-09-24',
  '2028-10-01', '2028-10-02', '2028-10-03', '2028-10-04', '2028-10-05', '2028-10-06', '2028-10-07',
]);

const isoDay = (d: Date) => d.toISOString().slice(0, 10);

/** B-004 顺延规则：日期落在法定节假日 → 逐日顺延至节后首个工作日（普通周末不顺延，按规范字面）。 */
export function shiftPastStatutoryHolidays(d: Date): Date {
  let cur = new Date(d.getTime());
  while (CN_STATUTORY_HOLIDAYS.has(isoDay(cur))) {
    cur = new Date(cur.getTime() + 24 * 3_600_000);
  }
  return cur;
}

/** 最早合法开标时间 = 售标开始 + 20 日，再跨法定节假日顺延。 */
export function minLegalOpeningTime(saleStart: Date): Date {
  return shiftPastStatutoryHolidays(new Date(saleStart.getTime() + SALE_TO_OPENING_MIN_DAYS * 24 * 3_600_000));
}

export interface BidNoticeTimingInput {
  /** 售标开始（采购公告发布时间） */
  saleStart: Date | null | undefined;
  openTime: Date | null | undefined;
  /** 发售截止（下载截止或投标截止） */
  saleEnd?: Date | null | undefined;
  legalMandatory: boolean;
}

export interface BidNoticeTimingResult {
  violated: boolean;
  deviated: boolean;
  rule?: 'B-004' | 'B-009';
}

/**
 * 公告发布时间规则校验。
 * - legalMandatory=true 且违规 → 抛 BadRequestException（code=BID_TIMING_20D / BID_TIMING_5D）
 * - legalMandatory=false → 不抛；实际违规时返回 deviated=true（调用方写监督日志留痕）
 * - 时间缺失 → 跳过对应规则（不误伤元数据不全的存量流程）
 */
export function assertBidNoticeTiming(input: BidNoticeTimingInput): BidNoticeTimingResult {
  // B-004：售标开始 → 开标 ≥20 日（节假日顺延）
  if (input.saleStart && input.openTime) {
    const minOpening = minLegalOpeningTime(input.saleStart);
    if (input.openTime.getTime() < minOpening.getTime()) {
      if (input.legalMandatory) {
        throw new BadRequestException({
          error: `依法必招项目：招标文件出售开始至开标须不少于 ${SALE_TO_OPENING_MIN_DAYS} 日（最早开标 ${minOpening.toISOString().slice(0, 10)}，含法定节假日顺延）`,
          code: 'BID_TIMING_20D',
        });
      }
      return { violated: true, deviated: true, rule: 'B-004' };
    }
  }
  // B-009：发售期 ≥5 日
  if (input.saleStart && input.saleEnd) {
    const minDaysMs = DOC_SALE_MIN_DAYS * 24 * 3_600_000;
    if (input.saleEnd.getTime() - input.saleStart.getTime() < minDaysMs) {
      if (input.legalMandatory) {
        throw new BadRequestException({
          error: `依法必招项目：招标文件发售期须不少于 ${DOC_SALE_MIN_DAYS} 日`,
          code: 'BID_TIMING_5D',
        });
      }
      return { violated: true, deviated: true, rule: 'B-009' };
    }
  }
  return { violated: false, deviated: false };
}

/** W3/B-006：邀请招标项目邀请对象（已接受）不足 3 家 → 阻断（409 INSUFFICIENT_INVITEES）。 */
export const MIN_INVITED_SUPPLIERS = 3;
const INVITED_METHODS = new Set(['邀请招标', '谈判采购']);

export function assertMinAcceptedInvitees(opts: { procurementMethod: string; acceptedCount: number }) {
  if (!INVITED_METHODS.has(opts.procurementMethod)) return;
  if (opts.acceptedCount < MIN_INVITED_SUPPLIERS) {
    throw new ForbiddenException({
      error: `邀请类采购须至少 ${MIN_INVITED_SUPPLIERS} 家供应商接受邀请（当前 ${opts.acceptedCount} 家），不足不得进入投标`,
      code: 'INSUFFICIENT_INVITEES',
    });
  }
}
