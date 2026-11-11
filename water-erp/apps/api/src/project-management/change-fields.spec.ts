import { CHANGE_FIELD_GROUPS, stageReached, FORBIDDEN_FIELDS, findFieldGroup } from './change-fields';

const STAGES = ['PROCUREMENT_DEMAND', 'INITIATION', 'TENDER_DOCUMENT', 'PUBLIC_ANNOUNCEMENT', 'EXPERT_SELECTION', 'BID_EVALUATION', 'AWARD_DECISION', 'CONTRACT'];

describe('变更字段分组与阶段闸门（2026-11-11 spec §2）', () => {
  it('两组均有阶段锚点，且开标时间在公告组', () => {
    expect(CHANGE_FIELD_GROUPS.map(g => g.key)).toEqual(['basic', 'notice']);
    const notice = findFieldGroup('bidOpeningTime');
    expect(notice?.key).toBe('notice');
    expect(notice?.stageKey).toBe('TENDER_DOCUMENT');
  });

  it('供应商/专家名单字段禁入白名单', () => {
    const all = CHANGE_FIELD_GROUPS.flatMap(g => g.fields.map(f => f.field));
    for (const f of FORBIDDEN_FIELDS) expect(all).not.toContain(f);
    expect(FORBIDDEN_FIELDS).toContain('biddingUnits');
  });

  it('stageReached：立项期 → basic 解锁、document/notice 锁；到采购文件期 → 全解锁', () => {
    expect(stageReached(STAGES, 'INITIATION', 'INITIATION')).toBe(true);
    expect(stageReached(STAGES, 'INITIATION', 'TENDER_DOCUMENT')).toBe(false);
  });

  it('currentStage 空（无阶段指针）→ 仅 basic 组可改', () => {
    expect(stageReached(STAGES, null, 'INITIATION')).toBe(true);
    expect(stageReached(STAGES, null, 'TENDER_DOCUMENT')).toBe(false);
  });
});
