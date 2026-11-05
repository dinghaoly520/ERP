/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   公告数据 — 首页、列表页、详情页共用
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

export interface AnnouncementItem {
  id: string;
  type: string;
  tag: string;
  color: string;
  date: string;
  urgent: boolean;
  title: string;
  desc: string;
  code: string;
  deadlineLabel: string;
  deadline: string;
  content: string;
  aiSummary?: string;
  metadata?: Record<string, any>;
  /** 浏览量（后端 viewCount 透传，公开详情页访问自增） */
  viewCount?: number;
  /** 发布单位（2026-10-16）：公告必须标明公司——创建时按登录人公司落写时快照 */
  companyName?: string;
  /** 已下线标题壳（2026-09-26 v2）：公示期满/存量下线——2026-10-20 改可点，详情为提示页 */
  titleOnly?: boolean;
  /** 已下线归因（2026-10-20）：PUBLICITY_ENDED=公示期满；OFFLINED=手动下线 */
  offlinedReason?: 'PUBLICITY_ENDED' | 'OFFLINED';
  /** 公告附件（2026-10-28）：公告组成部分，公告中心/信息门户/项目机会三端可下载；标题壳服务端已剥除 */
  attachments?: AnnouncementAttachmentInfo[];
}

export interface AnnouncementAttachmentInfo {
  id: string;
  title?: string;
  fileAsset?: { id?: string; originalName?: string; size?: number; mimeType?: string };
}

/* ── 结构化元数据字段定义（与采购管理工作台 :3005 保持一致）── */
export interface MetaField { key: string; label: string; area?: boolean; date?: boolean }
export const ANNOUNCEMENT_TYPE_META: Record<string, MetaField[]> = {
  ADDENDUM: [
    { key: 'projectCode', label: '项目编号' }, { key: 'relatedAnnouncementTitle', label: '关联采购公告' },
    { key: 'changes', label: '澄清/修改内容', area: true },
    { key: 'newDeadline', label: '调整后递交截止', date: true },
  ],
  BID_NOTICE: [
    { key: 'projectCode', label: '项目编号' }, { key: 'method', label: '招标方式' }, { key: 'budget', label: '预算金额' },
    { key: 'downloadDeadline', label: '采购文件下载时间' },
    { key: 'deadline', label: '报名/投标截止', date: true }, { key: 'openTime', label: '开标时间', date: true }, { key: 'contact', label: '联系方式' },
    { key: 'scope', label: '采购内容/范围', area: true }, { key: 'qualification', label: '投标人资格要求', area: true },
  ],
  PREQUAL_NOTICE: [
    { key: 'title', label: '预审名称' }, { key: 'projectCode', label: '项目编号' }, { key: 'relatedAnnouncementTitle', label: '关联采购公告' },
    { key: 'method', label: '预审方式' }, { key: 'applyDeadline', label: '申请截止时间', date: true },
    { key: 'documents', label: '需提交的申请材料', area: true },
  ],
  PRE_WIN_NOTICE: [
    { key: 'projectCode', label: '项目编号' }, { key: 'winner', label: '预成交供应商' }, { key: 'amount', label: '预成交价格' },
    { key: 'period', label: '工期/交货期/服务期限' }, { key: 'publicityPeriod', label: '公示期' }, { key: 'objection', label: '异议渠道', area: true },
  ],
  WIN_BID_NOTICE: [
    { key: 'projectCode', label: '项目编号' }, { key: 'method', label: '采购方式' }, { key: 'budget', label: '最高限价' },
    { key: 'openTime', label: '开标时间', date: true }, { key: 'bidder1Name', label: '中标供应商' }, { key: 'bidder1Price', label: '中标价格' },
    { key: 'remark', label: '备注' },
  ],
  WIN_NOTICE: [
    { key: 'projectCode', label: '项目编号' }, { key: 'winner', label: '成交供应商' }, { key: 'amount', label: '成交金额' },
    { key: 'period', label: '工期/交货期' }, { key: 'quality', label: '质量标准' }, { key: 'experts', label: '评审专家' },
    { key: 'publicityPeriod', label: '公示期' }, { key: 'objection', label: '异议渠道', area: true },
  ],
  POLICY: [
    { key: 'docNo', label: '文号' }, { key: 'issuer', label: '发布机关' }, { key: 'effectiveDate', label: '生效日期' },
    { key: 'scope', label: '适用范围', area: true },
  ],
  PLATFORM: [
    { key: 'impactScope', label: '影响范围' }, { key: 'changes', label: '功能变化', area: true }, { key: 'schedule', label: '时间安排' },
    { key: 'guide', label: '操作指引', area: true }, { key: 'support', label: '支持渠道' },
  ],
};

