'use client';

import { useState, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  createAnnouncement,
  listAttachments, addAttachment, removeAttachment, uploadFile,
} from '@/lib/api/announcement';
import type { AnnouncementType, AnnouncementStatus, AnnouncementAttachment } from '@/lib/api/announcement';
import { Upload, PlusCircle, Save, Send } from 'lucide-react';
import { RichTextEditor } from '@/components/rich-text-editor';
import { ANNOUNCEMENT_TYPE_ORDER, announcementTypeGroupIndex } from '@water-erp/shared';
import { PublishConfigSection, DEFAULT_PUBLISH_CONFIG, configToMetadata, type PublishConfig } from '@/components/notice/publish-config-section';

/** 可手工新建的公告类型。
 *  采购公告（BID_NOTICE）、流标公告（FAILED_BID_NOTICE）、中标公告（WIN_BID_NOTICE）
 *  由系统在项目公告发布向导中生成，不在此手工创建。 */
type NoticeType =
  | 'ADDENDUM'
  | 'PREQUAL_NOTICE'
  | 'PRE_WIN_NOTICE'
  | 'WIN_NOTICE'
  | 'CONTRACT_NOTICE'
  | 'PERFORMANCE_NOTICE'
  | 'POLICY'
  | 'PLATFORM';

const typeLabel: Record<NoticeType, string> = {
  ADDENDUM: '补遗公告', PREQUAL_NOTICE: '资格预审公告', PRE_WIN_NOTICE: '预成交公示', WIN_NOTICE: '成交公告',
  CONTRACT_NOTICE: '合同公告', PERFORMANCE_NOTICE: '履行结果公告', POLICY: '政策法规', PLATFORM: '平台通知',
};

