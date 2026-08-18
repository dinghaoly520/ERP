'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  getAnnouncement, updateAnnouncement, deleteAnnouncement,
  listAttachments, addAttachment, removeAttachment, uploadFile,
  getBidDocument, uploadBidDocument, updateBidDocumentConfig, confirmBidDocPayment, removeBidDocument,
  generateSummary,
} from '@/lib/api/announcement';
import type { AnnouncementListItem, AnnouncementType, AnnouncementStatus, AnnouncementAttachment, BidDocumentManage } from '@/lib/api/announcement';
import { getSupplierList } from '@/lib/api/supplier';
import type { Supplier } from '@/lib/types';
import { StatusBadge } from '@/components/workbench';
import { ArrowLeft, Pencil, X, Trash2, Megaphone, Upload, Sparkles } from 'lucide-react';
import { RichTextEditor } from '@/components/rich-text-editor';
import { PublishConfigSection, configFromMetadata, configToMetadata, type PublishConfig } from '@/components/notice/publish-config-section';

/* ── 类型/状态标签 ── */
const typeTone: Record<AnnouncementType, 'blue' | 'green' | 'orange' | 'gray'> = {
  BID_NOTICE: 'blue', WIN_NOTICE: 'green', POLICY: 'orange', PLATFORM: 'gray',
};
const typeLabel: Record<AnnouncementType, string> = {
  BID_NOTICE: '采购公告', WIN_NOTICE: '中标公告', POLICY: '政策法规', PLATFORM: '平台通知',
};
const statusTone: Record<AnnouncementStatus, 'green' | 'gray'> = {
  DRAFT: 'gray', PUBLISHED: 'green', ARCHIVED: 'gray',
};
const statusLabel: Record<AnnouncementStatus, string> = {
  DRAFT: '草稿', PUBLISHED: '已发布', ARCHIVED: '已归档',
};

interface MetaField { key: string; label: string; area?: boolean; date?: boolean }
const TYPE_META: Record<AnnouncementType, MetaField[]> = {
  BID_NOTICE: [
    { key: 'projectCode', label: '项目编号' }, { key: 'method', label: '招标方式' }, { key: 'budget', label: '预算金额' },
    { key: 'scope', label: '采购内容/范围', area: true }, { key: 'qualification', label: '投标人资格要求', area: true },
    { key: 'downloadDeadline', label: '采购文件下载时间' },
    { key: 'deadline', label: '报名/投标截止', date: true }, { key: 'openTime', label: '开标时间', date: true }, { key: 'contact', label: '联系方式' },
  ],
  WIN_NOTICE: [
    { key: 'projectCode', label: '项目编号' }, { key: 'winner', label: '中标供应商' }, { key: 'amount', label: '中标金额' },
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

export default function NoticeDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [ann, setAnn] = useState<AnnouncementListItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    getAnnouncement(id).then(setAnn).catch(() => setAnn(null)).finally(() => setLoading(false));
  }, [id]);

  if (loading) return (
    <div className="flex flex-col gap-4">
      <div className="h-4 w-24 animate-pulse rounded bg-[var(--muted)]" />
      <div className="page-hero h-28 animate-pulse" />
      <div className="h-64 w-full animate-pulse rounded-[20px] bg-[var(--muted)]" />
    </div>
  );
  const handleDelete = () => {
    if (!ann || !confirm(`确认删除「${ann.title}」？`)) return;
    deleteAnnouncement(ann.id)
      .then(() => { toast.success("已删除"); router.push("/notice"); })
      .catch((e: any) => toast.error(e?.message || "删除失败"));
  };

  if (!ann) return (
    <div className="flex flex-col items-center gap-3 py-24">
      <div className="neu-icon-well flex h-16 w-16 items-center justify-center rounded-2xl">
        <Megaphone size={24} className="text-[var(--muted-foreground)]" />
      </div>
      <p className="text-sm font-semibold text-[var(--foreground)]">信息不存在</p>
      <button onClick={() => router.push('/notice')} className="neu-btn-soft">返回列表</button>
    </div>
  );

  return (
    <div className="flex flex-col gap-5">
      <button onClick={() => router.push('/notice')} className="flow-back shrink-0 self-start">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="flow-back-arrow">
          <path d="M15 18l-6-6 6-6" />
        </svg>
        返回信息列表
      </button>

      <div className="page-hero">
        <div className="page-hero__row">
          <div className="page-hero__left">
            <div className="page-hero__icon">
              <Megaphone size={17} />
            </div>
            <div className="min-w-0">
              <div className="page-hero__title truncate">{ann.title}</div>
              <div className="page-hero__sub">
                {typeLabel[ann.type]}
                {ann.publishDate && <span> · {new Date(ann.publishDate).toLocaleDateString('zh-CN')} 发布</span>}
                <span> · 浏览 {ann.viewCount}</span>
              </div>
            </div>
          </div>
          <div className="page-hero__right">
            <StatusBadge tone={statusTone[ann.status]}>{statusLabel[ann.status]}</StatusBadge>
            <StatusBadge tone={typeTone[ann.type]}>{typeLabel[ann.type]}</StatusBadge>
            {ann.isTop && <StatusBadge tone="red">置顶</StatusBadge>}
            {!editing ? (
              <>
                <button onClick={() => setEditing(true)} className="neu-btn-soft"><Pencil size={14} /> 编辑</button>
                <button onClick={handleDelete} className="neu-btn-soft is-danger"><Trash2 size={14} /> 删除</button>
              </>
            ) : (
              <button onClick={() => setEditing(false)} className="neu-btn-soft"><X size={14} /> 取消编辑</button>
            )}
          </div>
        </div>

        {/* 结构化元数据（仅阅读模式且有数据时） */}
        {!editing && renderMeta(ann)}
      </div>

      {editing ? (
        <EditView ann={ann} onCancel={() => setEditing(false)} onSaved={(updated) => { setAnn(updated); setEditing(false); }} />
      ) : (
        <ReadOnlyView ann={ann} />
      )}
    </div>
  );
}

