import { CHANGE_FIELD_GROUPS, stageReached, FORBIDDEN_FIELDS, findFieldGroup } from './change-fields';

describe('变更字段分组与阶段闸门（2026-11-11 spec §2）', () => {
  it('四组均有阶段锚点，且开标时间在公告组', () => {
    expect(CHANGE_FIELD_GROUPS.map(g => g.key)).toEqual(['basic', 'notice', 'award', 'contract']);
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
    expect(stageReached('INITIATION', 'INITIATION')).toBe(true);
    expect(stageReached('INITIATION', 'TENDER_DOCUMENT')).toBe(false);
  });

  it('currentStage 空（无阶段指针）→ 仅 basic 组可改', () => {
    expect(stageReached(null, 'INITIATION')).toBe(true);
    expect(stageReached(null, 'TENDER_DOCUMENT')).toBe(false);
  });

  it('恒按超集序，与项目阶段链存取顺序无关（2026-11-12 SWHI-JJ-2026102302 实录：DB 返回字母序链）', () => {
    // 阶段链即使按字母序返回（BID_EVALUATION→…→TENDER_DOCUMENT），专家抽取仍应视为已过采购文件
    expect(stageReached('EXPERT_SELECTION', 'TENDER_DOCUMENT')).toBe(true);
    expect(stageReached('BID_EVALUATION', 'TENDER_DOCUMENT')).toBe(true);
    expect(stageReached('INITIATION', 'TENDER_DOCUMENT')).toBe(false);
  });

  it('存量方式链缺锚点键不误锁（旧版直接采购链无 TENDER_DOCUMENT）', () => {
    // 组锚点序恒按 STAGE_ORDER 超集计算；项目链缺键不再影响判定
    expect(stageReached('PUBLIC_ANNOUNCEMENT', 'TENDER_DOCUMENT')).toBe(true);
    expect(stageReached('PROCUREMENT_DEMAND', 'TENDER_DOCUMENT')).toBe(false);
  });
});
