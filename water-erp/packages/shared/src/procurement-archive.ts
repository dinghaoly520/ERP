/**
 * D1（GB/T 43711—2024 4.1.5.1）：电子采购交易档案标准类别模板。
 * 归集的档案资料宜包括：采购方案、采购公告/采购邀请书、资格审查资料、采购文件、
 * 成交和候选供应商的响应文件、开启记录、评审报告、预成交公示、成交公告、
 * 成交通知书、采购合同、验收报告，以及采购交易争议解决文件。
 *
 * satisfy: 满足度判定键——'item' 按既有归档项名匹配；'data' 按系统数据存在性匹配
 * （由 /bid/projects/:id/archive-template 端点解析）；'manual' 仅人工登记。
 */
export const GB_ARCHIVE_CATEGORIES = [
  { key: 'plan', name: '采购方案', satisfy: 'data', hint: '项目管理立项台账' },
  { key: 'notice', name: '采购公告/采购邀请书', satisfy: 'data', hint: '已发布的采购公告或邀请记录' },
  { key: 'prequal', name: '资格审查资料', satisfy: 'manual', hint: '线下预审材料登记上传' },
  { key: 'document', name: '采购文件', satisfy: 'data', hint: '加密采购文件（BidDocument）' },
  { key: 'response', name: '响应文件（成交及候选供应商）', satisfy: 'data', hint: '递交的响应文件/解密产物' },
  { key: 'opening', name: '开启记录', satisfy: 'item', match: ['开标记录表'], hint: '开标记录表' },
  { key: 'evaluation', name: '评审报告', satisfy: 'item', match: ['评标结果汇总', '评标签字包'], hint: '评审结果与签字包' },
  { key: 'pre_win', name: '预成交公示', satisfy: 'data', hint: '预成交公示公告' },
  { key: 'win', name: '成交公告', satisfy: 'data', hint: '成交公告' },
  { key: 'award_letter', name: '成交通知书', satisfy: 'data', hint: '中标（成交）通知书送达记录' },
  { key: 'contract', name: '采购合同', satisfy: 'data', hint: '已签署的采购合同' },
  { key: 'acceptance', name: '验收报告', satisfy: 'data', hint: '合同验收节点/报告' },
  { key: 'dispute', name: '采购交易争议解决文件', satisfy: 'manual', hint: '异议/投诉/裁决材料登记' },
] as const;

export type GbArchiveCategory = (typeof GB_ARCHIVE_CATEGORIES)[number];