/* ── 元数据值格式化（与 :3005 一致：日期解析、预算万元化）── */
export function formatMetaValue(field: MetaField, raw: any): string {
  if (raw == null || raw === '') return '';
  if (field.date) {
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) return '待定';
    return d.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  }
  if ((field.key === 'budget' || field.key === 'amount') && raw) {
    const n = Number(raw);
    if (!isNaN(n) && n >= 10000) return (n / 10000).toFixed(0) + ' 万元';
  }
  return String(raw);
}

export const ANNOUNCEMENT_TABS = [
  { key: '', label: '全部' },
  { key: 'BID_NOTICE', label: '采购公告', color: '#064ea2' },
  { key: 'FAILED_BID_NOTICE', label: '流标公告', color: '#e08a00' },
  { key: 'WIN_BID_NOTICE,PRE_WIN_NOTICE', label: '中标公告', color: '#18a56c' },
  { key: 'ADDENDUM', label: '补遗公告', color: '#e08a00' },
  { key: 'PREQUAL_NOTICE', label: '资格预审', color: '#0b63ce' },
  { key: 'POLICY', label: '政策法规', color: '#d43030' },
  { key: 'PLATFORM', label: '平台通知', color: '#f5a623' },
];

/* ── 类型→标签/颜色 映射 ── */
const TYPE_META: Record<string, { tag: string; color: string }> = {
  BID_NOTICE: { tag: '采购公告', color: '#064ea2' },
  ADDENDUM: { tag: '补遗公告', color: '#e08a00' },
  CLARIFY_NOTICE: { tag: '澄清与修改', color: '#e08a00' },
  PREQUAL_NOTICE: { tag: '资格预审公告', color: '#0b63ce' },
  PRE_WIN_NOTICE: { tag: '中标公告', color: '#18a56c' },
  WIN_BID_NOTICE: { tag: '中标公告', color: '#18a56c' },
  FAILED_BID_NOTICE: { tag: '流标公告', color: '#e08a00' },
  WIN_NOTICE: { tag: '成交公告', color: '#18a56c' },
  CONTRACT_NOTICE: { tag: '合同公告', color: '#064ea2' },
  PERFORMANCE_NOTICE: { tag: '履行结果公告', color: '#4c9a7a' },
  POLICY:     { tag: '政策法规', color: '#d43030' },
  PLATFORM:   { tag: '平台通知', color: '#f5a623' },
};

/* ── 本地日历日（YYYY-MM-DD）——与 :3005 toLocaleDateString 同口径；禁 UTC 切片
      （北京 0:00-7:59 发布会显示前一天，同 web 门户「日历日禁 UTC 切片」既有教训） ── */
