'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, FileUp, Check, AlertTriangle, ScanSearch } from 'lucide-react';
import { validateFileSize } from '@/lib/upload-rules';
import type { ReadyTenderDocumentType, TenderSectionKey } from '@/lib/types/tender-write';
import type {
  ImportAutofillResult,
  ImportAutofillFieldResult,
} from '@/lib/types/tender-write-import';
import { importAutofill, announcementImportAutofill } from '@/lib/api/tender-write-import';

/**
 * 导入识别弹窗（2026-11-11 全系统弹窗规范 A 版定版标本）：
 * 壳 = wb-modal-shell 瓷面（系统背景彩色渐变 + 顶缘内高光 + 方向性双影）；
 * 头部 = 图标井 + 动词标题 + 统计摘要行，hairline 分段；
 * 内容 = 章节内凹导航（激活白瓷片）+ 无框色调字段行 + 状态胶囊 + 来源内凹摘录盒；
 * 底部 = hairline + 左说明 + neu-btn-group 等高按钮组。
 */

const ACCEPT_STRING = '.docx,.pdf,.md,.txt';

// ---------------------------------------------------------------------------
// Section grouping helper
// ---------------------------------------------------------------------------

type SectionGroup = {
  sectionKey: TenderSectionKey;
  sectionTitle: string;
  fields: ImportAutofillFieldResult[];
};

function groupBySection(
  fields: ImportAutofillFieldResult[],
): SectionGroup[] {
  const map = new Map<TenderSectionKey, SectionGroup>();
  for (const f of fields) {
    let group = map.get(f.sectionKey as TenderSectionKey);
    if (!group) {
      group = {
        sectionKey: f.sectionKey as TenderSectionKey,
        sectionTitle: f.sectionTitle,
        fields: [],
      };
      map.set(f.sectionKey as TenderSectionKey, group);
    }
    group.fields.push(f);
  }
  return Array.from(map.values());
}

// ---------------------------------------------------------------------------
// Status badge（wb-status-pill：--tone 驱动，无 neumorphic shadow——文字级元素）
// ---------------------------------------------------------------------------

const STATUS_META: Record<ImportAutofillFieldResult['status'], { tone: string; label: string }> = {
  recognized: { tone: 'var(--success)', label: '高置信' },
  low_confidence: { tone: 'var(--warning)', label: '低置信' },
  not_found: { tone: 'var(--muted-foreground)', label: '未识别' },
};

