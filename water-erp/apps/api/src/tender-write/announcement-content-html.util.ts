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
 *
 * 软换行安全网（2026-10-22 重立，仅渲染层）：需求/立项表 PDF 解析的正文带句中
 * 软换行，docx 化后以 <br/> 或「每行一段」(<p>) 落进门户正文——词中断行（「勘察
 * 设/计」）。模板层不修补（2026-10-20 撤闸口径：替换原文直入），此处为唯一
 * 防线：合并 <br/> 断词 + 无句读段落边界，列表/序号/标题行/落款自然不命中。
 */

/** 句末/行末停顿标点——段尾命中则保留分段（真实段落边界） */
const SENTENCE_END_RE = /[。！？；：…”』」）)】】]$/;
/** 列表/序号/条款起始——段首命中则保留分段（条目边界）。
 *  数字序号 `\d+\.` 须排除小数（567.89 跨行直连曾误判列表致不合并） */
const LIST_START_RE = /^([（(]?[一二三四五六七八九十]+[）)、.．]|[（(]\d+[）)]|\d+[、．]|\d+\.(?!\d)|[①②③④⑤⑥⑦⑧⑨⑩]|第[一二三四五六七八九十\d]+[条章节款]|[•·■◆▲▷-]|[（（]?[甲乙丙丁戊己庚辛壬癸][、）)])/;
const CJK_RE = /[㐀-鿿豈-﫿　-〿＀-￯]/;

/** 相邻文本的拼接：CJK/数字直接连，拉丁字母补空格（沿用 2026-10-20 撤闸前口径） */
function joinLineTokens(left: string, right: string): string {
  const l = left.trimEnd().slice(-1);
  const r = right.trimStart().slice(0, 1);
  if (!l || !r) return `${left}${right}`;
  const latin = /[A-Za-z]/;
  if (latin.test(l) && latin.test(r)) return `${left.trimEnd()} ${right.trimStart()}`;
  return `${left}${right}`;
}

const stripTags = (s: string) => s.replace(/<[^>]+>/g, '');

/** 合并句中软换行 <br/>：仅 CJK↔CJK / 数字↔数字 / 字母↔字母 直接命中（句界标点自然不命中） */
export function collapseMidWordBreaks(html: string): string {
  return html.replace(
    /([^<>]+)<br\s*\/?>([^<>]+)/g,
    (whole, before: string, after: string) => {
      const l = before.trimEnd().slice(-1) || '';
      const r = after.trimStart().slice(0, 1) || '';
      const hit =
        (CJK_RE.test(l) && CJK_RE.test(r)) ||
        (/\d/.test(l) && /\d/.test(r)) ||
        (/[A-Za-z]/.test(l) && /[A-Za-z]/.test(r));
      if (!hit) return whole;
      return joinLineTokens(before, after);
    },
  );
}

/**
 * 合并「每行一段」软换行：docx 里 PDF 每行成为独立 <p> 段，真实段落被拆散、
 * 行距拉满（2026-10-22 用户实录截图形态）。仅当——
 *  - 前段**不**以句末标点收尾（句读在段尾 = 真实段落边界）
 *  - 后段**不**以列表/序号/条款起始（条目边界）
 *  - 前段非短标题行（短且带序号/以冒号收尾的标题）
 *  - 两段为紧邻兄弟节点（间隔仅空白——表格 </td><td> 等结构边界不越）
 * 时合并。段内已有结构标签（strong/em 等）原样保留。
 */
/** 纯日期段（落款）与惯用收尾行——保持独立段，防合并破坏落款右对齐/公告套话结构 */
const PURE_DATE_RE = /^\d{4}年\d{1,2}月\d{1,2}日$/;
const CLOSING_LINE_RE = /^(特此公告|特此公示|特此通知|特此说明)$/;
/** 监督块标签起始行（2026-10-30 根因修复）：公告 docx 模板监督四行各占一段且均无
 *  句读收尾——软换行合并安全网曾把它们粘回一段（门户/预览「监督举报不换行」实录）。
 *  前侧守卫防其吞并后段（监督电话行数字收尾 + 落款段），后侧守卫防其被前段吞并。 */
const SUPERVISION_LABEL_START_RE = /^(监督部门|地址|联系人|监督电话)：/;

export function collapseSoftWrappedParagraphs(html: string): string {
  if (!html.includes('<p')) return html;
  // tokens: [前导文本, 段1, 间隔1, 段2, 间隔2, 段3, …]——仅紧邻兄弟 <p>（间隔纯空白）可合并；
  // 表格 </td><td> 等结构间隔非空白，天然不越界
  const tokens = html.split(/(<p[^>]*>[\s\S]*?<\/p>)/);
  const out: string[] = [];
  for (const tok of tokens) {
    // 空串间隔必须占位——邻接判定依赖 [段, 间隔, 段] 三元结构（split 对紧邻段落产出空串）
    if (!tok || !/^<p/i.test(tok)) {
      out.push(tok);
      continue;
    }
    const prevIdx = out.length - 2;
    const gapIdx = out.length - 1;
    const prevIsAdjacentP =
      prevIdx >= 0 && gapIdx >= 0 && /^<p/i.test(out[prevIdx]) && out[gapIdx].trim() === '';
    if (prevIsAdjacentP) {
      const prevText = stripTags(out[prevIdx]).trim();
      const curText = stripTags(tok).trim();
      const prevIsShortHeading =
        prevText.length <= 25 && (LIST_START_RE.test(prevText) || /[：:]$/.test(prevText));
      const mergeable =
        prevText.length > 0 &&
        curText.length > 0 &&
        !SENTENCE_END_RE.test(prevText.slice(-1)) &&
        !prevIsShortHeading &&
        !LIST_START_RE.test(curText) &&
        !PURE_DATE_RE.test(prevText) &&
        !PURE_DATE_RE.test(curText) &&
        !CLOSING_LINE_RE.test(prevText) &&
        !CLOSING_LINE_RE.test(curText) &&
        !SUPERVISION_LABEL_START_RE.test(curText) &&
        !SUPERVISION_LABEL_START_RE.test(prevText);
      if (mergeable) {
        const merged = joinLineTokens(
          out[prevIdx].replace(/<\/p>\s*$/i, ''),
          tok.replace(/^<p[^>]*>/i, '').replace(/<\/p>\s*$/i, ''),
        );
        out.splice(prevIdx, 2, `${merged}</p>`);
        continue;
      }
    }
    out.push(tok);
  }
  return out.join('');
}