/* ════════ renderMeta  — 结构化元数据芯片（从 IIFE 提取为独立函数）════════ */
function renderMeta(ann: AnnouncementListItem) {
  const meta = (ann.metadata || {}) as Record<string, any>;
  // amount 无顶层值时从 winner.price 兜底（WIN_NOTICE 中标公示草稿）
  const hasVal = (f: { key: string }) => !!meta[f.key] || (f.key === 'amount' && meta.winner?.price != null);
  const allFields = TYPE_META[ann.type].filter(hasVal);
  if (allFields.length === 0) return null;
  const shortFields = allFields.filter(f => !f.area);
  const areaFields = allFields.filter(f => f.area);
  return (
    <div style={{ borderTop: "1px solid oklch(0.6 0.04 258 / 0.16)", paddingTop: "0.75rem" }}>
      <div className="flex flex-col gap-2.5">
        {shortFields.length > 0 && (
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            {shortFields.map(f => {
              // 对象/数组展平：WIN_NOTICE 的 metadata.winner 是对象（供应商名+报价等），
              // 直接渲染对象会抛 "Objects are not valid as a React child" 崩溃页面。
              let raw = meta[f.key];
              if (f.key === 'amount' && !raw && meta.winner?.price != null) raw = meta.winner.price;
              if (raw && typeof raw === 'object') {
                raw = Array.isArray(raw)
                  ? raw.map((x: any) => x?.supplierName ?? x?.name ?? '').filter(Boolean).join('、')
                  : (raw.supplierName ?? raw.name ?? JSON.stringify(raw));
              }
              let display = raw;
              if (f.date && raw) {
                const parsed = new Date(raw);
                display = Number.isNaN(parsed.getTime())
                  ? "待定"
                  : parsed.toLocaleDateString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
              }
              if ((f.key === "budget" || f.key === "amount") && raw) {
                const n = Number(raw);
                if (!isNaN(n) && n >= 10000) display = (n / 10000).toFixed(0) + " 万元";
              }
              const isCode = f.key === "projectCode" || f.key === "docNo";
              const isMoney = f.key === "budget" || f.key === "amount";
              const isDate = f.date;
              const labelColor = isCode ? "text-[var(--accent)]" : isMoney ? "text-[var(--success)]" : isDate ? "text-[var(--warning)]" : "text-[var(--muted-foreground)]";
              const valueClass = isCode ? "text-[var(--accent-strong)] font-mono tracking-[-0.02em]" : isMoney ? "text-[var(--success)] font-black text-[0.85rem] tabular-nums" : "text-[var(--foreground)]";
              return (
                <span key={f.key} className="inline-flex items-center gap-2 rounded-[8px] bg-[var(--surface)] px-3 py-1.5 shadow-[inset_0_1px_0_oklch(1_0_0/0.55),1px_1px_2px_oklch(0.55_0.03_258/0.06),-1px_-1px_1px_oklch(1_0_0/0.7)]">
                  <span className={"text-[0.65rem] font-bold uppercase tracking-[0.08em] " + labelColor}>{f.label}</span>
                  <span className={"text-[0.75rem] font-semibold " + valueClass}>{display}</span>
                </span>
              );
            })}
          </div>
        )}
        {areaFields.map(f => (
          <div key={f.key} className="rounded-[10px] bg-[var(--accent-soft)]/20 px-4 py-3 shadow-[inset_0_1px_0_oklch(1_0_0/0.4),inset_1px_1px_3px_oklch(0.55_0.03_258/0.06),inset_-1px_-1px_3px_oklch(1_0_0/0.6)]">
            <span className="text-[0.6rem] font-bold uppercase tracking-[0.1em] text-[var(--accent-strong)]/70">{f.label}</span>
            <p className="mt-1.5 text-[0.78rem] leading-relaxed text-[var(--foreground)] whitespace-pre-wrap">{meta[f.key]}</p>
          </div>
        ))}
      </div>
      </div>
  );
}

