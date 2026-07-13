// sanitize-html 是 CJS（export = function，require() 直接返回函数）。
// 项目 tsconfig 未开 esModuleInterop（仅 allowSyntheticDefaultImports），
// 默认 import 会编译成 sanitize_html_1.default → undefined。用 import = require 才稳。
import sanitizeHtml = require('sanitize-html');

/**
 * 公告 / 富文本允许的标签白名单。
 * 必须覆盖 seed 数据用到的 p/strong/h2/h3，以及富文本编辑器常见输出。
 */
const ALLOWED_TAGS = [
  'p', 'br', 'strong', 'em', 'b', 'i', 'u', 's', 'sub', 'sup',
  'h2', 'h3', 'h4',
  'ul', 'ol', 'li',
  'a', 'img',
  'table', 'thead', 'tbody', 'tr', 'td', 'th',
  'blockquote', 'hr',
  'span', 'div',
];

const ALLOWED_ATTRIBUTES: Record<string, string[]> = {
  a: ['href', 'title', 'target', 'rel'],
  img: ['src', 'alt', 'title', 'width', 'height'],
  span: ['class', 'style'],
  div: ['class', 'style'],
  p: ['class', 'style'],
  td: ['class', 'style', 'colspan', 'rowspan'],
  th: ['class', 'style', 'colspan', 'rowspan'],
  table: ['class'],
};

/**
 * 写时消毒公告 HTML，防存储型 XSS。
 *
 * 剥离：<script>、on* 事件处理器、javascript:/vbscript: 等危险协议、
 *       iframe/object/embed/svg-onload 等；disallowedTagsMode=discard 丢弃
 *       非白名单标签但保留其内部文本。
 * 保留：seed 与富文本所需的安全标签 + 受限属性。
 */
export function sanitizeHtmlContent(html: string): string {
  if (!html || typeof html !== 'string') return html;
  return sanitizeHtml(html, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: ALLOWED_ATTRIBUTES,
    allowedSchemes: ['http', 'https', 'mailto'],
    allowedSchemesByTag: { img: ['http', 'https', 'data', 'blob'] },
    disallowedTagsMode: 'discard',
  });
}
