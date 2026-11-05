// sanitize-html 是 CJS（export = function，require() 直接返回函数）。
// 项目 tsconfig 未开 esModuleInterop（仅 allowSyntheticDefaultImports），
// 默认 import 会编译成 sanitize_html_1.default → undefined。用 import = require 才稳。
import sanitizeHtml = require('sanitize-html');
import { stripMojibake } from './text-clean.util';

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
  return stripMojibake(sanitizeHtml(html, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: ALLOWED_ATTRIBUTES,
    allowedSchemes: ['http', 'https', 'mailto'],
    allowedSchemesByTag: { img: ['http', 'https', 'data', 'blob'] },
    disallowedTagsMode: 'discard',
  }));
}

/**
 * 公告 metadata 富文本字段写时消毒（2026-11-05 :3004 排查）：
 * `metadata.objectionContact`（异议联系方式）在 :3002/:3004 详情页被直接
 * dangerouslySetInnerHTML 渲染——content 有消毒而 metadata 整对象是 @IsObject()
 * 直通，内部角色可经此向供应商/公众注入脚本。仅消毒已知富文本键，其余键原样
 * （metadata 大多为结构化非展示字段，全量递归消毒有误伤语义风险）。
 */
export function sanitizeAnnouncementMetadata(meta: Record<string, any> | undefined | null): Record<string, any> | undefined {
  if (!meta || typeof meta !== 'object') return meta ?? undefined;
  if (typeof meta.objectionContact !== 'string') return meta;
  return { ...meta, objectionContact: sanitizeHtmlContent(meta.objectionContact) };
}
