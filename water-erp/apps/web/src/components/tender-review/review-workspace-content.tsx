'use client';

import { useState, useRef, useEffect } from 'react';
import { useTenderReview } from './tender-review-context';
import { useReviewOps } from './use-tender-review';
import RulesPanelCompact from './rules-panel-compact';
import ReportsPanelCompact from './reports-panel-compact';
import FilesPanelCompact from './files-panel-compact';
import KbManagerPanel from './kb-manager-panel';
import { SearchSelect } from '@/components/workbench/search-select';
import {
  FileText,
  Upload,
  Loader2,
  Play,
  Shield,
} from 'lucide-react';
import type { ReviewMode, KnowledgeBase } from '@/lib/types/tender-review';

const HAIRLINE = 'oklch(0.6 0.04 258 / 0.16)';

const MODE_LABELS: Record<ReviewMode, string> = {
  strict: '严格审查',
  general: '通用审查',
};
const MODE_DESCRIPTIONS: Record<ReviewMode, string> = {
  strict: '逐条比对知识库中的合规规则，输出逐项合规结论——适合制度性硬约束核查。',
  general: '语义检索结合大模型整体研判，无需预置规则——适合规则尚未成库的文档审查。',
};

function fmtFileSize(bytes: number): string {
  return bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${(bytes / 1024).toFixed(1)} KB`;
}

export default function ReviewWorkspaceContent() {
  const { selectedKbId, activeTab, setActiveTab, knowledgeBases } = useTenderReview();
  const { uploadDocument, startReview } = useReviewOps();
  const [mode, setMode] = useState<ReviewMode>('general');
  const [file, setFile] = useState<File | null>(null);
  const [executing, setExecuting] = useState(false);
  const [execUpPct, setExecUpPct] = useState(0); // 审查文档上传字节进度（2026-11-06）
  const fileInputRef = useRef<HTMLInputElement>(null);

  const selectedKb = knowledgeBases.find(kb => kb.id === selectedKbId);

  // 上下文视图守卫：files/rules 无选中库时回退到知识库管理视图（其父级入口）
  useEffect(() => {
    if (activeTab === 'files' && !selectedKbId) {
      setActiveTab('kb');
    }
    if (activeTab === 'rules' && !selectedKbId) {
      setActiveTab('kb');
    }
  }, [selectedKbId, activeTab, setActiveTab]);

  const handleExecute = async () => {
    if (!selectedKbId || !file) return;
    setExecuting(true);
    setExecUpPct(0);
    try {
      const uploadResult = await uploadDocument(file, {
        onProgress: (l, t) => setExecUpPct(t > 0 ? Math.round((l / t) * 100) : 0),
      });
      await startReview({
        knowledgeBaseId: selectedKbId,
        reviewMode: mode,
        documentContent: uploadResult.content,
        documentName: uploadResult.documentName,
        objectKey: uploadResult.objectKey,
      });
      setFile(null);
    } catch (err) {
      console.error('Review error:', err);
    } finally {
      setExecuting(false);
    }
  };

  return (
    <div className="wb-panel rounded-[24px] tender-section-enter h-full flex flex-col overflow-hidden">
      {/* Content area */}
      <div className="flex-1 flex flex-col min-h-0 p-3">
        {activeTab === 'review' && (
          <div className="flex-1 overflow-y-auto">
            <ReviewTab
              selectedKb={selectedKb}
              selectedKbId={selectedKbId}
              mode={mode}
              setMode={setMode}
              file={file}
              setFile={setFile}
              executing={executing}
              execUpPct={execUpPct}
              handleExecute={handleExecute}
              fileInputRef={fileInputRef}
            />
          </div>
        )}
        {activeTab === 'reports' && (
          <ReportsTab />
        )}
        {activeTab === 'kb' && (
          <div className="flex-1 overflow-y-auto">
            <KbManagerPanel />
          </div>
        )}
        {activeTab === 'files' && selectedKbId && (
          <div className="flex-1 overflow-y-auto">
            <FilesPanelCompact />
          </div>
        )}
        {activeTab === 'rules' && selectedKbId && (
          <div className="flex-1 overflow-y-auto">
            <RulesTab selectedKbId={selectedKbId} selectedKb={selectedKb} />
          </div>
        )}
      </div>
    </div>
  );
}

interface ReviewTabProps {
  selectedKb: { id: string; name: string; _count: { files: number; rules: number } } | undefined;
  selectedKbId: string | null;
  mode: ReviewMode;
  setMode: (mode: ReviewMode) => void;
  file: File | null;
  setFile: (file: File | null) => void;
  executing: boolean;
  /** 审查文档上传字节进度（2026-11-06 上传进度条）——提交按钮内展示 */
  execUpPct: number;
  handleExecute: () => Promise<void>;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
}

/** 步骤头：编号徽标 + 标题 + 状态 chip（tender-write 章节导航同配方） */
function StepHead({ num, title, done, chip }: { num: string; title: string; done: boolean; chip: string }) {
  return (
    <div className="flex items-center gap-2">
      <span
        className={`inline-flex h-5 min-w-[1.5rem] items-center justify-center rounded-[6px] px-1.5 text-[10px] font-bold tracking-[0.04em] transition-all duration-300 ${
          done
            ? 'bg-[color-mix(in_oklch,var(--accent)_16%,transparent)] text-[color:var(--accent)]'
            : 'bg-[oklch(0.55_0.03_258_/_0.08)] text-[color:var(--muted-foreground)]'
        }`}
      >
        {num}
      </span>
      <span className="text-[13px] font-semibold leading-snug text-[color:var(--foreground)]">{title}</span>
      <span
        className={`ml-auto shrink-0 rounded-[5px] px-1.5 py-0.5 text-[10px] font-semibold ${
          done
            ? 'border-[rgba(92,181,150,0.18)] bg-[rgba(92,181,150,0.08)] text-[rgba(78,150,124,1)]'
            : 'border-[oklch(0.6_0.04_258_/_0.22)] bg-[oklch(1_0_0_/_0.35)] text-[color:var(--muted-foreground)]'
        }`}
      >
        {chip}
      </span>
    </div>
  );
}

function ReviewTab({ selectedKb, selectedKbId, mode, setMode, file, setFile, executing, execUpPct, handleExecute, fileInputRef }: ReviewTabProps) {
  const { knowledgeBases, setSelectedKbId } = useTenderReview();

  const kbOptions = knowledgeBases.map((kb) => ({
    value: kb.id,
    label: kb.name,
    meta: `${kb._count.files} 文件 · ${kb._count.rules} 规则`,
  }));

  const modeSegDisabled = !selectedKbId;
  const summaryParts = [
    selectedKb ? (
      <b key="kb" className="font-semibold text-[color:var(--foreground)]">{selectedKb.name}</b>
    ) : (
      <span key="kb" className="text-[color:var(--warning)]">未选知识库</span>
    ),
    MODE_LABELS[mode],
    file ? (
      <b key="file" className="font-semibold text-[color:var(--foreground)]">{file.name}</b>
    ) : (
      <span key="file" className="text-[color:var(--warning)]">未选文件</span>
    ),
  ];

  return (
    <div className="py-1">
      {/* 三步流程分栏（2026-11-18 用户裁定方案 A）：01/02/03 步骤 + hairline 三列，
          宽屏全宽铺开；<lg 退化为纵向堆叠（横 hairline 分隔） */}
      <div className="flex flex-col gap-5 lg:flex-row lg:gap-0">
        {/* 步骤 01 选择知识库 */}
        <div className="flex flex-1 flex-col gap-3 lg:pr-6">
          <StepHead num="01" title="选择知识库" done={!!selectedKb} chip={selectedKb ? '✓ 已选' : '待选择'} />
          <SearchSelect
            options={kbOptions}
            value={selectedKbId ?? ''}
            onPick={(o) => setSelectedKbId(o.value)}
            placeholder="选择知识库"
            emptyText="暂无知识库，可在右侧新建"
          />
          {selectedKb && (
            <div className="pl-0.5 text-[11px] tabular-nums tracking-[0.02em] text-[color:var(--muted-foreground)]">
              {selectedKb._count.files} 文件 · {selectedKb._count.rules} 规则
            </div>
          )}
          <p className="text-[11px] leading-relaxed text-[color:var(--muted-foreground)]">
            审查将比对所选知识库中的制度文件与合规规则
          </p>
        </div>

        {/* 步骤 02 审查模式 */}
        <div className="flex flex-1 flex-col gap-3 border-t pt-4 lg:border-t-0 lg:border-l lg:pt-0 lg:px-6" style={{ borderColor: HAIRLINE }}>
          <StepHead num="02" title="审查模式" done chip={`✓ ${MODE_LABELS[mode]}`} />
          <div
            className={`neu-segment ${modeSegDisabled ? 'pointer-events-none opacity-40' : ''}`}
            role="group"
            aria-label="审查模式"
            data-index={mode === 'strict' ? '0' : '1'}
            style={{ '--segs': 2 } as React.CSSProperties}
          >
            <span className="neu-segment-thumb" aria-hidden="true" />
            <button type="button" className="neu-segment-btn" aria-pressed={mode === 'strict'} onClick={() => setMode('strict')}>
              严格审查
            </button>
            <button type="button" className="neu-segment-btn" aria-pressed={mode === 'general'} onClick={() => setMode('general')}>
              通用审查
            </button>
          </div>
          <p className="text-[11px] leading-relaxed text-[color:var(--muted-foreground)]">
            {MODE_DESCRIPTIONS[mode]}
          </p>
        </div>

        {/* 步骤 03 上传待审文件 */}
        <div className="flex flex-1 flex-col gap-3 border-t pt-4 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-6" style={{ borderColor: HAIRLINE }}>
          <StepHead num="03" title="上传待审文件" done={!!file} chip={file ? '✓ 已上传' : '待上传'} />
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            accept=".doc,.docx,.pdf,.txt"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
          {file ? (
            <div className="neu-attachment-item">
              <div className="flex min-w-0 items-center gap-2">
                <FileText className="h-4 w-4 shrink-0 text-[color:var(--accent)]" />
                <span className="truncate text-[13px] font-semibold text-[color:var(--foreground)]">{file.name}</span>
                <span className="shrink-0 text-[11px] tabular-nums text-[color:var(--muted-foreground)]">
                  ({fmtFileSize(file.size)})
                </span>
              </div>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="shrink-0 rounded-[6px] px-1.5 py-0.5 text-[11px] font-semibold text-[color:var(--accent-strong)] hover:bg-[color-mix(in_oklch,var(--accent)_10%,transparent)]"
              >
                重新选择
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const f = e.dataTransfer.files?.[0];
                if (f) setFile(f);
              }}
              disabled={!selectedKbId}
              className="neu-drop-zone min-h-[118px] w-full gap-1.5 disabled:pointer-events-none disabled:opacity-40"
            >
              <Upload className="h-[18px] w-[18px] text-[color:var(--accent)]" strokeWidth={1.7} />
              <span className="text-[13px] font-semibold text-[color:var(--foreground)]">点击或拖拽上传待审文件</span>
              <span className="text-[11px] text-[color:var(--muted-foreground)]">支持 DOCX / PDF / TXT · 单文件不超过 500MB</span>
            </button>
          )}
        </div>
      </div>

      {/* 底部执行条：hairline 之隔，左摘要右按钮（tender-write 编辑器头部同款语法） */}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t pt-3.5" style={{ borderColor: HAIRLINE }}>
        <div className="text-xs leading-relaxed text-[color:var(--muted-foreground)]">
          {summaryParts.map((part, i) => (
            <span key={i}>
              {i > 0 && <span className="mx-1.5">·</span>}
              {part}
            </span>
          ))}
        </div>
        <button
          onClick={handleExecute}
          disabled={executing || !selectedKbId || !file}
          className="neu-btn-primary !h-[38px] !px-6"
        >
          {executing ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Play className="h-4 w-4" />
          )}
          {executing ? `提交中${execUpPct > 0 ? ` ${execUpPct}%` : '…'}` : '开始审查'}
        </button>
      </div>
    </div>
  );
}

function RulesTab({ selectedKbId, selectedKb }: { selectedKbId: string | null; selectedKb: KnowledgeBase | undefined }) {
  const { currentUser } = useTenderReview();
  // 仅创建者或 admin 可维护规则；其他人只读（共享 KB 的「使用」边界）
  const canEdit = !!selectedKb && (currentUser?.role === 'admin' || selectedKb.ownerId === currentUser?.id);
  if (!selectedKbId) {
    return (
      <div className="text-center py-8 text-[var(--muted-foreground)] text-sm">
        <Shield className="h-8 w-8 mx-auto mb-2 opacity-30" />
        请从右侧选择知识库以管理规则
      </div>
    );
  }

  return (
    <RulesPanelCompact
      knowledgeBaseId={selectedKbId}
      knowledgeBaseName={selectedKb?.name || ''}
      canEdit={canEdit}
    />
  );
}

function ReportsTab() {
  return <ReportsPanelCompact />;
}
