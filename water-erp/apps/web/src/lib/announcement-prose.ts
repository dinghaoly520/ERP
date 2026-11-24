/* ── 公告正文展示归一 + 公文排版结构化（2026-11-23 用户裁定） ──
 *
 * 既有归一（2026-10-30）：存量公告监督块曾被生成端粘连成一段（监督举报四行串行），
 * 生成端已根治；此处兜存量数据——与后端 announcement-content-html.util 同口径：
 * ≥2 个监督标签同段时在非段首标签前断行 + 剔除 docx 空格撑行的纯空白段。
 *
 * 公文排版（2026-11-23，CSS 侧见 announcement-publish-wizard.tsx 注入的 .portal-announce-preview）：
 *  1. 粘连标题拆分：首段文本以公告标题开头（生成端标题与首段粘连）→ 拆为居中标题段 + 正文段；
 *  2. 「一、」序号节标题：加粗 + 缩进 2 字符；
 *  3. 正文段首行缩进 2 字符；
 *  4. 数字/西文 Times New Roman：字体栈 Times 置前——CJK 字形回落中文字体，拉丁/数字取 Times。
 */

const SUPERVISION_LABELS = ['监督部门：', '地址：', '联系人：', '监督电话：'];

function breakGluedSupervisionLabels(html: string): string {
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

function stripBlankParagraphs(html: string): string {
  if (!html.includes('<p')) return html;
  return html.replace(/<p[^>]*>[\s 　]*<\/p>/g, '');
}

/** 首段粘连标题拆分（两级）：居中标题段 + 余文段落。按剥离标签后的文本重建
 *  （首段内嵌 <strong> 随之剥离——公文样式类接管排版）。
 *  1) 精确：首段文本以公告标题开头（标题与正文同串粘连）；
 *  2) 启发式（2026-11-23 实录：列表标题「谈判文件公告 — 项目名」与正文粘连串
 *     「项目名+公告类型」不相等）：按首个「公告」词边界拆分，形态校验防误拆——
 *     候选标题 8~60 字、不含句读标点（标题形态）、余文非空且不以「公告」续接；
 *     两级皆不命中（正文段先行的异构存量）不猜测、原样返回。 */
function splitLeadingTitle(html: string, title?: string | null): string {
  if (!title?.trim() || !html.includes('<p')) return html;
  const m = html.match(/^\s*<p([^>]*)>([\s\S]*?)<\/p>/);
  if (!m) return html;
  const text = m[2].replace(/<[^>]+>/g, '').replace(/\s+/g, '');
  let head = '';
  if (title.replace(/\s+/g, '') && text.startsWith(title.replace(/\s+/g, ''))) {
    head = title;
  } else {
    const m2 = text.match(/^(.{7,59}?公告)([\s\S]+)$/);
    if (!m2 || /[，。；！？：、]/.test(m2[1]) || m2[2].startsWith('公告')) return html;
    head = m2[1];
  }
  const body = text.slice(head.replace(/\s+/g, '').length);
  if (!body.trim()) return `<p class="ann-prose-title">${head}</p>${html.slice(m[0].length)}`;
  return `<p class="ann-prose-title">${head}</p><p>${body}</p>${html.slice(m[0].length)}`;
}

/** 「一、」序号节标题：加粗 + 缩进 2 字符（正文段维持首行缩进）。 */
function markSectionHeadings(html: string): string {
  if (!html.includes('<p')) return html;
  return html.replace(/<p([^>]*)>([\s\S]*?)<\/p>/g, (para, attrs: string, inner: string) => {
    if (attrs.includes('class=')) return para; // 已带类（标题段等）不二次注入
    const text = inner.replace(/<[^>]+>/g, '').trim();
    return /^[一二三四五六七八九十百]+、/.test(text) ? `<p${attrs} class="ann-prose-h">${inner}</p>` : para;
  });
}

/** 单项列表包壳的节标题解包（2026-11-23 生产实录：竞价公告模板「四、五、六」行用了
 *  Word 列表样式，mammoth 产 <ol><li><strong>四、公示期限</strong></li></ol>——列表项
 *  非 <p>：节标题加粗标记不命中、首行缩进不适用、另吃列表缩进致视觉错位）。仅解
 *  「恰一个 <li> 且纯文本命中『N、』节标题形态」的 ol/ul；真列表（多项/非标题文本）不动。 */
function unwrapSingleItemHeadingLists(html: string): string {
  if (!/<(ol|ul)\b/i.test(html)) return html;
  return html.replace(/<(ol|ul)[^>]*>\s*<li[^>]*>((?:(?!<\/li>)[\s\S])*)<\/li>\s*<\/\1>/gi, (whole, _tag: string, inner: string) => {
    const text = inner.replace(/<[^>]+>/g, '').trim();
    return /^[一二三四五六七八九十百]+、/.test(text) ? `<p>${inner}</p>` : whole;
  });
}

export function normalizeAnnouncementContentHtml(html: string, title?: string | null): string {
  return markSectionHeadings(splitNumberedBrLines(splitLeadingTitle(stripBlankParagraphs(unwrapSingleItemHeadingLists(breakGluedSupervisionLabels(html))), title)));
}

/** 段内 <br/> 断行的编号项拆为独立段落（2026-11-23 用户裁定：编号项也要首行缩进——
 *  CSS text-indent 只缩段首行，br 断行缩不到）。仅拆「br 后续行以编号起始」的行
 *  （1）/1./1、/①/（1）等列表块），非编号续行（监督块标签行等）保持 br。
 *  置于 markSectionHeadings 之前——拆出的一、式节行可被加粗标记命中。 */
const NUMBERED_LINE_START_RE = /^(?:[（(]?\d+[）)、.．]|[①②③④⑤⑥⑦⑧⑨⑩]|[一二三四五六七八九十]+[、）)])/;

