'use client';

/**
 * 直接采购商谈报告编写（2026-11-18，模板文件/直接采购评审报告模板.docx）
 *
 * 版式与公告编写（公告发布向导 Step 1 内嵌 announcement-dialog）同款：左栏编辑区
 * （头部填写进度条 + 平铺字段行 border-b 分隔 + AI 优化 + 时间选择器）+ 右栏纸质
 * 文档实时预览（与 docx 模板章节一一对应）。
 * 解锁：过了开标时间 10 分钟方可打开填写（父级入口按钮控制）。
 * 产出：导出 Word（下载）/ 生成并上传「开标评标」步骤附件。
 */

import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { FileCheck2, Loader2, ScrollText, Upload, Wand2 } from 'lucide-react';
import { Modal } from '@/components/workbench';
import { buildDirectTalkReport, type DirectTalkReportDraft } from '@/lib/api/announcement';
import { polishInitiationField, uploadProjectStageAttachment } from '@/lib/api/project-management';
import type { ProjectManagementItem } from '@/lib/types/project-management';

type Props = {
  isOpen: boolean;
  onClose: () => void;
  project: ProjectManagementItem;
  bidProjectId: string;
  openTimeIso: string | null;
  round?: number;
  /** 已确认回执供应商（预填优先源） */
  acceptedSupplier?: string;
  /** 专家名册（预填商谈小组） */
  expertMembers: string;
  onUploaded?: () => void;
};

const pad = (n: number) => String(n).padStart(2, '0');

function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function fmtCn(local: string): string {
  const m = local.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!m) return local;
  return `${Number(m[1])}年${Number(m[2])}月${Number(m[3])}日 ${m[4]}:${m[5]}`;
}
function fmtDateCn(local: string): string {
  const m = local.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return local;
  return `${Number(m[1])}年${Number(m[2])}月${Number(m[3])}日`;
}

function buildPrefill(props: Props): DirectTalkReportDraft & { _coverDateLocal: string; _openTimeLocal: string } {
  const now = new Date();
  const otLocal = toLocalInput(props.openTimeIso);
  return {
    purchaserName: props.project.companyName || props.project.requesterDepartment || '',
    coverDate: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
    projectOverview: props.project.projectOverview || '',
    supplierName: props.acceptedSupplier || props.project.awardedSupplier || '',
    openingPlace: '',
    openingTime: otLocal ? fmtCn(otLocal) : '',
    expertMembers: props.expertMembers,
    supervisors: '',
    talkProcess: '',
    finalQuote: '',
    projectCode: props.project.projectCode ?? '',
    projectName: props.project.title ?? '',
    _coverDateLocal: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
    _openTimeLocal: otLocal,
  };
}

