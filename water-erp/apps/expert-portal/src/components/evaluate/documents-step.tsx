'use client';

import { Download, FileText } from 'lucide-react';
import type { ExpertProjectDetail, DecryptedDocuments } from '@/lib/types';
import { DECRYPT_LABEL } from '@water-erp/shared';
import { formatBytes } from '@/lib/utils';

interface DocumentsStepProps {
  project: ExpertProjectDetail;
  documents: Record<string, DecryptedDocuments | null>;
}

export function DocumentsStep({ project, documents }: DocumentsStepProps) {
  return (
    <div className="p-6 pt-4">
      {/* 招标文件（项目级，专家独立核对原文 ★号实质性条款）*/}
      <div className="neu-card-static mb-5 overflow-hidden">
        <div className="flex items-center gap-2.5 px-4 py-3">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[9px] bg-[var(--accent-strong)] text-white">
            <FileText size={15} strokeWidth={1.5} />
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-bold text-[var(--foreground)]">招标文件</h3>
            <p className="text-[10px] text-[var(--muted-foreground)]">评标依据原文 · 请独立核对 ★号实质性条款</p>
          </div>
        </div>
        <hr className="wb-section-rule" />
        <div className="p-4">
          {project.tenderDocument ? (
            <div className="neu-attachment-item">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] bg-[var(--accent-strong)] text-[9px] font-bold uppercase text-white">
                PDF
              </div>
              <div className="min-w-0 flex-1">
                <h4 className="truncate text-xs font-semibold text-[var(--foreground)]" title={project.tenderDocument.fileName}>{project.tenderDocument.fileName}</h4>
                <div className="mt-0.5 flex items-center gap-2">
                  <span className="text-[10px] text-[var(--muted-foreground)]">{formatBytes(project.tenderDocument.fileSize)}</span>
                  <span className="text-[10px] font-semibold text-[var(--accent-strong)]">可预览</span>
                </div>
              </div>
              <a href={project.tenderDocument.downloadUrl} target="_blank" rel="noopener" className="neu-btn-xs is-info shrink-0">
                <Download size={12} strokeWidth={1.5} /> 预览
              </a>
            </div>
          ) : (
            <div className="py-5 text-center text-[var(--muted-foreground)]">
              <FileText size={26} strokeWidth={1} className="mx-auto mb-2 opacity-50" />
              <p className="text-xs">本项目暂无招标文件</p>
            </div>
          )}
        </div>
      </div>

      {Object.keys(documents).length === 0 ? (
        <div className="py-12 text-center text-[var(--muted-foreground)]">
          <div className="mb-3"><FileText size={40} strokeWidth={1} className="mx-auto opacity-50" /></div>
          <p>正在加载标书...</p>
        </div>
      ) : (
        <div className="space-y-5">
          {project.suppliers.map(sup => {
            const doc = documents[sup.id];
            if (!doc) return null;
            const statusColor =
              sup.decryptStatus === 'SUCCESS' ? 'var(--success)'
              : sup.decryptStatus === 'DANGER' ? 'var(--danger)'
              : 'var(--warning)';
            return (
              <div key={sup.id} className="neu-card-static overflow-hidden">
                {/* 供应商头部 */}
                <div className="flex items-center justify-between px-4 py-3">
                  <div className="flex items-center gap-2.5">
                    <span className="exp-pill" style={{ '--c': statusColor } as React.CSSProperties}>
                      <span className="exp-pill-dot" />
                      {DECRYPT_LABEL[sup.decryptStatus] || sup.decryptStatus}
                    </span>
                    <h3 className="text-sm font-bold text-[var(--foreground)]">{sup.supplierName}</h3>
                  </div>
                  {!doc.canView && (
                    <span className="exp-pill" style={{ '--c': 'var(--warning)' } as React.CSSProperties}>标书尚未解密</span>
                  )}
                </div>
                <hr className="wb-section-rule" />

                {/* 文件列表 */}
                <div className="p-4">
                  {!doc.canView ? (
                    <p className="text-sm text-[var(--muted-foreground)]">请等待开标主持端完成解密</p>
                  ) : doc.documents.length === 0 ? (
                    <p className="py-4 text-center text-sm text-[var(--muted-foreground)]">该供应商未提交可查看的投标文件</p>
                  ) : (
                    <div className="grid grid-cols-2 gap-3">
                      {doc.documents.map((d, i) => (
                        <div key={i} className="neu-attachment-item">
                          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] bg-[var(--accent-strong)] text-[9px] font-bold uppercase text-white">
                            {d.type.replace('application/', '').replace('image/', '').replace('vnd.', '').slice(0, 4)}
                          </div>
                          <div className="min-w-0 flex-1">
                            <h4 className="truncate text-xs font-semibold text-[var(--foreground)]" title={d.originalName}>{d.originalName}</h4>
                            <div className="mt-0.5 flex items-center gap-2">
                              <span className="text-[10px] text-[var(--muted-foreground)]">{formatBytes(d.size)}</span>
                              <span className="text-[10px] font-semibold text-[var(--success)]">{d.status}</span>
                            </div>
                          </div>
                          {d.downloadUrl ? (
                            <a href={d.downloadUrl} target="_blank" rel="noopener" className="neu-btn-xs is-info shrink-0">
                              <Download size={12} strokeWidth={1.5} /> 预览
                            </a>
                          ) : (
                            <span className="shrink-0 px-2 py-1 text-[10px] text-[var(--muted-foreground)]">待解密</span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
