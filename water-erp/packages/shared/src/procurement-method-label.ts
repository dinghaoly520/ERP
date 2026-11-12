/**
 * 采购/招标文件称谓判定（bug#73 · 2026-11-03 裁定#3 落地的单源实现）。
 *
 * 口径：
 * - 平台为**采购口径**（「招标」不得泛指平台业务）——非招标类方式一律「采购文件」；
 * - **邀请招标/公开招标例外**：法定招标方式显法定名「招标文件」（裁定#3 原文针对邀请招标；
 *   公开招标同为法定招标方式，同口径）；
 * - 未知/缺失值 → 「采购文件」（canon 安全默认；两法定名由系统写入端发精确串，白名单稳定）。
 *
 * 生产安全（2026-11-12 bug#73 升级方案）：
 * - procurementMethod 为自由文本列、多端写入（公告 meta.method / PMI 表单 / 手工修数），
 *   本表非招标集已收录已知变体（单一来源×2/直接委托续约/直接签订合同/竞争性谈判 alias 等，
 *   出处 DIRECT_PROCUREMENT_METHODS 与 method-filter util 词表）；
 * - **部署前置**：生产 `SELECT DISTINCT "procurementMethod" FROM "BidProject"` 结果须比对本词表，
 *   出现新变体先并入此处再发版；
 * - 文档场景另有决定性双保险：tenderDocument.source==='negotiation' 恒「采购文件」
 *   （谈判轨无公告轨，消费端自行叠加，本函数不感知文档源）。
 */

/** 法定招标方式（显法定名「招标文件」的完备白名单——新增法定方式须修法后再改这里） */
export const LEGAL_TENDER_METHODS = ['公开招标', '邀请招标'] as const;

/** 已知非招标方式（含历史/变体拼写）——统一「采购文件」。未收录≠招标：未知值走 canon 默认 */
export const NON_TENDER_METHODS = [
  '谈判采购', '竞争性谈判',          // 谈判（method-filter util alias 对）
  '询比采购', '询比',
  '竞价采购', '竞价',
  '直接采购', '直接委托', '续约',
  '单一来源', '单一来源采购',
  '直接委托续约采购', '直接签订合同',
] as const;

/** 采购/招标文件称谓：法定招标方式→「招标文件」，其余（含未知/缺失）→「采购文件」 */
export function tenderDocumentLabel(procurementMethod: string | null | undefined): string {
  return (LEGAL_TENDER_METHODS as readonly string[]).includes(procurementMethod ?? '')
    ? '招标文件'
    : '采购文件';
}
