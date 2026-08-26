import { BadRequestException } from '@nestjs/common';
import { assertBidNoticeTiming, minLegalOpeningTime, shiftPastStatutoryHolidays } from './bid-timing-rules';

const D = (iso: string) => new Date(iso);

describe('bid-timing-rules（CTS-EBS01 B-004/B-009）', () => {
  const expectThrow = (fn: () => unknown, code: string) => {
    try { fn(); fail(`应抛 ${code}`); } catch (e) {
      expect(e).toBeInstanceOf(BadRequestException);
      expect((e as BadRequestException).getResponse()).toMatchObject({ code });
    }
  };

  it('B-004：售标开始→开标满 20 日放行；19 日拒绝 BID_TIMING_20D', () => {
    expect(() => assertBidNoticeTiming({
      saleStart: D('2026-09-01T00:00:00Z'), openTime: D('2026-09-21T00:00:00Z'), legalMandatory: true,
    })).not.toThrow();
    expectThrow(() => assertBidNoticeTiming({
      saleStart: D('2026-09-01T00:00:00Z'), openTime: D('2026-09-20T23:59:59Z'), legalMandatory: true,
    }), 'BID_TIMING_20D');
  });

  it('B-004 节假日顺延：第 20 日落在法定节假日 → 顺延至节后首个工作日才放行', () => {
    // 2026-10-01～10-07 国庆：9/11+20d=10/1 → 顺延至 10/8；开标 10/7 应拒、10/8 应过
    const saleStart = D('2026-09-11T00:00:00Z');
    expect(minLegalOpeningTime(saleStart).toISOString().slice(0, 10)).toBe('2026-10-08');
    expectThrow(() => assertBidNoticeTiming({
      saleStart, openTime: D('2026-10-07T00:00:00Z'), legalMandatory: true,
    }), 'BID_TIMING_20D');
    expect(() => assertBidNoticeTiming({
      saleStart, openTime: D('2026-10-08T00:00:00Z'), legalMandatory: true,
    })).not.toThrow();
  });

  it('B-009：发售期满 5 日放行；不足 5 日拒绝 BID_TIMING_5D', () => {
    expect(() => assertBidNoticeTiming({
      saleStart: D('2026-09-01T00:00:00Z'), openTime: D('2026-09-26T00:00:00Z'),
      saleEnd: D('2026-09-06T00:00:00Z'), legalMandatory: true,
    })).not.toThrow();
    expectThrow(() => assertBidNoticeTiming({
      saleStart: D('2026-09-01T00:00:00Z'), openTime: D('2026-09-26T00:00:00Z'),
      saleEnd: D('2026-09-05T23:59:59Z'), legalMandatory: true,
    }), 'BID_TIMING_5D');
  });

  it('legalMandatory=false：不抛错，violated 时返回 deviated=true（供留痕）', () => {
    const r = assertBidNoticeTiming({
      saleStart: D('2026-09-01T00:00:00Z'), openTime: D('2026-09-10T00:00:00Z'), legalMandatory: false,
    });
    expect(r).toMatchObject({ violated: true, deviated: true });
    const ok = assertBidNoticeTiming({
      saleStart: D('2026-09-01T00:00:00Z'), openTime: D('2026-09-21T00:00:00Z'), legalMandatory: false,
    });
    expect(ok).toMatchObject({ violated: false, deviated: false });
  });

  it('缺时间（openTime/saleStart 为空）→ 跳过校验不误伤', () => {
    expect(() => assertBidNoticeTiming({ saleStart: null, openTime: null, legalMandatory: true })).not.toThrow();
  });

  it('shiftPastStatutoryHolidays：普通周末不顺延（规范仅法定节假日）', () => {
    // 2026-09-19 周六、非法定节假日 → 不顺延
    expect(shiftPastStatutoryHolidays(D('2026-09-19T00:00:00Z')).toISOString().slice(0, 10)).toBe('2026-09-19');
  });
});

import { ForbiddenException } from '@nestjs/common';
import { assertMinAcceptedInvitees } from './bid-timing-rules';

describe('B-006 邀请对象 ≥3 家闸门（W3）', () => {
  const ok = () => expect(true).toBe(true);
  it('邀请类项目已接受 <3 家 → 409 INSUFFICIENT_INVITEES', () => {
    try {
      assertMinAcceptedInvitees({ procurementMethod: '邀请招标', acceptedCount: 2 });
      fail('应当抛');
    } catch (e) {
      expect(e).toBeInstanceOf(ForbiddenException);
      expect((e as ForbiddenException).getResponse()).toMatchObject({ code: 'INSUFFICIENT_INVITEES' });
    }
  });
  it('已接受 3 家放行；公开招标不设闸', () => {
    expect(() => assertMinAcceptedInvitees({ procurementMethod: '邀请招标', acceptedCount: 3 })).not.toThrow();
    expect(() => assertMinAcceptedInvitees({ procurementMethod: '公开招标', acceptedCount: 0 })).not.toThrow();
  });
});
