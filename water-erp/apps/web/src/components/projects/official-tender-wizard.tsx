'use client';

/**
 * 03「采购文件」完成向导（2026-09-26 用户裁定）：
 *  Step1 选择/上传正式盖章版采购文件（指针即真相，不限类型；选定即落库，中途取消不丢）
 *  Step2 左侧预览正式文件 + 右侧评分标准现状对照确认（AI 提取固定走正式文件 OCR，
 *        建议审核弹窗标新增/疑似重复由用户决定采纳）
 *  确认完成 → 由父组件执行原 updateStage 完成链（服务端双闸兜底：OFFICIAL_TENDER_REQUIRED 不可豁免）。
 *  关闭/取消 = 阶段不动。
 */
import { ArrowLeft, ArrowRight, CheckCircle2, FileText, Loader2, ShieldCheck, UploadCloud, X } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import type { ProjectManagementAttachment, ProjectManagementItem, ProjectManagementStage } from '@/lib/types/project-management';
import { selectOfficialTender, uploadProjectStageAttachment } from '@/lib/api/project-management';
import type { BidProjectDetail, BidProjectRef } from '@/lib/api/bid';
import { ScoreStandardCard } from './score-standard-card';
import { FilePreviewPane, getFileKind } from './file-preview-pane';

type Props = {
  project: ProjectManagementItem;
  stage: ProjectManagementStage;
  /** 该轮 03 附件（候选 + 上传落此阶段） */
  attachments: ProjectManagementAttachment[];
  /** 已落指针的正式文件 id（重开后再完成回显上次选择） */
  initialOfficialId: string | null;
  /** 该轮 BidProject 概要（null=未关联 → Step2 降级为仅确认正式文件） */
  bidProject: BidProjectRef | null;
  detail: BidProjectDetail | null;
  priceItemCount?: number;
  /** 评分标准配置状态（面板 ScoreGateStatus 全联合）：仅 'incomplete' 时禁用确认并给指引；
   *  unlinked/exempt/unknown 不本地拦——与原完成前预检口径一致，交服务端闸门权威判定。 */
  scoreStatus?: 'unlinked' | 'exempt' | 'ok' | 'incomplete' | 'unknown';
  /** 数据刷新（附件上传/评分标准变更后由抽屉级重拉） */
  onChanged: () => void;
  onClose: () => void;
  /** 确认完成 → 父组件执行原完成链 */
  onConfirm: () => void;
  submitting?: boolean;
};

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function OfficialTenderWizard({
  project,
  stage,
  attachments,
  initialOfficialId,
  bidProject,
  detail,
  priceItemCount,
  scoreStatus,
  onChanged,
  onClose,
  onConfirm,
  submitting,
}: Props) {
  const round = stage.round ?? 1;
  const [step, setStep] = useState<1 | 2>(1);
  // 智能默认：无已落指针且候选唯一 → 自动选中（仍需用户点「下一步」确认）
  const [selectedId, setSelectedId] = useState<string | null>(
    initialOfficialId ?? (attachments.length === 1 ? attachments[0].id ?? null : null),
  );
  const [selecting, setSelecting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const selectedFile = useMemo(
    () => attachments.find((a) => a.id === selectedId) ?? null,
    [attachments, selectedId],
  );

  // 智能排序（双键，修复 2026-09-26 审查：初版权重被毫秒时间戳淹没）：
  // ①文件名含「盖章/正式」排前（提示引导，不替用户决定）②其余按上传时间新→旧
  const candidates = useMemo(() => {
    const flagged = (f: ProjectManagementAttachment) => (/盖章|正式/.test(f.fileName) ? 0 : 1);
    const ts = (f: ProjectManagementAttachment) => -new Date(f.createdAt ?? 0).getTime();
    return [...attachments].sort((a, b) => flagged(a) - flagged(b) || ts(a) - ts(b));
  }, [attachments]);

  /** 选定即落指针（中途取消不丢——重进向导回显；后端拒绝已完成阶段改指针） */
  async function persistSelection(attachmentId: string) {
    setSelecting(true);
    try {
      await selectOfficialTender(project.id, 'TENDER_DOCUMENT', { attachmentId, round });
      onChanged(); // 刷新抽屉数据（指针回显）
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '标记正式文件失败');
      setSelectedId(initialOfficialId ?? null); // 回滚
    } finally {
      setSelecting(false);
    }
  }

  function handleSelect(attachmentId: string | null) {
    setSelectedId(attachmentId);
    if (attachmentId) void persistSelection(attachmentId);
  }

  async function handleUpload(file: File) {
    setUploading(true);
    try {
      const uploaded = await uploadProjectStageAttachment(project.id, 'TENDER_DOCUMENT', file);
      toast.success('已上传至「采购文件」步骤');
      await onChanged(); // 抽屉重拉 → attachments 注入新文件
      if (uploaded?.id) {
        setSelectedId(uploaded.id);
        await persistSelection(uploaded.id); // 上传即选定为正式文件（用户意图明确）
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '上传失败');
    } finally {
      setUploading(false);
    }
  }

  const confirmDisabled = scoreStatus === 'incomplete' || submitting;

  return (
    <div className="fixed inset-0 z-[500] flex flex-col">
      <div className="absolute inset-0 wb-overlay-backdrop" onClick={onClose} />
      <div className="relative z-10 mx-5 my-5 wb-overlay-panel">
        {/* ── 头部：步骤指示 ── */}
        <div className="flex shrink-0 items-center justify-between gap-3 px-6 py-4 wb-overlay-panel-header">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px]"
              style={{ background: 'color-mix(in oklch, var(--accent-soft) 45%, transparent)', boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.65), 2px 2px 4px oklch(0.55 0.03 258 / 0.1)' }}>
              <ShieldCheck size={16} className="text-[var(--accent)]" />
            </div>
            <div className="min-w-0">
              <h2 className="text-base font-semibold tracking-[-0.02em] text-[var(--foreground)]">
                完成采购文件阶段{round > 1 ? `（第 ${round} 轮）` : ''}
              </h2>
              <div className="mt-0.5 flex items-center gap-2 text-[11px] text-[var(--muted-foreground)]">
                <span className={step === 1 ? 'font-bold text-[var(--accent)]' : ''}>① 正式盖章版采购文件</span>
                <span className="opacity-50">→</span>
                <span className={step === 2 ? 'font-bold text-[var(--accent)]' : ''}>② 对照确认评分标准</span>
              </div>
            </div>
          </div>
          <button type="button" onClick={onClose} className="neu-btn-xs" title="关闭（不完成本阶段）">
            <X size={16} />
          </button>
        </div>

        {/* ── 内容区 ── */}
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
          {step === 1 ? (
            <div className="mx-auto max-w-3xl space-y-4">
              <p className="text-sm leading-6 text-[var(--muted-foreground)]">
                请选择或上传<span className="font-semibold text-[var(--foreground)]">正式盖章版采购文件</span>
                ——本阶段完成前必须确定（不可豁免）。已上传过的文件可直接选择；标记哪个文件为正式文件即认哪个（扫描 PDF / 图片 / 盖章 docx 均可）。
              </p>

              {/* 候选列表 */}
              {candidates.length > 0 ? (
                <div className="space-y-2">
                  {candidates.map((c) => {
                    const active = selectedId === c.id;
                    const kind = getFileKind(c.fileName);
                    const isOfficial = initialOfficialId === c.id;
                    return (
                      <button
                        key={c.objectKey}
                        type="button"
                        disabled={selecting}
                        onClick={() => handleSelect(c.id ?? null)}
                        className={`flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left transition ${
                          active
                            ? 'border-[var(--accent)] bg-[color-mix(in_oklch,var(--accent)_8%,transparent)]'
                            : 'border-[oklch(0.9_0.005_264)] hover:bg-[oklch(0.975_0.003_265)]'
                        }`}
                      >
                        <FileText size={18} className={kind === 'other' ? 'shrink-0 text-[var(--muted-foreground)]' : 'shrink-0 text-[var(--accent)]'} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium text-[var(--foreground)]">{c.fileName}</span>
                          <span className="mt-0.5 block text-xs text-[var(--muted-foreground)]">
                            {c.mimeType} · {formatSize(c.fileSize)}
                            {c.createdAt ? ` · ${new Date(c.createdAt).toLocaleString('zh-CN')}` : ''}
                          </span>
                        </span>
                        {isOfficial && (
                          <span className="shrink-0 rounded-full bg-[color-mix(in_oklch,var(--success)_12%,transparent)] px-2 py-0.5 text-[10px] font-bold text-[var(--success)]">
                            已标记正式
                          </span>
                        )}
                        <span
                          className={`grid h-5 w-5 shrink-0 place-items-center rounded-full border ${
                            active ? 'border-[var(--accent)] bg-[var(--accent)] text-white' : 'border-[oklch(0.75_0.01_258)]'
                          }`}
                        >
                          {active && <CheckCircle2 size={12} />}
                        </span>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed px-4 py-10 text-center"
                  style={{ borderColor: 'color-mix(in oklch, var(--muted-foreground) 30%, transparent)' }}>
                  <FileText size={26} className="text-[var(--muted-foreground)] opacity-60" />
                  <div className="text-sm font-semibold text-[var(--foreground)]">本步骤还没有上传文件</div>
                  <div className="text-xs text-[var(--muted-foreground)]">请上传正式盖章版采购文件（扫描 PDF / 图片 / 盖章 docx）</div>
                </div>
              )}

              {/* 上传区 */}
              <div className="rounded-xl p-4" style={{ background: 'color-mix(in oklch,var(--muted) 25%,transparent)', boxShadow: 'inset 1px 2px 5px oklch(0.55 0.03 258 / 0.14), inset -1px -1px 2px oklch(1 0 0 / 0.5)' }}>
                <label className="flex cursor-pointer items-center justify-center gap-3 rounded-lg bg-[oklch(1_0_0/0.5)] px-4 py-3 transition hover:bg-[oklch(1_0_0/0.75)]"
                  style={{ boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.7), 2px 2px 4px oklch(0.55 0.03 258 / 0.08), -1px -1px 3px oklch(1 0 0 / 0.8)' }}>
                  {uploading ? <Loader2 size={20} className="shrink-0 animate-spin text-[var(--accent)]" /> : <UploadCloud size={20} className="shrink-0 text-[var(--muted-foreground)]" />}
                  <div className="min-w-0 text-left">
                    <span className="text-sm font-medium text-[var(--foreground)]">{uploading ? '正在上传…' : '没有提前上传？现在上传正式盖章版文件'}</span>
                    <span className="mt-0.5 block text-xs text-[var(--muted-foreground)]">上传后自动选定为正式文件</span>
                  </div>
                  <input ref={fileInputRef} type="file" disabled={uploading}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void handleUpload(f);
                      e.target.value = '';
                    }}
                    className="sr-only" />
                </label>
              </div>
            </div>
          ) : (
            <div className="flex h-full min-h-[60vh] flex-col gap-4 lg:flex-row">
              {/* 左：正式文件预览 */}
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[16px]"
                style={{ background: 'linear-gradient(170deg, oklch(1 0 0 / 0.94), oklch(0.988 0.005 258 / 0.62))', boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.88), 2px 3px 12px oklch(0.46 0.07 258 / 0.14)' }}>
                <div className="flex shrink-0 items-center gap-2 px-4 py-2.5 text-xs"
                  style={{ borderBottom: '1px solid oklch(0.6 0.04 258 / 0.12)' }}>
                  <FileText size={13} className="shrink-0 text-[var(--accent)]" />
                  <span className="truncate font-semibold text-[var(--foreground)]" title={selectedFile?.fileName}>
                    {selectedFile?.fileName ?? '正式盖章版采购文件'}
                  </span>
                  <span className="ml-auto shrink-0 rounded-full bg-[color-mix(in_oklch,var(--success)_12%,transparent)] px-2 py-0.5 text-[10px] font-bold text-[var(--success)]">
                    正式盖章版
                  </span>
                </div>
                <div className="min-h-0 flex-1">
                  {selectedFile ? (
                    <FilePreviewPane projectId={project.id} file={selectedFile} />
                  ) : (
                    <div className="flex h-full items-center justify-center text-sm text-[var(--muted-foreground)]">未选择文件</div>
                  )}
                </div>
              </div>

              {/* 右：评分标准对照确认——始终渲染卡片（2026-09-26「进入即绑定」：
                  该轮无 BP 时卡片挂载即 ensure 建关联直达配置态，与评分标准面板同语义） */}
              <div className="flex min-h-0 flex-1 flex-col overflow-y-auto pl-1">
                <ScoreStandardCard
                  project={project}
                  round={round}
                  bidProject={bidProject}
                  detail={detail}
                  priceItemCount={priceItemCount}
                  onChanged={onChanged}
                  extractSource={selectedFile?.id && selectedFile.fileName
                    ? { attachmentId: selectedFile.id, fileName: selectedFile.fileName }
                    : null}
                />
              </div>
            </div>
          )}
        </div>

        {/* ── 底部操作 ── */}
        <div className="flex shrink-0 items-center justify-between gap-3 px-6 py-3.5"
          style={{ borderTop: '1px solid oklch(0.6 0.04 258 / 0.12)', background: 'linear-gradient(105deg, oklch(1 0 0 / 0.92) 0%, oklch(0.975 0.006 258 / 0.58) 60%)' }}>
          <div className="min-w-0 text-xs text-[var(--muted-foreground)]">
            {step === 1
              ? '关闭即取消，本阶段状态不变'
              : scoreStatus === 'incomplete'
                ? <span className="font-semibold text-[oklch(0.55_0.08_75)]">评分标准未配置完整——请在右侧完成配置（满分合计 100 且每项有得分点）后再确认</span>
                : '确认后本阶段完成、进入下一步骤；评分标准此后仍可在开标前修改'}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {step === 1 ? (
              <>
                <button type="button" onClick={onClose} className="neu-btn-soft">暂不完成</button>
                <button
                  type="button"
                  onClick={() => setStep(2)}
                  disabled={!selectedId || selecting || uploading}
                  className="neu-btn-primary !h-[38px] !text-xs gap-1.5"
                >
                  下一步：对照确认评分标准 <ArrowRight size={14} />
                </button>
              </>
            ) : (
              <>
                <button type="button" onClick={() => setStep(1)} className="neu-btn-soft gap-1.5">
                  <ArrowLeft size={14} /> 更换正式文件
                </button>
                <button
                  type="button"
                  onClick={onConfirm}
                  disabled={confirmDisabled}
                  title={scoreStatus === 'incomplete' ? '评分标准未配置完整' : undefined}
                  className="neu-btn-primary is-success !h-[38px] !text-xs gap-1.5"
                >
                  {submitting ? (<><Loader2 size={15} className="animate-spin" />提交中…</>) : (<><CheckCircle2 size={15} />确认完成本阶段</>)}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