interface MetaField { key: string; label: string; area?: boolean; date?: boolean }
const TYPE_META: Record<NoticeType, MetaField[]> = {
  // C5（GB/T 43711 7.2.6）：采购文件澄清/修改 → 补遗公告（发布后自动通知已获取文件的供应商）
  ADDENDUM: [
    { key: 'projectCode', label: '项目编号' }, { key: 'changes', label: '澄清/修改内容', area: true },
    { key: 'newDeadline', label: '调整后递交截止', date: true },
  ],
  // 7.2.3 资格预审公告：供应商按公告约定提交资格预审申请
  PREQUAL_NOTICE: [
    { key: 'title', label: '预审名称' }, { key: 'projectCode', label: '项目编号' },
    { key: 'method', label: '预审方式（合格制/有限数量制）' }, { key: 'applyDeadline', label: '申请截止时间', date: true },
    { key: 'documents', label: '需提交的申请材料', area: true }, { key: 'validUntil', label: '预审结果有效期', date: true },
    { key: 'contact', label: '联系方式' },
  ],
  // C1（GB/T 43711 7.5.2.2）：线下完成评审的项目由此登记预成交公示（线上归档项目自动生成草稿）
  PRE_WIN_NOTICE: [
    { key: 'projectCode', label: '项目编号' }, { key: 'winner', label: '预成交供应商' }, { key: 'amount', label: '预成交价格' },
    { key: 'period', label: '工期/交货期/服务期限' }, { key: 'objection', label: '异议渠道', area: true },
  ],
  // 7.5.2.7 成交公告：登记线下成交结果（两段式第二段期满确认由系统自动生成）
  WIN_NOTICE: [
    { key: 'projectCode', label: '项目编号' }, { key: 'winner', label: '成交供应商' }, { key: 'amount', label: '成交金额' },
    { key: 'period', label: '工期/交货期' }, { key: 'quality', label: '质量标准' },
    { key: 'objection', label: '异议渠道', area: true },
  ],
  // 7.5.4.5 合同公告（宜公开）：名称/编码、当事人、价款、签约时间、期限
  CONTRACT_NOTICE: [
    { key: 'projectCode', label: '项目编号' }, { key: 'contractCode', label: '合同编号' },
    { key: 'supplierName', label: '成交供应商' }, { key: 'amount', label: '合同价款' },
    { key: 'signedAt', label: '签约时间', date: true }, { key: 'period', label: '合同期限' },
  ],
  // 7.6.2.2 履行结果公告：验收/履约结果
  PERFORMANCE_NOTICE: [
    { key: 'projectCode', label: '项目编号' }, { key: 'contractCode', label: '合同编号' },
    { key: 'supplierName', label: '成交供应商' }, { key: 'result', label: '履行结果', area: true },
    { key: 'acceptanceDate', label: '验收日期', date: true }, { key: 'issues', label: '存在问题及处理', area: true },
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

/** 项目绑定类公告：projectCode 字段同步写入 relatedProjectCode（供项目反查/期满派生/发布联动） */
const PROJECT_LINKED_TYPES: NoticeType[] = ['ADDENDUM', 'PREQUAL_NOTICE', 'PRE_WIN_NOTICE', 'WIN_NOTICE', 'CONTRACT_NOTICE', 'PERFORMANCE_NOTICE'];

const Step = ({ n }: { n: number }) => (
  <span className="flex h-[18px] w-[18px] items-center justify-center rounded-md text-[10px] font-extrabold bg-[var(--accent)] text-white">{n}</span>
);

export default function NewNoticePage() {
  const router = useRouter();
  const [annId, setAnnId] = useState<string | null>(null);
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

  const onTypeChange = (t: NoticeType) => { setType(t); setMetadata({}); };

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
    const finalMeta = configToMetadata(publishConfig, meta);
    const payload: any = { title, content, type, summary, status: actualStatus, isTop, publishDate, metadata: finalMeta };
    // 项目绑定类公告挂项目编号：预成交公示供期满确认派生成交公告幂等去重；补遗公告供发布联动
    // （补遗计数 + 供应商定向通知）；其余类型供项目反查与列表关联
    if (PROJECT_LINKED_TYPES.includes(type) && meta.projectCode) payload.relatedProjectCode = meta.projectCode;
    try {
      const saved = await createAnnouncement(payload);
      setAnnId(saved.id);
      return saved.id;
    } catch (e: any) { toast.error(e?.message || '保存失败'); return null; }
    finally { setBusy(false); }
  };

  const saveDraft = async () => { const id = await saveNew('DRAFT'); if (id) { toast.success('草稿已保存，可上传附件'); loadExtras(); } };
  const publish = async () => {
    if (publishConfig.scheduleMode === 'scheduled' && !publishConfig.scheduledPublishDate) {
      toast.error('请设置定时发布时间');
      return;
    }
    const id = await saveNew('PUBLISHED');
    if (id) {
      toast.success(publishConfig.scheduleMode === 'scheduled' ? `已设定定时发布（${publishConfig.scheduledPublishDate.replace('T', ' ')}）` : '已发布');
      router.push(`/notice/${id}`);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      {/* ══════ page-hero — 标题卡片 ══════ */}
      <div className="page-hero">
        <div className="page-hero__row">
          <div className="page-hero__left">
            <div className="page-hero__icon">
              <PlusCircle size={17} />
            </div>
            <div>
              <div className="page-hero__title">新建信息</div>
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

      {/* ══════ 表单卡片 — neu-table-card ══════ */}
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
            采购公告、流标公告、中标公告由系统在项目的「公告制作与发布」向导中生成，不在此手工创建。
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

        {/* ③ 结构化元数据 */}
        <fieldset>
          <legend className="flex items-center gap-2 mb-3 text-xs font-bold uppercase tracking-[0.1em] text-[var(--muted-foreground)]">
            <Step n={3} />{typeLabel[type]} — 结构化信息（按字段填写，不混入正文）
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
                        ? <input type="datetime-local" value={val} onChange={e => setMetadata({ ...metadata, [f.key]: e.target.value })} className="neu-input" />
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
            <Step n={4} />正文内容
          </legend>
          <RichTextEditor value={content} onChange={setContent} placeholder="开始输入正文内容..." />
          <label className="space-y-1 mt-4 block">
            <span className="text-xs font-semibold text-[var(--muted-foreground)]">摘要（可选）</span>
            <input value={summary} onChange={e => setSummary(e.target.value)} className="neu-input" placeholder="简要概述..." />
          </label>
        </fieldset>

        <hr className="wb-section-rule" />

        {/* ⑤ 发布配置 */}
        <fieldset>
          <legend className="flex items-center gap-2 mb-3 text-xs font-bold uppercase tracking-[0.1em] text-[var(--muted-foreground)]">
            <Step n={5} />发布配置
          </legend>
          <PublishConfigSection config={publishConfig} onChange={setPublishConfig} />
        </fieldset>

        {/* ⑥ 附件 — 保存草稿后显示 */}
        {annId ? (
          <>
            <hr className="wb-section-rule" />
            <fieldset>
              <legend className="flex items-center gap-2 mb-3 text-xs font-bold uppercase tracking-[0.1em] text-[var(--muted-foreground)]">
                <Step n={6} />附件（公开可下载）
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
    </div>
  );
}

/* ── 附件上传器 ── */
function AttachmentUploader({ annId, attachments, onChanged }: { annId: string; attachments: AnnouncementAttachment[]; onChanged: () => void }) {
  const [title, setTitle] = useState('');
  const [uploading, setUploading] = useState(false);
  const onUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; if (!f) return;
    setUploading(true);
    try { const asset = await uploadFile(f, 'announcement'); await addAttachment(annId, asset.id, title || f.name); setTitle(''); onChanged(); toast.success('附件已添加'); }
    catch (err: any) { toast.error(err?.message || '上传失败'); }
    setUploading(false); e.target.value = '';
  };
  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <input value={title} onChange={e => setTitle(e.target.value)} placeholder="附件标题（可选）" className="neu-input flex-1" />
        <label className={'neu-btn-primary cursor-pointer whitespace-nowrap ' + (uploading ? 'opacity-50' : '')}>
          <Upload size={14} />{uploading ? '上传中...' : '添加附件'}
          <input type="file" className="hidden" onChange={onUpload} />
        </label>
      </div>
      {attachments.length === 0 ? <p className="text-xs text-[var(--muted-foreground)]">暂无附件</p> : attachments.map(a => (
        <div key={a.id} className="neu-attachment-item">
          <div><div className="text-sm font-semibold text-[var(--foreground)]">{a.title}</div><div className="text-xs text-[var(--muted-foreground)]">{a.fileAsset.originalName} · {(a.fileAsset.size / 1024).toFixed(0)} KB</div></div>
          <button onClick={async () => { if (confirm('删除该附件？')) { await removeAttachment(a.id); onChanged(); } }} className="neu-btn-xs is-danger">删除</button>
        </div>
      ))}
    </div>
  );
}
