'use client';

import { useState, useRef, useEffect } from 'react';
import { motion } from 'framer-motion';
import { useTenderReview } from './tender-review-context';
import { useReviewOps } from './use-tender-review';
import RulesPanelCompact from './rules-panel-compact';
import ReportsPanelCompact from './reports-panel-compact';
import FilesPanelCompact from './files-panel-compact';
import {
  FileText,
  Upload,
  Loader2,
  Play,
  Database,
  Shield,
  FolderOpen,
  ChevronDown,
} from 'lucide-react';
import type { ReviewMode } from '@/lib/types/tender-review';

export default function ReviewWorkspaceContent() {
  const { selectedKbId, activeTab, setActiveTab, knowledgeBases, runningTasks } = useTenderReview();
  const { uploadDocument, startReview } = useReviewOps();
  const [mode, setMode] = useState<ReviewMode>('general');
  const [file, setFile] = useState<File | null>(null);
  const [executing, setExecuting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const selectedKb = knowledgeBases.find(kb => kb.id === selectedKbId);

  // Determine which tabs to show based on activeTab
  const showFilesTab = activeTab === 'files';
  const showRulesTab = activeTab === 'rules';

  // When user leaves files/rules tab, reset to review
  useEffect(() => {
    if (activeTab === 'files' && !selectedKbId) {
      setActiveTab('review');
    }
    if (activeTab === 'rules' && !selectedKbId) {
      setActiveTab('review');
    }
  }, [selectedKbId, activeTab, setActiveTab]);

  const handleExecute = async () => {
    if (!selectedKbId || !file) return;
    setExecuting(true);
    try {
      const uploadResult = await uploadDocument(file);
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

  // Dynamic tabs based on context - order: review, reports, then dynamic tabs
  const tabs = [
    { id: 'review' as const, label: '审查执行', icon: Play },
    { id: 'reports' as const, label: '审查报告', icon: FileText },
    ...(showFilesTab ? [{ id: 'files' as const, label: '文件管理', icon: FolderOpen }] : []),
    ...(showRulesTab ? [{ id: 'rules' as const, label: '规则管理', icon: Shield }] : []),
  ];

  return (
    <div className="wb-panel rounded-[20px] h-full flex flex-col overflow-hidden">
      {/* Tab header */}
      <div className="flex items-center gap-1 p-2 shrink-0 overflow-x-auto" style={{ borderBottom: "1px solid oklch(0.6 0.04 258 / 0.16)" }}>
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] text-xs font-semibold transition-all duration-200 whitespace-nowrap ${
              activeTab === tab.id
                ? 'bg-[color-mix(in_oklch,var(--accent-soft)_55%,transparent)] text-[color:var(--accent)]'
                : 'text-[color:var(--muted-foreground)] hover:bg-[color-mix(in_oklch,var(--muted)_30%,transparent)]'
            }`}
            style={activeTab === tab.id ? {boxShadow:"inset 1px 2px 3px oklch(0.55 0.03 258 / 0.1), inset -1px -1px 2px oklch(1 0 0 / 0.4)"} : undefined}
          >
            <tab.icon className="h-3.5 w-3.5" />
            {tab.label}
            {(tab.id === 'files' || tab.id === 'rules') && selectedKb && (
              <span className="text-[10px] text-[var(--muted-foreground)]">({selectedKb.name})</span>
            )}
          </button>
        ))}
      </div>

      {/* Content area */}
      <div className="flex-1 flex flex-col min-h-0 p-4">
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
              handleExecute={handleExecute}
              fileInputRef={fileInputRef}
              runningTasks={runningTasks}
            />
          </div>
        )}
        {activeTab === 'reports' && (
          <ReportsTab />
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
  selectedKb: { id: string; name: string; _count: { files: number; rules: number }; description?: string | null } | undefined;
  selectedKbId: string | null;
  mode: ReviewMode;
  setMode: (mode: ReviewMode) => void;
  file: File | null;
  setFile: (file: File | null) => void;
  executing: boolean;
  handleExecute: () => Promise<void>;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  runningTasks: { id: string; documentName: string; status: string }[];
}

function ReviewTab({ selectedKb, selectedKbId, mode, setMode, file, setFile, executing, handleExecute, fileInputRef, runningTasks }: ReviewTabProps) {
  const { knowledgeBases, setSelectedKbId } = useTenderReview();
  const [showKbDropdown, setShowKbDropdown] = useState(false);

  return (
    <div className="space-y-5">
      {/* KB label and selector */}
      <div>
        <div className="text-sm text-[var(--muted-foreground)] mb-1.5">知识库</div>
        <div className="relative">
          <button
            onClick={() => setShowKbDropdown(!showKbDropdown)}
            className="w-full flex items-center justify-center gap-3 p-3 rounded-[14px] transition-colors"
            style={{background:"oklch(1 0 0 / 0.32)",boxShadow:"inset 0 1px 0 oklch(1 0 0 / 0.65), 2px 2px 4px oklch(0.55 0.03 258 / 0.08), -1px -1px 3px oklch(1 0 0 / 0.7)"}}
          >
            <Database className="h-5 w-5 text-[var(--accent)]" />
            {selectedKb ? (
              <div className="text-left">
                <div className="text-sm font-medium text-[var(--foreground)]">{selectedKb.name}</div>
                <div className="text-xs text-[var(--muted-foreground)]">
                  {selectedKb._count.files} 文件 · {selectedKb._count.rules} 规则
                </div>
              </div>
            ) : (
              <span className="text-sm text-[var(--muted-foreground)]">点击选择知识库</span>
            )}
          </button>

          {/* Dropdown */}
          {showKbDropdown && (
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              className="absolute top-full left-0 right-0 mt-1 z-10 rounded-[14px] overflow-hidden border border-[color-mix(in_oklch,var(--border)_50%,transparent)]"
              style={{background: "oklch(1 0 0 / 0.94)", boxShadow: "0 12px 32px oklch(0.48 0.07 258 / 0.18), inset 0 1px 0 oklch(1 0 0 / 0.8)"}}
            >
              {knowledgeBases.length === 0 ? (
                <div className="p-4 text-center text-xs text-[var(--muted-foreground)]">
                  暂无知识库，请在右侧创建
                </div>
              ) : (
                <div className="max-h-64 overflow-y-auto">
                  {knowledgeBases.map((kb) => (
                    <button
                      key={kb.id}
                      onClick={() => {
                        setSelectedKbId(kb.id);
                        setShowKbDropdown(false);
                      }}
                      className={`w-full flex items-center gap-3 p-3 text-left transition-colors ${
                        selectedKbId === kb.id
                          ? 'bg-[var(--accent)]/10'
                          : 'hover:bg-[var(--accent)]/5'
                      }`}
                    >
                      <Database className={`h-4 w-4 ${selectedKbId === kb.id ? 'text-[var(--accent)]' : 'text-[var(--muted-foreground)]'}`} />
                      <div className="flex-1 min-w-0">
                        <div className={`text-sm truncate ${selectedKbId === kb.id ? 'text-[var(--accent)] font-medium' : 'text-[var(--foreground)]'}`}>
                          {kb.name}
                        </div>
                        <div className="text-xs text-[var(--muted-foreground)]">
                          {kb._count.files} 文件 · {kb._count.rules} 规则
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </motion.div>
          )}
        </div>
      </div>

      {/* Mode selection */}
      <div>
        <label className="text-sm text-[var(--muted-foreground)] mb-1.5 block">审查模式</label>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <button
            onClick={() => setMode('strict')}
            disabled={!selectedKbId}
            className={`rounded-[14px] p-3 text-center transition-all ${
              mode === 'strict'
                ? 'border border-[color-mix(in_oklch,var(--accent)_25%,transparent)]'
                : 'hover:bg-[color-mix(in_oklch,var(--muted)_25%,transparent)]'
            } disabled:opacity-40`}
            style={mode === 'strict' ? {background:"color-mix(in oklch,var(--accent-soft) 30%,transparent)",boxShadow:"inset 0 1px 0 oklch(1 0 0 / 0.6), 2px 2px 4px oklch(0.55 0.03 258 / 0.06), -1px -1px 2px oklch(1 0 0 / 0.5)"} : {background:"oklch(1 0 0 / 0.32)",boxShadow:"inset 0 1px 0 oklch(1 0 0 / 0.65), 2px 2px 4px oklch(0.55 0.03 258 / 0.08), -1px -1px 3px oklch(1 0 0 / 0.7)"}}
          >
            <div className="font-medium text-sm text-[var(--foreground)]">严格审查</div>
            <div className="text-xs text-[var(--muted-foreground)] mt-0.5">
              规则引擎逐项核对
            </div>
          </button>
          <button
            onClick={() => setMode('general')}
            disabled={!selectedKbId}
            className={`rounded-[14px] p-3 text-center transition-all ${
              mode === 'general'
                ? 'border border-[color-mix(in_oklch,var(--accent)_25%,transparent)]'
                : 'hover:bg-[color-mix(in_oklch,var(--muted)_25%,transparent)]'
            } disabled:opacity-40`}
            style={mode === 'general' ? {background:"color-mix(in oklch,var(--accent-soft) 30%,transparent)",boxShadow:"inset 0 1px 0 oklch(1 0 0 / 0.6), 2px 2px 4px oklch(0.55 0.03 258 / 0.06), -1px -1px 2px oklch(1 0 0 / 0.5)"} : {background:"oklch(1 0 0 / 0.32)",boxShadow:"inset 0 1px 0 oklch(1 0 0 / 0.65), 2px 2px 4px oklch(0.55 0.03 258 / 0.08), -1px -1px 3px oklch(1 0 0 / 0.7)"}}
          >
            <div className="font-medium text-sm text-[var(--foreground)]">通用审查</div>
            <div className="text-xs text-[var(--muted-foreground)] mt-0.5">
              语义检索 + LLM 判断
            </div>
          </button>
        </div>
      </div>

      {/* File upload */}
      <div>
        <label className="text-sm text-[var(--muted-foreground)] mb-1.5 block">上传待审文件</label>
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          accept=".doc,.docx,.pdf,.txt"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={!selectedKbId}
          className="w-full rounded-[14px] p-5 text-center transition-colors disabled:opacity-40"
          style={{background:"color-mix(in oklch,var(--muted) 25%,transparent)",boxShadow:"inset 1px 2px 5px oklch(0.55 0.03 258 / 0.14), inset -1px -1px 2px oklch(1 0 0 / 0.5)"}}
        >
          {file ? (
            <div className="flex items-center justify-center gap-2">
              <FileText className="h-4 w-4 text-[var(--accent)]" />
              <span className="text-sm text-[var(--foreground)]">{file.name}</span>
              <span className="text-xs text-[var(--muted-foreground)]">
                ({(file.size / 1024).toFixed(1)} KB)
              </span>
            </div>
          ) : (
            <div className="flex items-center justify-center gap-2 text-[var(--muted-foreground)]">
              <Upload className="h-4 w-4" />
              <span className="text-sm">点击上传 DOCX 或 PDF 文件</span>
            </div>
          )}
        </button>
      </div>

      {/* Execute button */}
      <button
        onClick={handleExecute}
        disabled={executing || !selectedKbId || !file}
        className="neu-btn-primary w-full flex items-center justify-center gap-2 !rounded-[14px] py-2.5"
      >
        {executing ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Play className="h-4 w-4" />
        )}
        {executing ? '提交中...' : '开始审查'}
      </button>
    </div>
  );
}

function RulesTab({ selectedKbId, selectedKb }: { selectedKbId: string | null; selectedKb: { id: string; name: string; _count: { files: number; rules: number } } | undefined }) {
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
    />
  );
}

function ReportsTab() {
  return <ReportsPanelCompact />;
}