export function DirectTalkReportDialog(props: Props) {
  const { isOpen, onClose, project, round, onUploaded } = props;
  const [draft, setDraft] = useState(() => buildPrefill(props));
  const [busy, setBusy] = useState(false);
  const [polishing, setPolishing] = useState<'projectOverview' | 'talkProcess' | null>(null);

  const prevOpenRef = useRef(false);
  useEffect(() => {
    if (isOpen && !prevOpenRef.current) setDraft(buildPrefill(props));
    prevOpenRef.current = isOpen;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const setField = (key: string, value: string) => setDraft(prev => ({ ...prev, [key]: value }));

  /** AI 优化（公告/采购文件同款）：项目概况走 projectOverview 轨、商谈过程走 talkProcess 轨 */
  const handlePolish = async (field: 'projectOverview' | 'talkProcess') => {
    const cur = String(draft[field] ?? '').trim();
    if (!cur) { toast.error('请先填写初步内容，再进行 AI 优化'); return; }
    setPolishing(field);
    try {
      const { polished } = await polishInitiationField({
        field,
        text: cur,
        projectContext: { title: project.title, method: project.procurementMethod },
      });
      setDraft(prev => ({ ...prev, [field]: polished }));
      toast.success('AI 优化完成');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'AI 优化失败，请稍后重试');
    } finally {
      setPolishing(null);
    }
  };

  const requiredMissing = !draft.supplierName?.trim() || !draft.talkProcess?.trim() || !draft.finalQuote?.trim();

  const buildFile = async () => {
    const payload: DirectTalkReportDraft = {
      ...draft,
      coverDate: draft._coverDateLocal || draft.coverDate,
      openingTime: draft._openTimeLocal ? fmtCn(draft._openTimeLocal) : draft.openingTime,
    };
    const { blob, fileName } = await buildDirectTalkReport(payload);
    const file = new File([blob], fileName, { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
    return { file, fileName };
  };

  /** 导出 Word（仅下载，不入库） */
  const handleExport = async () => {
    setBusy(true);
    try {
      const { file } = await buildFile();
      const url = URL.createObjectURL(file);
      const a = document.createElement('a');
      a.href = url;
      a.download = file.name;
      a.click();
      URL.revokeObjectURL(url);
      toast.success('商谈报告已导出');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '导出失败');
    } finally {
      setBusy(false);
    }
  };

  /** 生成并上传「开标评标」步骤附件（备案表同款链路） */
  const handleUpload = async () => {
    setBusy(true);
    try {
      const { file } = await buildFile();
      await uploadProjectStageAttachment(project.id, 'BID_EVALUATION', file, round);
      toast.success('商谈报告已生成并上传至「开标评标」步骤');
      onUploaded?.();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '上传失败');
    } finally {
      setBusy(false);
    }
  };

  /* ── 编辑区（公告编写同款）：填写进度 + 平铺字段行。
     字段行用普通渲染函数而非内部组件——内部组件随父渲染重挂载，输入即失焦。 ── */
  const inputCls =
    'mt-2 w-full rounded-[18px] border border-[oklch(0.6_0.04_258_/_0.25)] bg-[oklch(1_0_0_/_0.5)] px-4 py-3 text-sm text-[color:var(--foreground)] outline-none transition-all duration-200 focus:border-[rgba(107,149,240,0.34)] focus:bg-[oklch(1_0_0_/_0.7)] focus:shadow-[0_0_0_4px_rgba(113,152,242,0.08)] hover:border-[oklch(0.6_0.04_258_/_0.35)]';
  const rowCls = 'border-b border-[oklch(0.6_0.04_258_/_0.12)] py-3.5';
  const badgeCls = (hasValue: boolean) => [
    'rounded-[5px] px-2 py-0.5 text-[10px] font-semibold',
    hasValue
      ? 'bg-[color-mix(in_oklch,var(--success)_12%,transparent)] text-[var(--success)]'
      : 'bg-[color-mix(in_oklch,var(--danger)_10%,transparent)] text-[var(--danger)]',
  ].join(' ');

  // textarea 自适应高度（公告编写同款：min 120px；AI 回填/预填重置亦随动）
  const overviewTaRef = useRef<HTMLTextAreaElement | null>(null);
  const processTaRef = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => {
    for (const el of [overviewTaRef.current, processTaRef.current]) {
      if (!el) continue;
      el.style.height = 'auto';
      el.style.height = `${Math.max(120, el.scrollHeight)}px`;
    }
  }, [draft.projectOverview, draft.talkProcess, isOpen]);

  // 填写进度（公告编写编辑区头部同款口径：可见字段计数 + 进度条）
  const progressFields = [
    draft.purchaserName, draft._coverDateLocal, draft.projectOverview,
    draft._openTimeLocal, draft.openingPlace, draft.supplierName,
    draft.expertMembers, draft.supervisors, draft.talkProcess, draft.finalQuote,
  ];
  const totalCount = progressFields.length;
  const filledCount = progressFields.filter(v => String(v ?? '').trim().length > 0).length;
  const remainingFields = totalCount - filledCount;
  const progressPercent = Math.round((filledCount / Math.max(totalCount, 1)) * 100);

  /** 短字段行（公告编写 AnnouncementFieldEditor 同款：label + 已填写/待补充徽章 + 输入） */
  const renderField = (k: string, label: string, type = 'text', placeholder?: string) => {
    const value = String(draft[k as keyof typeof draft] ?? '');
    const hasValue = value.trim().length > 0;
    return (
      <div className={rowCls}>
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-medium text-[color:var(--foreground)]">{label}</span>
          <span className={badgeCls(hasValue)}>{hasValue ? '已填写' : '待补充'}</span>
        </div>
        <input type={type} value={value} onChange={(e) => setField(k, e.target.value)} placeholder={placeholder ?? `请输入${label}`} className={inputCls} />
      </div>
    );
  };

  /** 长文本行：徽章 + AI 优化按钮（公告编写字段操作同位）+ 自适应高度 textarea */
  const renderLongField = (
    k: 'projectOverview' | 'talkProcess',
    label: string,
    placeholder: string,
    taRef: React.RefObject<HTMLTextAreaElement | null>,
  ) => {
    const value = String(draft[k] ?? '');
    const hasValue = value.trim().length > 0;
    return (
      <div className={rowCls}>
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-medium text-[color:var(--foreground)]">{label}</span>
          <div className="flex items-center gap-2">
            {polishing === k ? (
              <span className="neu-btn-primary is-water pointer-events-none !h-[30px] !px-2.5 !text-xs"><Loader2 size={13} className="animate-spin text-[var(--accent)]" /></span>
            ) : (
              <button
                type="button"
                onClick={() => void handlePolish(k)}
                disabled={busy}
                title="AI 优化：基于当前内容润色"
                className="neu-btn-primary is-water !h-[30px] !px-2.5 !text-xs gap-1 disabled:opacity-50"
              >
                <Wand2 size={13} /> AI 优化
              </button>
            )}
            <span className={badgeCls(hasValue)}>{hasValue ? '已填写' : '待补充'}</span>
          </div>
        </div>
        <textarea ref={taRef} value={value} onChange={(e) => setField(k, e.target.value)} placeholder={placeholder} className={`${inputCls} resize-none overflow-hidden`} />
      </div>
    );
  };

  return (
    <Modal
      open={isOpen}
      onClose={() => { if (!busy) onClose(); }}
      icon={<ScrollText size={14} strokeWidth={1.9} />}
      title="直接采购商谈报告 · 编写"
      description="开标后填写商谈情况——生成 Word 或上传「开标评标」步骤"
      size="lg"
      className="!max-w-[min(1180px,95vw)]"
      footer={
        <>
          <button type="button" onClick={() => onClose()} disabled={busy} className="neu-btn-soft">取消</button>
          <button type="button" onClick={() => void handleExport()} disabled={busy} className="tender-btn disabled:cursor-not-allowed disabled:opacity-60">
            <span className="tb-icon tb-anim-bob">
              {busy ? <Loader2 size={13} className="animate-spin" /> : <FileCheck2 size={13} />}
            </span>
            导出 Word
          </button>
          <button
            type="button"
            onClick={() => void handleUpload()}
            disabled={busy || requiredMissing}
            title={requiredMissing ? '请先填写供应商名称、商谈过程与最终报价' : undefined}
            className="tender-btn tender-btn--export disabled:cursor-not-allowed"
          >
            <span className="tb-icon tb-anim-bob">
              {busy ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
            </span>
            {busy ? '生成中...' : '生成并上传'}
          </button>
        </>
      }
    >
      <div className="flex flex-row gap-4">
        {/* 左：编辑区（公告编写同款——头部填写进度 + 平铺字段行） */}
        <section className="flex min-h-0 flex-1 flex-col rounded-[20px] wb-panel">
          <div className="shrink-0 border-b border-[oklch(0.6_0.04_258_/_0.16)] px-5 py-3">
            <div className="text-[11px] font-semibold uppercase tracking-[.16em] text-[color-mix(in_oklch,var(--accent)_50%,transparent)]">编辑区</div>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-[color:var(--muted-foreground)]">
              <span className="tabular-nums">{filledCount}/{totalCount} 项已填写</span>
              {remainingFields > 0 && (
                <span className="text-[10px]">还差 {remainingFields} 项即可完成报告填写</span>
              )}
            </div>
            {/* 填写进度条（与公告编写编辑器头部样式一致） */}
            <div className="mt-2 flex items-center gap-3">
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[oklch(0.55_0.03_258_/_0.1)]">
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{
                    width: `${progressPercent}%`,
                    background: progressPercent === 100
                      ? 'oklch(0.6 0.13 164)'
                      : 'linear-gradient(90deg, oklch(0.5 0.16 258 / 0.9), oklch(0.6 0.1 258 / 0.7))',
                  }}
                />
              </div>
              <span className="text-[11px] font-semibold tabular-nums text-[color:var(--muted-foreground)]">
                {progressPercent}%
              </span>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-5 tender-scroll">
            <div className="grid gap-3">
              {renderField('purchaserName', '采购人名称')}
              {renderField('_coverDateLocal', '封面时间', 'date')}
              {renderLongField('projectOverview', '项目概况', '一、采购项目基本情况介绍（可 AI 优化）', overviewTaRef)}
              {renderField('_openTimeLocal', '商谈时间', 'datetime-local')}
              {renderField('openingPlace', '商谈地点')}
              {renderField('supplierName', '供应商名称')}
              {renderField('expertMembers', '商谈小组成员', 'text', '姓名（职称）、姓名（职称）…')}
              {renderField('supervisors', '监督人员')}
              {renderLongField('talkProcess', '商谈过程', '四、商谈过程：各轮商谈要点与共识（可 AI 优化）', processTaRef)}
              {renderField('finalQuote', '最终报价（万元）')}
            </div>
          </div>
        </section>

        {/* 右：纸质文档实时预览（与 docx 模板章节一一对应） */}
        <aside className="flex min-h-0 flex-[1.05] flex-col overflow-hidden rounded-[24px] wb-panel">
          <div className="shrink-0 border-b border-[oklch(0.6_0.04_258_/_0.16)] px-5 py-3">
            <div className="text-[11px] font-semibold uppercase tracking-[.16em] text-[color-mix(in_oklch,var(--accent)_50%,transparent)]">预览区</div>
            <div className="mt-1 text-xs text-[color:var(--muted-foreground)]">直接采购商谈报告 · 实时预览</div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto tender-scroll">
            <div className="mx-4 my-3 rounded-[10px] bg-white px-8 py-8 text-[#18243a] shadow-sm" style={{ fontFamily: '"FangSong","仿宋","SimSun",serif' }}>
              <div className="text-center text-[15px] font-bold tracking-wide">{draft.purchaserName || '　'}</div>
              <div className="mt-4 text-center text-[22px] font-bold tracking-[.3em]">直接采购</div>
              <div className="text-center text-[22px] font-bold tracking-[.3em]">商谈报告</div>
              <div className="mt-4 text-center text-[12px]">{draft._coverDateLocal ? fmtDateCn(draft._coverDateLocal) : '　'}</div>
              <div className="mt-2 text-center text-[11px] text-[#3a4658]">四川·成都</div>

              <div className="mt-6 text-[13px] font-bold">一、采购项目基本情况介绍</div>
              <p className="mt-1 whitespace-pre-wrap text-[12px] leading-6">{draft.projectOverview || '　'}</p>

              <div className="mt-4 text-[13px] font-bold">二、供应商名称</div>
              <p className="mt-1 text-[12px] leading-6">{draft.supplierName || '　'}</p>

              <div className="mt-4 text-[13px] font-bold">三、商谈地点、时间以及商谈小组成员名单</div>
              <p className="mt-1 text-[12px] leading-6">（一）地点：{draft.openingPlace || '　'}</p>
              <p className="text-[12px] leading-6">（二）时间：{draft._openTimeLocal ? fmtCn(draft._openTimeLocal) : draft.openingTime || '　'}</p>
              <p className="mt-1 text-[12px] leading-6">（三）商谈小组成员：{draft.expertMembers || '　'}</p>
              <p className="text-[12px] leading-6">　　监督人员：{draft.supervisors || '　'}</p>

              <div className="mt-4 text-[13px] font-bold">四、商谈过程</div>
              <p className="mt-1 whitespace-pre-wrap text-[12px] leading-6">{draft.talkProcess || '　'}</p>

              <div className="mt-4 text-[13px] font-bold">五、商谈结果</div>
              <p className="mt-1 text-[12px] leading-6">（一）供应商名称：{draft.supplierName || '　'}</p>
              <p className="text-[12px] leading-6">（二）报价：{draft.finalQuote ? `${draft.finalQuote} 万元` : '　'}</p>

              <div className="mt-8 flex justify-between text-[12px]">
                <span>商谈小组签字：</span>
                <span>监督人员签字：</span>
              </div>
            </div>
            <div className="mx-4 mb-3 flex items-start gap-2 rounded-[12px] px-4 py-3 text-[11px] leading-relaxed text-[color:var(--muted-foreground)]"
              style={{ background: 'color-mix(in oklch, var(--accent-soft) 18%, transparent)' }}>
              <ScrollText size={14} className="mt-0.5 shrink-0 text-[color:var(--accent)]" />
              <span>导出仅下载 Word；「生成并上传」落「开标评标」步骤附件。纸质报告须商谈小组与监督人员线下签字后归档。</span>
            </div>
          </div>
        </aside>
      </div>
    </Modal>
  );
}
