"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, ChevronUp, Clock, FileUp, History, Loader2, Pencil, RotateCcw, Save, Search, Sparkles, X } from 'lucide-react';
import { toast } from 'sonner';
import { useDraftAutosave, loadDraft, clearDraft } from '../../hooks/projects/useDraftAutosave';

const API_BASE = '/api';

interface Props { isOpen: boolean; projectId: string; attachmentId: string; attachmentName: string; onClose: () => void; onFileReplaced: () => Promise<void>; }

const DOC_STYLES = `
table { border-collapse: collapse; width: 100%; margin: 16px 0; }
table td, table th { border: 1px solid #000; padding: 4px 8px; min-width: 40px; }
table th { background: #f0f0f0; font-weight: bold; }
h1 { font-size: 22px; font-weight: bold; margin: 24px 0 12px; }
h2 { font-size: 18px; font-weight: bold; margin: 20px 0 10px; }
h3 { font-size: 16px; font-weight: bold; margin: 16px 0 8px; }
h4 { font-size: 15px; font-weight: bold; margin: 12px 0 6px; }
p { margin: 6px 0; text-indent: 2em; line-height: 1.9; }
img { max-width: 100%; height: auto; margin: 12px 0; }
hr.tfe-page-break {
  display: block; height: 0; margin: 36px -72px; padding: 0; border: none;
  border-top: 1px dashed oklch(0.55 0.03 258 / 0.25);
  position: relative; overflow: visible;
}
hr.tfe-page-break::after {
  content: '—  分  页  —';
  position: absolute; top: -10px; left: 50%; transform: translateX(-50%);
  background: #fff; padding: 0 16px; font-size: 11px;
  color: oklch(0.5 0.02 258 / 0.4); font-family: system-ui, sans-serif;
  letter-spacing: 0.15em; white-space: nowrap;
}
/* 审阅标注色 */
.tfe-review-insertion { background: color-mix(in oklch, #22c55e 18%, transparent); border-bottom: 2px solid #22c55e; }
.tfe-review-deletion { background: color-mix(in oklch, var(--danger) 14%, transparent); text-decoration: line-through; }
.tfe-review-comment { background: color-mix(in oklch, #f59e0b 22%, transparent); border-bottom: 2px dashed #f59e0b; cursor: pointer; position: relative; }
.tfe-review-comment::after { content: '💬'; font-size: 10px; margin-left: 1px; vertical-align: super; }
.tfe-review-highlight { background: color-mix(in oklch, #fde047 30%, transparent); }
/* 用户修改标红 */
.tfe-modified { background: color-mix(in oklch, var(--danger) 14%, transparent); text-decoration: underline; text-decoration-color: var(--danger); text-underline-offset: 2px; border-radius: 2px; padding: 0 1px; }
/* 查找定位高亮 */
mark.tfe-search-hit { background: color-mix(in oklch, #fbbf24 38%, transparent); color: inherit; border-radius: 2px; padding: 0; box-shadow: 0 0 0 1px color-mix(in oklch, #f59e0b 30%, transparent); }
mark.tfe-search-hit.tfe-search-current { background: #f59e0b; color: #fff; box-shadow: 0 0 0 2px color-mix(in oklch, #f59e0b 40%, transparent); }
/* 批注弹出泡 */
.tfe-comment-popover {
  position: absolute; z-index: 100; left: 0; bottom: calc(100% + 6px);
  max-width: 320px; min-width: 200px;
  background: oklch(1 0 0 / 0.97); border: 1px solid #f59e0b;
  border-radius: 8px; padding: 10px 12px; font-size: 12px; line-height: 1.7;
  box-shadow: 0 2px 12px oklch(0.3 0.02 258 / 0.18);
  color: var(--foreground); white-space: pre-wrap; word-break: break-word;
  font-family: system-ui, -apple-system, sans-serif;
}
.tfe-comment-popover::after {
  content: ''; position: absolute; top: 100%; left: 16px;
  border: 6px solid transparent; border-top-color: #f59e0b;
}
.tfe-comment-popover .tfe-comment-label {
  font-size: 10px; font-weight: 600; color: #d97706;
  margin-bottom: 4px; text-transform: uppercase; letter-spacing: 0.05em;
}
.tfe-comment-popover .tfe-comment-close {
  position: absolute; top: 4px; right: 8px;
  font-size: 13px; cursor: pointer; color: var(--muted-foreground);
  line-height: 1;
}
`;

const ICON_BOX = { background: 'color-mix(in oklch, var(--accent-soft) 45%, transparent)', boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.65), 2px 2px 4px oklch(0.55 0.03 258 / 0.1)' };
const PAGE_CARD = { padding: '60px 72px', background: '#fff', fontFamily: "'Songti SC','Noto Serif CJK SC','SimSun',serif", fontSize: '15px', lineHeight: '1.9', color: 'var(--foreground)', minHeight: 1122 };
const PAGE_SHADOW = { boxShadow: '0 1px 3px oklch(0.4 0.03 258 / 0.12), 0 6px 16px oklch(0.35 0.04 258 / 0.09), 0 0 0 1px oklch(0.5 0.03 258 / 0.06)' };

