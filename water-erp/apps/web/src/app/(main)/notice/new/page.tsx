'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  createAnnouncement, updateAnnouncement, listAnnouncements,
  listAttachments, addAttachment, removeAttachment, uploadFile,
} from '@/lib/api/announcement';
import type { AnnouncementType, AnnouncementStatus, AnnouncementAttachment } from '@/lib/api/announcement';
import { Upload, PlusCircle, Save, Send, FolderKanban, Megaphone, Search, X } from 'lucide-react';
import { RichTextEditor } from '@/components/rich-text-editor';
import { useConfirm } from '@/components/workbench/use-confirm';
import { ANNOUNCEMENT_TYPE_ORDER, announcementTypeGroupIndex } from '@water-erp/shared';
import { PublishConfigSection, DEFAULT_PUBLISH_CONFIG, configToMetadata, type PublishConfig } from '@/components/notice/publish-config-section';
import { Modal } from '@/components/workbench';
import { fetchProjectManagementList } from '@/lib/api/project-management';
import { ATTACHMENT_ACCEPT, ATTACHMENT_HINT, validateAttachmentFile } from '@/lib/upload-rules';
import type { ProjectManagementItem } from '@/lib/types/project-management';
import { fetchCurrentUser } from '@/lib/api/auth';

/** 可手工新建的公告类型。
 *  采购公告（BID_NOTICE）、流标公告（FAILED_BID_NOTICE）、中标公告（WIN_BID_NOTICE）
 *  由系统在项目公告发布向导中生成，不在此手工创建。
 *  2026-10-16 用户裁定：中标公告（PRE_WIN_NOTICE）、成交公告（WIN_NOTICE）、合同公告（CONTRACT_NOTICE）、
 *  履行结果公告（PERFORMANCE_NOTICE）同样收归项目「公告制作与发布」向导（announcement-publish-wizard）
 *  生成——此四类不再提供手工创建入口。 */
type NoticeType =
  | 'ADDENDUM'
  | 'PREQUAL_NOTICE'
  | 'POLICY'
  | 'PLATFORM';

const typeLabel: Record<NoticeType, string> = {
  ADDENDUM: '补遗公告', PREQUAL_NOTICE: '资格预审公告', POLICY: '政策法规', PLATFORM: '平台通知',
};

interface MetaField { key: string; label: string; area?: boolean; date?: boolean }

