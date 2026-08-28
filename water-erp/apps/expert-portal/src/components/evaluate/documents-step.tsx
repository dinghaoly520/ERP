'use client';

import { useEffect, useState } from 'react';
import { Download, FileText, RotateCcw, Loader, ScrollText, ChevronDown, ChevronRight } from 'lucide-react';
import { toast } from 'sonner';
import type { ExpertProjectDetail, DecryptedDocuments } from '@/lib/types';
import { DECRYPT_LABEL } from '@water-erp/shared';
import { formatBytes } from '@/lib/utils';
import { api } from '@/lib/api';

/** A-136：专家视角已发布澄清/修改文件（listDocsForExpert 返回形状）。 */
interface ClarificationDoc {
  id: string;
  version: number;
  title: string;
  content: string;
  publishedAt: string | null;
  fileAssetId: string | null;
}

/**
 * A-136：澄清与修改文件卡片（「招标文件」区块下方）。
 * 评委须以「招标文件 + 澄清修改文件」为有效评标依据——挂载时拉取本项目已发布清单，
 * 附件经服务端流式直出下载（POST → blob → a.download，不走 /upload 授权链）。
 * 加载失败静默降级为空态（console.warn），不阻塞标书获取步骤。
 */
function ClarificationDocsCard({ projectId }: { projectId: string }) {
  const [docs, setDocs] = useState<ClarificationDoc[] | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<ClarificationDoc[]>(`/expert/projects/${projectId}/clarification-docs`)
      .then(setDocs)
      .catch((err) => {
        console.warn('[A-136] 澄清修改文件列表加载失败', err);
        setDocs([]);
      });
  }, [projectId]);

  async function downloadAttachment(doc: ClarificationDoc) {
    if (downloadingId) return;
    setDownloadingId(doc.id);
    try {
      // 二进制响应需原始 fetch（api.post 只解析 JSON）；X-Portal + cookie 与 api 客户端同源
      const res = await fetch(`/api/expert/projects/${projectId}/clarification-docs/${doc.id}/download`, {
        method: 'POST',
        headers: { 'X-Portal': 'expert' },
        credentials: 'include',
      });
      // 204 = 服务端确认文档存在但无附件实体（纯正文/附件悬空）——不落 0 字节文件
      if (res.status === 204) {
        toast.error('附件不存在或已失效');
        return;
      }
      if (!res.ok) {
        // 400/403 带后端规范体 { error, code }——透传文案；其余状态给通用提示
        let message = '下载失败请重试';
        if (res.status === 400 || res.status === 403) {
          try {
            const data = await res.json();
            if (data?.error) message = String(data.error);
          } catch { /* 非 JSON 错误体 */ }
        }
        toast.error(message);
        return;
      }
      const blob = await res.blob();
      if (blob.size === 0) {
        toast.error('附件不存在或已失效');
        return;
      }
      const disposition = res.headers.get('content-disposition') || '';
      const m = disposition.match(/filename="?([^"]+)"?/);
      const fileName = m ? decodeURIComponent(m[1]) : `澄清修改文件_v${doc.version}`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.warn('[A-136] 澄清修改文件下载失败', err);
      toast.error('下载失败请重试');
    } finally {
      setDownloadingId(null);
    }
  }

  return (
    <div className="neu-card-static mb-5 overflow-hidden">
      <div className="flex items-center gap-2.5 px-4 py-3">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[9px] bg-[var(--accent-strong)] text-white">
          <ScrollText size={15} strokeWidth={1.5} />
        </div>
        <div className="min-w-0">
          <h3 className="text-sm font-bold text-[var(--foreground)]">澄清与修改文件</h3>
          <p className="text-[10px] text-[var(--muted-foreground)]">评标依据补充 · 请与招标文件一并核对</p>
        </div>
        {docs && docs.length > 0 && (
          <span className="ml-auto shrink-0 text-[10px] text-[var(--muted-foreground)]">共 {docs.length} 份</span>
        )}
      </div>
      <hr className="wb-section-rule" />
      <div className="p-4">
        {docs === null ? (
          <div className="flex items-center justify-center gap-2 py-5 text-[var(--muted-foreground)]">
            <Loader size={14} strokeWidth={1.5} className="animate-spin" />
            <span className="text-xs">正在加载澄清修改文件...</span>
          </div>
        ) : docs.length === 0 ? (
          <div className="py-5 text-center text-[var(--muted-foreground)]">
            <ScrollText size={26} strokeWidth={1} className="mx-auto mb-2 opacity-50" />
            <p className="text-xs">暂无澄清修改文件</p>
          </div>
        ) : (
          <div className="space-y-3">
            {docs.map((doc) => {
              const expanded = expandedId === doc.id;
              return (
                <div key={doc.id} className="rounded-xl border border-[color-mix(in_oklch,var(--foreground)_6%,transparent)] p-3">
                  <div className="flex items-center gap-2">
                    <span className="shrink-0 rounded bg-[var(--accent-strong)] px-2 py-0.5 text-[10px] font-bold text-white">
                      v{doc.version}
                    </span>
                    <h4 className="min-w-0 flex-1 truncate text-xs font-semibold text-[var(--foreground)]" title={doc.title}>
                      {doc.title}
                    </h4>
                    {doc.publishedAt && (
                      <span className="shrink-0 text-[10px] text-[var(--muted-foreground)]">
                        {new Date(doc.publishedAt).toLocaleString('zh-CN')}
                      </span>
                    )}
                    {doc.fileAssetId && (
                      <button
                        type="button"
                        onClick={() => downloadAttachment(doc)}
                        disabled={downloadingId !== null}
                        className="neu-btn-xs is-info shrink-0 disabled:opacity-50"
                      >
                        {downloadingId === doc.id ? <Loader size={12} strokeWidth={1.5} className="animate-spin" /> : <Download size={12} strokeWidth={1.5} />}
                        {downloadingId === doc.id ? '下载中…' : '下载附件'}
                      </button>
                    )}
                  </div>
                  {doc.content && (
                    <div className="mt-2">
                      <button
                        type="button"
                        onClick={() => setExpandedId(expanded ? null : doc.id)}
                        className="flex items-center gap-1 text-[10px] font-semibold text-[var(--accent-strong)]"
                      >
                        {expanded ? <ChevronDown size={12} strokeWidth={1.5} /> : <ChevronRight size={12} strokeWidth={1.5} />}
                        {expanded ? '收起正文' : '查看正文'}
                      </button>
                      {expanded && (
                        <p className="mt-1.5 max-h-40 overflow-y-auto whitespace-pre-wrap rounded-lg bg-[color-mix(in_oklch,var(--accent)_4%,transparent)] p-2.5 text-xs leading-relaxed text-[var(--foreground)]">
                          {doc.content}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

interface DocumentsStepProps {
  project: ExpertProjectDetail;
  documents: Record<string, DecryptedDocuments | null>;
  onRefresh?: () => void;
  refreshing?: boolean;
}

export function DocumentsStep({ project, documents, onRefresh, refreshing }: DocumentsStepProps) {
  return (
    <div className="p-6 pt-4">
      {onRefresh && (
        <div className="mb-4 flex items-center justify-end">
          <button type="button" onClick={onRefresh} disabled={refreshing}
            className="neu-btn-soft disabled:opacity-50">
            {refreshing ? <Loader size={13} className="animate-spin" /> : <RotateCcw size={13} strokeWidth={1.5} />}
            {refreshing ? '刷新中…' : '刷新'}
          </button>
        </div>
      )}
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

      {/* A-136：澄清与修改文件（评委核对招标文件澄清修改的法定输入）*/}
      <ClarificationDocsCard projectId={project.id} />

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