/* ════════════ 只读展示 ════════════ */
function ReadOnlyView({ ann }: { ann: AnnouncementListItem }) {
  const [attachments, setAttachments] = useState<AnnouncementAttachment[]>([]);
  const [bidDoc, setBidDoc] = useState<BidDocumentManage | null>(null);
  const [localAiSummary, setLocalAiSummary] = useState<string | undefined>(ann.aiSummary);
  useEffect(() => {
    listAttachments(ann.id).then(setAttachments).catch(() => {});
    if (ann.type === 'BID_NOTICE') getBidDocument(ann.id).then(setBidDoc).catch(() => setBidDoc(null));
  }, [ann.id, ann.type]);

  const aiSummary = localAiSummary ?? ann.aiSummary;

  const handleGenerateSummary = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const btn = e.currentTarget as HTMLButtonElement;
    btn.disabled = true;
    try {
      const result = await generateSummary(ann.id);
      if (result.aiSummary) { setLocalAiSummary(result.aiSummary); toast.success("摘要已生成"); }
      else { toast.error("AI 返回空摘要"); }
    } catch (err: any) { toast.error(err?.message || "生成失败"); }
    finally { btn.disabled = false; }
  };

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
      {/* 左列：正文 —— 凸起卡片 */}
      <div className="neu-table-card min-w-0">
        <div className="p-5 sm:p-6">
          {ann.content ? (
            <div
              className="prose prose-sm text-[var(--foreground)] leading-relaxed break-words [&_table]:w-full [&_table]:border-collapse [&_table_td]:border [&_table_td]:border-[var(--border)] [&_table_td]:px-3 [&_table_td]:py-2 [&_table_td]:break-all [&_table_th]:border [&_table_th]:border-[var(--border)] [&_table_th]:px-3 [&_table_th]:py-2 [&_table_th]:bg-[var(--muted)]/60 [&_h2]:text-lg [&_h2]:font-bold [&_h2]:mt-5 [&_h2]:mb-2 [&_h3]:text-base [&_h3]:font-semibold [&_h3]:mt-4 [&_p]:mb-3 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5"
              dangerouslySetInnerHTML={{ __html: ann.content }}
            />
          ) : (
            <p className="py-12 text-center text-sm text-[var(--muted-foreground)]">暂无正文内容</p>
          )}
        </div>
      </div>

      {/* 右列：附件 + 招标文件 + 摘要 —— 全部凸起卡片，无可见框线 */}
      <div className="flex flex-col gap-4 min-w-0">
        {attachments.length > 0 && (
          <div className="neu-table-card p-4">
            <div className="flex items-center gap-2 mb-3">
              <span className="text-xs font-bold tracking-[0.06em] uppercase text-[var(--muted-foreground)]">附件</span>
              <span className="neu-tab-count ml-auto">{attachments.length}</span>
            </div>
            <div className="flex flex-col gap-1.5">
              {attachments.map(a => (
                <a key={a.id} href={"/api/upload/files/" + a.fileAsset.id} target="_blank" rel="noreferrer"
                  className="flex items-center justify-between rounded-[8px] bg-[var(--surface)] px-3 py-2 text-sm font-medium text-[var(--accent)] shadow-[inset_0_1px_0_oklch(1_0_0/0.5),1px_1px_2px_oklch(0.55_0.03_258/0.05),-1px_-1px_1px_oklch(1_0_0/0.6)] transition-shadow hover:shadow-[inset_0_1px_0_oklch(1_0_0/0.6),2px_2px_4px_oklch(0.55_0.03_258/0.1),-1px_-1px_2px_oklch(1_0_0/0.7)]">
                  <span className="min-w-0 break-words leading-snug">{a.title}</span>
                  <span className="ml-2 shrink-0 text-[11px] text-[var(--muted-foreground)] tabular-nums">{(a.fileAsset.size / 1024).toFixed(0)} KB</span>
                </a>
              ))}
            </div>
          </div>
        )}
        {bidDoc && (
          <div className="neu-table-card p-4">
            <span className="text-xs font-bold tracking-[0.06em] uppercase text-[var(--muted-foreground)]">采购文件</span>
            <div className="mt-3 rounded-[10px] bg-[var(--surface)] p-3 shadow-[inset_0_1px_0_oklch(1_0_0/0.5),1px_1px_3px_oklch(0.55_0.03_258/0.06),-1px_-1px_2px_oklch(1_0_0/0.6)]">
              <p className="text-sm font-bold text-[var(--foreground)] break-words leading-snug">🔒 {bidDoc.title}</p>
              <p className="mt-1 text-[11px] text-[var(--muted-foreground)] break-words leading-snug">{bidDoc.fileName} · {(bidDoc.fileSize / 1024).toFixed(0)} KB · {bidDoc.downloadCount} 次下载</p>
              {bidDoc.requirePayment && <span className="mt-1 inline-flex text-[11px] font-semibold text-[var(--warning)]">需付费下载</span>}
            </div>
          </div>
        )}
        <div className="neu-table-card p-4">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-xs font-bold tracking-[0.06em] uppercase text-[var(--muted-foreground)]">摘要</span>
            <button
              onClick={handleGenerateSummary}
              className="neu-btn-xs ml-auto shrink-0"
            ><Sparkles size={11} /> AI 摘要</button>
          </div>
          <p className="text-[0.8rem] leading-relaxed text-[var(--foreground)] whitespace-pre-wrap break-words">{aiSummary || '点击「AI 摘要」按钮生成'}</p>
        </div>
      </div>
    </div>
  );
}

