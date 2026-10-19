import * as mammoth from 'mammoth';

/**
 * 公告正文 HTML 提取（2026-10-19 表格丢失根治）。
 *
 * 背景：发布向导正文此前用 mammoth.extractRawText（纯文本），表格单元格被拆成
 * 逐格竖排段落，门户详情「表格部分内容缺失」（实录：中标公告投标单位/报价表格
 * 整块变成单行文字堆）。convertToHtml 保留 <table>/<tr>/<td>（含 rowspan/colspan
 * 合并），经 API 写时消毒白名单（table/thead/tbody/tr/td/th 已放行）原样入库。
 *
 * 落款右对齐沿用纯文本路径（buildAnnouncementContentHtml）2026-09-11 口径：
 * 识别最后一个「纯日期」段，与其前一采购人段一起右对齐。
 */

/** 模板标题段「{{项目名称}}采购」在项目名以「采购」结尾时会拼出「采购采购」——
 *  docx XML 层归一抓不到跨 run 重复，提取为 HTML 后统一归一（与 textContent 路径同款）。 */
function normalizeRepeatedCaiGou(html: string): string {
  return html.replace(/采购采购+/g, '采购');
}

/**
 * 落款右对齐：最后一个「纯日期」`<p>` 段及其紧邻前一个 `<p>` 段注入
 * style="text-align:right"（docx 靠前导空格模拟右对齐，HTML 折叠空格）。
 * mammoth 输出的段落均为无属性裸 `<p>`；带属性/非纯文本日期段不匹配，保持原样。
 */
export function alignSignatureParagraphs(html: string): string {
  if (!html) return html;
  // 前导/尾随空白（docx 前导空格模拟右对齐，mammoth 保留为空格/nbsp）与纯文本路径
  // 的 /^\s*…\s*$/ 同口径，否则询比/竞价/流标模板的落款日期段会失配（2026-10-19 补）
  const dateRe = /<p>[\s\u00a0]*(\d{4}年\d{1,2}月\d{1,2}日)[\s\u00a0]*<\/p>/g;
  let m: RegExpExecArray | null;
  let last: { index: number; len: number; date: string } | null = null;
  while ((m = dateRe.exec(html))) {
    last = { index: m.index, len: m[0].length, date: m[1] };
  }
  if (!last) return html;

  const alignedDate = `<p style="text-align:right">${last.date}</p>`;
  const before = html.slice(0, last.index);
  // 前一段（采购人名称）紧邻日期段；非 <p>（如表格结尾）时只对齐日期段
  const prevMatch = before.match(/<p>([^<]*)<\/p>\s*$/);
  if (prevMatch && prevMatch.index !== undefined) {
    return (
      before.slice(0, prevMatch.index) +
      `<p style="text-align:right">${prevMatch[1]}</p>` +
      alignedDate +
      html.slice(last.index + last.len)
    );
  }
  return before + alignedDate + html.slice(last.index + last.len);
}

/** 公告 docx → 正文 HTML（表格保结构 + 跨 run「采购采购」归一 + 落款右对齐） */
export async function extractAnnouncementContentHtml(buffer: Buffer): Promise<string> {
  const result = await mammoth.convertToHtml({ buffer });
  return alignSignatureParagraphs(normalizeRepeatedCaiGou(result.value || ''));
}
