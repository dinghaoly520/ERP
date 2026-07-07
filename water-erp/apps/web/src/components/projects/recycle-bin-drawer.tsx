"use client";

import { useState } from 'react';
import { AlertTriangle, Loader2, Recycle, RotateCcw, Trash2, X } from 'lucide-react';
import type { ProjectManagementItem } from '@/lib/types/project-management';
import { LoginErrorDialog } from '@/components/login/login-error-dialog';

function getStageLabel(stageKey: string) {
  return (
    {
      INITIATION: '项目立项',
      TENDER_DOCUMENT: '采购文件',
      PUBLIC_ANNOUNCEMENT: '采购公示',
      EXPERT_SELECTION: '专家抽取',
      BID_EVALUATION: '评标过程',
      AWARD_DECISION: '定标',
      CONTRACT: '合同',
    }[stageKey] ?? stageKey
  );
}

export function RecycleBinDrawer({
  isOpen,
  items,
  submittingId,
  errorMessage,
  canModify,
  onClose,
  onRestore,
  onDelete,
  onDeleteAll,
  onDismissError,
}: {
  isOpen: boolean;
  items: ProjectManagementItem[];
  submittingId: string | null;
  errorMessage: string | null;
  canModify: (project: { createdById?: string | null }) => boolean;
  onClose: () => void;
  onRestore: (projectId: string) => Promise<void>;
  onDelete: (projectId: string) => Promise<void>;
  onDeleteAll: () => Promise<void>;
  onDismissError: () => void;
}) {
  const [showDeleteAllConfirm, setShowDeleteAllConfirm] = useState(false);

  if (!isOpen) {
    return null;
  }

  return (
    <>
      <div
        className="fixed inset-0 z-[92] bg-[var(--background)]/60 backdrop-blur-sm"
        onClick={onClose}
      />

      <section className="fixed inset-0 z-[93] flex items-center justify-center px-4 py-6">
        <div className="flex h-[min(760px,calc(100dvh-3rem))] w-full max-w-[min(860px,92vw)] flex-col overflow-hidden rounded-[24px] bg-[var(--background)] shadow-[0_20px_60px_rgba(0,0,0,0.12)]">
          <div className="px-5 py-5 sm:px-6 lg:px-7" style={{ borderBottom: "1px solid oklch(0.6 0.04 258 / 0.16)" }}>
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="inline-flex items-center gap-2 rounded-full bg-[color-mix(in_oklch,var(--accent)_12%,transparent)] px-3 py-1 text-[11px] font-semibold tracking-[0.14em] text-[color:var(--accent)]">
                  <Recycle size={14} />
                  回收站
                </div>
                <h2 className="mt-3 font-[family-name:var(--font-display)] text-2xl font-semibold tracking-[-0.05em] text-[color:var(--foreground)]">
                  已移除项目
                </h2>
                <p className="mt-2 max-w-[46ch] text-sm leading-6 text-[color:var(--muted-foreground)]">
                  回收站中的项目不会出现在进行中列表。你可以恢复项目，或彻底删除它。
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                {items.length > 0 ? (
                  <button
                    type="button"
                    onClick={() => setShowDeleteAllConfirm(true)}
                    disabled={Boolean(submittingId)}
                    className="neu-btn-soft is-danger"
                  >
                    <Trash2 size={16} />
                    {submittingId === '__all__' ? '删除中...' : '一键删除'}
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={onClose}
                  className="neu-btn-xs"
                  aria-label="关闭回收站"
                >
                  <X size={18} />
                </button>
              </div>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-5 py-5 sm:px-6 lg:px-7">
            {items.length === 0 ? (
              <div className="wb-panel flex items-center justify-center px-5 py-10 text-sm leading-6 text-[color:var(--muted-foreground)]">
                当前回收站为空。被移除的项目会在这里等待恢复或彻底删除。
              </div>
            ) : (
              <div className="grid gap-4 lg:grid-cols-2">
                {items.map((item) => {
                  const isSubmitting = submittingId === item.id;
                  const isModifiable = canModify(item);
                  return (
                    <article
                      key={item.id}
                      className="neu-card-static !rounded-[20px] p-5"
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0">
                          <div className="text-[1.02rem] font-semibold tracking-[-0.03em] text-[color:var(--foreground)]">
                            {item.title}
                          </div>
                          <div className="mt-2 text-sm text-[color:var(--muted-foreground)]">
                            {item.requesterDepartment} · {item.requesterName}
                          </div>
                        </div>
                        <span className="shrink-0 rounded-full bg-[color-mix(in_oklch,var(--warning)_14%,transparent)] px-3 py-1 text-[11px] font-semibold text-[color:var(--warning)]">
                          已移除
                        </span>
                      </div>

                      <div className="mt-4 grid gap-x-4 gap-y-3 sm:grid-cols-2">
                        <div>
                          <div className="text-[11px] font-semibold tracking-[0.14em] text-[color:var(--muted-foreground)]">
                            采购方式
                          </div>
                          <div className="mt-1 text-sm text-[color:var(--foreground)]">
                            {item.procurementMethod || '待补充'}
                          </div>
                        </div>
                        <div>
                          <div className="text-[11px] font-semibold tracking-[0.14em] text-[color:var(--muted-foreground)]">
                            当前阶段
                          </div>
                          <div className="mt-1 text-sm text-[color:var(--foreground)]">
                            {getStageLabel(item.currentStage)}
                          </div>
                        </div>
                      </div>

                      <div className="mt-5 flex flex-wrap gap-3">
                        {isModifiable ? (
                          <>
                            <button
                              type="button"
                              onClick={() => void onRestore(item.id)}
                              disabled={isSubmitting}
                              className="neu-btn-soft"
                            >
                              <RotateCcw size={16} />
                              {isSubmitting ? '处理中...' : '恢复项目'}
                            </button>
                            <button
                              type="button"
                              onClick={() => void onDelete(item.id)}
                              disabled={isSubmitting}
                              className="neu-btn-soft is-danger"
                            >
                              <Trash2 size={16} />
                              {isSubmitting ? '处理中...' : '彻底删除'}
                            </button>
                          </>
                        ) : (
                          <span className="inline-flex items-center text-xs text-[color:var(--muted-foreground)]">
                            仅创建者可操作
                          </span>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </section>

      <LoginErrorDialog
        isOpen={Boolean(errorMessage)}
        message={errorMessage ?? ''}
        onClose={onDismissError}
      />

      {showDeleteAllConfirm ? (
        <div className="fixed inset-0 z-[100] flex items-center justify-center px-4 py-6">
          <div
            className="absolute inset-0 bg-[var(--background)]/60 backdrop-blur-md"
            onClick={() => {
              if (!submittingId) setShowDeleteAllConfirm(false);
            }}
          />
          <div className="relative w-full max-w-[460px] overflow-hidden rounded-[24px] bg-[var(--background)] shadow-[0_20px_60px_rgba(0,0,0,0.12)]">
            <div className="absolute inset-x-0 top-0 h-1.5 bg-[linear-gradient(90deg,rgba(209,88,88,0.95),rgba(234,191,106,0.72),rgba(121,162,239,0.35))]" />
            <div className="px-6 py-6">
              <div className="flex items-start gap-4">
                <div className="flex h-13 w-13 shrink-0 items-center justify-center rounded-[18px] border border-[color-mix(in_oklch,var(--danger)_24%,transparent)] bg-[color-mix(in_oklch,var(--danger)_11%,transparent)] text-[color:var(--danger)]">
                  <AlertTriangle size={24} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="inline-flex rounded-full bg-[color-mix(in_oklch,var(--danger)_10%,transparent)] px-2.5 py-1 text-[11px] font-semibold tracking-[0.14em] text-[color:var(--danger)]">
                    不可恢复操作
                  </div>
                  <h3 className="mt-3 font-[family-name:var(--font-display)] text-[1.28rem] font-semibold tracking-[-0.05em] text-[color:var(--foreground)]">
                    清空回收站？
                  </h3>
                  <p className="mt-2 text-sm leading-6 text-[color:var(--muted-foreground)]">
                    将彻底删除回收站中的 <span className="font-semibold text-[color:var(--danger)]">{items.length}</span> 个项目。删除后无法恢复，请确认这些项目不再需要保留。
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowDeleteAllConfirm(false)}
                  disabled={Boolean(submittingId)}
                  className="neu-btn-xs"
                  aria-label="取消一键删除"
                >
                  <X size={17} />
                </button>
              </div>

              <div className="mt-5 rounded-[18px] border border-[color-mix(in_oklch,var(--danger)_14%,transparent)] bg-[linear-gradient(145deg,rgba(255,245,245,0.86),rgba(255,255,255,0.72))] px-4 py-3 text-sm leading-6 text-[rgba(145,63,63,0.92)]">
                建议仅在确认项目已无归档价值时使用。若只是误移除，请选择"恢复项目"。
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 px-6 py-4" style={{ borderTop: "1px solid oklch(0.6 0.04 258 / 0.16)" }}>
              <button
                type="button"
                onClick={() => setShowDeleteAllConfirm(false)}
                disabled={Boolean(submittingId)}
                className="neu-btn-soft"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => void onDeleteAll().then(() => setShowDeleteAllConfirm(false))}
                disabled={Boolean(submittingId)}
                className="neu-btn-primary is-danger"
              >
                {submittingId === '__all__' ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
                {submittingId === '__all__' ? '正在删除' : '确认一键删除'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
