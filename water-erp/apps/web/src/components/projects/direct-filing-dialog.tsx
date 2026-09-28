'use client';

/**
 * 直接采购备案表编写（2026-09-28，《集团采购管理办法》附件6）
 *
 * 项目管理 09「直接采购备案表」步骤的「备案表编写」弹窗：左栏字段编辑 +
 * 右栏纸质表格实时预览（版式口径同采购文件编写/公告编写），生成 docx 后
 * 自动上传到 DIRECT_PURCHASE_FILING 阶段附件。
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { FileCheck2, Loader2, ShieldCheck, Upload } from 'lucide-react';
import { Modal } from '@/components/workbench';
import { numberToChineseAmount } from '@/lib/tender-write/announcement-templates';
import { buildDirectFiling, type DirectFilingDraft } from '@/lib/api/announcement';
import { uploadProjectStageAttachment } from '@/lib/api/project-management';
import type { ProjectManagementItem } from '@/lib/types/project-management';

/** 项目数据 → 备案表草稿预填：金额/名称/经办人等在前序步骤已定，备案只做核对勾选 */
function buildPrefill(project: ProjectManagementItem): DirectFilingDraft {
  const today = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const amount =
    project.contractAmount != null ? String(project.contractAmount)
    : project.budgetAmount != null ? String(project.budgetAmount)
    : '';
  return {
    projectCode: project.projectCode ?? '',
    projectName: project.title ?? '',
    purchaserName: project.companyName || project.requesterDepartment || '',
    filingDate: `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`,
    amount,
    amountChinese: amount ? numberToChineseAmount(amount) : '',
    // 默认按「材料齐全 + 同意备案」预选，前序材料缺失时手动改「无/否」
    approvalsComplete: '是',
    hasNegotiationReport: '有',
    hasWinnerConfirmation: '有',
    hasNotificationLetter: '有',
    hasContract: '有',
    filingOpinion: '同意',
    signatory: project.requesterName ?? '',
    remark: '',
  };
}

type RadioKey =
  | 'approvalsComplete'
  | 'hasNegotiationReport'
  | 'hasWinnerConfirmation'
  | 'hasNotificationLetter'
  | 'hasContract'
  | 'filingOpinion';

/** 勾选框渲染（与 docx 模板 toCheckBox 同口径） */
function check(value: string, yes: string, no: string): string {
  if (value === yes) return `${yes} ☑　${no} □`;
  if (value === no) return `${yes} □　${no} ☑`;
  return `${yes} □　${no} □`;
}

const RADIO_ROWS: Array<{ key: RadioKey; label: string; options: [string, string] }> = [
  { key: 'approvalsComplete', label: '审批资料是否齐全', options: ['是', '否'] },
  { key: 'hasNegotiationReport', label: '商谈报告', options: ['有', '无'] },
  { key: 'hasWinnerConfirmation', label: '中选供应商确认单', options: ['有', '无'] },
  { key: 'hasNotificationLetter', label: '中选通知书', options: ['有', '无'] },
  { key: 'hasContract', label: '合同书', options: ['有', '无'] },
  { key: 'filingOpinion', label: '备案意见', options: ['同意', '不同意'] },
];

