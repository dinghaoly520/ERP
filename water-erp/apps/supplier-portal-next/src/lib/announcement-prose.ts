/* ── 公告正文展示归一 + 公文排版结构化（2026-11-23 用户裁定） ──
 *
 * 既有归一（2026-10-30）：存量公告监督块曾被生成端粘连成一段（监督举报四行串行），
 * 生成端已根治；此处兜存量数据——与后端 announcement-content-html.util 同口径：
 * ≥2 个监督标签同段时在非段首标签前断行 + 剔除 docx 空格撑行的纯空白段。
 *
 * 公文排版（2026-11-23，CSS 侧见 announcements.css .detail-content）：
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

export function normalizeAnnouncementContentHtml(html: string, title?: string | null): string {
  return markSectionHeadings(splitLeadingTitle(stripBlankParagraphs(breakGluedSupervisionLabels(html)), title));
}
