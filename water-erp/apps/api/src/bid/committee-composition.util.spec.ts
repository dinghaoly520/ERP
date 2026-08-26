import { BadRequestException } from '@nestjs/common';
import { assertCommitteeComposition, isWaterProject, MIN_COMMITTEE_DEFAULT, MIN_COMMITTEE_WATER } from './committee-composition.util';

/** W5（CTS B-020/021/022）：评标委员会组成法定校验——参数化（默认 5 / 水利 7） */
describe('committee-composition.util', () => {
  const expectCode = (fn: () => unknown, code: string) => {
    try { fn(); fail(`应抛 ${code}`); } catch (e) {
      expect(e).toBeInstanceOf(BadRequestException);
      expect((e as BadRequestException).getResponse()).toMatchObject({ code });
    }
  };

  it('默认门槛 5：4 人 INSUFFICIENT、5 人通过、6 人 EVEN', () => {
    expectCode(() => assertCommitteeComposition({ confirmed: 4, representatives: 0 }), 'INSUFFICIENT_COMMITTEE_SIZE');
    expect(() => assertCommitteeComposition({ confirmed: 5, representatives: 0 })).not.toThrow();
    expectCode(() => assertCommitteeComposition({ confirmed: 6, representatives: 0 }), 'EVEN_COMMITTEE_SIZE');
  });

  it('小项目底线 3：3 人通过（ representatives 比例须达标）、2 人 INSUFFICIENT', () => {
    expect(() => assertCommitteeComposition({ confirmed: 3, representatives: 1 })).not.toThrow(); // 2/3 ≥ 2/3
    expectCode(() => assertCommitteeComposition({ confirmed: 3, representatives: 2 }), 'COMMITTEE_RATIO');
    expectCode(() => assertCommitteeComposition({ confirmed: 2, representatives: 0 }), 'INSUFFICIENT_COMMITTEE_SIZE');
  });

  it('水利工程 7 人门槛：5 人 INSUFFICIENT、7 人通过、8 人 EVEN', () => {
    expectCode(() => assertCommitteeComposition({ confirmed: 5, representatives: 0 }, { minSize: MIN_COMMITTEE_WATER }), 'INSUFFICIENT_COMMITTEE_SIZE');
    expect(() => assertCommitteeComposition({ confirmed: 7, representatives: 2 }, { minSize: MIN_COMMITTEE_WATER })).not.toThrow();
    expectCode(() => assertCommitteeComposition({ confirmed: 8, representatives: 2 }, { minSize: MIN_COMMITTEE_WATER }), 'EVEN_COMMITTEE_SIZE');
  });

  it('isWaterProject：类别含「水利」或名称命中水利关键词', () => {
    expect(isWaterProject({ procurementCategory: '水利工程' }, '某采购')).toBe(true);
    expect(isWaterProject({ procurementCategory: null }, '芦稿溪水库主体工程')).toBe(true);
    expect(isWaterProject({ procurementCategory: '货物' }, '办公家具采购')).toBe(false);
  });

  it('常量：默认 5 / 水利 7', () => {
    expect(MIN_COMMITTEE_DEFAULT).toBe(5);
    expect(MIN_COMMITTEE_WATER).toBe(7);
  });
});