/* ════════════ 编辑视图 ════════════ */
function EditView({ ann, onCancel, onSaved }: { ann: AnnouncementListItem; onCancel: () => void; onSaved: (updated: AnnouncementListItem) => void }) {
  const [type, setType] = useState<AnnouncementType>(ann.type);
  const [title, setTitle] = useState(ann.title);
  const [content, setContent] = useState(ann.content);
  const [summary, setSummary] = useState(ann.summary || '');
  const [status, setStatus] = useState<AnnouncementStatus>(ann.status);
  const [isTop, setIsTop] = useState(ann.isTop);
  const [publishDate, setPublishDate] = useState(ann.publishDate ? ann.publishDate.slice(0, 10) : new Date().toISOString().slice(0, 10));
  const buildMeta = (t: AnnouncementType) => {
    const out: Record<string, string> = {};
    const m = (ann.metadata || {}) as Record<string, any>;
    for (const f of TYPE_META[t]) {
      const v = m[f.key];
      // 对象值（WIN_NOTICE 的 winner）在输入框里只展示供应商名，保存时再还原对象（见 save）
      out[f.key] = v == null ? '' : (typeof v === 'object' ? (v.supplierName ?? v.name ?? '') : String(v));
    }
    return out;
  };
  const [metadata, setMetadata] = useState<Record<string, string>>(() => buildMeta(ann.type));
  const [publishConfig, setPublishConfig] = useState<PublishConfig>(() => configFromMetadata(ann.metadata));
  const [busy, setBusy] = useState(false);
  const [attachments, setAttachments] = useState<AnnouncementAttachment[]>([]);
  const [bidDoc, setBidDoc] = useState<BidDocumentManage | null>(null);

  const loadExtras = useCallback(async () => {
    try { setAttachments(await listAttachments(ann.id)); } catch {}
    if (type === 'BID_NOTICE') { try { setBidDoc(await getBidDocument(ann.id)); } catch { setBidDoc(null); } }
  }, [ann.id, type]);
  useEffect(() => { loadExtras(); }, [loadExtras]);

  const onTypeChange = (t: AnnouncementType) => { setType(t); setMetadata(buildMeta(t)); };

  const save = async (targetStatus: AnnouncementStatus): Promise<AnnouncementListItem | null> => {
    if (!title.trim()) { toast.error('请填写标题'); return null; }
    if (targetStatus === 'PUBLISHED' && publishConfig.visibility === 'RESTRICTED' && publishConfig.restrictedSupplierIds.length === 0) {
      toast.error('部分供应商可见模式下请至少选择一家供应商');
      return null;
    }
    // 定时发布：实际保存为 DRAFT，由 scheduler 到点自动发布
    const actualStatus: AnnouncementStatus =
      targetStatus === 'PUBLISHED' && publishConfig.scheduleMode === 'scheduled' && publishConfig.scheduledPublishDate
        ? 'DRAFT'
        : targetStatus;
    setBusy(true);
    const meta: Record<string, any> = {};
    for (const f of TYPE_META[type]) if (metadata[f.key]?.trim()) meta[f.key] = metadata[f.key].trim();
    // WIN_NOTICE：winner 是结构化对象（供应商名+报价+得分）。编辑表单只改供应商名，
    // 保存时保留原对象（仅覆盖 supplierName），避免 String(object)="[object Object]" 破坏 metadata
    if (type === 'WIN_NOTICE') {
      const orig = (ann.metadata || {}) as Record<string, any>;
      const origWinner = orig.winner;
      if (origWinner && typeof origWinner === 'object') {
        meta.winner = { ...origWinner, supplierName: (meta.winner || origWinner.supplierName)?.trim() };
      }
    }
    const finalMeta = configToMetadata(publishConfig, meta);
    const payload = { title, content, type, summary, status: actualStatus, isTop, publishDate, metadata: finalMeta, ...(type === 'BID_NOTICE' ? { relatedProjectCode: meta.projectCode || null } : {}) };
    try { return await updateAnnouncement(ann.id, payload as any); }
    catch (e: any) { toast.error(e?.message || '保存失败'); return null; }
    finally { setBusy(false); }
  };

  const saveDraft = async () => { const s = await save('DRAFT'); if (s) { toast.success('草稿已保存'); onSaved(s); } };
  const publish = async () => {
    if (publishConfig.scheduleMode === 'scheduled' && !publishConfig.scheduledPublishDate) { toast.error('请设置定时发布时间'); return; }
    if (type === 'BID_NOTICE' && !bidDoc && publishConfig.scheduleMode === 'immediate' && !confirm('该采购公告尚未上传采购文件，确认直接发布？')) return;
    const s = await save('PUBLISHED');
    if (s) {
      toast.success(publishConfig.scheduleMode === 'scheduled' ? `已设定定时发布（${publishConfig.scheduledPublishDate.replace('T', ' ')}）` : '已发布');
      onSaved(s);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
      <div className="neu-table-card p-5 space-y-5">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs font-semibold text-[var(--muted-foreground)] mb-1.5">类型</label>
            <select value={type} onChange={e => onTypeChange(e.target.value as AnnouncementType)} className="neu-input" disabled>
              {(Object.keys(typeLabel) as AnnouncementType[]).map(t => <option key={t} value={t}>{typeLabel[t]}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-[var(--muted-foreground)] mb-1.5">状态</label>
            <select value={status} onChange={e => setStatus(e.target.value as AnnouncementStatus)} className="neu-input">
              <option value="DRAFT">草稿</option><option value="PUBLISHED">已发布</option><option value="ARCHIVED">已归档</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-[var(--muted-foreground)] mb-1.5">发布日期</label>
            <input type="date" value={publishDate} onChange={e => setPublishDate(e.target.value)} className="neu-input" />
          </div>
        </div>
        <div>
          <label className="block text-xs font-semibold text-[var(--muted-foreground)] mb-1.5">标题</label>
          <input value={title} onChange={e => setTitle(e.target.value)} className="neu-input" placeholder="信息标题..." />
        </div>
        <label className="flex items-center gap-2 text-sm text-[var(--muted-foreground)]">
          <input type="checkbox" checked={isTop} onChange={e => setIsTop(e.target.checked)} className="accent-[var(--accent)]" />置顶
        </label>

        {/* 结构化元数据 —— 内凹底色区，无可见框线 */}
        <div className="rounded-xl bg-[var(--accent-soft)]/15 p-5 shadow-[inset_0_1px_0_oklch(1_0_0/0.3),inset_1px_1px_4px_oklch(0.55_0.03_258/0.06),inset_-1px_-1px_4px_oklch(1_0_0/0.5)]">
          <div className="text-xs font-bold text-[var(--accent-strong)] mb-4">{typeLabel[type]} — 结构化信息</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {TYPE_META[type].map(f => (
              <div key={f.key} className={f.area ? 'sm:col-span-2' : ''}>
                <label className="block text-xs font-semibold text-[var(--muted-foreground)] mb-1.5">{f.label}</label>
                {f.area
                  ? <textarea value={metadata[f.key] || ''} onChange={e => setMetadata({ ...metadata, [f.key]: e.target.value })} className="neu-input h-20 resize-none" />
                  : f.date
                    ? <input type="datetime-local" value={metadata[f.key] || ''} onChange={e => setMetadata({ ...metadata, [f.key]: e.target.value })} className="neu-input" />
                    : <input value={metadata[f.key] || ''} onChange={e => setMetadata({ ...metadata, [f.key]: e.target.value })} className="neu-input" />
                }
              </div>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-xs font-semibold text-[var(--muted-foreground)] mb-1.5">正文内容</label>
          <RichTextEditor value={content} onChange={setContent} placeholder="开始输入正文内容..." />
        </div>

        <div>
          <label className="block text-xs font-semibold text-[var(--muted-foreground)] mb-1.5">摘要</label>
          <input value={summary} onChange={e => setSummary(e.target.value)} className="neu-input" placeholder="简要概述..." />
        </div>


      </div>

      <div className="flex flex-col gap-4 min-w-0">
        <AttachmentEditSection annId={ann.id} attachments={attachments} onChanged={loadExtras} />
        {type === 'BID_NOTICE' && <BidDocEditSection annId={ann.id} bidDoc={bidDoc} onChanged={loadExtras} />}
        <div className="flex flex-col gap-2 pt-1">
          <button onClick={saveDraft} disabled={busy} className="neu-btn-soft w-full justify-center disabled:opacity-50">{busy ? "保存中..." : "保存草稿"}</button>
          <button onClick={publish} disabled={busy} className="neu-btn-soft is-success w-full justify-center disabled:opacity-50">{busy ? "处理中..." : publishConfig.scheduleMode === 'scheduled' ? "设定时发布" : "发布"}</button>
        </div>
      </div>
      </div>

      {/* 发布配置 — 全宽，在双列网格下方 */}
      <div className="neu-table-card p-5">
        <div className="text-xs font-bold text-[var(--accent-strong)] mb-4">发布配置</div>
        <PublishConfigSection config={publishConfig} onChange={setPublishConfig} />
      </div>
    </div>
  );
}

/* ── 附件编辑 ── */
function AttachmentEditSection({ annId, attachments, onChanged }: { annId: string; attachments: AnnouncementAttachment[]; onChanged: () => void }) {
  const [title, setTitle] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);

  const handleAdd = async () => {
    if (!file) return;
    setUploading(true);
    try {
      const asset = await uploadFile(file, "announcement");
      await addAttachment(annId, asset.id, title || file.name);
      setTitle("");
      setFile(null);
      onChanged();
      toast.success("附件已添加");
    } catch (err: any) { toast.error(err?.message || "上传失败"); }
    finally { setUploading(false); }
  };

  return (
    <div className="neu-table-card p-4 text-sm">
      <span className="text-xs font-bold tracking-[0.06em] uppercase text-[var(--muted-foreground)]">附件</span>

      <label className="neu-drop-zone mt-3">
        <Upload size={14} className="text-[var(--muted-foreground)] mb-1" />
        <span className="text-[0.75rem] font-medium text-[var(--muted-foreground)]">
          {file ? file.name : "选择文件"}
        </span>
        <span className="mt-0.5 text-[0.65rem] text-[var(--muted-foreground)]/60">
          {file ? `${(file.size / 1024).toFixed(0)} KB` : "点击浏览或拖拽上传"}
        </span>
        <input type="file" className="hidden" onChange={e => setFile(e.target.files?.[0] || null)} />
      </label>

      {/* 标题 + 添加按钮 */}
      <div className="mt-2.5 flex gap-2">
        <input value={title} onChange={e => setTitle(e.target.value)} placeholder="标题（可选）" className="neu-input flex-1 text-sm" />
        <button onClick={handleAdd} disabled={!file || uploading} className="neu-btn-soft shrink-0 disabled:opacity-40">
          <Upload size={14} />{uploading ? "..." : "添加"}
        </button>
      </div>

      {/* 已上传列表 */}
      {attachments.length > 0 && (
        <div className="mt-3 flex flex-col gap-1.5">
          {attachments.map(a => (
            <div key={a.id} className="flex items-center justify-between rounded-[8px] bg-[var(--surface)] px-3 py-2 shadow-[inset_0_1px_0_oklch(1_0_0/0.5),1px_1px_2px_oklch(0.55_0.03_258/0.05),-1px_-1px_1px_oklch(1_0_0/0.6)]">
              <div className="min-w-0">
                <div className="break-words text-[0.85rem] font-semibold text-[var(--foreground)] leading-snug">{a.title}</div>
                <div className="text-[11px] text-[var(--muted-foreground)]">{a.fileAsset.originalName} · {(a.fileAsset.size / 1024).toFixed(0)} KB</div>
              </div>
              <button onClick={async () => { if (confirm("删除？")) { await removeAttachment(a.id); onChanged(); } }} className="neu-btn-xs is-danger ml-2 shrink-0">删除</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── 招标文件编辑 ── */
function BidDocEditSection({ annId, bidDoc, onChanged }: { annId: string; bidDoc: BidDocumentManage | null; onChanged: () => void }) {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [supplierSearch, setSupplierSearch] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [docTitle, setDocTitle] = useState("");
  const [scope, setScope] = useState<"OPEN" | "INVITED">(bidDoc?.accessScope || "OPEN");
  const [requirePayment, setRequirePayment] = useState(bidDoc?.requirePayment ?? false);
  const [price, setPrice] = useState<number | "">(bidDoc?.price ?? "");
  const [selected, setSelected] = useState<string[]>(bidDoc?.allowedSupplierIds || []);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (scope === "INVITED") getSupplierList({ status: "APPROVED", search: supplierSearch || undefined, pageSize: 50 }).then(r => setSuppliers(r.items)).catch(() => {}); }, [scope, supplierSearch]);

  const doUpload = async () => {
    if (!file) { toast.error("请选择采购文件"); return; }
    setBusy(true);
    try {
      await uploadBidDocument(annId, file, { title: docTitle || file.name, accessScope: scope, requirePayment, price: requirePayment ? (price || 0) : undefined, allowedSupplierIds: scope === "INVITED" ? selected : undefined });
      toast.success("已加密上传"); setFile(null); setDocTitle(""); onChanged();
    } catch (e: any) { toast.error(e?.message || "上传失败"); }
    finally { setBusy(false); }
  };
  const saveConfig = async () => {
    if (!bidDoc) return;
    setBusy(true);
    try { await updateBidDocumentConfig(annId, { accessScope: scope, requirePayment, price: requirePayment ? (price || 0) : undefined, allowedSupplierIds: scope === "INVITED" ? selected : undefined }); toast.success("配置已保存"); onChanged(); }
    catch (e: any) { toast.error(e?.message || "保存失败"); }
    finally { setBusy(false); }
  };
  const confirmPay = async (id: string) => { try { await confirmBidDocPayment(annId, id); toast.success("已确认"); onChanged(); } catch (e: any) { toast.error(e?.message || "失败"); } };
  const removeDoc = async () => { if (!bidDoc || !confirm("删除？")) return; try { await removeBidDocument(annId); toast.success("已删除"); onChanged(); } catch (e: any) { toast.error(e?.message || "失败"); } };

  return (
    <div className="neu-table-card p-4 text-sm">
      <span className="text-xs font-bold tracking-[0.06em] uppercase text-[var(--muted-foreground)]">采购文件</span>
      <span className="ml-2 text-[10px] text-[var(--muted-foreground)]">AES-256 加密</span>

      {bidDoc ? (
        /* 已上传状态 */
        <div className="mt-3 space-y-3">
          <div className="flex items-center justify-between rounded-[8px] bg-[var(--surface)] px-3 py-2 shadow-[inset_0_1px_0_oklch(1_0_0/0.5),1px_1px_2px_oklch(0.55_0.03_258/0.05),-1px_-1px_1px_oklch(1_0_0/0.6)]">
            <div className="min-w-0"><p className="break-words text-[0.85rem] font-bold text-[var(--foreground)] leading-snug">🔒 {bidDoc.title}</p><p className="text-[11px] text-[var(--muted-foreground)]">{bidDoc.fileName} · {(bidDoc.fileSize / 1024).toFixed(0)} KB · {bidDoc.downloadCount} 次</p></div>
            <button onClick={removeDoc} className="neu-btn-xs is-danger ml-2 shrink-0">删除</button>
          </div>
          <div className="grid gap-2 grid-cols-2">
            <select value={scope} onChange={e => setScope(e.target.value as any)} className="neu-input text-sm"><option value="OPEN">公开</option><option value="INVITED">邀请</option></select>
            <select value={requirePayment ? "1" : "0"} onChange={e => setRequirePayment(e.target.value === "1")} className="neu-input text-sm"><option value="0">免费</option><option value="1">付费</option></select>
            {requirePayment && <input type="number" value={price} onChange={e => setPrice(e.target.value === "" ? "" : Number(e.target.value))} className="neu-input text-sm" placeholder="价格（元）" />}
          </div>
          {scope === "INVITED" && (
            <div>
              <div className="flex items-center justify-between mb-1"><span className="text-[11px] text-[var(--muted-foreground)]">已选 {selected.length} 家</span><input value={supplierSearch} onChange={e => setSupplierSearch(e.target.value)} placeholder="搜索供应商" className="neu-input !h-7 w-32 px-2 text-[11px]" /></div>
              <div className="max-h-32 overflow-y-auto rounded-lg bg-[var(--surface)] shadow-[inset_1px_1px_3px_oklch(0.55_0.03_258/0.08),inset_-1px_-1px_3px_oklch(1_0_0/0.5)]">
                {suppliers.map(s => (<label key={s.id} className="flex items-center gap-2 px-3 py-1.5 text-[0.8rem] hover:bg-[var(--muted)] cursor-pointer"><input type="checkbox" checked={selected.includes(s.id)} onChange={() => setSelected(prev => prev.includes(s.id) ? prev.filter(x => x !== s.id) : [...prev, s.id])} className="accent-[var(--accent)]" /><span className="text-[var(--foreground)] truncate">{s.name}</span></label>))}
              </div>
            </div>
          )}
          <button onClick={saveConfig} disabled={busy} className="neu-btn-soft w-full justify-center disabled:opacity-50">{busy ? "保存中..." : "保存配置"}</button>
          {bidDoc.accesses.length > 0 && (
            <div className="rounded-lg bg-[var(--surface)] p-2 shadow-[inset_0_1px_0_oklch(1_0_0/0.4),inset_1px_1px_3px_oklch(0.55_0.03_258/0.06),inset_-1px_-1px_3px_oklch(1_0_0/0.5)]">
              <span className="text-[10px] font-bold uppercase tracking-[0.06em] text-[var(--muted-foreground)]">到账确认</span>
              {bidDoc.accesses.map(a => (
                <div key={a.supplierId} className="flex items-center justify-between py-1 text-[0.8rem]">
                  <span className="truncate text-[var(--foreground)]">{a.supplierName}{a.paymentRef && <span className="ml-1 text-[var(--muted-foreground)]">凭证:{a.paymentRef}</span>}</span>
                  {bidDoc.requirePayment ? (a.paid ? <StatusBadge tone="green">已付</StatusBadge> : <button onClick={() => confirmPay(a.supplierId)} className="neu-btn-xs is-success">确认</button>) : <span className="text-[var(--muted-foreground)]">{a.downloadCount} 次</span>}
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        /* 上传表单 */
        <div className="mt-3 space-y-2.5">
          {/* 文件选择 - 虚线拖放区 */}
          <label className="neu-drop-zone">
            <Upload size={14} className="text-[var(--muted-foreground)] mb-1" />
            <span className="text-[0.75rem] font-medium text-[var(--muted-foreground)]">{file ? file.name : "选择招标文件"}</span>
            <span className="mt-0.5 text-[0.65rem] text-[var(--muted-foreground)]/60">{file ? `${(file.size / 1024).toFixed(0)} KB` : "点击浏览或拖拽上传"}</span>
            <input type="file" className="hidden" onChange={e => setFile(e.target.files?.[0] || null)} />
          </label>

          <input value={docTitle} onChange={e => setDocTitle(e.target.value)} className="neu-input" placeholder="文件标题（选填）" />

          <div className="grid gap-2 grid-cols-2">
            <select value={scope} onChange={e => setScope(e.target.value as any)} className="neu-input text-sm"><option value="OPEN">公开</option><option value="INVITED">邀请</option></select>
            <select value={requirePayment ? "1" : "0"} onChange={e => setRequirePayment(e.target.value === "1")} className="neu-input text-sm"><option value="0">免费</option><option value="1">付费</option></select>
            {requirePayment && <input type="number" value={price} onChange={e => setPrice(e.target.value === "" ? "" : Number(e.target.value))} className="neu-input text-sm" placeholder="价格（元）" />}
          </div>

          {scope === "INVITED" && (
            <div>
              <div className="flex items-center justify-between mb-1"><span className="text-[11px] text-[var(--muted-foreground)]">已选 {selected.length} 家</span><input value={supplierSearch} onChange={e => setSupplierSearch(e.target.value)} placeholder="搜索供应商" className="neu-input !h-7 w-32 px-2 text-[11px]" /></div>
              <div className="max-h-32 overflow-y-auto rounded-lg bg-[var(--surface)] shadow-[inset_1px_1px_3px_oklch(0.55_0.03_258/0.08),inset_-1px_-1px_3px_oklch(1_0_0/0.5)]">
                {suppliers.map(s => (<label key={s.id} className="flex items-center gap-2 px-3 py-1.5 text-[0.8rem] hover:bg-[var(--muted)] cursor-pointer"><input type="checkbox" checked={selected.includes(s.id)} onChange={() => setSelected(prev => prev.includes(s.id) ? prev.filter(x => x !== s.id) : [...prev, s.id])} className="accent-[var(--accent)]" /><span className="text-[var(--foreground)] truncate">{s.name}</span></label>))}
              </div>
            </div>
          )}

          <button onClick={doUpload} disabled={busy || !file} className="neu-btn-soft w-full justify-center disabled:opacity-40">{busy ? "加密上传中..." : "加密上传"}</button>
        </div>
      )}
    </div>
  );
}