export function DirectFilingDialog({
  isOpen,
  onClose,
  project,
  onUploaded,
}: {
  isOpen: boolean;
  onClose: () => void;
  project: ProjectManagementItem;
  /** 备案表上传到阶段成功后回调（父面板刷新项目数据与文件分析） */
  onUploaded: () => void;
}) {
  const [draft, setDraft] = useState<DirectFilingDraft>(() => buildPrefill(project));
  const [busy, setBusy] = useState(false);

  // 预填重置仅在 isOpen false→true 边沿执行：弹窗开着时父组件刷新 localItem
  // （上传回填等）不应重置用户正在编辑的草稿
  const prevOpenRef = useRef(false);
  useEffect(() => {
    if (isOpen && !prevOpenRef.current) setDraft(buildPrefill(project));
    prevOpenRef.current = isOpen;
  }, [isOpen, project]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isOpen, onClose, busy]);

  const setField = <K extends keyof DirectFilingDraft>(key: K, value: DirectFilingDraft[K]) => {
    setDraft((prev) => {
      const next = { ...prev, [key]: value };
      if (key === 'amount') {
        next.amountChinese = String(value).trim() ? numberToChineseAmount(String(value)) : '';
      }
      return next;
    });
  };

  const requiredMissing =
    !draft.projectName.trim() || !draft.purchaserName.trim() || !draft.amount.trim();

  /** 生成 docx → 上传到 09 阶段附件（公告向导上传 PUBLIC_ANNOUNCEMENT 同款链路） */
  const handleGenerateAndUpload = async () => {
    setBusy(true);
    try {
      const { blob, fileName } = await buildDirectFiling(draft);
      const file = new File([blob], fileName, {
        type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      });
      await uploadProjectStageAttachment(project.id, 'DIRECT_PURCHASE_FILING', file);
      toast.success('备案表已生成并上传至「直接采购备案表」步骤');
      onUploaded();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '备案表生成失败');
    } finally {
      setBusy(false);
    }
  };

  const filingDateLabel = useMemo(() => {
    const m = draft.filingDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return m ? `${m[1]}年${Number(m[2])}月${Number(m[3])}日` : draft.filingDate;
  }, [draft.filingDate]);

  const inputCls =
    'mt-2 w-full rounded-[18px] border border-[oklch(0.6_0.04_258_/_0.25)] bg-[oklch(1_0_0_/_0.5)] px-4 py-3 text-sm text-[color:var(--foreground)] outline-none transition-all duration-200 focus:border-[rgba(107,149,240,0.34)] focus:bg-[oklch(1_0_0_/_0.7)] focus:shadow-[0_0_0_4px_rgba(113,152,242,0.08)] hover:border-[oklch(0.6_0.04_258_/_0.35)]';

  const filledCount =
    [
      draft.purchaserName, draft.projectName, draft.amount, draft.amountChinese,
      draft.signatory, draft.filingDate,
      ...RADIO_ROWS.map((r) => draft[r.key]),
    ].filter((v) => String(v).trim()).length;
  const totalCount = 6 + RADIO_ROWS.length;

  return (
    <Modal
      open={isOpen}
      onClose={() => { if (!busy) onClose(); }}
      title="直接采购备案表 · 备案表编写"
      description="集团采购管理办法 附件6"
      size="lg"
      className="!max-w-[min(1120px,95vw)]"
      footer={
        <>
          <button type="button" onClick={() => onClose()} disabled={busy} className="neu-btn-soft">
            取消
          </button>
          <button
            type="button"
            onClick={() => void handleGenerateAndUpload()}
            disabled={busy || requiredMissing}
            title={requiredMissing ? '请先填写项目名称、采购人名称与中标金额' : undefined}
            className="tender-btn tender-btn--export disabled:cursor-not-allowed"
          >
            <span className="tb-icon tb-anim-bob">
              {busy ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
            </span>
            {busy ? '生成中...' : '生成备案表并上传'}
          </button>
        </>
      }
    >
      <div className="flex flex-row gap-4">
        {/* 左：字段编辑区（notification-letter 同款字段卡版式） */}
        <section className="flex min-h-0 flex-1 flex-col rounded-[20px] wb-panel">
          <div className="shrink-0 border-b border-[oklch(0.6_0.04_258_/_0.16)] px-5 py-3">
            <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[color-mix(in_oklch,var(--accent)_50%,transparent)]">编辑区</div>
            <div className="mt-1 text-xs text-[color:var(--muted-foreground)]">
              {filledCount}/{totalCount} 项已填写 · 勾选项默认按材料齐全预选，缺失时请改为「无/否」
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-5 tender-scroll">
            <div className="grid gap-3">
              {([
                { key: 'filingDate' as const, label: '备案时间', type: 'date' as const },
                { key: 'purchaserName' as const, label: '采购人名称' },
                { key: 'projectName' as const, label: '项目名称' },
                { key: 'amount' as const, label: '中标金额（小写，元）', type: 'number' as const },
                { key: 'amountChinese' as const, label: '中标金额（大写）', readOnly: true },
                { key: 'signatory' as const, label: '签字（经办人）' },
                { key: 'remark' as const, label: '备注' },
              ]).map((field) => {
                const value = draft[field.key];
                const hasValue = String(value).trim().length > 0;
                return (
                  <label
                    key={field.key}
                    className={[
                      'block rounded-[18px] border px-4 py-3.5 transition-all duration-300',
                      hasValue
                        ? 'border-[color-mix(in_oklch,var(--success)_14%,transparent)] bg-[color-mix(in_oklch,var(--success)_6%,transparent)]'
                        : 'border-[oklch(0.55_0.05_258_/_0.15)] bg-[oklch(1_0_0_/_0.3)] hover:border-[oklch(0.5_0.08_258_/_0.25)] hover:bg-[oklch(1_0_0_/_0.5)]',
                    ].join(' ')}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium text-[color:var(--foreground)]">{field.label}</span>
                      <span
                        className={[
                          'rounded-full px-2 py-0.5 text-[10px] font-semibold',
                          hasValue
                            ? 'bg-[color-mix(in_oklch,var(--success)_12%,transparent)] text-[var(--success)]'
                            : 'bg-[color-mix(in_oklch,var(--danger)_10%,transparent)] text-[var(--danger)]',
                        ].join(' ')}
                      >
                        {hasValue ? (field.readOnly ? '已生成' : '已填写') : '待补充'}
                      </span>
                    </div>
                    <input
                      type={field.type ?? 'text'}
                      value={value}
                      readOnly={field.readOnly}
                      onChange={(e) => setField(field.key, e.target.value)}
                      placeholder={field.readOnly ? '自动生成' : `请输入${field.label}`}
                      className={[
                        inputCls,
                        field.readOnly ? 'cursor-default bg-[oklch(1_0_0_/_0.3)] opacity-80' : '',
                      ].join(' ')}
                    />
                  </label>
                );
              })}

              {/* 勾选行：是/否 · 有/无 · 同意/不同意 */}
              {RADIO_ROWS.map((row) => (
                <div
                  key={row.key}
                  className="rounded-[18px] border border-[color-mix(in_oklch,var(--success)_14%,transparent)] bg-[oklch(1_0_0_/_0.3)] px-4 py-3.5"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium text-[color:var(--foreground)]">{row.label}</span>
                    <span className="rounded-full bg-[color-mix(in_oklch,var(--success)_12%,transparent)] px-2 py-0.5 text-[10px] font-semibold text-[var(--success)]">已勾选</span>
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    {row.options.map((opt) => {
                      const active = draft[row.key] === opt;
                      return (
                        <button
                          key={opt}
                          type="button"
                          onClick={() => setField(row.key, opt as DirectFilingDraft[typeof row.key])}
                          className={[
                            'flex-1 rounded-[12px] border px-3 py-2 text-sm font-semibold transition-all',
                            active
                              ? 'border-[color-mix(in_oklch,var(--accent)_45%,transparent)] bg-[color-mix(in_oklch,var(--accent)_10%,transparent)] text-[color:var(--accent)]'
                              : 'border-[oklch(0.6_0.04_258_/_0.2)] bg-[oklch(1_0_0_/_0.45)] text-[color:var(--muted-foreground)] hover:border-[oklch(0.5_0.08_258_/_0.3)]',
                          ].join(' ')}
                        >
                          {opt}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* 右：纸质表格实时预览（与 docx 模板行列一一对应） */}
        <aside className="flex min-h-0 flex-[1.05] flex-col overflow-hidden rounded-[24px] wb-panel">
          <div className="shrink-0 border-b border-[oklch(0.6_0.04_258_/_0.16)] px-5 py-3">
            <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[color-mix(in_oklch,var(--accent)_50%,transparent)]">预览区</div>
            <div className="mt-1 text-xs text-[color:var(--muted-foreground)]">直接采购备案表 · 实时预览</div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto tender-scroll">
            <div className="mx-4 my-3 rounded-[10px] bg-white px-6 py-6 text-[#18243a] shadow-sm" style={{ fontFamily: '"FangSong","仿宋","SimSun",serif' }}>
              <div className="text-[12px]">附件6</div>
              <div className="mt-2 text-center text-[15px] font-bold tracking-wide">四川省水利发展集团有限公司</div>
              <div className="text-center text-[19px] font-bold tracking-[0.18em]">直接采购备案表</div>
              <div className="mt-2 text-right text-[12px]">备案时间：{filingDateLabel || '　'}</div>
              <table className="mt-2 w-full border-collapse text-[12px]">
                <tbody>
                  <tr>
                    <td colSpan={4} className="border border-black px-2 py-2 text-center font-bold">备案基本情况</td>
                  </tr>
                  <tr>
                    <td className="w-[18%] border border-black px-2 py-2 text-center font-bold">采购人名称</td>
                    <td className="w-[32%] border border-black px-2 py-2">{draft.purchaserName || '　'}</td>
                    <td className="w-[18%] border border-black px-2 py-2 text-center font-bold">项目名称</td>
                    <td className="w-[32%] border border-black px-2 py-2">{draft.projectName || '　'}</td>
                  </tr>
                  <tr>
                    <td className="border border-black px-2 py-2 text-center font-bold">中标金额</td>
                    <td colSpan={3} className="border border-black px-2 py-2">
                      小写：{draft.amount ? `${draft.amount}元` : '　'}　　大写：{draft.amountChinese || '　'}
                    </td>
                  </tr>
                  <tr>
                    <td className="border border-black px-2 py-2 text-center font-bold">审批资料是否齐全</td>
                    <td className="border border-black px-2 py-2">{check(draft.approvalsComplete, '是', '否')}</td>
                    <td className="border border-black px-2 py-2 text-center font-bold">商谈报告</td>
                    <td className="border border-black px-2 py-2">{check(draft.hasNegotiationReport, '有', '无')}</td>
                  </tr>
                  <tr>
                    <td className="border border-black px-2 py-2 text-center font-bold">中选供应商确认单</td>
                    <td className="border border-black px-2 py-2">{check(draft.hasWinnerConfirmation, '有', '无')}</td>
                    <td className="border border-black px-2 py-2 text-center font-bold">中选通知书</td>
                    <td className="border border-black px-2 py-2">{check(draft.hasNotificationLetter, '有', '无')}</td>
                  </tr>
                  <tr>
                    <td className="border border-black px-2 py-2 text-center font-bold">合同书</td>
                    <td className="border border-black px-2 py-2">{check(draft.hasContract, '有', '无')}</td>
                    <td className="border border-black px-2 py-2 text-center font-bold">备案意见</td>
                    <td className="border border-black px-2 py-2">{check(draft.filingOpinion, '同意', '不同意')}</td>
                  </tr>
                  <tr>
                    <td className="border border-black px-2 py-2 text-center font-bold">签字（盖章）</td>
                    <td className="border border-black px-2 py-2">签字：{draft.signatory || '　'}　　盖章：</td>
                    <td className="border border-black px-2 py-2 text-center font-bold">备注</td>
                    <td className="border border-black px-2 py-2">{draft.remark || '　'}</td>
                  </tr>
                </tbody>
              </table>
              <div className="mt-3 text-[11px] leading-5 text-[#3a4658]">
                注：采购人应依据档案管理有关规定，将采购资料逐一整理、编序，形成电子档案提交备案。
              </div>
            </div>
            <div className="mx-4 mb-3 flex items-start gap-2 rounded-[12px] px-4 py-3 text-[11px] leading-relaxed text-[color:var(--muted-foreground)]"
              style={{ background: 'color-mix(in oklch, var(--accent-soft) 18%, transparent)' }}>
              <ShieldCheck size={14} className="mt-0.5 shrink-0 text-[color:var(--accent)]" />
              <span>生成后自动上传至本步骤附件区；纸质备案表需线下签字盖章后归档留存。</span>
            </div>
          </div>
        </aside>
      </div>

      <div className="mt-3 flex items-center gap-2 px-1 text-[11px] text-[color:var(--muted-foreground)]">
        <FileCheck2 size={12} className="shrink-0" />
        勾选项与纸质附件6一一对应；「商谈报告/确认单/通知书/合同书」按项目实际存档情况勾选。
      </div>
    </Modal>
  );
}
