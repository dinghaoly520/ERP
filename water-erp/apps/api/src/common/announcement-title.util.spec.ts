import { stripAnnouncementTitlePrefix } from './announcement-title.util';

/** 公告标题类型前缀剥离（2026-09-11 口径）：项目侧只展示项目本身。
 *  2026-11-19 补「谈判文件公告」（:3011 态势列表实录存量名带前缀入库）。 */
describe('stripAnnouncementTitlePrefix', () => {
  it.each([
    ['谈判文件公告 — 便携式全液压岩心钻机（800型）采购', '便携式全液压岩心钻机（800型）采购'],
    ['直接采购公告 — 便携式全液压岩心钻机（800型）采购', '便携式全液压岩心钻机（800型）采购'],
    ['竞价采购公告—甲项目', '甲项目'],
    ['中标结果公示 · 乙项目', '乙项目'],
  ])('剥前缀：%s → %s', (input, expected) => {
    expect(stripAnnouncementTitlePrefix(input)).toBe(expected);
  });

  it('非公告标题原样返回（含空串兜底）', () => {
    expect(stripAnnouncementTitlePrefix('便携式全液压岩心钻机（800型）采购')).toBe('便携式全液压岩心钻机（800型）采购');
    expect(stripAnnouncementTitlePrefix('— 只有分隔符')).toBe('— 只有分隔符'); // 剥后为空回退原文
  });
});
