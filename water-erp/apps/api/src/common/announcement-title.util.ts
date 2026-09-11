/**
 * 公告标题类型前缀剥离（2026-09-11）。
 * 公告标题形如「直接采购公告 — 便携式全液压岩心钻机（800型）采购」；项目侧
 * （BidProject.name / PMI.title / 供应商门户「采购项目」列表）只展示项目本身，
 * 前缀属公告展示语义——直建/关联项目时统一剥离。
 */
const ANNOUNCEMENT_TITLE_PREFIX_RE =
  /^(?:单源直接采购公告|直接采购公告|谈判采购公告|竞价采购公告|询比采购公告|邀请招标公告|招标公告|采购公告|中标结果公示|中标公示|预成交公示|成交公告|中标公告|流标公告|合同公告|履约公告)\s*[—\-–·]\s*/;

export function stripAnnouncementTitlePrefix(title: string): string {
  return title.replace(ANNOUNCEMENT_TITLE_PREFIX_RE, '').trim() || title;
}