/** datetime-local 值归一：存量纯日期（2026-07-01）补 T00:00，否则控件显示空；已合规/空原样 */
function toDateInputValue(raw: string): string {
  if (!raw) return '';
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T00:00` : raw;
}
const TYPE_META: Record<NoticeType, MetaField[]> = {
  // C5（GB/T 43711 7.2.6）：采购文件澄清/修改 → 补遗公告（发布后自动通知已获取文件的供应商）
  // projectCode 不在通用网格——移入「关联信息」区块（选择器 + 手填兜底，2026-10-16）
  ADDENDUM: [
    { key: 'changes', label: '澄清/修改内容', area: true },
    { key: 'newDeadline', label: '调整后递交截止', date: true },
  ],
  // 7.2.3 资格预审公告：供应商按公告约定提交资格预审申请
  PREQUAL_NOTICE: [
    { key: 'title', label: '预审名称' },
    { key: 'method', label: '预审方式（合格制/有限数量制）' }, { key: 'applyDeadline', label: '申请截止时间', date: true },
    { key: 'documents', label: '需提交的申请材料', area: true }, { key: 'validUntil', label: '预审结果有效期', date: true },
    { key: 'contact', label: '联系方式' },
  ],
  POLICY: [
    { key: 'docNo', label: '文号' }, { key: 'issuer', label: '发布机关' }, { key: 'effectiveDate', label: '生效日期', date: true },
    { key: 'scope', label: '适用范围', area: true },
  ],
  PLATFORM: [
    { key: 'impactScope', label: '影响范围' }, { key: 'changes', label: '功能变化', area: true }, { key: 'schedule', label: '时间安排' },
    { key: 'guide', label: '操作指引', area: true }, { key: 'support', label: '支持渠道' },
  ],
};

/** 项目绑定类公告：projectCode 字段同步写入 relatedProjectCode（供项目反查/期满派生/发布联动） */
const PROJECT_LINKED_TYPES: NoticeType[] = ['ADDENDUM', 'PREQUAL_NOTICE'];

const Step = ({ n }: { n: number }) => (
  <span className="flex h-[18px] w-[18px] items-center justify-center rounded-md text-[10px] font-extrabold bg-[var(--accent)] text-white">{n}</span>
);

/** 关联条目（项目/公告）选择器弹窗：搜索 + 列表 + 空态，选中即回调（2026-10-16 关联信息区块） */
function LinkOptionPicker({ open, title, hint, busy, options, query, onQuery, onPick, onClose }: {
  open: boolean;
  title: string;
  hint: string;
  busy: boolean;
  options: { id: string; primary: string; secondary?: string | null }[];
  query: string;
  onQuery: (q: string) => void;
  onPick: (id: string) => void;
  onClose: () => void;
}) {
  const q = query.trim().toLowerCase();
  const filtered = q
    ? options.filter(o => o.primary.toLowerCase().includes(q) || (o.secondary || '').toLowerCase().includes(q))
    : options;
  return (
    <Modal open={open} onClose={onClose} title={title} size="xl"
      footer={<span className="text-xs text-[var(--muted-foreground)]">{hint}</span>}>
      <div className="relative mb-3">
        <Search size={14} className="absolute left-3 top-1/2 z-10 -translate-y-1/2 text-[var(--muted-foreground)]" />
        {/* !pl-9：压过 .neu-input 自带 padding-left（操作日志/供应商库同款口径），否则文字与放大镜重叠 */}
        <input autoFocus value={query} onChange={e => onQuery(e.target.value)} placeholder="搜索名称 / 编号…" className="neu-input !pl-9" />
      </div>
      {busy ? (
        <p className="py-8 text-center text-xs text-[var(--muted-foreground)]">加载中…</p>
      ) : filtered.length === 0 ? (
        <p className="py-8 text-center text-xs text-[var(--muted-foreground)]">无可选项</p>
      ) : (
        <div className="max-h-[46vh] space-y-1.5 overflow-y-auto tender-scroll pr-1">
          {filtered.map(o => (
            <button key={o.id} type="button" onClick={() => onPick(o.id)}
              className="w-full rounded-xl border border-[oklch(0.6_0.04_258_/_0.14)] bg-[oklch(1_0_0_/_0.45)] px-4 py-3 text-left transition-all hover:border-[rgba(107,149,240,0.4)] hover:bg-[oklch(1_0_0_/_0.7)]">
              <div className="truncate text-sm font-semibold text-[color:var(--foreground)]">{o.primary}</div>
              {o.secondary && <div className="mt-0.5 truncate font-mono text-[10px] text-[var(--muted-foreground)]">{o.secondary}</div>}
            </button>
          ))}
        </div>
      )}
    </Modal>
  );
}

export default function NewNoticePage() {
  const router = useRouter();
  const [annId, setAnnId] = useState<string | null>(null);
  // 已发布标记：publish 成功后 router.push 生效前的窗口期内，再点「保存草稿」会把
  // 已发布公告降级回 DRAFT——用 ref 拦住（2026-09-29 健壮性复查补充）
  const publishedRef = useRef(false);
  const [type, setType] = useState<NoticeType>('POLICY');
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [summary, setSummary] = useState('');
  const [isTop, setIsTop] = useState(false);
  const [publishDate, setPublishDate] = useState(new Date().toISOString().slice(0, 10));
  const [metadata, setMetadata] = useState<Record<string, string>>({});
  const [publishConfig, setPublishConfig] = useState<PublishConfig>({ ...DEFAULT_PUBLISH_CONFIG });
  const [busy, setBusy] = useState(false);

  const [attachments, setAttachments] = useState<AnnouncementAttachment[]>([]);

  // ── 关联信息（补遗/资格预审，2026-10-16）：关联项目 / 关联采购公告，均限本公司（服务端公司隔离）──
  // 补遗公告、资格预审公告须挂在具体项目上（补遗发布联动/资格预审反查），改自由手输为选择器 + 手填兜底
  const isProjectLinked = type === 'ADDENDUM' || type === 'PREQUAL_NOTICE';
  const [publisher, setPublisher] = useState(''); // 发布单位（登录人公司，发布时标明）
  const [linkedProject, setLinkedProject] = useState<{ id: string; title: string; projectCode?: string | null } | null>(null);
  const [linkedAnnouncement, setLinkedAnnouncement] = useState<{ id: string; title: string; relatedProjectCode?: string | null } | null>(null);
  const [projectPickerOpen, setProjectPickerOpen] = useState(false);
  const [annPickerOpen, setAnnPickerOpen] = useState(false);
  const [projectOptions, setProjectOptions] = useState<ProjectManagementItem[] | null>(null); // null=未加载
  const [annOptions, setAnnOptions] = useState<{ id: string; title: string; relatedProjectCode?: string | null; publishDate?: string | null }[] | null>(null);
  const [pickerBusy, setPickerBusy] = useState(false);
  const [projectQuery, setProjectQuery] = useState('');
  const [annQuery, setAnnQuery] = useState('');

  const onTypeChange = (t: NoticeType) => {
    setType(t); setMetadata({});
    setLinkedProject(null); setLinkedAnnouncement(null); setProjectQuery(''); setAnnQuery('');
  };

  // 发布单位：登录人公司（后端 create 时 stampFor 落 companyName 快照，此处仅展示口径一致）
  useEffect(() => { fetchCurrentUser().then(u => setPublisher(u.company || '')).catch(() => {}); }, []);

  const openProjectPicker = () => {
    setProjectPickerOpen(true);
    if (projectOptions === null) {
      setPickerBusy(true);
      // GET /project-management 已按登录人公司隔离（非 admin 强制本公司；admin 默认全部公司视野）
      fetchProjectManagementList('ACTIVE')
        .then(setProjectOptions)
        .catch(() => { toast.error('项目列表加载失败'); setProjectOptions([]); })
        .finally(() => setPickerBusy(false));
    }
  };

  const openAnnPicker = () => {
    setAnnPickerOpen(true);
    if (annOptions === null) {
      setPickerBusy(true);
      // GET /announcements 已按登录人公司隔离；仅列已发布采购公告（补遗/预审的对象）
      listAnnouncements({ type: 'BID_NOTICE', status: 'PUBLISHED', pageSize: 100 })
        .then(res => setAnnOptions(res.items || []))
        .catch(() => { toast.error('公告列表加载失败'); setAnnOptions([]); })
        .finally(() => setPickerBusy(false));
    }
  };

  const pickProject = (id: string) => {
    const p = (projectOptions || []).find(x => x.id === id);
    if (!p) return;
    setLinkedProject(p);
    setMetadata(prev => ({ ...prev, projectCode: p.projectCode || '' }));
    // 标题为空时按类型给建议标题（可改）
    if (!title.trim()) setTitle(type === 'ADDENDUM' ? `关于「${p.title}」的补遗公告` : `${p.title}资格预审公告`);
    setProjectPickerOpen(false); setProjectQuery('');
  };

  const pickAnnouncement = (id: string) => {
    const a = (annOptions || []).find(x => x.id === id);
    if (!a) return;
    setLinkedAnnouncement(a);
    setMetadata(prev => ({
      ...prev,
      relatedAnnouncementTitle: a.title,
      // 关联公告可带出项目编号（采购公告发布时必挂 relatedProjectCode）；未带则不覆盖已填值
      ...(a.relatedProjectCode && !prev.projectCode ? { projectCode: a.relatedProjectCode } : {}),
    }));
    setAnnPickerOpen(false); setAnnQuery('');
  };

  const loadExtras = useCallback(async () => {
    if (!annId) return;
    try { setAttachments(await listAttachments(annId)); } catch {}
  }, [annId]);
  useEffect(() => { loadExtras(); }, [loadExtras]);

  const saveNew = async (targetStatus: AnnouncementStatus): Promise<string | null> => {
    if (!title.trim()) { toast.error('请填写标题'); return null; }
    // 定时发布模式下「发布」按钮实际保存为 DRAFT（scheduler 到点自动发布）
    const actualStatus: AnnouncementStatus =
      targetStatus === 'PUBLISHED' && publishConfig.scheduleMode === 'scheduled' && publishConfig.scheduledPublishDate
        ? 'DRAFT'
        : targetStatus;
    if (targetStatus === 'PUBLISHED' && publishConfig.visibility === 'RESTRICTED' && publishConfig.restrictedSupplierIds.length === 0) {
      toast.error('部分供应商可见模式下请至少选择一家供应商');
      return null;
    }
    setBusy(true);
    const meta: Record<string, any> = {};
    for (const f of TYPE_META[type]) if (metadata[f.key]?.trim()) meta[f.key] = metadata[f.key].trim();
    // 关联信息（2026-10-16）：projectCode/relatedAnnouncementTitle 移入选择器区块、不在 TYPE_META，须显式带走
    if (isProjectLinked) {
      if (metadata.projectCode?.trim()) meta.projectCode = metadata.projectCode.trim();
      if (metadata.relatedAnnouncementTitle?.trim()) meta.relatedAnnouncementTitle = metadata.relatedAnnouncementTitle.trim();
    }
    // draft 闸（2026-10-23 修正）：剥除定时字段的判定须看**用户动作**（targetStatus）而非落库态
    // （actualStatus）——定时发布落库态也是 DRAFT，此前误用 actualStatus 把 scheduledPublishDate
    // 一并剥掉 → 草稿永无定时元数据、scheduler 永不发布（补遗定时失效实录）。保存草稿（动作=DRAFT）
    // 仍剥除，防止草稿被误定时。
    const finalMeta = configToMetadata(publishConfig, meta, { draft: targetStatus === 'DRAFT' });
    const payload: any = { title, content, type, summary, status: actualStatus, isTop, publishDate, metadata: finalMeta };
    // 项目绑定类公告挂项目编号：补遗公告供发布联动（补遗计数 + 供应商定向通知）；
    // 资格预审公告供项目反查与列表关联（中标/成交/合同/履行结果四类已收归项目向导，2026-10-16）
    if (PROJECT_LINKED_TYPES.includes(type) && meta.projectCode) payload.relatedProjectCode = meta.projectCode;
    try {
      // P0 修复（2026-09-28 审计）：已保存过草稿（annId 存在）时必须 update 原记录——
      // 此前无条件 create，导致「保存草稿→传附件→发布」必产生孤儿草稿且附件滞留旧记录，
      // 多次点「保存草稿」也会每点新建一条
      const saved = annId
        ? await updateAnnouncement(annId, payload)
        : await createAnnouncement(payload);
      setAnnId(saved.id);
      return saved.id;
    } catch (e: any) { toast.error(e?.message || '保存失败'); return null; }
    finally { setBusy(false); }
  };

  const saveDraft = async () => {
    if (publishedRef.current) { toast.error('公告已发布，如需调整请从详情页操作'); return; }
    const id = await saveNew('DRAFT'); if (id) { toast.success('草稿已保存，可上传附件'); loadExtras(); }
  };
  const publish = async () => {
    if (publishConfig.scheduleMode === 'scheduled' && !publishConfig.scheduledPublishDate) {
      toast.error('请设置定时发布时间');
      return;
    }
    const id = await saveNew('PUBLISHED');
    if (id) {
      publishedRef.current = true;
      toast.success(publishConfig.scheduleMode === 'scheduled' ? `已设定定时发布（${publishConfig.scheduledPublishDate.replace('T', ' ')}）` : '已发布');
      router.push(`/notice/${id}`);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      {/* page-hero — 标题卡片 */}
      <div className="page-hero">
        <div className="page-hero__row">
          <div className="page-hero__left">
            <div className="page-hero__icon">
              <PlusCircle size={17} />
            </div>
            <div>
              <div className="page-hero__title">新建公告</div>
              <div className="page-hero__sub">{typeLabel[type]} — 填写基本信息后保存草稿，配齐附件后发布</div>
            </div>
          </div>
          <div className="page-hero__right">
            <button onClick={() => router.push('/notice')} className="neu-btn-soft">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
              返回信息列表
            </button>
          </div>
        </div>
      </div>

      {/* 提示条 */}
      {!annId && (
        <div className="rounded-lg px-4 py-2.5 text-xs font-medium text-[var(--accent-strong)]"
          style={{ background: 'color-mix(in oklch, var(--accent-soft), transparent 50%)', boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.4)' }}>
          先填写基本信息并「保存草稿」后，才能上传附件；全部配齐后再「发布」。
        </div>
      )}

      {/* 表单卡片 — neu-table-card */}
      <div className="neu-table-card p-5 space-y-6">
        {/* ① 信息类型 */}
        <fieldset>
          <legend className="flex items-center gap-2 mb-3 text-xs font-bold uppercase tracking-[0.1em] text-[var(--muted-foreground)]">
            <Step n={1} />信息类型
          </legend>
          <div className="neu-tab-bar">
            {(Object.keys(typeLabel) as NoticeType[]).sort((a, b) => ANNOUNCEMENT_TYPE_ORDER.indexOf(a) - ANNOUNCEMENT_TYPE_ORDER.indexOf(b)).map((t, i, arr) => (
              <span key={t} className="flex items-center gap-1">
                {i > 0 && announcementTypeGroupIndex(t) !== announcementTypeGroupIndex(arr[i - 1]) && (
                  <span className="mx-1.5 h-4 w-px shrink-0 bg-[var(--border)]" aria-hidden="true" />
                )}
                <button
                  onClick={() => onTypeChange(t)}
                  className={`neu-tab ${type === t ? 'is-active' : ''}`}
                  disabled={!!annId}
                >
                  {typeLabel[t]}
                </button>
              </span>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-[var(--muted-foreground)]">
            采购公告、流标公告、中标公告、成交公告、合同公告、履行结果公告由系统在项目的「公告制作与发布」向导中生成，不在此手工创建。
          </p>
        </fieldset>

        <hr className="wb-section-rule" />

        {/* ② 基本信息 */}
        <fieldset>
          <legend className="flex items-center gap-2 mb-3 text-xs font-bold uppercase tracking-[0.1em] text-[var(--muted-foreground)]">
            <Step n={2} />基本信息
          </legend>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <label className="space-y-1">
              <span className="text-xs font-semibold text-[var(--muted-foreground)]">当前状态</span>
              <input value="草稿" disabled className="neu-input text-[var(--muted-foreground)]" />
            </label>
            <label className="space-y-1">
              <span className="text-xs font-semibold text-[var(--muted-foreground)]">发布日期</span>
              <input type="date" value={publishDate} onChange={e => setPublishDate(e.target.value)} className="neu-input" />
            </label>
            {/* 发布单位（2026-10-16）：发布的公告必须标明公司——创建时后端按登录人 stampFor 落快照，此处同步展示 */}
            <label className="space-y-1">
              <span className="text-xs font-semibold text-[var(--muted-foreground)]">发布单位</span>
              <input value={publisher || '（账号未归属公司，发布后将无法标明）'} disabled
                className={`neu-input ${publisher ? 'text-[var(--foreground)]' : 'text-[var(--danger)]'}`} />
            </label>
          </div>
          <label className="space-y-1 mt-4 block">
            <span className="text-xs font-semibold text-[var(--muted-foreground)]">标题</span>
            <input value={title} onChange={e => setTitle(e.target.value)} className="neu-input" placeholder="信息标题..." />
          </label>
          <label className="flex items-center gap-2 mt-3 text-sm text-[var(--muted-foreground)] cursor-pointer">
            <input type="checkbox" checked={isTop} onChange={e => setIsTop(e.target.checked)} className="neu-checkbox" />置顶
          </label>
        </fieldset>

        <hr className="wb-section-rule" />

        {/* ③ 关联信息（补遗/资格预审）：选择器限本公司项目/公告（服务端公司隔离），保留手填兜底 */}
        {isProjectLinked && (
          <fieldset>
            <legend className="flex items-center gap-2 mb-3 text-xs font-bold uppercase tracking-[0.1em] text-[var(--muted-foreground)]">
              <Step n={3} />关联信息（仅本公司项目 / 公告）
            </legend>
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" onClick={openProjectPicker} className="neu-btn-soft"><FolderKanban size={14} />选择关联项目</button>
                {linkedProject ? (
                  <span className="inline-flex max-w-full items-center gap-1.5 rounded-lg border border-[oklch(0.6_0.04_258_/_0.16)] bg-[color-mix(in_oklch,var(--accent)_7%,transparent)] px-2.5 py-1.5 text-xs text-[color:var(--foreground)]">
                    {linkedProject.projectCode && <span className="font-mono text-[10px] text-[var(--accent-strong)]">{linkedProject.projectCode}</span>}
                    <span className="truncate font-semibold">{linkedProject.title}</span>
                    <button type="button" aria-label="清除关联项目" title="清除关联项目"
                      onClick={() => { setLinkedProject(null); setMetadata(prev => ({ ...prev, projectCode: '' })); }}
                      className="ml-0.5 rounded p-0.5 text-[var(--muted-foreground)] transition-colors hover:bg-[oklch(0.55_0.04_258_/_0.1)] hover:text-[var(--danger)]">
                      <X size={12} />
                    </button>
                  </span>
                ) : (
                  <span className="text-xs text-[var(--muted-foreground)]">未选择——可先选项目（自动带出编号与建议标题），或用下方项目编号手填</span>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" onClick={openAnnPicker} className="neu-btn-soft"><Megaphone size={14} />选择关联采购公告</button>
                {linkedAnnouncement ? (
                  <span className="inline-flex max-w-full items-center gap-1.5 rounded-lg border border-[oklch(0.6_0.04_258_/_0.16)] bg-[color-mix(in_oklch,var(--accent)_7%,transparent)] px-2.5 py-1.5 text-xs text-[color:var(--foreground)]">
                    <span className="truncate font-semibold">{linkedAnnouncement.title}</span>
                    <button type="button" aria-label="清除关联公告" title="清除关联公告"
                      onClick={() => { setLinkedAnnouncement(null); setMetadata(prev => ({ ...prev, relatedAnnouncementTitle: '' })); }}
                      className="ml-0.5 rounded p-0.5 text-[var(--muted-foreground)] transition-colors hover:bg-[oklch(0.55_0.04_258_/_0.1)] hover:text-[var(--danger)]">
                      <X size={12} />
                    </button>
                  </span>
                ) : (
                  <span className="text-xs text-[var(--muted-foreground)]">可选——关联本公司的已发布采购公告，自动带出其项目编号</span>
                )}
              </div>
              {/* 手填兜底：项目编号随 PROJECT_LINKED_TYPES 写入 relatedProjectCode（发布联动/项目反查） */}
              <label className="block max-w-md space-y-1">
                <span className="text-xs font-semibold text-[var(--muted-foreground)]">项目编号（选择项目自动带出，可手填修正）</span>
                <input value={metadata.projectCode || ''} onChange={e => setMetadata({ ...metadata, projectCode: e.target.value })}
                  placeholder="如 SWHI-TP-2026101301" className="neu-input font-mono" />
              </label>
            </div>
          </fieldset>
        )}

        {isProjectLinked && <hr className="wb-section-rule" />}

        {/* ③/④ 结构化元数据（有项目关联区块时顺延一步） */}
        <fieldset>
          <legend className="flex items-center gap-2 mb-3 text-xs font-bold uppercase tracking-[0.1em] text-[var(--muted-foreground)]">
            <Step n={isProjectLinked ? 4 : 3} />{typeLabel[type]} — 结构化信息（按字段填写，不混入正文）
          </legend>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {TYPE_META[type].map(f => {
              const val = metadata[f.key] || '';
              return (
                <div key={f.key} className={f.area ? 'sm:col-span-2' : ''}>
                  <label className="space-y-1">
                    <span className="text-xs font-semibold text-[var(--muted-foreground)]">{f.label}</span>
                    {f.area
                      ? <textarea value={val} onChange={e => setMetadata({ ...metadata, [f.key]: e.target.value })} className="neu-input h-20 resize-y" />
                      : f.date
                        ? <input type="datetime-local" value={toDateInputValue(val)} onChange={e => setMetadata({ ...metadata, [f.key]: e.target.value })} className="neu-input" />
                        : <input value={val} onChange={e => setMetadata({ ...metadata, [f.key]: e.target.value })} className="neu-input" />
                    }
                  </label>
                </div>
              );
            })}
          </div>
        </fieldset>

        <hr className="wb-section-rule" />

        {/* ⑤ 正文 */}
        <fieldset>
          <legend className="flex items-center gap-2 mb-3 text-xs font-bold uppercase tracking-[0.1em] text-[var(--muted-foreground)]">
            <Step n={isProjectLinked ? 5 : 4} />正文内容
          </legend>
          <RichTextEditor value={content} onChange={setContent} placeholder="开始输入正文内容..." />
          {/* 摘要输入已删（2026-10-16 用户裁定）：summary state 保留恒空传参，公开页摘要展示回退 aiSummary/正文截取 */}
        </fieldset>

        <hr className="wb-section-rule" />

        {/* ⑤ 发布配置 */}
        <fieldset>
          <legend className="flex items-center gap-2 mb-3 text-xs font-bold uppercase tracking-[0.1em] text-[var(--muted-foreground)]">
            <Step n={isProjectLinked ? 6 : 5} />发布配置
          </legend>
          <PublishConfigSection config={publishConfig} onChange={setPublishConfig} />
        </fieldset>

        {/* ⑥ 附件 — 保存草稿后显示 */}
        {annId ? (
          <>
            <hr className="wb-section-rule" />
            <fieldset>
              <legend className="flex items-center gap-2 mb-3 text-xs font-bold uppercase tracking-[0.1em] text-[var(--muted-foreground)]">
                <Step n={isProjectLinked ? 7 : 6} />附件（公开可下载）
              </legend>
              <AttachmentUploader annId={annId} attachments={attachments} onChanged={loadExtras} />
            </fieldset>
          </>
        ) : (
          <>
            <hr className="wb-section-rule" />
            <p className="text-xs text-[var(--muted-foreground)] py-2">保存草稿后可上传附件</p>
          </>
        )}

        {/* 操作栏 */}
        <div className="flex items-center justify-between gap-3 pt-4 border-t border-[color-mix(in_oklch,var(--muted-foreground)_16%,transparent)]">
          <span className="text-xs text-[var(--muted-foreground)]">{annId ? 'ID: ' + annId.slice(-8) : '未保存'}</span>
          <div className="flex gap-3">
            <button onClick={() => router.push('/notice')} className="neu-btn-soft">取消</button>
            <button onClick={saveDraft} disabled={busy} className="neu-btn-soft is-info disabled:opacity-50">
              <Save size={14} />{busy ? '保存中...' : '保存草稿'}
            </button>
            <button onClick={publish} disabled={busy} className="neu-btn-primary disabled:opacity-50">
              <Send size={14} />{busy ? '处理中...' : publishConfig.scheduleMode === 'scheduled' ? '设定时发布' : '发布'}
            </button>
          </div>
        </div>
      </div>

      {/* 关联选择器弹窗：数据源均为公司隔离端点（非 admin 服务端强制本公司；admin 默认全部视野） */}
      {isProjectLinked && (
        <>
          <LinkOptionPicker
            open={projectPickerOpen} title="选择关联项目（本公司）"
            hint="项目列表按登录人公司隔离——仅本公司项目可选（admin 为全部公司视野）"
            busy={pickerBusy && projectOptions === null}
            options={(projectOptions || []).map(p => ({ id: p.id, primary: p.title, secondary: p.projectCode }))}
            query={projectQuery} onQuery={setProjectQuery} onPick={pickProject}
            onClose={() => setProjectPickerOpen(false)}
          />
          <LinkOptionPicker
            open={annPickerOpen} title="选择关联采购公告（本公司）"
            hint="仅列本公司的已发布采购公告；选中后自动带出其项目编号"
            busy={pickerBusy && annOptions === null}
            options={(annOptions || []).map(a => ({
              id: a.id, primary: a.title,
              secondary: [a.relatedProjectCode, a.publishDate ? new Date(a.publishDate).toLocaleDateString('zh-CN') + ' 发布' : ''].filter(Boolean).join(' · '),
            }))}
            query={annQuery} onQuery={setAnnQuery} onPick={pickAnnouncement}
            onClose={() => setAnnPickerOpen(false)}
          />
        </>
      )}
    </div>
  );
}

/* 附件上传器 */
function AttachmentUploader({ annId, attachments, onChanged }: { annId: string; attachments: AnnouncementAttachment[]; onChanged: () => void }) {
  const [title, setTitle] = useState('');
  const [uploading, setUploading] = useState(false);
  const { confirm, dialog } = useConfirm();
  // 附件统一限制（2026-10-19）：多选 + 100MB + 9 扩展白名单，坏文件当场提示并剔除
  const onUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    const invalid = files.map((f) => validateAttachmentFile(f)).filter(Boolean) as string[];
    const okFiles = files.filter((f) => !validateAttachmentFile(f));
    if (invalid.length > 0) toast.error(invalid[0] + (invalid.length > 1 ? ` 等 ${invalid.length} 个文件被跳过` : ''));
    if (okFiles.length === 0) { e.target.value = ''; return; }
    setUploading(true);
    let done = 0;
    for (const f of okFiles) {
      try { const asset = await uploadFile(f, 'announcement'); await addAttachment(annId, asset.id, title || f.name); done++; }
      catch (err: any) { toast.error(`${f.name}：${err?.message || '上传失败'}`); }
    }
    if (done > 0) { setTitle(''); toast.success(`已添加 ${done} 个附件`); }
    setUploading(false); e.target.value = ''; onChanged();
  };
  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <input value={title} onChange={e => setTitle(e.target.value)} placeholder="附件标题（可选）" className="neu-input flex-1" />
        <label className={'neu-btn-primary cursor-pointer whitespace-nowrap ' + (uploading ? 'opacity-50' : '')}>
          <Upload size={14} />{uploading ? '上传中...' : '添加附件'}
          <input type="file" multiple accept={ATTACHMENT_ACCEPT} className="hidden" onChange={onUpload} />
        </label>
      </div>
      <p className="text-[11px] text-[var(--muted-foreground)]">{ATTACHMENT_HINT}，可选择多个文件</p>
      {attachments.length === 0 ? <p className="text-xs text-[var(--muted-foreground)]">暂无附件</p> : attachments.map(a => (
        <div key={a.id} className="neu-attachment-item">
          <div><div className="text-sm font-semibold text-[var(--foreground)]">{a.title}</div><div className="text-xs text-[var(--muted-foreground)]">{a.fileAsset.originalName} · {(a.fileAsset.size / 1024).toFixed(0)} KB</div></div>
          <button onClick={async () => { if (!(await confirm({ message: '删除该附件？', danger: true }))) return; await removeAttachment(a.id); onChanged(); }} className="neu-btn-xs is-danger">删除</button>
        </div>
      ))}
      {dialog}
    </div>
  );
}