function splitNumberedBrLines(html: string): string {
  if (!html.includes('<p')) return html;
  return html.replace(/<p([^>]*)>([\s\S]*?)<\/p>/g, (whole, attrs: string, inner: string) => {
    const hasBr = /<br\s*\/?>/i.test(inner);
    // 带其它内嵌标签（strong/em 等）且无 br —— 保守不动（句内拆分只做纯文本）
    if (!hasBr && /<[a-z]/i.test(inner)) return whole;
    // 先按 br 分段，逐段做句内拆分（2026-11-23 存量兜底：「……投递。资格条件：1.持有…」
    // 粘在首截、2~6 条才是 br 行的混排形态——br 拆段先跑会注入标签令纯文本守卫失效，
    // 故逐段处理）：
    //  - 句内编号项（句点式，小数/「第N」防误伤）前拆分并归一「N）」
    //  - 句号后 2~6 汉字短标签（「。资格条件：」）前拆分
    const SEP = '\u0000';
    const segs = hasBr ? inner.split(/<br\s*\/?>/i) : [inner];
    const pieces: Array<{ text: string; kind: 'first' | 'br' | 'split' }> = [];
    segs.forEach((seg, si) => {
      if (/<[a-z]/i.test(seg)) {
        pieces.push({ text: seg, kind: si === 0 ? 'first' : 'br' });
        return;
      }
      const parts = seg
        .replace(/([㐀-鿿；。：，、））\"?])(\d+)([.．])(?!\d)/g, (w2: string, prev: string, n: string) =>
          prev && !/[第\d.．]/.test(prev) ? `${prev}${SEP}${n}）` : w2)
        .replace(/。([㐀-鿿]{2,6}：)/g, `。${SEP}$1`)
        .split(SEP);
      parts.forEach((pt, pi) => pieces.push({ text: pt, kind: si === 0 && pi === 0 ? 'first' : pi > 0 ? 'split' : 'br' }));
    });
    let out = '';
    for (const piece of pieces) {
      if (piece.kind === 'first') { out += piece.text; continue; }
      const text = piece.text.replace(/<[^>]+>/g, '').trim();
      // 句内拆分边界一律成段；br 边界仅编号行成段（非编号续行保持 br）；
      // 成段件行首句点式序号统一归一「N）」（含 br 边界件——存量 2./3. 形态）
      const asPara = piece.kind === 'split' || NUMBERED_LINE_START_RE.test(text);
      out += asPara ? '</p><p>' : '<br/>';
      out += asPara ? piece.text.replace(/^(\d+)[.．](?!\d)/, '$1）') : piece.text;
    }
    if (out === inner) return whole;
    return `<p${attrs}>${out}</p>`;
  });
}
