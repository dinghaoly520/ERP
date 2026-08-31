'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Download, Loader2, RefreshCw, X } from 'lucide-react';
import { api } from '@/lib/api';
import { uploadProjectStageAttachment } from '@/lib/api/project-management';

/**
 * 采购邀请书（供应商邀请·第 5 步附件选择）：
 * AI 依据项目已知信息起草整篇公文体正文（连续段落、无条目编号）→ 预览/可改 →
 * 导出 Word（公函排版）→ 导出即自动落入本步骤「上传附件」清单（随确认配置下发供应商）。
 */

export interface InvitationLetterTimes {
  acquireStart?: string;
  acquireEnd?: string;
  bidAt?: string;
}

interface GenerateResult {
  paragraphs: string[];
  source: 'ai' | 'fallback';
  project: { name: string; code: string };
}

interface ExportResult {
  id: string;
  url: string;
  originalName: string;
  size: number;
}

export function InvitationLetterModal({
  open,
  projectId,
  pmiId,
  times,
  onClose,
  onExported,
}: {
  open: boolean;
  projectId: string;
  /** 项目管理项 id：传入时导出的邀请书同步挂到「供应商邀请」阶段，纳入项目文件分析 */
  pmiId?: string;
  times: InvitationLetterTimes;
  onClose: () => void;
  onExported: (file: { id: string; name: string; size: number }) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [result, setResult] = useState<GenerateResult | null>(null);
  // 整篇正文（段落以空行分隔展示/编辑）
  const [bodyText, setBodyText] = useState('');
  const lastProjectId = useRef('');

  const runGenerate = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      const res = await api.post<GenerateResult>('/ai/invitation-letter/generate', {
        projectId,
        acquireStart: times.acquireStart,
        acquireEnd: times.acquireEnd,
        bidAt: times.bidAt,
      });
      setResult(res);
      setBodyText(res.paragraphs.join('\n\n'));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'AI 起草失败，请稍后重试');
    } finally {
      setLoading(false);
    }
  }, [projectId, times.acquireStart, times.acquireEnd, times.bidAt]);

  // 项目变更 → 缓存失效；同一项目重复打开直接展示已生成内容（「重新起草」才重新生成）
  useEffect(() => {
    if (projectId !== lastProjectId.current) {
      lastProjectId.current = projectId;
      setResult(null);
      setBodyText('');
    }
  }, [projectId]);

  useEffect(() => {
    if (open && !result && !loading) void runGenerate();
  }, [open, result, loading, runGenerate]);

  if (!open) return null;

  const handleExport = async () => {
    if (!result) return;
    const paragraphs = bodyText.split(/\n\s*\n/).map((t) => t.trim()).filter(Boolean);
    if (paragraphs.length === 0) { toast.error('正文为空'); return; }
    setExporting(true);
    try {
      const res = await api.post<ExportResult>('/ai/invitation-letter/export', {
        paragraphs,
        project: result.project,
      });
      // 导出 Word 到本地
      const dl = await fetch(res.url, { credentials: 'include', headers: { 'X-Portal': 'web' } });
      let blob: Blob | null = null;
      if (dl.ok) {
        blob = await dl.blob();
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = res.originalName;
        a.click();
        URL.revokeObjectURL(a.href);
      }
      // 同步挂到「供应商邀请」阶段：进入项目文件分析（analyzeProjectManagementItem 各阶段摘要）
      if (pmiId && blob) {
        try {
          await uploadProjectStageAttachment(
            pmiId,
            'SUPPLIER_INVITATION',
            new File([blob], res.originalName, { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }),
          );
        } catch {
          toast.warning('邀请书已导出，但挂入「供应商邀请」阶段失败，可手动上传');
        }
      }
      // 自动加入本步骤附件清单
      onExported({ id: res.id, name: res.originalName, size: res.size });
      toast.success(`采购邀请书已导出并加入附件清单${pmiId ? '，同步至「供应商邀请」阶段供文件分析' : ''}`);
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '导出失败，请稍后重试');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-[color:var(--background)]/70 backdrop-blur-[6px]" onClick={onClose} />
      <div className="neu-dialog relative flex max-h-[90vh] w-full max-w-[min(760px,92vw)] flex-col">
        <button type="button" onClick={onClose} className="neu-btn-xs absolute right-4 top-4 z-[2]"><X size={16} /></button>

        <div className="flex-shrink-0 pr-[3.8rem]">
          <h2 className="text-[clamp(1.34rem,2.7vw,1.58rem)] font-semibold leading-tight tracking-[-0.05em] text-[color:var(--foreground)]">采购邀请书</h2>
          <p className="mt-1 text-xs text-[var(--muted-foreground)]">
            AI 依据项目信息起草的公文体正文，可直接修改后导出 Word；导出后自动加入附件清单。
            {result && result.source === 'fallback' && '（AI 服务暂不可用，已按项目数据成稿）'}
          </p>
        </div>

        <div className="wb-section-rule mt-4 flex-shrink-0" />

        <div className="flex-1 min-h-0 mt-4 px-[1.7rem] overflow-y-auto pb-4">
          {loading ? (
            <div className="flex flex-col items-center justify-center gap-3 py-16">
              <Loader2 size={26} className="animate-spin text-[var(--accent)]" />
              <p className="text-sm text-[var(--muted-foreground)]">AI 正在根据项目信息起草邀请书…</p>
            </div>
          ) : result ? (
            <textarea
              value={bodyText}
              onChange={(e) => setBodyText(e.target.value)}
              rows={16}
              className="neu-input min-h-[420px] w-full resize-y text-[13px] leading-[1.9]"
              placeholder="邀请书正文（段落之间空一行）"
            />
          ) : (
            <div className="flex flex-col items-center justify-center gap-3 py-16">
              <p className="text-sm text-[var(--muted-foreground)]">起草失败，请重试</p>
            </div>
          )}
        </div>

        <div className="flex-shrink-0 px-[1.7rem] py-4" style={{ borderTop: '1px solid oklch(0.6 0.04 258 / 0.16)' }}>
          <div className="flex items-center justify-between">
            <button type="button" onClick={() => void runGenerate()} disabled={loading || exporting} className="neu-btn-soft h-[38px] gap-2">
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
              重新起草
            </button>
            <button type="button" onClick={() => void handleExport()} disabled={loading || exporting || !result} className="neu-btn-primary !h-[38px] gap-2">
              {exporting ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}
              {exporting ? '导出中…' : '导出 Word 并加入附件'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