function fmtLocalDate(v: string): string {
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/* ── 报名/公示截止——发布向导 canonical 键 metadata.deadline（ISO 串）；
      无值返回 ''（featured 卡按 falsy 隐藏该行，2026-11-05 前恒空是死特性） ── */
function extractDeadline(a: any): string {
  const v = a?.metadata?.deadline;
  return typeof v === 'string' && v ? fmtLocalDate(v) : '';
}

/* ── 列表摘要兜底——content 是后端归一后的 HTML，须剥标签再截断，
      否则无 AI 摘要的公告在卡片字面显示「<p>一、…」 ── */
function htmlToPlainText(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}

/* ── 将后端 Announcement 转为前端 AnnouncementItem ── */
function toAnnouncementItem(a: any): AnnouncementItem {
  const meta = TYPE_META[a.type] ?? { tag: a.type, color: '#5a6d8a' };
  const date = a.publishDate
    ? fmtLocalDate(a.publishDate)
    : fmtLocalDate(a.createdAt);

  return {
    id: a.id,
    type: a.type,
    tag: meta.tag,
    color: meta.color,
    date,
    urgent: a.isTop ?? false,
    title: a.title,
    desc: a.aiSummary || a.summary || htmlToPlainText(a.content || '').slice(0, 120),
    code: a.relatedProjectCode || '',
    deadlineLabel: a.type === 'WIN_NOTICE' || a.type === 'PRE_WIN_NOTICE' || a.type === 'WIN_BID_NOTICE' ? '公示截止' : '报名截止',
    deadline: extractDeadline(a),
    companyName: a.companyName ?? '',
    content: a.titleOnly ? '' : (a.content || ''),
    aiSummary: a.titleOnly ? undefined : (a.aiSummary || undefined),
    metadata: a.metadata || {},
    viewCount: typeof a.viewCount === 'number' ? a.viewCount : 0,
    titleOnly: a.titleOnly === true,
    offlinedReason: a.offlinedReason,
    attachments: a.titleOnly ? [] : Array.isArray(a.attachments) ? a.attachments : [],
  };
}

/* ── 公告附件下载（2026-10-28）：公开端点（匿名可下公开公告附件），失败透出后端业务文案 ── */
export async function downloadAnnouncementAttachment(att: AnnouncementAttachmentInfo): Promise<void> {
  const res = await fetch(`/api/announcements/attachments/${att.id}/download`);
  if (!res.ok) {
    let msg = `附件下载失败 (${res.status})`;
    try { const b = await res.json(); if (b?.error) msg = String(b.error); } catch { /* 非 JSON 错误体 */ }
    throw new Error(msg);
  }
  const disposition = res.headers.get('content-disposition') || '';
  const m = disposition.match(/filename="?([^";]+)"?/);
  const fileName = m ? decodeURIComponent(m[1]) : (att.fileAsset?.originalName || att.title || '附件');
  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = objectUrl;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // 与供应商门户 saveBlob 同口径：延迟回收，避免 revoke 抢在浏览器读取 blob URL 之前
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
}

/* ── API 获取公告列表 ── */
export async function fetchPublicAnnouncements(params?: {
  type?: string;
  search?: string;
  page?: number;
  pageSize?: number;
}): Promise<{ items: AnnouncementItem[]; total: number }> {
  const sp = new URLSearchParams();
  if (params?.type) sp.set('type', params.type);
  if (params?.search) sp.set('search', params.search);
  if (params?.page) sp.set('page', String(params.page));
  if (params?.pageSize) sp.set('pageSize', String(params.pageSize));

  const res = await fetch(`/api/announcements/public?${sp.toString()}`);
  if (!res.ok) throw new Error(`公告加载失败 (${res.status})`);
  const data = await res.json();
  return {
    items: (data.items || []).map(toAnnouncementItem),
    total: data.total || 0,
  };
}

/* ── API 获取公告详情 ── */
export async function fetchPublicAnnouncement(id: string): Promise<AnnouncementItem> {
  const res = await fetch(`/api/announcements/public/${id}`);
  if (!res.ok) {
    // 透传后端业务文案（如「该公告已下线」），无 body 再回落通用文案
    let msg = `公告加载失败 (${res.status})`;
    try { const b = await res.json(); if (b?.error) msg = b.error; } catch { /* keep */ }
    throw new Error(msg);
  }
  const data = await res.json();
  return toAnnouncementItem(data);
}

/* ── 服务端预取（Server Component 专用）——须用 API 绝对地址（服务端无法用相对 /api），
   按类型各取 5 条，失败返回空数组、绝不抛错以免阻塞首屏渲染 ── */
export async function fetchAnnouncementsServer(apiBase: string): Promise<AnnouncementItem[]> {
  const types = ['BID_NOTICE', 'ADDENDUM', 'PREQUAL_NOTICE', 'PRE_WIN_NOTICE', 'WIN_BID_NOTICE', 'FAILED_BID_NOTICE', 'CLARIFY_NOTICE', 'WIN_NOTICE', 'CONTRACT_NOTICE', 'PERFORMANCE_NOTICE', 'POLICY', 'PLATFORM'];
  const settled = await Promise.all(
    types.map(type =>
      fetch(`${apiBase}/api/announcements/public?type=${type}&pageSize=5`, { cache: 'no-store' })
        .then(async r => {
          if (!r.ok) {
            const body = await r.text().catch(() => '');
            console.warn(`[fetchAnnouncementsServer] ${type} → ${r.status}: ${body.slice(0, 200)}`);
            return { items: [] };
          }
          return r.json();
        })
        .catch(err => {
          console.warn(`[fetchAnnouncementsServer] ${type} fetch error:`, (err as Error).message);
          return { items: [] };
        }),
    ),
  );
  return settled.flatMap(r => (r.items || []).map(toAnnouncementItem));
}

