import test from "node:test";
import assert from "node:assert/strict";

import { getAnnouncementLabel } from "./announcement-templates";

/** 公告名称统一（2026-11-24 用户裁定）：谈判此前落兜底 `${tenderLabel}公告`=
 *  「谈判文件公告」（tenderLabel 是采购文件名「谈判文件」），与「竞价采购公告」等
 *  不一致。统一口径：招标两方式对仗（邀请招标公告/公开招标公告——公开招标同日
 *  二次裁定由「招标公告」改「公开招标公告」），其余四方式一律「X采购公告」
 *  ——与后端导出 typeLabel（tender-write.service.ts）逐一对齐；docx 文书内部
 *  标题仍「招标公告」法定口吻（2026-11-20 裁定，两面对象不同）。 */
test("六方式 procurement_document 公告名称统一：招标对仗名 + 其余「X采购公告」", () => {
  assert.equal(getAnnouncementLabel("COMPETITIVE_NEGOTIATION", "procurement_document"), "谈判采购公告");
  assert.equal(getAnnouncementLabel("INTERNAL_BIDDING", "procurement_document"), "竞价采购公告");
  assert.equal(getAnnouncementLabel("INQUIRY_PURCHASE", "procurement_document"), "询比采购公告");
  assert.equal(getAnnouncementLabel("SINGLE_SOURCE", "procurement_document"), "直接采购公告");
  assert.equal(getAnnouncementLabel("INVITED_BIDDING", "procurement_document"), "邀请招标公告");
  assert.equal(getAnnouncementLabel("PUBLIC_BIDDING", "procurement_document"), "公开招标公告");
});