export function TenderFileEditorModal({ isOpen, projectId, attachmentId, attachmentName, onClose, onFileReplaced }: Props) {
  /* ── 原文档 ── */
  const [rawHtml, setRawHtml]           = useState('');
  const [loading, setLoading]           = useState(false);
  const [saving, setSaving]             = useState(false);
  const [isDirty, setIsDirty]           = useState(false);
  /* ── 修改历史（只读，记录每次保存并替换）── */
  const [historyOpen, setHistoryOpen]   = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyItems, setHistoryItems] = useState<Array<{
    id: string; createdAt: string; fileSize: number;
    changeSummary: string | null;
    operatorName: string;
  }>>([]);

  const openHistory = useCallback(async () => {
    setHistoryOpen(true); setHistoryLoading(true);
    try {
      const r = await fetch(`${API_BASE}/project-management/${projectId}/attachment/${attachmentId}/versions`, { credentials: 'include' });
      if (!r.ok) throw new Error(`历史加载失败 (${r.status})`);
      const data = await r.json() as Array<any>;
      setHistoryItems((data || []).map(v => ({
        id: v.id,
        createdAt: v.createdAt,
        fileSize: v.fileSize,
        changeSummary: v.changeSummary,
        operatorName: v.createdBy?.displayName || v.createdBy?.username || '未知用户',
      })));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '历史加载失败');
      setHistoryOpen(false);
    } finally { setHistoryLoading(false); }
  }, [projectId, attachmentId]);
  /* ── 导入审阅版 ── */
  const [reviewHtml, setReviewHtml]           = useState('');
  const [reviewAnnotationCount, setReviewAnnotationCount] = useState(0);
  const [reviewFileName, setReviewFileName]     = useState('');
  const [reviewImporting, setReviewImporting]   = useState(false);

  /* ── Refs ── */
  const editorRef       = useRef<HTMLDivElement>(null);
  const reviewRef       = useRef<HTMLDivElement>(null);
  const scrollLeftRef   = useRef<HTMLDivElement>(null);
  const scrollRightRef  = useRef<HTMLDivElement>(null);
  const originalHtmlRef = useRef('');
  // 后端定点补丁所需的段落锚点哈希 + 原始纯文本（与追踪器解耦的"是否改动"判定）
  const originalHashRef = useRef('');
  const originalTextRef = useRef('');
  const syncingRef      = useRef(false);
  const fileInputRef    = useRef<HTMLInputElement>(null);
  const isDirtyRef      = useRef(false);
  // 修改历史刷新计数器：每次编辑后递增，触发面板重新扫描
  const [historyVersion, setHistoryVersion] = useState(0);

  /* ── 查找定位 ── */
  const [searchOpen, setSearchOpen]       = useState(false);
  const [searchQuery, setSearchQuery]     = useState('');
  const [searchCount, setSearchCount]     = useState(0);
  const [searchIndex, setSearchIndex]     = useState(0);
  const [searchVersion, setSearchVersion] = useState(0); // 每次重扫高亮递增，驱动"当前命中"刷新
  const searchInputRef   = useRef<HTMLInputElement>(null);
  const searchMarkingRef = useRef(false); // 查找高亮插入/拆除期间为 true，隔离编辑追踪 MutationObserver
  const searchScrollRef  = useRef(true);  // 本次命中刷新是否滚动跟随
  const observerRef      = useRef<MutationObserver | null>(null);

  // 草稿自动保存（按 attachmentId 分键，防抖 2s）；scheduleRef 供 MutationObserver 内部避免 stale 闭包
  // 内容经 serializeEditorHtml() 剥离查找高亮后落盘——高亮只是视图状态，绝不进草稿
  const scheduleDraftSave = useDraftAutosave(attachmentId, () => serializeEditorHtml());
  const scheduleDraftSaveRef = useRef(scheduleDraftSave);
  scheduleDraftSaveRef.current = scheduleDraftSave;

  /* ── Load ── */
  useEffect(() => {
    if (!isOpen || !attachmentId) return;
    setLoading(true); setIsDirty(false); isDirtyRef.current = false;
    setHistoryVersion(0);
    setSearchOpen(false); setSearchQuery(''); setSearchCount(0); setSearchIndex(0);
    setReviewHtml(''); setReviewAnnotationCount(0); setReviewFileName('');
    fetch(`${API_BASE}/project-management/${projectId}/attachment-html/${attachmentId}`, { credentials: 'include' })
      .then(r => r.ok ? r.json() as Promise<{ fileName: string; html: string; originalHash: string }> : r.text().then(body => { let detail = `HTTP ${r.status}`; try { detail = (JSON.parse(body) as any).message || detail; } catch {} throw new Error(`加载失败（${detail}）`); }))
      .then(d => {
        setRawHtml(d.html); originalHtmlRef.current = d.html;
        originalHashRef.current = d.originalHash ?? '';
        // 原始纯文本（去标签/折叠空白），用于与追踪器解耦的"是否真的改了"判定（语义对齐后端逐段文字 diff）
        originalTextRef.current = d.html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
        // 草稿恢复：若有未保存草稿且与服务器原文不同，询问是否恢复
        const draft = loadDraft(attachmentId);
        const draftText = draft?.html?.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
        if (draft && draft.html && draftText && draftText !== originalTextRef.current) {
          toast('检测到未保存的草稿，是否恢复？', {
            duration: 12000,
            action: {
              label: '恢复',
              onClick: () => {
                if (!editorRef.current) return;
                contentReadyRef.current = false;
                editorRef.current.innerHTML = draft.html;
                injectDocStyles(editorRef.current);
                refreshBlockSnapshot();
                setIsDirty(true); isDirtyRef.current = true;
                setHistoryVersion(v => v + 1);
                requestAnimationFrame(() => { requestAnimationFrame(() => { contentReadyRef.current = true; }); });
                toast.success('已恢复未保存的草稿');
              },
            },
            cancel: { label: '丢弃', onClick: () => clearDraft(attachmentId) },
          });
        }
      })
      .catch(e => toast.error(e instanceof Error ? e.message : '加载失败'))
      .finally(() => setLoading(false));
  }, [isOpen, projectId, attachmentId]);

  /* ── 修改历史：扫描 DOM 中所有 .tfe-modified span ── */
  const scannedHistory = useMemo(() => {
    if (!editorRef.current || historyVersion === -1) return [] as Array<{ el: HTMLElement; oldText: string; newText: string; timestamp: number }>;
    const spans = editorRef.current.querySelectorAll('.tfe-modified');
    return Array.from(spans).map((span, i) => ({
      el: span as HTMLElement,
      oldText: (span as HTMLElement).getAttribute('data-old') || '(空)',
      newText: ((span as HTMLElement).textContent || '').replace(/\s+/g, ' ').trim().slice(0, 200),
      timestamp: Date.now() - (spans.length - i) * 1000, // 稳定递增的时间戳
    }));
  }, [historyVersion]);

    /* ── 填充 contentEditable ── */
  const contentReadyRef = useRef(false);

  useEffect(() => {
    const el = editorRef.current;
    if (!el || loading || !rawHtml) return;
    if (el.textContent?.trim()) return;
    contentReadyRef.current = false; // 装入期间暂停MutationObserver
    el.innerHTML = rawHtml;
    injectDocStyles(el);
    refreshBlockSnapshot(); // 初始化块级原文快照
    // 延迟开启观察，确保初始 DOM 插入不被当作用户修改
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        contentReadyRef.current = true;
      });
    });
  }, [loading, rawHtml]);

  useEffect(() => {
    const el = reviewRef.current;
    if (!el || !reviewHtml) return;
    el.innerHTML = reviewHtml;
    injectDocStyles(el);
  }, [reviewHtml]);

  /* ── 批注弹出泡：点击 .tfe-review-comment 标记显示/隐藏批注内容 ── */
  useEffect(() => {
    const container = reviewRef.current;
    if (!container || !reviewHtml) return;

    const handleClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const mark = target.closest('.tfe-review-comment') as HTMLElement | null;

      // 点击关闭按钮 → 关闭气泡
      if (target.closest('.tfe-comment-close')) {
        const popover = container.querySelector('.tfe-comment-popover') as HTMLElement | null;
        if (popover) popover.remove();
        e.stopPropagation();
        return;
      }

      // 点了气泡内部 → 不关
      if (target.closest('.tfe-comment-popover')) return;

      // 移除旧气泡
      const existing = container.querySelector('.tfe-comment-popover') as HTMLElement | null;
      if (existing) existing.remove();

      // 点击批注标记 → 显示气泡
      if (mark) {
        e.stopPropagation();
        const commentText = mark.getAttribute('data-comment') || '（无批注内容）';

        const popover = document.createElement('div');
        popover.className = 'tfe-comment-popover';
        popover.innerHTML = '<div class="tfe-comment-label">审阅批注</div><span class="tfe-comment-close">&times;</span><div class="tfe-comment-body">' + commentText + '</div>';
        mark.appendChild(popover);
      }
    };

    container.addEventListener('click', handleClick);

    // 点击容器外的任意位置 → 关闭气泡
    const handleDocClick = (e: MouseEvent) => {
      if (!container.contains(e.target as Node)) {
        const popover = container.querySelector('.tfe-comment-popover') as HTMLElement | null;
        if (popover) popover.remove();
      }
    };
    document.addEventListener('click', handleDocClick);

    return () => {
      container.removeEventListener('click', handleClick);
      document.removeEventListener('click', handleDocClick);
    };
  }, [reviewHtml]);

  function injectDocStyles(el: HTMLElement) {
    if (el.querySelector('#tfe-doc-styles')) return;
    const styleEl = document.createElement('style');
    styleEl.id = 'tfe-doc-styles';
    styleEl.textContent = DOC_STYLES;
    if (el.firstChild) el.insertBefore(styleEl, el.firstChild);
    else el.appendChild(styleEl);
  }

  /* ── contentEditable 规范化 ── */
  useEffect(() => {
    const el = editorRef.current;
    if (!el) return;
    try { document.execCommand('defaultParagraphSeparator', false, 'p'); } catch {}
    const onPaste = (e: ClipboardEvent) => {
      e.preventDefault();
      const text = e.clipboardData?.getData('text/plain');
      if (text) document.execCommand('insertText', false, text);
    };
    el.addEventListener('paste', onPaste);
    return () => el.removeEventListener('paste', onPaste);
  }, [loading]);

  /* ── 同步滚动 ── */
  const handleLeftScroll = useCallback(() => {
    if (syncingRef.current || !scrollLeftRef.current || !scrollRightRef.current) return;
    syncingRef.current = true;
    const sl = scrollLeftRef.current;
    const sr = scrollRightRef.current;
    const ratio = sl.scrollTop / Math.max(1, sl.scrollHeight - sl.clientHeight);
    sr.scrollTop = ratio * Math.max(0, sr.scrollHeight - sr.clientHeight);
    requestAnimationFrame(() => { syncingRef.current = false; });
  }, []);

  const handleRightScroll = useCallback(() => {
    if (syncingRef.current || !scrollLeftRef.current || !scrollRightRef.current) return;
    syncingRef.current = true;
    const sr = scrollRightRef.current;
    const sl = scrollLeftRef.current;
    const ratio = sr.scrollTop / Math.max(1, sr.scrollHeight - sr.clientHeight);
    sl.scrollTop = ratio * Math.max(0, sl.scrollHeight - sl.clientHeight);
    requestAnimationFrame(() => { syncingRef.current = false; });
  }, []);

  /* ── 导入审阅文件 ── */
  const handleImportReview = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.docx') && !file.name.toLowerCase().endsWith('.doc')) {
      toast.error('仅支持 .docx 格式'); return;
    }
    setReviewImporting(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const r = await fetch(`${API_BASE}/project-management/${projectId}/import-review-file`, {
        method: 'POST', credentials: 'include', body: formData,
      });
      if (!r.ok) {
        let msg = `导入失败（${r.status}）`;
        try { msg = (await r.json() as any).message || msg; } catch {}
        throw new Error(msg);
      }
      const data = await r.json() as { html: string; annotationCount: number };
      setReviewHtml(data.html);
      setReviewAnnotationCount(data.annotationCount || 0);
      setReviewFileName(file.name);
      toast.success(`已导入审阅版：${file.name}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '导入失败');
    } finally {
      setReviewImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }, [projectId]);

  const clearReview = useCallback(() => {
    setReviewHtml(''); setReviewAnnotationCount(0); setReviewFileName('');
  }, []);

  /* ── 编辑追踪：MutationObserver 标红 + blockSnapshot 存原文 + 版本号刷新 ── */
  const mutateDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 块级元素 → 批前全文映射。每批 flush 后刷新，供下一批标红时取原文。
  const blockSnapshotRef = useRef<Map<Element, string>>(new Map());

  /** 遍历编辑器所有块级元素，缓存当前全文为"批前快照" */
  function refreshBlockSnapshot() {
    if (!editorRef.current) return;
    const snap = blockSnapshotRef.current;
    snap.clear();
    const blocks = editorRef.current.querySelectorAll('p,h1,h2,h3,h4,h5,h6,li,td,th,div,blockquote');
    blocks.forEach(b => snap.set(b, (b.textContent || '').replace(/\s+/g, ' ').trim()));
  }

  useEffect(() => {
    const el = editorRef.current;
    if (!el || loading) return;

    const observer = new MutationObserver((records) => {
      if (syncingRef.current) return;
      if (!contentReadyRef.current) return;
      if (revertingRef.current) return;
      if (searchMarkingRef.current) return; // 查找高亮 DOM 操作，不是用户编辑

      let hasChanges = false;
      for (const rec of records) {
        if (rec.type === 'characterData') {
          const node = rec.target as Text;
          const oldVal = (rec.oldValue || '').trim();
          const newVal = (node.textContent || '').trim();
          if (oldVal === newVal || (!oldVal && !newVal)) continue;
          hasChanges = true;
          markNodeModified(node, rec.oldValue || '');
        }
        if (rec.type === 'childList') {
          for (const added of rec.addedNodes) {
            if (added.nodeType === Node.TEXT_NODE) markNodeModified(added as Text, '');
            else if (added instanceof HTMLElement) markElementModified(added);
          }
          if (rec.addedNodes.length > 0 || rec.removedNodes.length > 0) hasChanges = true;
        }
      }

      if (!hasChanges) return;

      if (!isDirtyRef.current) { isDirtyRef.current = true; setIsDirty(true); }

      if (mutateDebounceRef.current) clearTimeout(mutateDebounceRef.current);
      mutateDebounceRef.current = setTimeout(() => {
        refreshBlockSnapshot(); // 为新批次准备原文快照
        setHistoryVersion(v => v + 1);
        scheduleDraftSaveRef.current(); // 触发草稿自动保存（防抖 2s）
      }, 500);
    });

    observer.observe(el, {
      characterData: true,
      characterDataOldValue: true,
      childList: true,
      subtree: true,
    });
    observerRef.current = observer;

    return () => {
      observerRef.current = null;
      observer.disconnect();
      if (mutateDebounceRef.current) clearTimeout(mutateDebounceRef.current);
    };
  }, [loading]);

  function nearestBlockElement(node: Node): Element | null {
    let el: Node | null = node;
    while (el && el !== editorRef.current) {
      if (el.nodeType === Node.ELEMENT_NODE && /^(P|H[1-6]|LI|TD|TH|DIV|BLOCKQUOTE)$/.test((el as Element).tagName)) return el as Element;
      el = el.parentNode;
    }
    return null;
  }

  const revertingRef = useRef(false);

  // 标记单个文本节点为已修改，存储原文到 data-old
  function markNodeModified(node: Text, recordOldValue: string) {
    const parent = node.parentNode;
    if (!parent || parent instanceof HTMLStyleElement) return;
    if (/^[\s\n]*$/.test(node.textContent || '')) return;
    if (revertingRef.current) return;

    const ancestor = parent instanceof HTMLElement ? parent.closest('.tfe-modified,.tfe-review-insertion,.tfe-review-deletion,.tfe-review-comment,.tfe-review-highlight') : null;
    if (ancestor && ancestor.classList.contains('tfe-modified')) return;
    if (ancestor) return;

    // 优先从块级批前快照取完整原文，其次从 MutationRecord.oldValue 取，最后取当前节点文本
    const block = nearestBlockElement(node);
    let original: string;
    if (block && blockSnapshotRef.current.has(block)) {
      original = blockSnapshotRef.current.get(block)!;
    } else if (recordOldValue && recordOldValue.trim()) {
      original = recordOldValue.replace(/\s+/g, ' ').trim();
    } else {
      original = (node.textContent || '').replace(/\s+/g, ' ').trim();
    }

    const span = document.createElement('span');
    span.className = 'tfe-modified';
    span.setAttribute('data-old', original || '(空)');
    parent.insertBefore(span, node);
    span.appendChild(node);
  }

  // 递归标记 HTML 元素内所有子节点
  function markElementModified(el: HTMLElement) {
    if (el.matches('style,script,.tfe-modified,.tfe-review-insertion,.tfe-review-deletion,.tfe-review-comment,.tfe-review-highlight')) return;
    // 对直接子元素中新增的文本节点/非样式元素标红
    el.querySelectorAll(':not(style):not(script)').forEach(child => {
      if (child.childNodes.length === 1 && child.firstChild?.nodeType === Node.TEXT_NODE) {
        markNodeModified(child.firstChild as Text, '');
      }
    });
  }

  /* ── 查找定位：搜索文档文字，高亮全部匹配并支持上/下跳转 ──
     高亮用 <mark> 包裹文本节点实现。包裹/拆解是程序化 DOM 变更，必须与
     编辑追踪 MutationObserver 完全隔离（searchMarkingRef 守卫 + takeRecords
     抽干待派发记录），否则会被误判为用户修改、触发标红与脏状态。
     保存 / 草稿序列化统一走 serializeEditorHtml() 剥离高亮——高亮绝不落盘。 ── */

  function beginSearchDomEdit() { searchMarkingRef.current = true; }
  function endSearchDomEdit() { observerRef.current?.takeRecords(); searchMarkingRef.current = false; }

  /** 拆解容器内全部查找高亮 mark，还原文本并合并相邻文本节点（调用方需自行加守卫） */
  function clearSearchMarksIn(root: HTMLElement) {
    root.querySelectorAll('mark.tfe-search-hit').forEach(m => {
      const p = m.parentNode; if (!p) return;
      while (m.firstChild) p.insertBefore(m.firstChild, m);
      p.removeChild(m);
      p.normalize();
    });
  }

  /** 重新扫描编辑器、包裹全部匹配项，返回匹配数（大小写不敏感） */
  function applySearchMarks(root: HTMLElement, query: string): number {
    beginSearchDomEdit();
    clearSearchMarksIn(root);
    const q = query.trim();
    let count = 0;
    if (q) {
      const ql = q.toLowerCase();
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode: (node) => {
          const p = (node as Text).parentElement;
          if (!p || p.closest('style,mark.tfe-search-hit')) return NodeFilter.FILTER_REJECT;
          return ((node as Text).textContent || '').toLowerCase().includes(ql)
            ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
        },
      });
      const nodes: Text[] = [];
      let w = walker.nextNode() as Text | null;
      while (w) { nodes.push(w); w = walker.nextNode() as Text | null; }
      for (const startNode of nodes) {
        let node: Text | null = startNode;
        while (node) {
          const idx = (node.textContent || '').toLowerCase().indexOf(ql);
          if (idx === -1) break;
          const range = document.createRange();
          range.setStart(node, idx);
          range.setEnd(node, idx + q.length);
          const mark = document.createElement('mark');
          mark.className = 'tfe-search-hit';
          range.surroundContents(mark);
          count++;
          const next = mark.nextSibling; // 匹配后的剩余文本被分裂为新节点
          node = next && next.nodeType === Node.TEXT_NODE ? (next as Text) : null;
        }
      }
    }
    endSearchDomEdit();
    return count;
  }

  /** 给第 index 个匹配加"当前命中"样式，可选平滑滚动到视野中央 */
  function markCurrentHit(index: number, scroll: boolean) {
    const root = editorRef.current; if (!root) return;
    root.querySelectorAll('mark.tfe-search-hit.tfe-search-current').forEach(m => m.classList.remove('tfe-search-current'));
    const marks = root.querySelectorAll('mark.tfe-search-hit');
    if (marks.length === 0) return;
    const el = marks[Math.min(index, marks.length - 1)];
    el.classList.add('tfe-search-current');
    if (scroll) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }

  /** 序列化编辑器 HTML（保存/草稿共用）：克隆后剥离内联样式块与查找高亮 mark。
      块级 data-pid 是后端 diff 锚点，原样保留。 */
  function serializeEditorHtml(): string {
    const el = editorRef.current; if (!el) return '';
    const clone = el.cloneNode(true) as HTMLElement;
    clone.querySelector('#tfe-doc-styles')?.remove();
    clearSearchMarksIn(clone);
    return clone.innerHTML;
  }

  const searchQueryRef = useRef(''); searchQueryRef.current = searchQuery;
  const searchOpenRef  = useRef(false); searchOpenRef.current = searchOpen;
  const runSearchRef   = useRef<(scroll: boolean) => void>(() => {});

  /** 重扫匹配并更新计数/索引；scroll=true 时滚动到当前命中 */
  const runSearch = useCallback((scroll: boolean) => {
    const root = editorRef.current; if (!root) return;
    const count = applySearchMarks(root, searchQuery);
    searchScrollRef.current = scroll;
    setSearchCount(count);
    setSearchIndex(prev => (count === 0 ? 0 : Math.min(prev, count - 1)));
    setSearchVersion(v => v + 1);
  }, [searchQuery]);
  runSearchRef.current = runSearch;

  const openSearch = useCallback(() => {
    if (loading) return;
    if (searchOpen) { searchInputRef.current?.focus(); searchInputRef.current?.select(); return; }
    setSearchOpen(true);
  }, [searchOpen, loading]);

  const closeSearch = useCallback(() => {
    setSearchOpen(false); setSearchQuery(''); setSearchCount(0); setSearchIndex(0);
    const root = editorRef.current;
    if (root) { beginSearchDomEdit(); clearSearchMarksIn(root); endSearchDomEdit(); }
  }, []);

  const gotoMatch = useCallback((delta: number) => {
    if (searchCount === 0) return;
    searchScrollRef.current = true;
    setSearchIndex(i => (i + delta + searchCount) % searchCount);
  }, [searchCount]);

  /* 输入防抖 250ms 后重扫匹配并滚动到命中处 */
  useEffect(() => {
    if (!searchOpen) return;
    const t = setTimeout(() => runSearchRef.current(true), 250);
    return () => clearTimeout(t);
  }, [searchOpen, searchQuery]);

  /* 用户编辑（含撤销单条/AI 应用）后高亮可能失效或位移：随历史版本号重扫，不打断用户滚动 */
  useEffect(() => {
    if (historyVersion === 0) return;
    if (!searchOpenRef.current || !searchQueryRef.current.trim()) return;
    runSearchRef.current(false);
  }, [historyVersion]);

  /* 匹配集合或当前索引变化 → 刷新"当前命中"高亮 */
  useEffect(() => {
    if (!searchOpen || searchCount === 0) return;
    markCurrentHit(searchIndex, searchScrollRef.current);
  }, [searchOpen, searchCount, searchIndex, searchVersion]);


  /* ── 编辑（用于粘贴事件等仍需手动处理的场景） ── */
  const handleInput = useCallback(() => {
    if (!isDirtyRef.current) {
      isDirtyRef.current = true;
      setIsDirty(true);
    }
    const el = editorRef.current;
    if (el) injectDocStyles(el);
  }, []);

  /* ── Reset ── */
  const handleReset = useCallback(() => {
    if (!editorRef.current) return;
    contentReadyRef.current = false;
    editorRef.current.innerHTML = originalHtmlRef.current;
    injectDocStyles(editorRef.current);
    refreshBlockSnapshot(); // 重置块级快照
    setRawHtml(originalHtmlRef.current);
    setIsDirty(false); isDirtyRef.current = false;
    setHistoryVersion(0);
    clearDraft(attachmentId); // 还原全部修改 = 丢弃草稿
    requestAnimationFrame(() => { requestAnimationFrame(() => { contentReadyRef.current = true; }); });
    toast.success('已还原为原始内容');
  }, []);

  /* ── 撤销单条修改：用 data-old 还原文本并去掉 span 标记 ── */
  const revertSingleMod = useCallback((el: HTMLElement) => {
    revertingRef.current = true;
    const oldText = el.getAttribute('data-old');
    if (oldText && oldText !== '(空)') {
      el.textContent = oldText;
    } else if (oldText === '(空)') {
      el.textContent = '';
    }
    const parent = el.parentNode;
    if (parent) {
      while (el.firstChild) parent.insertBefore(el.firstChild, el);
      parent.removeChild(el);
    }
    if (!isDirtyRef.current) { isDirtyRef.current = true; setIsDirty(true); }
    setHistoryVersion(v => v + 1);
    requestAnimationFrame(() => { revertingRef.current = false; });
    toast.success('已撤销该修改');
  }, []);

  /* ── Save：序列化编辑器 HTML（含 data-pid）+ originalHash 发后端定点补丁。
        "是否改动"用 textContent 判定，与追踪器解耦——追踪器只负责可视化，不决定存得对不对。── */
  const handleSave = useCallback(async () => {
    if (!editorRef.current) return;
    // 序列化时剥离内联样式块与查找高亮；块级 data-pid 是后端 diff 锚点，原样保留
    const editedHtml = serializeEditorHtml();
    const currentText = (editorRef.current.textContent || '').replace(/\s+/g, ' ').trim();
    if (currentText === originalTextRef.current) { toast.warning('没有检测到任何修改内容'); return; }

    setSaving(true);
    try {
      const r = await fetch(`${API_BASE}/project-management/${projectId}/save-attachment-html`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ attachmentId, html: editedHtml, originalHash: originalHashRef.current }),
      });
      if (!r.ok) {
        let msg = `保存失败（${r.status}）`;
        try { msg = (await r.json() as any).message || msg; } catch {}
        if (r.status === 409) {
          // 并发冲突：文件已被他人改过，关闭强制重载
          toast.error(msg || '文件已被他人修改，请刷新重载');
          onClose();
          return;
        }
        throw new Error(msg);
      }
      const data = await r.json() as { success: boolean; attachmentId: string };
      toast.success('已保存并替换文件');
      // 清除标红，更新 attachmentId 引用
      editorRef.current.querySelectorAll('.tfe-modified').forEach(s => {
        const p = s.parentNode; if (!p) return;
        while (s.firstChild) p.insertBefore(s.firstChild, s);
        p.removeChild(s);
      });
      setIsDirty(false); isDirtyRef.current = false;
      setHistoryVersion(0);
      clearDraft(attachmentId); // 保存成功，清除草稿
      await onFileReplaced();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '保存失败');
    } finally { setSaving(false); }
  }, [projectId, attachmentId, onFileReplaced, onClose]);

  /* ── Keyboard ── */
  useEffect(() => { if (!isOpen) return; const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') { if (searchOpen) closeSearch(); else onClose(); return; }
    if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); void handleSave(); return; }
    if ((e.metaKey || e.ctrlKey) && (e.key === 'f' || e.key === 'F')) { e.preventDefault(); openSearch(); return; }
    if (searchOpen && (e.key === 'F3' || ((e.metaKey || e.ctrlKey) && (e.key === 'g' || e.key === 'G')))) {
      e.preventDefault(); gotoMatch(e.shiftKey ? -1 : 1); return;
    }
  }; document.addEventListener('keydown', onKey); return () => document.removeEventListener('keydown', onKey); }, [isOpen, handleSave, onClose, searchOpen, closeSearch, openSearch, gotoMatch]);

  /* ── AI ── */
  type AiPhase = 'idle' | 'toolbar' | 'panel' | 'diff';
  const [aiPhase, setAiPhase] = useState<AiPhase>('idle');
  const [aiData, setAiData] = useState<{ selectedText: string; instruction: string; busy: boolean; polishedText: string | null; suggesting: boolean; source: 'left' | 'review' } | null>(null);
  const [toolbarPos, setToolbarPos] = useState<{x:number;y:number}|null>(null);
  const [editorVersion, setEditorVersion] = useState(0);
  const savedRangeRef = useRef<Range | null>(null);
  const dismissAi = useCallback(() => { setAiPhase('idle'); setAiData(null); setToolbarPos(null); }, []);

  useEffect(() => {
    if (!isOpen) return;
    const onSelect = () => {
      if (aiPhase === 'panel' || aiPhase === 'diff') return;
      const sel = window.getSelection(); if (!sel || sel.isCollapsed) { if (aiPhase === 'toolbar') dismissAi(); return; }
      const txt = sel.toString().trim(); if (txt.length < 2) return;
      if (sel.rangeCount > 0) { const r = sel.getRangeAt(0); savedRangeRef.current = r.cloneRange(); setToolbarPos({ x: r.getBoundingClientRect().left + r.getBoundingClientRect().width / 2, y: r.getBoundingClientRect().top - 8 }); }
      setAiData({ selectedText: txt, instruction: '', busy: false, polishedText: null, suggesting: false, source: (reviewRef.current && sel.anchorNode && reviewRef.current.contains(sel.anchorNode)) ? 'review' : 'left' });
      setAiPhase('toolbar');
    };
    document.addEventListener('mouseup', onSelect); document.addEventListener('keyup', onSelect);
    return () => { document.removeEventListener('mouseup', onSelect); document.removeEventListener('keyup', onSelect); };
  }, [isOpen, aiPhase, dismissAi]);

  const openAiPanel = useCallback(() => {
    if (!aiData) return; setAiPhase('panel'); setAiData(p => p ? { ...p, suggesting: true } : null);
    fetch(`${API_BASE}/project-management/${projectId}/attachment-ai-polish`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: aiData.selectedText, instruction: `请分析以下选中文字，给出一个简洁的修改方向建议（不超过30字）。不要只关注标点格式——着重分析语义表达、用词是否正式恰当、信息是否完整、逻辑是否连贯、是否与采购文件专业风格一致。直接输出建议，不要任何解释性文字。` }),
    }).then(r => r.ok ? r.json() : Promise.reject()).then((d: { polished: string }) => setAiData(p => p ? { ...p, instruction: (d.polished || '').replace(/^建议[：:]\s*/, '').trim(), suggesting: false } : null)).catch(() => setAiData(p => p ? { ...p, suggesting: false } : null));
  }, [aiData, projectId]);

  const handleAiPolish = useCallback(async () => {
    if (!aiData || aiData.busy) return; setAiData(p => p ? { ...p, busy: true } : null);
    try { const r = await fetch(`${API_BASE}/project-management/${projectId}/attachment-ai-polish`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: aiData.selectedText, instruction: aiData.instruction || '优化文字表述' }) }); if (!r.ok) throw new Error('AI 修改失败'); const result = await r.json() as { polished: string }; setAiData(p => p ? { ...p, busy: false, polishedText: result.polished } : null); setEditorVersion(v => v + 1); setAiPhase('diff'); } catch (e) { toast.error(e instanceof Error ? e.message : 'AI 修改失败'); setAiData(p => p ? { ...p, busy: false } : null); }
  }, [aiData, projectId]);

  const confirmAiPolish = useCallback(() => {
    if (!aiData?.polishedText || !editorRef.current) return;

    const needle = aiData.selectedText;

    // ── 左屏选中：直接用保存的 Range 替换（最可靠，无需文本匹配） ──
    if (aiData.source === 'left' && savedRangeRef.current) {
      const range = savedRangeRef.current;
      // 验证 Range 仍在左屏编辑器内
      if (editorRef.current.contains(range.commonAncestorContainer)) {
        range.deleteContents();
        const span = document.createElement('span');
        span.className = 'tfe-modified';
        span.textContent = aiData.polishedText;
        range.insertNode(span);
        span.setAttribute('data-old', needle);
        savedRangeRef.current = null;
        setHistoryVersion(v => v + 1);

        if (!isDirtyRef.current) { isDirtyRef.current = true; setIsDirty(true); }
        dismissAi();
        return;
      }
    }

    // ── 右屏选中 / Range 失效：用全文 textContent 偏移匹配 ──
    const editor = editorRef.current;
    const collapseSpaces = (s: string) => s.replace(/[\s ]+/g, ' ').trim();
    const flatNeedle = collapseSpaces(needle);

    const textNodes: Text[] = [];
    const w = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => {
        const p = n.parentElement;
        if (p instanceof HTMLStyleElement || p?.closest('style')) return NodeFilter.FILTER_REJECT;
        if ((p as HTMLElement | null)?.id === 'tfe-doc-styles') return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    let n: Text | null;
    while ((n = w.nextNode() as Text | null)) textNodes.push(n);

    const nodeStarts: number[] = [];
    let fullText = '';
    for (const node of textNodes) {
      nodeStarts.push(fullText.length);
      fullText += node.textContent || '';
    }
    // 将全文也做 collapse，包括
    const flatFull = fullText.replace(/[\s ]+/g, ' ').trim();
    const flatIdx = flatFull.indexOf(flatNeedle);

    if (flatIdx === -1) {
      toast.error('无法在编辑器中定位到选中文字');
      dismissAi(); return;
    }

    // 映射 flatIdx → raw 偏移：逐个字符走 raw text，\s/ →跳过，非空白→fti++
    let rawStart = 0, fti = 0;
    while (fti < flatIdx && rawStart < fullText.length) {
      if (/[\s ]/.test(fullText[rawStart])) { rawStart++; continue; }
      rawStart++; fti++;
    }
    // 跳过 raw 处连续的空白
    while (rawStart < fullText.length && /[\s ]/.test(fullText[rawStart])) rawStart++;
    // 找 rawEnd
    let rawEnd = rawStart, fne = 0;
    while (fne < flatNeedle.length && rawEnd < fullText.length) {
      if (/[\s ]/.test(fullText[rawEnd])) { rawEnd++; continue; }
      rawEnd++; fne++;
    }

    function resolveOffset(globalOffset: number): { node: Node; offset: number } | null {
      for (let i = textNodes.length - 1; i >= 0; i--) {
        if (nodeStarts[i] <= globalOffset) return { node: textNodes[i], offset: globalOffset - nodeStarts[i] };
      }
      return null;
    }
    const startPos = resolveOffset(rawStart);
    const endPos = resolveOffset(rawEnd);
    if (!startPos || !endPos) { dismissAi(); return; }

    const range = document.createRange();
    range.setStart(startPos.node, startPos.offset);
    range.setEnd(endPos.node, endPos.offset);
    range.deleteContents();

    const span = document.createElement('span');
    span.className = 'tfe-modified';
    span.textContent = aiData.polishedText;
    range.insertNode(span);

    span.setAttribute('data-old', needle);
    setHistoryVersion(v => v + 1);

    savedRangeRef.current = null;
    if (!isDirtyRef.current) { isDirtyRef.current = true; setIsDirty(true); }
    dismissAi();
  }, [aiData, dismissAi]);

  if (!isOpen) return null;

  const isDualPane = reviewHtml.length > 0;

  return (
    <div className="fixed inset-0 z-[600] flex flex-col">
      <div className="absolute inset-0" style={{ background: 'oklch(0.975 0.012 258 / 0.72)', backdropFilter: 'blur(5px)' }} onClick={onClose} />
      <div className="relative z-10 mx-5 my-5 flex flex-1 flex-col overflow-hidden rounded-[28px]" style={{ background: 'linear-gradient(170deg, oklch(1 0 0 / 0.94), oklch(0.988 0.005 258 / 0.62))', boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.88), 3px 4px 16px oklch(0.46 0.07 258 / 0.18), -3px -3px 10px oklch(1 0 0 / 0.94)' }}>

        {/* ══════ Header ══════ */}
        <div className="relative flex shrink-0 items-center justify-between gap-3 px-6 py-4" style={{ background: 'linear-gradient(105deg, oklch(1 0 0 / 0.92) 0%, oklch(0.975 0.006 258 / 0.58) 60%)', borderBottom: '1px solid oklch(0.6 0.04 258 / 0.14)' }}>
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[11px]" style={ICON_BOX}><Pencil size={17} className="text-[var(--accent)]" /></div>
            <div className="min-w-0">
              <div className="text-[0.92rem] font-semibold tracking-[-0.02em] text-[var(--foreground)] truncate">采购文件修改</div>
              <div className="mt-0.5 text-[11px] text-[var(--muted-foreground)] truncate">{attachmentName}</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {/* 查找定位 */}
            <button type="button" onClick={openSearch} disabled={loading} title="在文档中查找（Ctrl/Cmd+F）"
              className={`neu-btn-soft gap-1.5 h-8 text-xs ${searchOpen ? 'text-[var(--accent)]' : ''}`}>
              <Search size={13} />查找
            </button>

            {/* ─── 查找定位面板：定位在 header 查找按钮正下方，不受左右分屏影响 ─── */}
            {searchOpen && (
              <div className="absolute right-5 top-full z-30 mt-1 flex items-center gap-1 rounded-[14px] px-3 py-1.5"
                style={{ background: 'linear-gradient(170deg, oklch(1 0 0 / 0.97), oklch(0.99 0.003 258 / 0.82))', boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.9), 2px 3px 8px oklch(0.5 0.04 258 / 0.16), -1px -1px 3px oklch(1 0 0 / 0.85)' }}>
                <Search size={13} className="shrink-0 text-[var(--muted-foreground)]" />
                <input ref={searchInputRef} autoFocus value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); gotoMatch(e.shiftKey ? -1 : 1); } }}
                  placeholder="在文档中查找…"
                  className="w-44 bg-transparent text-xs text-[color:var(--foreground)] outline-none placeholder:text-[color:var(--muted-foreground)]/50" />
                <span className={`w-12 shrink-0 text-center text-[10px] tabular-nums ${searchQuery.trim() && searchCount === 0 ? 'font-semibold' : 'text-[var(--muted-foreground)]'}`}
                  style={searchQuery.trim() && searchCount === 0 ? { color: 'var(--danger)' } : undefined}>
                  {searchQuery.trim() ? (searchCount > 0 ? `${searchIndex + 1}/${searchCount}` : '无匹配') : ' '}
                </span>
                <span className="h-4 w-px shrink-0" style={{ background: 'oklch(0.6 0.04 258 / 0.2)' }} />
                {/* 上/下翻找配对控件 —— neumorphic 分组按钮，方向性双影 + 内高光线 */}
                <div className="flex shrink-0 overflow-hidden rounded-[7px]"
                  style={{
                    background: 'oklch(0.98 0.005 258)',
                    boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.65), 1px 1px 3px oklch(0.55 0.03 258 / 0.1), -1px -1px 2px oklch(1 0 0 / 0.8)',
                  }}>
                  <button type="button" onClick={() => gotoMatch(-1)} disabled={searchCount === 0}
                    title="上一个匹配（Shift+Enter）"
                    className="grid h-[26px] w-[26px] place-items-center text-[var(--muted-foreground)] transition-all duration-200 hover:text-[var(--accent-strong)] hover:bg-[oklch(0.96_0.008_258)] active:shadow-[inset_1px_1px_3px_oklch(0.55_0.03_258_/_0.14),inset_-1px_-1px_3px_oklch(1_0_0_/_0.5)] disabled:opacity-25 disabled:pointer-events-none">
                    <ChevronUp size={14} strokeWidth={2} />
                  </button>
                  <span className="block w-px self-stretch" style={{ background: 'oklch(0.6 0.04 258 / 0.16)' }} />
                  <button type="button" onClick={() => gotoMatch(1)} disabled={searchCount === 0}
                    title="下一个匹配（Enter）"
                    className="grid h-[26px] w-[26px] place-items-center text-[var(--muted-foreground)] transition-all duration-200 hover:text-[var(--accent-strong)] hover:bg-[oklch(0.96_0.008_258)] active:shadow-[inset_1px_1px_3px_oklch(0.55_0.03_258_/_0.14),inset_-1px_-1px_3px_oklch(1_0_0_/_0.5)] disabled:opacity-25 disabled:pointer-events-none">
                    <ChevronDown size={14} strokeWidth={2} />
                  </button>
                </div>
                <button type="button" onClick={closeSearch} title="关闭查找（Esc）"
                  className="grid h-[26px] w-[26px] place-items-center rounded-[7px] text-[var(--muted-foreground)] transition-all duration-200 hover:text-[var(--foreground)] hover:bg-[oklch(1_0_0_/_0.4)] active:shadow-[inset_1px_1px_2px_oklch(0.55_0.03_258_/_0.12)]">
                  <X size={13} strokeWidth={2} />
                </button>
              </div>
            )}

            {/* 导入审阅文件 */}
            <input ref={fileInputRef} type="file" accept=".docx,.doc" onChange={handleImportReview} className="hidden" />
            <button type="button" onClick={() => fileInputRef.current?.click()} disabled={reviewImporting || loading}
              className="neu-btn-soft gap-1.5 h-8 text-xs">
              {reviewImporting ? <Loader2 size={12} className="animate-spin" /> : <FileUp size={13} />}
              {reviewImporting ? '导入中…' : reviewFileName ? reviewFileName.length > 16 ? reviewFileName.slice(0,14)+'…' : reviewFileName : '导入审阅文件'}
            </button>

            {isDualPane && (
              <button type="button" onClick={clearReview} className="text-[10px] text-[var(--muted-foreground)] hover:text-[color:var(--danger)]">
                <X size={12} />
              </button>
            )}
            {isDirty && <span className="text-[10px] font-semibold" style={{ color: 'var(--danger)' }}>已修改</span>}
            {/* 修改历史：只读展示每次保存并替换的操作人/时间/变更内容 */}
            <button type="button" onClick={() => void openHistory()} disabled={loading} className="neu-btn-soft gap-1.5 h-8 text-xs">
              <History size={13} />修改历史
            </button>
            <button type="button" onClick={() => void handleSave()} disabled={saving || loading} className="neu-btn-soft gap-1.5 h-8 text-xs">
              {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}{saving ? '保存中…' : '保存并替换'}
            </button>
            <button type="button" onClick={onClose} className="neu-btn-soft !p-2"><X size={16} /></button>
          </div>
        </div>

        {/* ══════ Body ══════ */}
        <div className="flex-1 min-h-0 flex" style={{ background: 'oklch(0.975 0.012 258 / 0.32)', boxShadow: 'inset 2px 3px 8px oklch(0.5 0.04 258 / 0.1), inset -1px -1px 3px oklch(1 0 0 / 0.55)' }}>

          {/* ─── 左：原文件（可编辑） ─── */}
          <div className={`flex-1 min-w-0 flex flex-col ${isDualPane ? '' : ''}`}>
            {isDirty && (
              <div className="shrink-0 flex items-center justify-between px-6 py-2 text-[10px]" style={{ background: 'color-mix(in oklch, var(--danger) 6%, transparent)', borderBottom: '1px solid oklch(0.6 0.04 258 / 0.1)' }}>
                <span className="font-semibold inline-flex items-center gap-1.5" style={{ color: 'var(--danger)' }}>
                  <span className="w-1.5 h-1.5 rounded-full" style={{ background: 'var(--danger)' }} />文档已修改
                </span>
                <button type="button" onClick={handleReset} className="inline-flex items-center gap-1 rounded-[5px] px-2 py-0.5 hover:bg-[oklch(1_0_0_/_0.3)] transition-colors" style={{ color: 'var(--danger)' }}>
                  <RotateCcw size={10} />撤销全部修改
                </button>
              </div>
            )}
            {loading ? (
              <div className="flex items-center justify-center flex-1"><Loader2 size={28} className="animate-spin text-[var(--accent)]" /></div>
            ) : (
              <div className="relative flex-1 min-h-0">
                <div ref={scrollLeftRef} onScroll={handleLeftScroll} className="h-full overflow-y-auto" style={{ background: 'oklch(0.96 0.008 258 / 0.4)' }}>
                  <div className="py-10 px-6">
                    <div className={`mx-auto rounded-[2px] ${isDualPane ? 'max-w-full' : 'max-w-[794px]'}`}
                      style={{ ...PAGE_SHADOW, ...PAGE_CARD }}>
                      <div ref={editorRef} contentEditable suppressContentEditableWarning onInput={handleInput} className="outline-none" />
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* ─── 右：审阅版（只读） ─── */}
          {isDualPane && (
            <div className="flex-1 min-w-0 flex flex-col border-l" style={{ borderColor: 'oklch(0.6 0.04 258 / 0.18)' }}>
              {/* 审阅版标题 + 内嵌标注图例 */}
              <div className="shrink-0" style={{ borderBottom: '1px solid oklch(0.6 0.04 258 / 0.12)' }}>
                <div className="flex items-center justify-between px-4 py-2 text-[10px]" style={{ color: 'var(--danger)' }}>
                  <span className="font-semibold inline-flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full" style={{ background: 'var(--danger)' }} />审阅版（只读）
                  </span>
                  <span className="text-[var(--muted-foreground)]">{reviewFileName}</span>
                </div>
                {reviewAnnotationCount > 0 && (
                  <div className="flex items-center gap-3 px-4 py-1.5 text-[9px] text-[var(--muted-foreground)]">
                    <span className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: 'color-mix(in oklch, #22c55e 30%, transparent)', borderBottom: '2px solid #22c55e' }} />新增</span>
                    <span className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: 'color-mix(in oklch, var(--danger) 20%, transparent)', textDecoration: 'line-through', textDecorationThickness: '1px' }} />删除</span>
                    <span className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: 'color-mix(in oklch, #f59e0b 25%, transparent)', borderBottom: '2px dashed #f59e0b' }} />批注</span>
                    <span className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: 'color-mix(in oklch, #fde047 35%, transparent)' }} />高亮</span>
                    <span className="font-semibold ml-auto">{reviewAnnotationCount} 处标注</span>
                  </div>
                )}
              </div>

              {/* 审阅版内容（只读） */}
              <div ref={scrollRightRef} onScroll={handleRightScroll} className="flex-1 overflow-y-auto" style={{ background: 'oklch(0.96 0.008 258 / 0.4)' }}>
                <div className="py-10 px-6">
                  <div className="mx-auto max-w-full rounded-[2px]" style={{ ...PAGE_SHADOW, ...PAGE_CARD }}>
                    <div ref={reviewRef}  />
                  </div>
                </div>
              </div>
            </div>
          )}

{/* ══════ 修改历史（右侧常驻） ══════ */}
          <div className="shrink-0 flex flex-col border-l" style={{ width: '260px', borderColor: 'oklch(0.6 0.04 258 / 0.18)', background: 'oklch(0.997 0.002 258 / 0.98)' }}>
            <div className="flex items-center gap-2 px-4 py-3" style={{ borderBottom: '1px solid oklch(0.6 0.04 258 / 0.12)' }}>
              <Clock size={12} className="text-[var(--muted-foreground)]" />
              <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--muted-foreground)]">修改历史</span>
              {scannedHistory.length > 0 && (
                <span className="text-[10px] font-semibold text-[var(--accent)]">{scannedHistory.length}</span>
              )}
            </div>
            <div className="flex-1 overflow-y-auto px-3 py-2 space-y-1.5">
              {scannedHistory.map((item, i) => (
                <div key={i} className="rounded-[8px] px-3 py-2.5 text-[11px] leading-5"
                  style={{ background: 'oklch(1 0 0 / 0.45)', boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.6)' }}>
                  {/* 修改前 */}
                  <div className="mb-1">
                    <span className="text-[9px] font-semibold" style={{ color: 'var(--danger)' }}>← 原文：</span>
                    <span className="text-[var(--muted-foreground)] line-through" style={{ textDecorationColor: 'var(--danger)' }}>{item.oldText.length > 80 ? item.oldText.slice(0, 80) + '…' : item.oldText}</span>
                  </div>
                  {/* 修改后 */}
                  <div className="mb-2">
                    <span className="text-[9px] font-semibold" style={{ color: '#16a34a' }}>→ 修改：</span>
                    <span className="text-[var(--foreground)]">{item.newText.length > 80 ? item.newText.slice(0, 80) + '…' : item.newText}</span>
                  </div>
                  {/* 撤销按钮 */}
                  <button type="button" onClick={() => revertSingleMod(item.el)}
                    className="flex items-center gap-1 text-[10px] font-medium rounded-[5px] px-2 py-0.5 hover:bg-[oklch(1_0_0_/_0.4)] transition-colors"
                    style={{ color: 'var(--danger)' }}>
                    <RotateCcw size={10} />撤销此修改
                  </button>
                </div>
              ))}
              {scannedHistory.length === 0 && (
                <div className="py-12 text-center text-[11px] text-[var(--muted-foreground)]/50">暂无修改记录</div>
              )}
            </div>
          </div>
        </div>

        {/* ══════ AI toolbar popup ══════ */}
        {aiPhase === 'toolbar' && toolbarPos && aiData && (
          <div className="fixed z-[650]" style={{ left: toolbarPos.x, top: toolbarPos.y, transform: 'translate(-50%, -100%)' }}>
            <div className="flex items-center gap-1.5 rounded-[16px] px-3 py-2"
              style={{ background: 'linear-gradient(170deg, oklch(1 0 0 / 0.97), oklch(0.99 0.003 258 / 0.78))', boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.9), 2px 3px 8px oklch(0.5 0.04 258 / 0.14), -1px -1px 3px oklch(1 0 0 / 0.8)' }}>
              <span className="text-[11px] text-[var(--muted-foreground)] px-1">已选中 {aiData.selectedText.length} 字</span>
              <span className="w-px h-4" style={{ background: 'oklch(0.6 0.04 258 / 0.2)' }} />
              <button type="button" onClick={openAiPanel} className="flex items-center gap-1.5 rounded-[10px] px-3 py-1.5 text-xs font-semibold transition-all duration-200 hover:scale-105 active:scale-[0.97]"
                style={{ background: 'color-mix(in oklch, var(--accent-soft) 55%, transparent)', color: 'var(--accent)', boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.5), 1px 2px 3px oklch(0.55 0.03 258 / 0.08)' }}>
                <Sparkles size={13} />AI 优化
              </button>
              <button type="button" onClick={dismissAi} className="ml-0.5 p-1.5 rounded-[10px] text-[var(--muted-foreground)]/50 hover:text-[var(--muted-foreground)] hover:bg-[oklch(1_0_0_/_0.4)] transition-colors"><X size={12} /></button>
            </div>
          </div>
        )}

        {/* ══════ AI Dialog ══════ */}
        {(aiPhase === 'panel' || aiPhase === 'diff') && aiData && (
          <div className="fixed inset-0 z-[700] flex items-end sm:items-center justify-center" onClick={dismissAi}
            style={{ background: 'oklch(0.1 0.02 258 / 0.4)', backdropFilter: 'blur(4px)' }}>
            <div className="w-full sm:w-[600px] max-h-[85vh] overflow-y-auto rounded-t-[28px] sm:rounded-[24px]"
              style={{ background: 'linear-gradient(170deg, oklch(1 0 0 / 0.96), oklch(0.99 0.003 258 / 0.72))', boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.9), 3px 4px 16px oklch(0.46 0.07 258 / 0.2), -3px -3px 10px oklch(1 0 0 / 0.92)' }}
              onClick={e => e.stopPropagation()}>
              <div className="flex items-center gap-3 px-6 pt-6 pb-4">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px]" style={ICON_BOX}><Sparkles size={15} className="text-[var(--accent)]" /></div>
                <div className="min-w-0 flex-1">
                  <div className="text-[0.9rem] font-semibold tracking-[-0.02em] text-[color:var(--foreground)]">{aiPhase === 'diff' ? '修改确认' : 'AI 辅助修改'}</div>
                  <div className="text-[11px] text-[var(--muted-foreground)] mt-0.5">{aiData.source === 'review' ? '审阅版 · ' : ''}选中 {aiData.selectedText.length} 字{aiData.suggesting ? ' · AI 正在分析建议…' : ''}</div>
                </div>
                <button type="button" onClick={dismissAi} className="neu-btn-soft !p-2 !rounded-[10px] shrink-0"><X size={15} /></button>
              </div>
              <div className="px-6 pb-6 space-y-4" style={{ background: 'oklch(0.975 0.012 258 / 0.32)', boxShadow: 'inset 2px 3px 8px oklch(0.5 0.04 258 / 0.1), inset -1px -1px 3px oklch(1 0 0 / 0.55)', borderTop: '1px solid oklch(0.6 0.04 258 / 0.1)' }}>
                {aiPhase === 'diff' && aiData.polishedText ? (<>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="rounded-[18px] px-4 py-3.5 text-sm leading-6" style={{ background: 'oklch(1 0 0 / 0.48)', boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.7), inset 2px 3px 6px oklch(0.55 0.03 258 / 0.1), inset -1px -1px 2px oklch(1 0 0 / 0.7)', whiteSpace: 'pre-wrap' }}>
                      <div className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--muted-foreground)] mb-2">原文</div>{aiData.selectedText}
                    </div>
                    <div className="rounded-[18px] px-4 py-3.5 text-sm leading-6" style={{ background: 'oklch(1 0 0 / 0.48)', boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.7), inset 2px 3px 6px oklch(0.55 0.03 258 / 0.1), inset -1px -1px 2px oklch(1 0 0 / 0.7)' }}>
                      <div className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--danger)] mb-2">修改后（红色=差异）</div>
                      <div contentEditable suppressContentEditableWarning key={editorVersion}
                        dangerouslySetInnerHTML={{ __html: (() => { const tk = (s: string) => { const t: string[] = []; let i = 0; while (i < s.length) { if (/[一-鿿]/.test(s[i])) { t.push(s[i]); i++; } else { let w = ''; while (i < s.length && !/[一-鿿]/.test(s[i])) { w += s[i]; i++; } t.push(w); } } return t; }; const ot = tk(aiData.selectedText), mt = tk(aiData.polishedText); const dp: number[][] = Array.from({ length: ot.length + 1 }, () => new Array(mt.length + 1).fill(0)); for (let y = 1; y <= ot.length; y++) for (let x = 1; x <= mt.length; x++) dp[y][x] = ot[y - 1] === mt[x - 1] ? dp[y - 1][x - 1] + 1 : Math.max(dp[y - 1][x], dp[y][x - 1]); const ops: Array<{ token: string; changed: boolean }> = []; let y = ot.length, x = mt.length; while (y > 0 || x > 0) { if (y > 0 && x > 0 && ot[y - 1] === mt[x - 1]) { ops.push({ token: mt[x - 1], changed: false }); y--; x--; } else if (x > 0 && (y === 0 || dp[y][x - 1] >= dp[y - 1][x])) { ops.push({ token: mt[x - 1], changed: true }); x--; } else { y--; } } ops.reverse(); let html = ''; for (const op of ops) { html += op.changed ? '<span style=\"color:var(--danger);background:color-mix(in oklch,var(--danger)_15%,transparent);border-radius:2px;padding:0 1px;font-weight:500\">' + (op.token === '\n' ? '<br>' : op.token.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\"/g, '&quot;')) + '</span>' : op.token === '\n' ? '<br>' : '<span>' + op.token.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\"/g, '&quot;') + '</span>'; } return html; })() }}
                        onInput={e => { const lines: string[] = []; e.currentTarget.childNodes.forEach(n => { if (n.nodeType === Node.TEXT_NODE) lines.push((n.textContent || '').replace(/ /g, ' ')); else if (n instanceof HTMLBRElement) lines.push(''); else if (n instanceof HTMLDivElement) lines.push((n.textContent || '').replace(/ /g, ' ').trim()); else lines.push((n.textContent || '').replace(/ /g, ' ')); }); setAiData(p => p ? { ...p, polishedText: lines.filter((_, i) => i > 0 || lines[0] !== '').join('\n').trim() } : null); }}
                        className="w-full min-h-[80px] rounded-[10px] text-sm leading-6 outline-none px-1 py-0.5 whitespace-pre-wrap focus:bg-[rgba(107,149,240,0.06)]"
                        style={{ fontFamily: "'Songti SC','Noto Serif CJK SC',serif", fontSize: '0.875rem', lineHeight: '1.6rem', color: 'var(--foreground)' }} />
                    </div>
                  </div>
                  <div className="flex items-center gap-2.5 justify-end pt-1">
                    <button type="button" onClick={() => { setAiData(p => p ? { ...p, polishedText: null } : null); setAiPhase('panel'); }} className="neu-btn-soft h-9 text-xs px-4 gap-1.5"><RotateCcw size={12} />重新修改</button>
                    <button type="button" onClick={dismissAi} className="neu-btn-soft h-9 text-xs px-4">放弃</button>
                    <button type="button" onClick={confirmAiPolish} className="neu-btn-primary h-9 text-xs px-5 gap-1.5"><Check size={13} />确认应用</button>
                  </div>
                </>) : (<>
                  <div className="rounded-[18px] px-4 py-3.5 text-sm leading-6" style={{ background: 'oklch(1 0 0 / 0.48)', boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.7), inset 2px 3px 6px oklch(0.55 0.03 258 / 0.1), inset -1px -1px 2px oklch(1 0 0 / 0.7)', whiteSpace: 'pre-wrap' }}>{aiData.selectedText}</div>
                  <div className="relative">
                    <textarea value={aiData.instruction} onChange={e => setAiData(p => p ? { ...p, instruction: e.target.value } : null)}
                      placeholder={aiData.suggesting ? 'AI 正在分析文本…' : '描述修改方向… Enter 提交'}
                      className="w-full resize-none rounded-[18px] px-4 py-3.5 text-sm leading-6 outline-none text-[color:var(--foreground)] placeholder:text-[color:var(--muted-foreground)]/50"
                      style={{ background: 'oklch(1 0 0 / 0.48)', boxShadow: 'inset 2px 3px 6px oklch(0.55 0.03 258 / 0.12), inset -1px -1px 2px oklch(1 0 0 / 0.65)', border: '1px solid oklch(0.6 0.04 258 / 0.16)', minHeight: 88 }}
                      rows={3} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.metaKey && aiData.instruction.trim()) { e.preventDefault(); void handleAiPolish(); } }} />
                    {aiData.suggesting && (<div className="absolute right-4 top-4 flex items-center gap-1.5 text-[10px] text-[var(--muted-foreground)]"><Loader2 size={10} className="animate-spin" />分析中…</div>)}
                  </div>
                  <div className="flex items-center justify-end gap-2.5 pt-1">
                    <button type="button" onClick={dismissAi} className="neu-btn-soft h-9 text-xs px-4">取消</button>
                    <button type="button" onClick={() => void handleAiPolish()} disabled={aiData.busy || !aiData.instruction.trim()} className="neu-btn-primary h-9 text-xs px-5 gap-1.5">
                      {aiData.busy ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}AI 修改
                    </button>
                  </div>
                </>)}
              </div>
            </div>
          </div>
        )}

        {/* ══════ 修改历史弹窗（只读——不可删改）══════ */}
        {historyOpen && (
          <div className="fixed inset-0 z-[700] flex items-center justify-center" onClick={() => setHistoryOpen(false)}>
            <div className="absolute inset-0" style={{ background: 'oklch(0.975 0.012 258 / 0.6)', backdropFilter: 'blur(3px)' }} />
            <div className="relative z-10 mx-5 w-full max-w-[560px] max-h-[76vh] overflow-y-auto rounded-[22px] p-6"
              style={{ background: 'linear-gradient(170deg, oklch(1 0 0 / 0.97), oklch(0.99 0.003 258 / 0.72))', boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.9), 3px 4px 18px oklch(0.46 0.07 258 / 0.18), -3px -3px 10px oklch(1 0 0 / 0.94)' }}
              onClick={e => e.stopPropagation()}>
              <div className="flex items-start justify-between gap-3 mb-4">
                <div className="flex items-center gap-2.5">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[11px]"
                    style={{ background: 'color-mix(in oklch, var(--accent) 14%, transparent)', boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.6), 2px 2px 3px oklch(0.55 0.03 258 / 0.08)' }}>
                    <History size={17} className="text-[var(--accent)]" />
                  </div>
                  <div>
                    <div className="text-sm font-semibold tracking-[-0.02em] text-[color:var(--foreground)]">修改历史</div>
                    <div className="text-[11px] text-[color:var(--muted-foreground)]">每次保存并替换的完整记录 · 只读不可删改</div>
                  </div>
                </div>
                <button type="button" onClick={() => setHistoryOpen(false)} className="neu-btn-xs"><X size={16} /></button>
              </div>

              {historyLoading ? (
                <div className="flex flex-col items-center gap-3 py-12">
                  <Loader2 size={24} className="animate-spin text-[var(--accent)]" />
                  <span className="text-sm text-[color:var(--muted-foreground)]">正在加载修改历史…</span>
                </div>
              ) : historyItems.length === 0 ? (
                <div className="text-sm text-[color:var(--muted-foreground)] text-center py-10">暂无保存记录（首次保存后此处将显示历史）</div>
              ) : (
                <div className="space-y-2.5 mb-2">
                  {historyItems.map((v, i) => (
                    <div key={v.id} className="rounded-[12px] px-4 py-3"
                      style={{ background: 'oklch(1 0 0 / 0.48)', boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.5)' }}>
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-[6px] text-[9px] font-bold text-white tabular-nums"
                            style={{ background: 'linear-gradient(135deg, oklch(0.52 0.16 258), oklch(0.45 0.14 258))' }}>
                            {historyItems.length - i}
                          </span>
                          <span className="text-[13px] font-bold text-[color:var(--foreground)]">{v.operatorName}</span>
                        </div>
                        <span className="text-[11px] text-[color:var(--muted-foreground)] tabular-nums">
                          {new Date(v.createdAt).toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                      <p className="mt-2 rounded-[8px] px-3 py-2 text-[12px] leading-relaxed"
                        style={{ background: 'color-mix(in oklch, var(--accent) 4%, transparent)', color: 'var(--foreground)' }}>
                        {v.changeSummary || '内容已更新（早期版本未记录摘要）'}
                      </p>
                      <div className="mt-1.5 text-[10px] text-[color:var(--muted-foreground)]/60">
                        版本大小 {(v.fileSize / 1024).toFixed(0)} KB
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