/** 公告正文 HTML 渲染层归一（软换行安全网：<br/> 断词 + 每行成段，先段后行内） */
export function normalizeAnnouncementHtml(html: string): string {
  if (!html) return html;
  return collapseMidWordBreaks(collapseSoftWrappedParagraphs(html));
}

/**
 * 纯文本软换行合并（announ­cement.service 纯文本→HTML 切段前的预处理）：
 * PDF 提取的正文每行带 \n，切段会放大成「每行一段」。守卫与 HTML 版同口径——
 * 句末标点行收段、列表/序号行起段、短标题行独立、纯日期/收尾行独立；
 * 空行为显式分段边界，链式合并在此截断。
 */
export function joinSoftWrappedPlainText(text: string): string {
  if (!text.includes('\n')) return text;
  const lines = text.split('\n');
  const out: string[] = [];
  for (const line of lines) {
    const prev = out.length ? out[out.length - 1] : null;
    const prevText = (prev ?? '').trim();
    const curText = line.trim();
    const prevIsShortHeading =
      prevText.length > 0 && prevText.length <= 25 && (LIST_START_RE.test(prevText) || /[：:]$/.test(prevText));
    const mergeable =
      prev !== null &&
      prevText.length > 0 &&
      curText.length > 0 &&
      !SENTENCE_END_RE.test(prevText.slice(-1)) &&
      !prevIsShortHeading &&
      !LIST_START_RE.test(curText) &&
      !PURE_DATE_RE.test(prevText) &&
      !PURE_DATE_RE.test(curText) &&
      !CLOSING_LINE_RE.test(prevText) &&
      !CLOSING_LINE_RE.test(curText) &&
      !SUPERVISION_LABEL_START_RE.test(curText) &&
      !SUPERVISION_LABEL_START_RE.test(prevText);
    if (mergeable) {
      out[out.length - 1] = joinLineTokens(prev!, line);
    } else {
      out.push(line);
    }
  }
  return out.join('\n');
}

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

/** 公告 docx → 正文 HTML（表格保结构 + 跨 run「采购采购」归一 + 软换行安全网 + 监督块断行 + 落款右对齐） */
export async function extractAnnouncementContentHtml(buffer: Buffer): Promise<string> {
  const result = await mammoth.convertToHtml({ buffer });
  // 顺序：软换行安全网先跑（其段合并条件「前段无句末标点」会把刚断行的监督段
  // 重新粘回——断行必须在其后）；空白段剔除放在落款对齐前，别让空白段
  // 隔断「采购人段+日期段」的紧邻判定
  return alignSignatureParagraphs(
    stripBlankParagraphs(
      breakGluedSupervisionLabels(
        normalizeAnnouncementHtml(normalizeRepeatedCaiGou(result.value || '')),
      ),
    ),
  );
}

/* ── 监督举报块粘连断行 + 空白段剔除（2026-10-30 用户实录：5 个公告 docx 模板的
      监督块整块一段，mammoth 转出单 <p> 粘连「监督部门：X地址：Y联系人：Z监督电话：W」，
      门户与发布预览全部串行。模板层已同步拆段根治；此处为生成侧安全网——模板若被
      旧文件重导入仍兜底。仅纯文本段处理，≥2 个监督标签同段才触发，正常正文零扰动）── */

const SUPERVISION_LABELS = ['监督部门：', '地址：', '联系人：', '监督电话：'];

/** 监督块粘连标签断行：段文本含 ≥2 个监督标签时，每个非段首标签前插 <br/> */
export function breakGluedSupervisionLabels(html: string): string {
  if (!html.includes('<p')) return html;
  return html.replace(/<p([^>]*)>([^<]*)<\/p>/g, (para, attrs: string, text: string) => {
    const hits = SUPERVISION_LABELS.filter((l) => text.includes(l));
    if (hits.length < 2) return para;
    let out = text;
    for (const label of SUPERVISION_LABELS) {
      const parts = out.split(label);
      if (parts.length < 2) continue;
      const firstAtParaStart = parts[0].trim() === '';
      out = parts.reduce((acc, part, i) => {
        if (i === 0) return part;
        const br = i === 1 && firstAtParaStart ? '' : '<br/>';
        return `${acc}${br}${label}${part}`;
      }, '');
    }
    return `<p${attrs}>${out}</p>`;
  });
}

/** 纯空白段剔除：docx 里用空格段撑间距（`<p>     </p>`），HTML 折叠空格后成空行 */
export function stripBlankParagraphs(html: string): string {
  if (!html.includes('<p')) return html;
  return html.replace(/<p[^>]*>[\s 　]*<\/p>/g, '');
}