function StatusBadge({ status }: { status: ImportAutofillFieldResult['status'] }) {
  const meta = STATUS_META[status];
  return (
    <span
      className="wb-status-pill shrink-0"
      style={{ '--tone': meta.tone } as React.CSSProperties}
    >
      <span className="wb-status-pill-dot" />
      {meta.label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Field row（无外框色调行：高置信=品牌淡染 / 低置信=警示淡染 / 未识别=灰底）
// ---------------------------------------------------------------------------

function FieldRow({
  field,
  checked,
  onToggle,
}: {
  field: ImportAutofillFieldResult;
  checked: boolean;
  onToggle: () => void;
}) {
  const isFillable = field.status !== 'not_found';

  const rowTone =
    field.status === 'recognized'
      ? 'bg-[color-mix(in_oklch,var(--accent)_5%,transparent)]'
      : field.status === 'low_confidence'
        ? 'bg-[color-mix(in_oklch,var(--warning)_8%,transparent)]'
        : 'bg-[oklch(0.55_0.03_258_/_0.035)]';

  return (
    <div
      className={`flex items-start gap-3 rounded-[12px] px-3.5 py-3 transition-colors ${rowTone} ${
        isFillable ? 'cursor-pointer' : 'opacity-80'
      }`}
      onClick={isFillable ? onToggle : undefined}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={!isFillable}
        onChange={onToggle}
        onClick={(e) => e.stopPropagation()}
        className="neu-checkbox mt-0.5"
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-medium text-[var(--foreground)]">
            {field.label}
          </span>
          <StatusBadge status={field.status} />
        </div>
        {isFillable && field.value && (
          <div className="mt-1 text-sm font-semibold text-[var(--foreground)]">
            {field.value}
          </div>
        )}
        {isFillable && field.source && (
          <div className="neu-pre mt-2 rounded-[10px] px-3 py-2 text-xs leading-5 text-[var(--muted-foreground)]">
            <div>
              <strong className="text-[var(--foreground)]">来源字段：</strong>
              {field.source.fileName} / {field.source.location} / &ldquo;
              {field.source.sourceField}&rdquo;
            </div>
            <div className="mt-1">
              <strong className="text-[var(--foreground)]">原文摘录：</strong>
              {field.source.quote}
            </div>
            {field.source.reason && (
              <div className="mt-1 text-[oklch(0.52_0.13_70)]">
                <strong>低置信原因：</strong>
                {field.source.reason}
              </div>
            )}
          </div>
        )}
        {!isFillable && (
          <div className="mt-1 text-xs text-[var(--muted-foreground)]">
            AI 未在上传文件中找到可用内容，不会回填。
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main dialog
// ---------------------------------------------------------------------------

export function ImportAutofillDialog({
  documentType,
  onConfirm,
  onClose,
  initialFiles,
  initialFilesNote,
  announcement,
}: {
  documentType?: ReadyTenderDocumentType;
  onConfirm: (selectedFields: ImportAutofillFieldResult[]) => void;
  onClose: () => void;
  /** 预载文件（2026-10-30「参考上一轮」）：打开即自动分析，跳过手动选文件——
   *  上一轮采购文件本体识别回填的入口 */
  initialFiles?: File[];
  /** 预载来源说明（显示在标题下方，如「正在识别第 1 轮采购文件…」） */
  initialFilesNote?: string;
  /** 公告模式（2026-11-03）：传入即按（公告类别 × 采购方式）识别公告字段，忽略 documentType */
  announcement?: {
    category: 'procurement_document' | 'failed_bid' | 'winning_bid' | 'change_notice' | 'addendum';
    tenderType: string;
  };
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  // Esc 关闭（2026-11-03）：嵌入 workbench Modal 内使用时，role=dialog 使父级 Modal 的
  // 「只关最顶层」判定把本弹层视为顶层；自身补 Esc 通道，避免按键穿透
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [onClose]);
  const [result, setResult] = useState<ImportAutofillResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [upPct, setUpPct] = useState(0); // 批量上传字节进度（2026-11-06）
  const [error, setError] = useState<string | null>(null);
  const [checkedKeys, setCheckedKeys] = useState<Set<string>>(new Set());
  const [activeSection, setActiveSection] = useState<TenderSectionKey | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  const handleFileSelect = () => {
    inputRef.current?.click();
  };

  const runAnalysis = async (selectedFiles: File[]) => {
    const docFiles = selectedFiles.filter(
      (f) =>
        f.name.toLowerCase().endsWith('.doc') &&
        !f.name.toLowerCase().endsWith('.docx'),
    );
    if (docFiles.length > 0) {
      setError(
        `暂不支持 .doc 文件（${docFiles.map((f) => f.name).join('、')}），请另存为 .docx 后再上传。`,
      );
      return;
    }

    // 前置体积校验（与后端 FilesInterceptor 20MB 对齐，避免白跑一趟 413）
    const sizeErrors = selectedFiles
      .map((f) => validateFileSize(f, 20))
      .filter((v): v is string => !!v);
    if (sizeErrors.length > 0) {
      setError(sizeErrors.join('；'));
      return;
    }

    setLoading(true);
    setError(null);
    setResult(null);
    setUpPct(0);

    try {
      const progressOpts = { onProgress: (l: number, t: number) => setUpPct(t > 0 ? Math.round((l / t) * 100) : 0) };
      const res = announcement
        ? await announcementImportAutofill(announcement.category, announcement.tenderType, selectedFiles, progressOpts)
        : await importAutofill(documentType as ReadyTenderDocumentType, selectedFiles, progressOpts);
      setResult(res as ImportAutofillResult);
      // Default: check all fillable fields
      const fillable = new Set(
        res.fields
          .filter((f) => f.status !== 'not_found')
          .map((f) => f.key),
      );
      setCheckedKeys(fillable);
      setActiveSection(null);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : '分析失败，请稍后重试。',
      );
    } finally {
      setLoading(false);
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    const selectedFiles = Array.from(files);
    e.target.value = '';
    await runAnalysis(selectedFiles);
  };

  // 预载文件：挂载即自动分析（一次性，ref 防重放）
  const initialRanRef = useRef(false);
  useEffect(() => {
    if (initialRanRef.current || !initialFiles?.length) return;
    initialRanRef.current = true;
    void runAnalysis(initialFiles);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialFiles]);

  const toggleKey = (key: string) => {
    setCheckedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const handleConfirm = () => {
    if (!result) return;
    const selected = result.fields.filter((f) => checkedKeys.has(f.key));
    onConfirm(selected);
  };

  // 章节导航：点击滚动定位 + 右侧滚动回写激活项（白瓷片）
  const scrollToSection = (key: TenderSectionKey) => {
    const body = bodyRef.current;
    const target = body?.querySelector<HTMLElement>(`[data-section-key="${key}"]`);
    if (!body || !target) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    body.scrollTo({ top: Math.max(0, target.offsetTop - 8), behavior: reduced ? 'auto' : 'smooth' });
  };

  const handleBodyScroll = () => {
    const body = bodyRef.current;
    if (!body) return;
    const sectionEls = Array.from(body.querySelectorAll<HTMLElement>('[data-section-key]'));
    let current: TenderSectionKey | null = (sectionEls[0]?.dataset.sectionKey as TenderSectionKey) ?? null;
    for (const s of sectionEls) {
      if (s.offsetTop - body.scrollTop <= 96) current = s.dataset.sectionKey as TenderSectionKey;
    }
    setActiveSection(current);
  };

  const sections = result ? groupBySection(result.fields) : [];
  const recognizedCount = result?.fields.filter((f) => f.status === 'recognized').length ?? 0;
  const lowConfCount = result?.fields.filter((f) => f.status === 'low_confidence').length ?? 0;
  const notFoundCount = result?.fields.filter((f) => f.status === 'not_found').length ?? 0;

  const title = announcement ? '公告导入识别' : '导入识别';
  const subtitle =
    initialFilesNote && !result
      ? initialFilesNote
      : result
        ? `${result.files.length} 个文件 · ${recognizedCount} 个识别成功 · ${lowConfCount} 个低置信 · ${notFoundCount} 个未识别`
        : `上传资料文件，AI 将按${announcement ? '当前公告类型' : '当前文件类型'}识别可填写的字段`;

  if (typeof document === 'undefined') return null;
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-[610] flex items-center justify-center p-4"
    >
      <div className="absolute inset-0 bg-[var(--background)]/60 backdrop-blur-sm" aria-hidden="true" />
      <div className="wb-modal-shell relative flex max-h-[85vh] w-[min(820px,92vw)] flex-col overflow-hidden">
        {/* 头部：图标井 + 动词标题 + 统计摘要，hairline 分段 */}
        <div className="flex shrink-0 items-start justify-between gap-4 px-6 pb-3.5 pt-5">
          <div className="flex min-w-0 items-start gap-3">
            <span className="neu-icon-well mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[9px] text-[var(--accent)]">
              <ScanSearch size={14} strokeWidth={1.9} />
            </span>
            <div className="min-w-0">
              <h2 className="text-lg font-bold tracking-[-0.02em] text-[var(--foreground)]">{title}</h2>
              <p className="mt-0.5 text-xs leading-5 tabular-nums text-[var(--muted-foreground)]">{subtitle}</p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <input
              ref={inputRef}
              type="file"
              accept={ACCEPT_STRING}
              multiple
              className="hidden"
              onChange={handleFileChange}
            />
            <button
              type="button"
              onClick={handleFileSelect}
              disabled={loading}
              className="neu-btn-soft"
            >
              <FileUp size={13} />
              {loading ? `上传并分析中 ${upPct}%…` : result ? '重新上传' : '选择文件'}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="neu-btn-xs"
              aria-label="关闭"
            >
              <X size={15} />
            </button>
          </div>
        </div>
        <div className="mx-6 h-px shrink-0 bg-[oklch(0.6_0.04_258_/_0.16)]" />

        {/* 错误条：wb-alert--danger 色调横幅（无框线） */}
        {error && !loading && (
          <div className="wb-alert wb-alert--danger mx-6 mt-3 flex items-center gap-2 font-medium">
            <AlertTriangle size={14} className="shrink-0" />
            <span className="flex-1">{error}</span>
            <button
              type="button"
              onClick={() => setError(null)}
              aria-label="关闭错误提示"
              className="shrink-0 opacity-60 transition-opacity hover:opacity-100"
            >
              <X size={13} />
            </button>
          </div>
        )}

        {/* 空态：内凹图标井 + 引导主按钮（44px 白瓷片——弹窗内唯一主行动） */}
        {!result && !loading && (
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 px-6 py-14">
            <span className="neu-icon-well inline-flex h-12 w-12 items-center justify-center rounded-[14px] text-[var(--accent)]">
              <FileUp size={20} strokeWidth={1.8} />
            </span>
            <div className="text-center">
              <p className="text-sm font-medium text-[var(--foreground)]">
                上传资料文件，AI 将按当前{announcement ? '公告类型' : '文件类型'}识别可填写的字段
              </p>
              <p className="mt-1 text-xs text-[var(--muted-foreground)]">
                支持 .docx / .pdf / .md / .txt，可上传多个文件
              </p>
            </div>
            <button
              type="button"
              onClick={handleFileSelect}
              className="neu-btn-primary"
            >
              <FileUp size={15} />
              选择文件开始分析
            </button>
          </div>
        )}

        {/* 加载态 */}
        {loading && (
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-6 py-14">
            <span className="h-8 w-8 animate-spin rounded-full border-2 border-[color-mix(in_oklch,var(--accent)_25%,transparent)] border-t-[var(--accent)]" />
            <p className="text-sm text-[var(--muted-foreground)]">正在解析文件并调用 AI 识别，请稍候…</p>
          </div>
        )}

        {/* 结果态：左章节内凹导航（激活白瓷片）｜hairline｜右字段行 */}
        {result && !loading && (
          <div className="flex min-h-0 flex-1">
            <aside className="w-[168px] shrink-0 overflow-y-auto p-4 xl:w-[200px]">
              <div className="mb-2 px-2.5 text-[10px] font-bold uppercase tracking-[0.08em] text-[var(--muted-foreground)]">
                章节
              </div>
              <nav className="flex flex-col gap-1">
                {sections.map((section) => {
                  const recognized = section.fields.filter(
                    (f) => f.status !== 'not_found',
                  ).length;
                  const total = section.fields.length;
                  const isActive = activeSection === section.sectionKey;
                  return (
                    <button
                      key={section.sectionKey}
                      type="button"
                      className={`neu-modal-nav-item ${isActive ? 'is-active' : ''}`}
                      onClick={() => scrollToSection(section.sectionKey)}
                    >
                      <span className="block text-xs leading-5">{section.sectionTitle}</span>
                      <span
                        className={`mt-0.5 block text-[10px] tabular-nums ${
                          recognized === total
                            ? 'text-[var(--success)]'
                            : isActive
                              ? ''
                              : 'text-[var(--muted-foreground)]'
                        }`}
                      >
                        {recognized}/{total} 已识别
                      </span>
                    </button>
                  );
                })}
              </nav>
            </aside>
            <div className="w-px shrink-0 bg-[oklch(0.6_0.04_258_/_0.16)]" />

            <div
              ref={bodyRef}
              onScroll={handleBodyScroll}
              className="relative min-w-0 flex-1 overflow-y-auto px-5 py-4"
            >
              <div className="flex flex-col gap-6">
                {sections.map((section) => (
                  <section key={section.sectionKey} data-section-key={section.sectionKey}>
                    <h3 className="mb-2.5 text-[13px] font-bold text-[var(--foreground)]">
                      {section.sectionTitle}
                    </h3>
                    <div className="flex flex-col gap-2">
                      {section.fields.map((field) => (
                        <FieldRow
                          key={field.key}
                          field={field}
                          checked={checkedKeys.has(field.key)}
                          onToggle={() => toggleKey(field.key)}
                        />
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* 底部：hairline + 左说明 + 右等高按钮组 */}
        {result && !loading && (
          <>
            <div className="mx-6 h-px shrink-0 bg-[oklch(0.6_0.04_258_/_0.16)]" />
            <div className="flex shrink-0 items-center justify-between gap-3 px-6 py-3.5">
              <span className="text-xs tabular-nums text-[var(--muted-foreground)]">
                已选择 {checkedKeys.size} 个字段，确认后写入当前{announcement ? '公告' : '草稿'}
              </span>
              <div className="neu-btn-group">
                <button
                  type="button"
                  onClick={onClose}
                  className="neu-btn-soft"
                >
                  取消
                </button>
                <button
                  type="button"
                  onClick={handleConfirm}
                  className="neu-btn-primary"
                >
                  <Check size={14} />
                  确认回填
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>

    ,
    document.body,
  );
}
