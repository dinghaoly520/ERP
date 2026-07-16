"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, Loader2, Pencil, RotateCcw, Save, Search, Sparkles, Undo2, X } from 'lucide-react';
import { toast } from 'sonner';

const API_BASE = '/api';

interface Para { index: number; text: string; html: string; style: 'heading' | 'body'; rawRange?: { from: number; to: number }; }
interface ModRecord { paraIdx: number; oldText: string; newText: string; timestamp: number; }
interface Props { isOpen: boolean; projectId: string; attachmentId: string; attachmentName: string; onClose: () => void; onFileReplaced: () => Promise<void>; }

function paraTitle(p: Para): string { const ln = p.text.split('\n')[0]?.trim() || ''; return ln.length > 36 ? ln.slice(0, 36) + '…' : ln; }
function escapeHtml(s: string): string { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

/** 构建带红色高亮标记的 HTML 字符串（仅 AI 面板 diff 视图使用）。 */
function renderDiffHtml(original: string, modified: string): string {
  const tk = (s: string) => { const t: string[] = []; let i = 0; while (i < s.length) { if (/[一-鿿]/.test(s[i])) { t.push(s[i]); i++; } else { let w = ''; while (i < s.length && !/[一-鿿]/.test(s[i])) { w += s[i]; i++; } t.push(w); } } return t; };
  const ot = tk(original), mt = tk(modified);
  const dp: number[][] = Array.from({ length: ot.length + 1 }, () => new Array(mt.length + 1).fill(0));
  for (let y = 1; y <= ot.length; y++) for (let x = 1; x <= mt.length; x++) dp[y][x] = ot[y - 1] === mt[x - 1] ? dp[y - 1][x - 1] + 1 : Math.max(dp[y - 1][x], dp[y][x - 1]);
  const ops: Array<{ token: string; changed: boolean }> = [];
  let y = ot.length, x = mt.length;
  while (y > 0 || x > 0) { if (y > 0 && x > 0 && ot[y - 1] === mt[x - 1]) { ops.push({ token: mt[x - 1], changed: false }); y--; x--; } else if (x > 0 && (y === 0 || dp[y][x - 1] >= dp[y - 1][x])) { ops.push({ token: mt[x - 1], changed: true }); x--; } else { y--; } }
  ops.reverse();
  let html = '';
  for (const op of ops) {
    const isNewline = op.token === '\n';
    const esc = isNewline ? '' : escapeHtml(op.token);
    const inner = isNewline ? '<br>' : esc;
    html += op.changed
      ? `<span style="color:var(--danger);background:color-mix(in oklch,var(--danger)_15%,transparent);border-radius:2px;padding:0 1px;font-weight:500">${inner}</span>`
      : `<span>${inner}</span>`;
  }
  return html;
}

const iconBox = { background: 'color-mix(in oklch, var(--accent-soft) 45%, transparent)', boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.65), 2px 2px 4px oklch(0.55 0.03 258 / 0.1)' };

export function TenderFileEditorModal({ isOpen, projectId, attachmentId, attachmentName, onClose, onFileReplaced }: Props) {
  const [paragraphs, setParagraphs] = useState<Para[]>([]);
  const [loading, setLoading]         = useState(false);
  const [saving, setSaving]           = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [modLog, setModLog]           = useState<ModRecord[]>([]);
  const [navCollapsed, setNavCollapsed] = useState(false);
  const [historyCollapsed, setHistoryCollapsed] = useState(false);

  type AiPhase = 'idle' | 'toolbar' | 'panel' | 'diff';
  const [aiPhase, setAiPhase] = useState<AiPhase>('idle');
  const [aiData, setAiData] = useState<{ paraIdx: number; startPos: number; endPos: number; selectedText: string; instruction: string; busy: boolean; polishedText: string | null; suggesting: boolean } | null>(null);

  const blockRefs            = useRef<Map<number, HTMLDivElement>>(new Map());
  const ceRefs               = useRef<Map<number, HTMLDivElement>>(new Map());
  const htmlSetRef           = useRef<Set<number>>(new Set());
  const originalTextsRef     = useRef<Map<number, string>>(new Map());
  const originalHtmlsRef     = useRef<Map<number, string>>(new Map()); // 原始 Word 格式 HTML，撤销时恢复
  const dirtyRef             = useRef<Set<number>>(new Set());
  const [activeNavIdx, setActiveNavIdx] = useState(0);

  /* ── Load ── */
  useEffect(() => {
    if (!isOpen || !attachmentId) return;
    setLoading(true);
    htmlSetRef.current.clear();
    dirtyRef.current.clear();
    fetch(`${API_BASE}/project-management/${projectId}/attachment-paragraphs/${attachmentId}`, { credentials: 'include' })
      .then(r => {
        if (!r.ok) {
          return r.text().then(body => {
            let detail = `HTTP ${r.status}`;
            try { const j = JSON.parse(body); if (j.message) detail = j.message; } catch {}
            throw new Error(`加载失败（${detail}）`);
          });
        }
        return r.json() as Promise<{ fileName: string; paragraphs: Para[] }>;
      })
      .then(d => {
        setParagraphs(d.paragraphs);
        setModLog([]);
        setAiPhase('idle');
        d.paragraphs.forEach(p => {
          originalTextsRef.current.set(p.index, p.text);
          originalHtmlsRef.current.set(p.index, p.html);
        });
      })
      .catch(e => toast.error(e instanceof Error ? e.message : '加载失败'))
      .finally(() => setLoading(false));
  }, [isOpen, projectId, attachmentId]);

  /* ── Nav ── */
  useEffect(() => {
    if (paragraphs.length === 0) return;
    const obs = new IntersectionObserver(entries => { for (const e of entries) if (e.isIntersecting) { setActiveNavIdx(parseInt(e.target.getAttribute('data-para-idx') || '0', 10)); break; } }, { rootMargin: '-15% 0px -70% 0px' });
    blockRefs.current.forEach(el => obs.observe(el));
    return () => obs.disconnect();
  }, [paragraphs]);

  /* ── 编辑 ── */
  const handleEditableInput = useCallback((paraIdx: number, el: HTMLDivElement) => {
    dirtyRef.current.add(paraIdx);
  }, []);

  const handleParagraphBlur = useCallback((paraIdx: number, el: HTMLDivElement) => {
    if (!dirtyRef.current.has(paraIdx)) return;
    dirtyRef.current.delete(paraIdx);
    const text = (el.textContent || '').replace(/ /g, ' ').trim();
    const originalText = originalTextsRef.current.get(paraIdx) ?? '';

    if (text === originalText) {
      setModLog(ml => ml.filter(r => r.paraIdx !== paraIdx));
      setParagraphs(prev => prev.map(p => {
        if (p.index !== paraIdx) return p;
        const origHtml = originalHtmlsRef.current.get(paraIdx) ?? p.html;
        return { ...p, text: originalText, html: origHtml };
      }));
      return;
    }

    // 构建新 HTML（丢失 Word 原始格式，但保证文字不错乱）
    const newHtml = text ? `<div>${escapeHtml(text).replace(/\n/g, '<br>')}</div>` : '';

    setModLog(ml => {
      const existing = ml.find(r => r.paraIdx === paraIdx);
      if (existing) return ml.map(r => r.paraIdx === paraIdx ? { ...r, newText: text, timestamp: Date.now() } : r);
      return [...ml, { paraIdx, oldText: originalText, newText: text, timestamp: Date.now() }];
    });
    setParagraphs(prev => prev.map(p => (p.index === paraIdx ? { ...p, text, html: newHtml } : p)));
  }, []);

  const modifiedSet = useMemo(() => new Set(modLog.map(r => r.paraIdx)), [modLog]);

  /* ── 撤销 ── */
  const undoMod = useCallback((rec: ModRecord) => {
    setModLog(prev => prev.filter(r => r !== rec));
    const originalText = originalTextsRef.current.get(rec.paraIdx) ?? rec.oldText;
    const originalHtml = originalHtmlsRef.current.get(rec.paraIdx) ?? `<div>${escapeHtml(originalText).replace(/\n/g, '<br>')}</div>`;
    setParagraphs(prev => prev.map(p => (p.index === rec.paraIdx ? { ...p, text: originalText, html: originalHtml } : p)));
    // 还原 DOM 为原始 Word 格式 HTML
    const el = ceRefs.current.get(rec.paraIdx);
    if (el) el.innerHTML = originalHtml;
    dirtyRef.current.delete(rec.paraIdx);
  }, []);

  const undoAll = useCallback(() => {
    for (const [idx, origHtml] of originalHtmlsRef.current) {
      const origText = originalTextsRef.current.get(idx) ?? '';
      setParagraphs(prev => prev.map(p => (p.index === idx ? { ...p, text: origText, html: origHtml } : p)));
      const el = ceRefs.current.get(idx);
      if (el) el.innerHTML = origHtml;
    }
    dirtyRef.current.clear();
    setModLog([]);
    toast.success('已撤销全部修改');
  }, []);

  /* ── Search ── */
  const displayParagraphs = useMemo(() => searchQuery.trim() ? paragraphs.filter(p => p.text.toLowerCase().includes(searchQuery.toLowerCase())) : paragraphs, [paragraphs, searchQuery]);
  const navGroups = useMemo(() => { const g: Array<{ title: string; paragraphs: Para[] }> = []; for (const p of paragraphs) { if (p.style === 'heading') g.push({ title: p.text, paragraphs: [p] }); else if (g.length > 0) g[g.length - 1].paragraphs.push(p); else g.push({ title: '', paragraphs: [p] }); } return g; }, [paragraphs]);
  const scrollToPara = (idx: number) => { blockRefs.current.get(idx)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); };

  /* ── Save ── */
  const handleSave = useCallback(async () => {
    // 收集所有脏段落和 modLog 中已提交的段落
    const dirtySet = new Set([...modLog.map(r => r.paraIdx), ...dirtyRef.current]);

    if (dirtySet.size === 0) { toast.warning('没有检测到任何修改内容'); return; }

    // 构建 payload：从 DOM 读脏段落的实时内容，从 state 读已提交的
    const payload: Array<{ index: number; text: string; rawRange?: { from: number; to: number } }> = [];

    for (const idx of dirtySet) {
      const para = paragraphs.find(p => p.index === idx);
      if (!para) continue;

      let text: string;
      const el = ceRefs.current.get(idx);
      if (el && dirtyRef.current.has(idx)) {
        // 仍在编辑中 → 从 DOM 读
        text = (el.textContent || '').replace(/ /g, ' ').trim();
      } else {
        text = para.text;
      }

      const origText = originalTextsRef.current.get(idx) ?? '';
      if (text === origText) continue;

      payload.push({ index: idx, text, rawRange: para.rawRange });
    }

    if (payload.length === 0) { toast.warning('没有检测到任何修改内容'); return; }

    setSaving(true);
    try {
      const r = await fetch(`${API_BASE}/project-management/${projectId}/save-paragraphs`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ attachmentId, paragraphs: payload }),
      });
      if (!r.ok) {
        let msg = `保存失败（${r.status}）`;
        try { msg = (await r.json()).message || msg; } catch {}
        throw new Error(msg);
      }
      toast.success('已保存并替换文件');
      await onFileReplaced();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '保存失败');
    } finally {
      setSaving(false);
    }
  }, [projectId, attachmentId, paragraphs, modLog, onFileReplaced, onClose]);

  /* ── Keyboard ── */
  useEffect(() => { if (!isOpen) return; const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') { if (aiPhase !== 'idle') dismissAi(); else onClose(); }
    if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); void handleSave(); }
    if ((e.metaKey || e.ctrlKey) && e.key === 'f') { e.preventDefault(); document.getElementById('tfe-search')?.focus(); }
  }; document.addEventListener('keydown', onKey); return () => document.removeEventListener('keydown', onKey); }, [isOpen, aiPhase, handleSave]);

  /* ── AI ── */
  const [editorVersion, setEditorVersion] = useState(0);
  const savedRangeRef = useRef<Range | null>(null);
  const [toolbarPos, setToolbarPos] = useState<{x:number;y:number}|null>(null);

  const dismissAi = useCallback(() => { setAiPhase('idle'); setAiData(null); setToolbarPos(null); }, []);

  useEffect(() => {
    if (!isOpen) return;
    const onSelect = () => {
      if (aiPhase === 'panel' || aiPhase === 'diff') return;
      const sel = window.getSelection(); if (!sel || sel.isCollapsed) { if (aiPhase === 'toolbar') dismissAi(); return; }
      const txt = sel.toString().trim(); if (txt.length < 2) return;
      if (sel.rangeCount > 0) { const r = sel.getRangeAt(0); savedRangeRef.current = r.cloneRange(); setToolbarPos({ x: r.getBoundingClientRect().left + r.getBoundingClientRect().width / 2, y: r.getBoundingClientRect().top - 8 }); }
      let el: HTMLElement | null = sel.anchorNode instanceof HTMLElement ? sel.anchorNode : sel.anchorNode?.parentElement || null;
      while (el && !el.getAttribute('data-para-idx')) el = el.parentElement; if (!el) return;
      const paraIdx = parseInt(el.getAttribute('data-para-idx') || '', 10); if (isNaN(paraIdx)) return;
      const range = sel.getRangeAt(0); const preRange = document.createRange(); preRange.selectNodeContents(el); preRange.setEnd(range.startContainer, range.startOffset);
      setAiData({ paraIdx, startPos: preRange.toString().length, endPos: preRange.toString().length + range.toString().length, selectedText: txt, instruction: '', busy: false, polishedText: null, suggesting: false });
      setAiPhase('toolbar');
    };
    document.addEventListener('mouseup', onSelect); document.addEventListener('keyup', onSelect);
    return () => { document.removeEventListener('mouseup', onSelect); document.removeEventListener('keyup', onSelect); };
  }, [isOpen, aiPhase, dismissAi]);

  const openAiPanel = useCallback(() => {
    if (!aiData) return; setAiPhase('panel'); setAiData(p => p ? { ...p, suggesting: true } : null);
    const para = paragraphs.find(p => p.index === aiData.paraIdx);
    const contextText = para ? para.text.substring(0, 1000) : '';
    fetch(`${API_BASE}/project-management/${projectId}/attachment-ai-polish`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: aiData.selectedText, instruction:
        `所选文字位于如下段落的上下文中：\n「${contextText}」\n\n` +
        `请基于以上上下文分析所选文字，给出一个简洁的修改方向建议（不超过30字）。` +
        `不要只关注标点格式——着重分析：语义表达是否清晰准确、用词是否正式恰当、信息是否完整、` +
        `逻辑是否连贯、是否与采购文件（招标/谈判/询比）的专业风格一致、有无冗余或遗漏。` +
        `直接输出建议，不要任何解释性文字。`,
      }) })
      .then(r => r.ok ? r.json() : Promise.reject()).then((d: { polished: string }) => setAiData(p => p ? { ...p, instruction: (d.polished || '').replace(/^建议[：:]\s*/, '').trim(), suggesting: false } : null)).catch(() => setAiData(p => p ? { ...p, suggesting: false } : null));
  }, [aiData, projectId, paragraphs]);

  const handleAiPolish = useCallback(async () => {
    if (!aiData || aiData.busy) return; setAiData(p => p ? { ...p, busy: true } : null);
    try { const r = await fetch(`${API_BASE}/project-management/${projectId}/attachment-ai-polish`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: aiData.selectedText, instruction: aiData.instruction || '优化文字表述' }) }); if (!r.ok) throw new Error('AI 修改失败'); const result = await r.json() as { polished: string }; setAiData(p => p ? { ...p, busy: false, polishedText: result.polished } : null); setEditorVersion(v => v + 1); setAiPhase('diff'); } catch (e) { toast.error(e instanceof Error ? e.message : 'AI 修改失败'); setAiData(p => p ? { ...p, busy: false } : null); }
  }, [aiData, projectId]);

  const confirmAiPolish = useCallback(() => {
    if (!aiData?.polishedText) return;
    const { paraIdx, startPos, endPos, polishedText } = aiData;
    const para = paragraphs[paraIdx]; if (!para) return;
    const newText = para.text.slice(0, startPos) + polishedText + para.text.slice(endPos);

    // 替换选中内容为红色高亮 span
    const el = ceRefs.current.get(paraIdx); if (!el) return;
    const range = savedRangeRef.current;
    if (range) {
      range.deleteContents();
      const highlightHtml = escapeHtml(polishedText).replace(/\n/g, '<br>');
      const span = document.createElement('span');
      Object.assign(span.style, {
        background: 'color-mix(in oklch, var(--danger) 20%, transparent)',
        borderRadius: '2px', padding: '0 1px',
        textDecoration: 'underline', textDecorationColor: 'var(--danger)', textUnderlineOffset: '3px',
      });
      span.style.fontFamily = "'Songti SC','Noto Serif CJK SC','SimSun',serif";
      span.style.fontSize = para.style === 'heading' ? '1.25rem' : '0.9375rem';
      span.style.lineHeight = '2rem';
      span.innerHTML = highlightHtml;
      range.insertNode(span);
      savedRangeRef.current = null;
    }

    dirtyRef.current.add(paraIdx);
    setModLog(ml => [...ml, { paraIdx, oldText: para.text, newText, timestamp: Date.now() }]);
    setParagraphs(prev => prev.map(p => (p.index === paraIdx ? { ...p, text: newText } : p)));
    dismissAi();
  }, [aiData, paragraphs, dismissAi]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[600] flex flex-col">
      <div className="absolute inset-0" style={{ background: 'oklch(0.975 0.012 258 / 0.72)', backdropFilter: 'blur(5px)' }} onClick={onClose} />
      <div className="relative z-10 mx-5 my-5 flex flex-1 flex-col overflow-hidden rounded-[28px]" style={{ background: 'linear-gradient(170deg, oklch(1 0 0 / 0.94), oklch(0.988 0.005 258 / 0.62))', boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.88), 3px 4px 16px oklch(0.46 0.07 258 / 0.18), -3px -3px 10px oklch(1 0 0 / 0.94)' }}>

        {/* ══════ Header ══════ */}
        <div className="flex shrink-0 items-center justify-between gap-3 px-6 py-4" style={{ background: 'linear-gradient(105deg, oklch(1 0 0 / 0.92) 0%, oklch(0.975 0.006 258 / 0.58) 60%)', borderBottom: '1px solid oklch(0.6 0.04 258 / 0.14)' }}>
          <div className="flex items-center gap-3 min-w-0"><div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[11px]" style={iconBox}><Pencil size={17} className="text-[var(--accent)]" /></div><div className="min-w-0"><div className="text-[0.92rem] font-semibold tracking-[-0.02em] text-[var(--foreground)] truncate">采购文件修改</div><div className="mt-0.5 text-[11px] text-[var(--muted-foreground)] truncate">{attachmentName}</div></div></div>
          <div className="flex items-center gap-2">
            <div className="relative"><Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)]" /><input id="tfe-search" type="text" value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder={`查找… ${paragraphs.length} 段`} className="w-40 rounded-[10px] border border-[oklch(0.6_0.04_258_/_0.2)] bg-[oklch(1_0_0_/_0.5)] py-1.5 pl-8 pr-3 text-xs outline-none transition focus:border-[rgba(107,149,240,0.34)]" />{searchQuery && <button type="button" onClick={() => setSearchQuery('')} className="absolute right-2 top-1/2 -translate-y-1/2"><X size={11} className="text-[var(--muted-foreground)]" /></button>}</div>
            <span className="text-[10px] text-[var(--muted-foreground)] hidden sm:inline">{displayParagraphs.length}/{paragraphs.length} 段</span>
            <button type="button" onClick={() => void handleSave()} disabled={saving || loading} className="neu-btn-soft gap-1.5 h-8 text-xs">{saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}{saving ? '保存中…' : '保存并替换'}</button>
            <button type="button" onClick={onClose} className="neu-btn-soft !p-2"><X size={16} /></button>
          </div>
        </div>

        {/* ══════ Body: Nav + Center + History ══════ */}
        <div className="flex-1 min-h-0 flex" style={{ background: 'oklch(0.975 0.012 258 / 0.32)', boxShadow: 'inset 2px 3px 8px oklch(0.5 0.04 258 / 0.1), inset -1px -1px 3px oklch(1 0 0 / 0.55)' }}>

          {/* Left Nav */}
          {!navCollapsed ? (
            <div className="w-[190px] shrink-0 border-r overflow-y-auto" style={{ borderColor: 'oklch(0.6 0.04 258 / 0.12)' }}>
              <div className="px-3 py-4">
                <div className="flex items-center justify-between mb-3 px-2"><span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--muted-foreground)]">文档大纲</span><button type="button" onClick={() => setNavCollapsed(true)} className="text-[var(--muted-foreground)]/50 hover:text-[var(--muted-foreground)]"><X size={12} /></button></div>
                {navGroups.map((group, gi) => (<div key={gi} className="mb-2">{group.title && <div className="text-[10px] font-semibold text-[var(--muted-foreground)]/60 tracking-[0.06em] px-2 py-1 truncate">{group.title}</div>}{group.paragraphs.map(p => (<button key={p.index} type="button" onClick={() => scrollToPara(p.index)} className={`w-full text-left px-2.5 py-1.5 rounded-[7px] text-xs leading-5 truncate block ${activeNavIdx === p.index ? 'font-semibold text-[color:var(--accent)]' : 'text-[color:var(--muted-foreground)]'}`} style={activeNavIdx === p.index ? { background: 'color-mix(in oklch, var(--accent-soft) 25%, transparent)' } : {}}><span className="flex items-center gap-1.5">{modifiedSet.has(p.index) ? <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: 'var(--danger)' }} /> : <span className="w-1.5 shrink-0" />}<span className="truncate">{paraTitle(p)}</span></span></button>))}</div>))}
              </div>
            </div>
          ) : (<button type="button" onClick={() => setNavCollapsed(false)} className="shrink-0 w-8 flex items-start justify-center pt-4 border-r text-[var(--muted-foreground)]/40 hover:text-[var(--accent)] transition-colors" style={{ borderColor: 'oklch(0.6 0.04 258 / 0.12)' }}><span className="text-[9px] font-semibold tracking-[0.15em] [writing-mode:vertical-rl]">大纲</span></button>)}

          {/* Center — 所有段落始终 contentEditable */}
          <div className="flex-1 min-w-0 overflow-y-auto">
            {loading ? (<div className="flex items-center justify-center py-32"><Loader2 size={28} className="animate-spin text-[var(--accent)]" /></div>)
            : displayParagraphs.length === 0 ? (<div className="flex flex-col items-center justify-center py-32 gap-3 text-sm text-[var(--muted-foreground)]"><Search size={32} className="opacity-30" />未找到匹配「{searchQuery}」的内容</div>)
            : (<div className="max-w-[720px] mx-auto py-10">
                <div className="rounded-[24px] px-10 py-12" style={{ background: 'oklch(0.992 0.003 258 / 0.95)', boxShadow: '0 1px 3px oklch(0.55 0.03 258 / 0.06), 0 6px 20px oklch(0.5 0.04 258 / 0.07), 0 12px 40px oklch(0.45 0.06 258 / 0.05)', minHeight: '60vh' }}>
                  {displayParagraphs.map((para, displayIdx) => {
                    const isModified = modifiedSet.has(para.index);
                    return (
                    <div key={para.index}>
                      <div ref={el => { if (el) blockRefs.current.set(para.index, el); else blockRefs.current.delete(para.index); }} data-para-idx={para.index} className={`group relative ${displayIdx > 0 ? 'mt-8' : ''}`}>

                        {/* 左边条：已修改=红色始终可见，未修改=hover 时才可见蓝色 */}
                        <div
                          className={`absolute -left-8 top-0 bottom-0 w-1 rounded-full transition-opacity ${isModified ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
                          style={{ background: isModified ? 'var(--danger)' : 'var(--accent)' }}
                        />

                        {/* 段落主体：始终 contentEditable */}
                        <div
                          contentEditable suppressContentEditableWarning
                          ref={el => {
                            if (el) {
                              ceRefs.current.set(para.index, el);
                              if (!htmlSetRef.current.has(para.index)) {
                                el.innerHTML = para.html;
                                htmlSetRef.current.add(para.index);
                              }
                            } else {
                              // React 卸载此节点 → 清除标记，下次挂载时重新填入内容
                              htmlSetRef.current.delete(para.index);
                              ceRefs.current.delete(para.index);
                            }
                          }}
                          data-para-idx={para.index}
                          onInput={e => handleEditableInput(para.index, e.currentTarget)}
                          onBlur={e => handleParagraphBlur(para.index, e.currentTarget)}
                          className={`outline-none rounded-[6px] px-2 py-1 leading-8 transition-colors duration-200 ${para.style === 'heading' ? 'text-xl font-bold' : 'text-[15px]'} text-[color:var(--foreground)]`}
                          style={{
                            fontFamily: "'Songti SC','Noto Serif CJK SC','SimSun',serif",
                            ...(isModified ? {
                              background: 'color-mix(in oklch, var(--danger) 6%, transparent)',
                              borderLeft: '3px solid var(--danger)',
                              borderTopLeftRadius: '0',
                              borderBottomLeftRadius: '0',
                            } : {
                              background: 'transparent',
                              borderLeft: '3px solid transparent',
                            }),
                          }}
                        />

                        {/* 段落底部状态栏 */}
                        <div className={`flex items-center gap-2 mt-1.5 transition-opacity ${isModified || dirtyRef.current.has(para.index) ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
                          {isModified && (
                            <>
                              <span className="text-[10px] font-semibold inline-flex items-center gap-1" style={{ color: 'var(--danger)' }}><span className="w-1 h-1 rounded-full" style={{ background: 'var(--danger)' }} />已修改</span>
                              <button type="button" onClick={() => {
                                const rec = [...modLog].reverse().find(r => r.paraIdx === para.index);
                                if (rec) undoMod(rec);
                              }} className="text-[10px] font-medium inline-flex items-center gap-0.5 rounded-[5px] px-1.5 py-0.5 transition-colors" style={{ color: 'var(--danger)' }}><Undo2 size={9} />撤销</button>
                            </>
                          )}
                          <span className="text-[9px] text-[var(--muted-foreground)]/40">{para.text.length} 字</span>
                        </div>
                        {displayIdx < displayParagraphs.length - 1 && <div className="mt-8" style={{ borderTop: '1px solid oklch(0.6 0.04 258 / 0.08)' }} />}
                      </div>
                    </div>
                    );
                  })}
                </div>
              </div>)}

            {/* AI toolbar popup */}
            {aiPhase === 'toolbar' && toolbarPos && aiData && (
              <div className="fixed z-[650]" style={{ left: toolbarPos.x, top: toolbarPos.y, transform: 'translate(-50%, -100%)' }}>
                <div className="flex items-center gap-1.5 rounded-[16px] px-3 py-2"
                  style={{
                    background: 'linear-gradient(170deg, oklch(1 0 0 / 0.97), oklch(0.99 0.003 258 / 0.78))',
                    boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.9), 2px 3px 8px oklch(0.5 0.04 258 / 0.14), -1px -1px 3px oklch(1 0 0 / 0.8)',
                  }}>
                  <span className="text-[11px] text-[var(--muted-foreground)] px-1">已选中 {aiData.selectedText.length} 字</span>
                  <span className="w-px h-4" style={{ background: 'oklch(0.6 0.04 258 / 0.2)' }} />
                  <button type="button" onClick={openAiPanel}
                    className="flex items-center gap-1.5 rounded-[10px] px-3 py-1.5 text-xs font-semibold transition-all duration-200 hover:scale-105 active:scale-[0.97]"
                    style={{
                      background: 'color-mix(in oklch, var(--accent-soft) 55%, transparent)',
                      color: 'var(--accent)',
                      boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.5), 1px 2px 3px oklch(0.55 0.03 258 / 0.08)',
                    }}>
                    <Sparkles size={13} />AI 优化
                  </button>
                  <button type="button" onClick={dismissAi} className="ml-0.5 p-1.5 rounded-[10px] text-[var(--muted-foreground)]/50 hover:text-[var(--muted-foreground)] hover:bg-[oklch(1_0_0_/_0.4)] transition-colors"><X size={12} /></button>
                </div>
              </div>
            )}
          </div>

          {/* Right History */}
          {!historyCollapsed ? (
            <div className="w-[220px] shrink-0 border-l overflow-y-auto" style={{ borderColor: 'oklch(0.6 0.04 258 / 0.12)' }}>
              <div className="px-3 py-4">
                <div className="flex items-center justify-between mb-3 px-2"><span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--muted-foreground)]">修改记录</span><div className="flex items-center gap-1.5">{modLog.length > 0 && <span className="text-[10px] font-semibold text-[var(--accent)]">{modLog.length}</span>}<button type="button" onClick={() => setHistoryCollapsed(true)} className="text-[var(--muted-foreground)]/50 hover:text-[var(--muted-foreground)]"><X size={12} /></button></div></div>
                {modLog.length > 0 ? (<div className="space-y-1.5"><button type="button" onClick={undoAll} className="w-full flex items-center justify-center gap-1.5 rounded-[8px] py-2 text-[11px] font-medium text-[var(--muted-foreground)] hover:text-[color:var(--danger)] transition-colors mb-2" style={{ background: 'oklch(1 0 0 / 0.3)' }}><RotateCcw size={11} />撤销全部修改</button>{[...modLog].reverse().map((rec, i) => (<div key={i} className="rounded-[10px] px-3 py-2.5 text-xs" style={{ background: 'oklch(1 0 0 / 0.4)', boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.6)' }}><button type="button" onClick={() => scrollToPara(rec.paraIdx)} className="block w-full text-left leading-5 text-[color:var(--foreground)] hover:text-[color:var(--accent)] transition-colors">段落 {rec.paraIdx + 1}<span className="block text-[10px] text-[var(--muted-foreground)] mt-0.5">{new Date(rec.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span></button><button type="button" onClick={() => undoMod(rec)} className="mt-1.5 flex items-center gap-1 text-[10px] text-[var(--muted-foreground)] hover:text-[color:var(--danger)] transition-colors"><Undo2 size={10} />撤销</button></div>))}</div>) : (<div className="px-2 py-8 text-center text-[11px] leading-5 text-[var(--muted-foreground)]">尚未修改<br />选中文字后可 AI 优化</div>)}
              </div>
            </div>
          ) : (<button type="button" onClick={() => setHistoryCollapsed(false)} className="shrink-0 w-8 flex items-start justify-center pt-4 border-l text-[var(--muted-foreground)]/40 hover:text-[var(--accent)] transition-colors" style={{ borderColor: 'oklch(0.6 0.04 258 / 0.12)' }}><span className="text-[9px] font-semibold tracking-[0.15em] [writing-mode:vertical-rl]">记录</span></button>)}
        </div>

        {/* ══════ AI Dialog ══════ */}
        {(aiPhase === 'panel' || aiPhase === 'diff') && aiData && (
          <div className="fixed inset-0 z-[700] flex items-end sm:items-center justify-center" onClick={dismissAi}
            style={{ background: 'oklch(0.1 0.02 258 / 0.4)', backdropFilter: 'blur(4px)' }}>
            <div className="w-full sm:w-[600px] max-h-[85vh] overflow-y-auto rounded-t-[28px] sm:rounded-[24px]"
              style={{
                background: 'linear-gradient(170deg, oklch(1 0 0 / 0.96), oklch(0.99 0.003 258 / 0.72))',
                boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.9), 3px 4px 16px oklch(0.46 0.07 258 / 0.2), -3px -3px 10px oklch(1 0 0 / 0.92)',
              }}
              onClick={e => e.stopPropagation()}>
              <div className="flex items-center gap-3 px-6 pt-6 pb-4">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px]" style={iconBox}>
                  <Sparkles size={15} className="text-[var(--accent)]" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-[0.9rem] font-semibold tracking-[-0.02em] text-[color:var(--foreground)]">
                    {aiPhase === 'diff' ? '修改确认' : 'AI 辅助修改'}
                  </div>
                  <div className="text-[11px] text-[var(--muted-foreground)] mt-0.5">
                    段落 {aiData.paraIdx + 1} · 选中 {aiData.selectedText.length} 字{aiData.suggesting ? ' · AI 正在分析建议…' : ''}
                  </div>
                </div>
                <button type="button" onClick={dismissAi} className="neu-btn-soft !p-2 !rounded-[10px] shrink-0"><X size={15} /></button>
              </div>

              <div className="px-6 pb-6 space-y-4"
                style={{
                  background: 'oklch(0.975 0.012 258 / 0.32)',
                  boxShadow: 'inset 2px 3px 8px oklch(0.5 0.04 258 / 0.1), inset -1px -1px 3px oklch(1 0 0 / 0.55)',
                  borderTop: '1px solid oklch(0.6 0.04 258 / 0.1)',
                }}>
                {aiPhase === 'diff' && aiData.polishedText ? (<>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="rounded-[18px] px-4 py-3.5 text-sm leading-6" style={{ background: 'oklch(1 0 0 / 0.48)', boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.7), inset 2px 3px 6px oklch(0.55 0.03 258 / 0.1), inset -1px -1px 2px oklch(1 0 0 / 0.7)', whiteSpace: 'pre-wrap' }}>
                      <div className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--muted-foreground)] mb-2">原文</div>{aiData.selectedText}
                    </div>
                    <div className="rounded-[18px] px-4 py-3.5 text-sm leading-6" style={{ background: 'oklch(1 0 0 / 0.48)', boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.7), inset 2px 3px 6px oklch(0.55 0.03 258 / 0.1), inset -1px -1px 2px oklch(1 0 0 / 0.7)' }}>
                      <div className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--danger)] mb-2">修改后（红色=差异）</div>
                      <div contentEditable suppressContentEditableWarning key={editorVersion}
                        dangerouslySetInnerHTML={{ __html: renderDiffHtml(aiData.selectedText, aiData.polishedText) }}
                        onInput={e => {
                          const lines: string[] = [];
                          e.currentTarget.childNodes.forEach(n => {
                            if (n.nodeType === Node.TEXT_NODE) lines.push((n.textContent || '').replace(/ /g, ' '));
                            else if (n instanceof HTMLBRElement) lines.push('');
                            else if (n instanceof HTMLDivElement) lines.push((n.textContent || '').replace(/ /g, ' ').trim());
                            else lines.push((n.textContent || '').replace(/ /g, ' '));
                          });
                          setAiData(p => p ? { ...p, polishedText: lines.filter((_, i) => i > 0 || lines[0] !== '').join('\n').trim() } : null);
                        }}
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
                    <textarea value={aiData.instruction}
                      onChange={e => setAiData(p => p ? { ...p, instruction: e.target.value } : null)}
                      placeholder={aiData.suggesting ? 'AI 正在分析文本…' : '描述修改方向… Enter 提交'}
                      className="w-full resize-none rounded-[18px] px-4 py-3.5 text-sm leading-6 outline-none text-[color:var(--foreground)] placeholder:text-[color:var(--muted-foreground)]/50"
                      style={{
                        background: 'oklch(1 0 0 / 0.48)',
                        boxShadow: 'inset 2px 3px 6px oklch(0.55 0.03 258 / 0.12), inset -1px -1px 2px oklch(1 0 0 / 0.65)',
                        border: '1px solid oklch(0.6 0.04 258 / 0.16)',
                        minHeight: 88,
                      }}
                      rows={3}
                      onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.metaKey && aiData.instruction.trim()) { e.preventDefault(); void handleAiPolish(); } }} />
                    {aiData.suggesting && (<div className="absolute right-4 top-4 flex items-center gap-1.5 text-[10px] text-[var(--muted-foreground)]"><Loader2 size={10} className="animate-spin" />分析中…</div>)}
                  </div>
                  <div className="flex items-center justify-end gap-2.5 pt-1">
                    <button type="button" onClick={dismissAi} className="neu-btn-soft h-9 text-xs px-4">取消</button>
                    <button type="button" onClick={() => void handleAiPolish()} disabled={aiData.busy || !aiData.instruction.trim()} className="neu-btn-primary h-9 text-xs px-5 gap-1.5">{aiData.busy ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}AI 修改</button>
                  </div>
                </>)}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
