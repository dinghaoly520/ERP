'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { toast } from 'sonner';
import {
  Eraser, ExternalLink, Keyboard, Loader2, Maximize2, Minimize2,
  PenLine, Save, Trash2, Undo2,
} from 'lucide-react';
import { AtramentCanvas, type AtramentCanvasHandle } from './atrament-canvas';
import {
  createMemo, deleteMemo, getMemoInkUrl, listMemos,
} from '@/lib/api';
import type { ExpertMemo } from '@water-erp/shared';

interface MemoPanelProps {
  projectId: string;
  supplierId?: string;
  scoreItemId?: string;
  /** 得分点 id + 名称（得分点粒度备忘） */
  scorePointId?: string;
  scorePointName?: string;
  compact?: boolean;
  sourceDevice?: 'tablet' | 'desktop';
  defaultMode?: Mode;
}

type Mode = 'handwriting' | 'keyboard';

const COLORS = [
  { value: '#1e3a5f', label: '墨蓝' },
  { value: '#000000', label: '黑' },
  { value: '#e74c3c', label: '红' },
];
const WEIGHTS = [
  { value: 4, label: '细' },
  { value: 6, label: '中' },
  { value: 9, label: '粗' },
];

function memoDeviceLabel(sourceDevice: string): string {
  const [device, input] = sourceDevice.split('_');
  const dl = device === 'desktop' ? '桌面' : device === 'tablet' ? '平板' : device;
  const il = input === 'handwriting' ? '手写' : input === 'keyboard' ? '键盘' : input;
  return `${dl}·${il}`;
}

export function MemoPanel({
  projectId, supplierId, scorePointId, scorePointName,
  compact, sourceDevice = 'tablet', defaultMode,
}: MemoPanelProps) {
  const [mode, setMode] = useState<Mode>(defaultMode ?? (sourceDevice === 'desktop' ? 'keyboard' : 'handwriting'));
  const [text, setText] = useState('');
  const [memos, setMemos] = useState<ExpertMemo[]>([]);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [fullscreen, setFullscreen] = useState(false);
  const [currentColor, setCurrentColor] = useState('#1e3a5f');
  const [currentWeight, setCurrentWeight] = useState(6);
  const [eraseMode, setEraseMode] = useState(false);
  const canvasRef = useRef<AtramentCanvasHandle>(null);

  // 得分点粒度 reload
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const list = await listMemos(projectId, supplierId, scorePointId);
      setMemos(list);
    } catch (e) {
      const err = e as { message?: string };
      toast.error(err?.message || '加载备忘失败');
    } finally {
      setLoading(false);
    }
  }, [projectId, supplierId, scorePointId]);

  useEffect(() => { load(); }, [load]);

  const doSave = useCallback(async () => {
    if (saving) return;
    setSaving(true);
    try {
      if (mode === 'handwriting') {
        if (canvasRef.current?.isEmpty()) {
          toast.warning('请先在手写区书写内容');
          return;
        }
        const blob = await canvasRef.current?.toBlob();
        if (!blob) { toast.error('墨迹导出失败'); return; }
        await createMemo(projectId, {
          inkBlob: blob,
          sourceDevice: `${sourceDevice}_handwriting`,
          supplierId, scorePointId,
        });
        canvasRef.current?.clear();
      } else {
        const trimmed = text.trim();
        if (!trimmed) { toast.warning('请输入备忘内容'); return; }
        await createMemo(projectId, {
          contentText: trimmed,
          sourceDevice: `${sourceDevice}_keyboard`,
          supplierId, scorePointId,
        });
        setText('');
      }
      toast.success('备忘已保存');
      await load();
    } catch (e) {
      const err = e as { message?: string };
      toast.error(err?.message || '保存失败');
    } finally {
      setSaving(false);
    }
  }, [saving, mode, projectId, sourceDevice, supplierId, scorePointId, text, load]);

  const handleDelete = async (memoId: string) => {
    if (!confirm('确认删除该条备忘？')) return;
    try {
      await deleteMemo(projectId, memoId);
      setMemos(prev => prev.filter(m => m.id !== memoId));
      toast.success('已删除');
    } catch (e) { toast.error('删除失败'); }
  };

  const openInkUrl = async (memoId: string) => {
    try {
      const { url } = await getMemoInkUrl(projectId, memoId);
      window.open(url, '_blank', 'noopener');
    } catch (e) { toast.error('获取墨迹失败'); }
  };

  const padY = compact ? 'py-1.5' : 'py-2';

  const toolbar = (
    <div className="flex items-center gap-2">
      {/* 颜色 */}
      {COLORS.map(c => (
        <button
          key={c.value}
          type="button" title={c.label}
          onClick={() => { setCurrentColor(c.value); canvasRef.current?.setColor(c.value); }}
          className={`h-5 w-5 rounded-full border-2 transition ${
            currentColor === c.value ? 'border-[#064ea2] ring-1 ring-[#064ea2]/30' : 'border-[oklch(0.88_0.005_264)]'
          }`}
          style={{ backgroundColor: c.value }}
        />
      ))}
      <span className="w-px h-4 bg-[oklch(0.88_0.005_264)]" />
      {/* 线宽 */}
      {WEIGHTS.map(w => (
        <button
          key={w.value} type="button"
          onClick={() => { setCurrentWeight(w.value); canvasRef.current?.setWeight(w.value); }}
          className={`px-1.5 rounded text-[10px] font-semibold transition ${
            currentWeight === w.value ? 'bg-[#064ea2] text-white' : 'text-[oklch(0.55_0.01_264)] hover:bg-[oklch(0.97_0.005_264)]'
          }`}
        >
          {w.label}
        </button>
      ))}
      <span className="w-px h-4 bg-[oklch(0.88_0.005_264)]" />
      {/* 画笔/橡皮 */}
      <button
        type="button"
        onClick={() => { const next = !eraseMode; setEraseMode(next); canvasRef.current?.setMode(next ? 'erase' : 'draw'); }}
        className={`rounded px-1.5 ${padY} text-[10px] font-semibold transition ${
          eraseMode ? 'bg-amber-100 text-amber-700' : 'text-[oklch(0.55_0.01_264)] hover:bg-[oklch(0.97_0.005_264)]'
        }`}
      >
        <Eraser size={11} strokeWidth={1.7} />
      </button>
      {/* 撤销 */}
      <button
        type="button"
        onClick={() => canvasRef.current?.undo()}
        className="rounded px-1 py-0.5 text-[oklch(0.55_0.01_264)] hover:bg-[oklch(0.97_0.005_264)]"
        title="撤销上一笔"
      >
        <Undo2 size={12} strokeWidth={1.7} />
      </button>
    </div>
  );

  const fullscreenOverlay = fullscreen && mode === 'handwriting'
    ? createPortal(
      <div className="fixed inset-0 z-50 flex flex-col bg-white"
        style={{ WebkitUserSelect: 'none', userSelect: 'none', WebkitTouchCallout: 'none' }}
        onContextMenu={e => e.preventDefault()}
        onTouchStart={e => e.preventDefault()}>
        <div className="flex items-center justify-between px-4 py-2 border-b border-[oklch(0.91_0.006_264)]">
          <div className="flex items-center gap-2 text-sm font-bold text-[oklch(0.18_0.012_265)]">
            <PenLine size={14} strokeWidth={1.5} />
            全屏手写{scorePointName ? ` · ${scorePointName}` : ''}
          </div>
          <div className="flex items-center gap-2">
            {toolbar}
            <button
              type="button" onClick={() => setFullscreen(false)}
              className="flex items-center gap-1 rounded-lg border border-[oklch(0.91_0.006_264)] px-3 py-1.5 text-xs font-semibold text-[oklch(0.55_0.01_264)] hover:bg-[oklch(0.97_0.005_264)]"
            >
              <Minimize2 size={13} strokeWidth={1.7} /> 退出全屏
            </button>
          </div>
        </div>
        <AtramentCanvas ref={canvasRef} width={800} height={560} className="flex-1 rounded-none border-0" />
        <div className="flex items-center gap-2 px-4 py-2 border-t">
          <button type="button" onClick={() => { canvasRef.current?.clear(); }}
            className="rounded-lg border px-3 py-1.5 text-xs">清空</button>
          <button type="button" onClick={doSave} disabled={saving}
            className="flex flex-1 items-center justify-center gap-1 rounded-lg bg-[#064ea2] py-2 text-xs font-bold text-white">
            {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} strokeWidth={1.7} />}
            {saving ? '保存中…' : '保存手写'}
          </button>
        </div>
      </div>,
      document.body,
    )
    : null;

  return (
    <section className="flex h-full flex-col">
      {fullscreenOverlay}
      <div className="mb-3 flex items-center justify-between">
        <h3 className="flex items-center gap-1.5 text-sm font-bold text-[oklch(0.18_0.012_265)]">
          <PenLine size={14} strokeWidth={1.5} /> 专家备忘
          {scorePointName && <span className="text-[11px] font-normal text-[#064ea2]">· {scorePointName}</span>}
        </h3>
        <div className="flex items-center gap-1 rounded-lg border border-[oklch(0.91_0.006_264)] bg-white p-0.5">
          <button type="button" onClick={() => setMode('handwriting')} aria-pressed={mode === 'handwriting'}
            className={`flex items-center gap-1 rounded-md px-2 ${padY} text-xs font-semibold transition ${
              mode === 'handwriting' ? 'bg-[#064ea2] text-white' : 'text-[oklch(0.55_0.01_264)] hover:bg-[oklch(0.97_0.005_264)]'
            }`}>
            <PenLine size={12} strokeWidth={1.7} /> 手写
          </button>
          <button type="button" onClick={() => setMode('keyboard')} aria-pressed={mode === 'keyboard'}
            className={`flex items-center gap-1 rounded-md px-2 ${padY} text-xs font-semibold transition ${
              mode === 'keyboard' ? 'bg-[#064ea2] text-white' : 'text-[oklch(0.55_0.01_264)] hover:bg-[oklch(0.97_0.005_264)]'
            }`}>
            <Keyboard size={12} strokeWidth={1.7} /> 键盘
          </button>
        </div>
      </div>

      {/* 得分点空状态 */}
      {!scorePointId && !scorePointName && (
        <p className="mb-2 text-[11px] text-[oklch(0.62_0.008_264)] italic">
          点击左侧得分点开始手写备忘
        </p>
      )}

      <div className="flex min-h-0 flex-col">
        {mode === 'handwriting' ? (
          <div className="flex flex-col gap-2">
            {/* 工具栏 */}
            {toolbar}
            <div className="relative" style={{ WebkitUserSelect: 'none', userSelect: 'none' }}
              onContextMenu={e => e.preventDefault()}>
              <AtramentCanvas ref={canvasRef} height={compact ? 320 : 420} />
              <button type="button" onClick={() => setFullscreen(true)}
                className="absolute right-2 top-2 rounded-md bg-white/70 p-1 text-[oklch(0.45_0.01_264)] hover:bg-white hover:text-[#064ea2] transition"
                title="全屏手写">
                <Maximize2 size={14} strokeWidth={1.7} />
              </button>
            </div>
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => canvasRef.current?.clear()}
                className={`flex items-center gap-1 rounded-lg border border-[oklch(0.91_0.006_264)] ${padY} px-3 text-xs font-semibold text-[oklch(0.55_0.01_264)] hover:bg-[oklch(0.97_0.005_264)]`}>
                <Eraser size={12} strokeWidth={1.7} /> 清空
              </button>
              <button type="button" onClick={doSave} disabled={saving}
                className="flex flex-1 items-center justify-center gap-1 rounded-lg bg-[#064ea2] px-3 py-2 text-xs font-bold text-white hover:bg-[#054280] disabled:opacity-50">
                {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} strokeWidth={1.7} />}
                {saving ? '保存中…' : '保存手写'}
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <textarea
              value={text} onChange={e => setText(e.target.value)}
              rows={compact ? 5 : 7} placeholder="键入备忘内容…"
              className="w-full resize-none rounded-xl border border-[oklch(0.91_0.006_264)] px-3 py-2 text-sm focus:border-[#064ea2] focus:outline-none focus:ring-1 focus:ring-[#064ea2]"
            />
            <button type="button" onClick={doSave} disabled={saving}
              className="flex items-center justify-center gap-1 rounded-lg bg-[#064ea2] px-3 py-2 text-xs font-bold text-white hover:bg-[#054280] disabled:opacity-50">
              {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} strokeWidth={1.7} />}
              {saving ? '保存中…' : '保存文本'}
            </button>
          </div>
        )}
      </div>

      {/* 备忘列表 */}
      <div className="mt-3 max-h-[40%] flex-shrink-0 space-y-1.5 overflow-y-auto border-t border-[oklch(0.91_0.006_264)] pt-2">
        {loading ? (
          <p className="py-3 text-center text-xs text-[oklch(0.62_0.008_264)]">加载中…</p>
        ) : memos.length === 0 ? (
          <p className="py-3 text-center text-xs text-[oklch(0.62_0.008_264)]">暂无备忘</p>
        ) : (
          memos.map(m => (
            <div key={m.id} className="rounded-lg border border-[oklch(0.91_0.006_264)] bg-white px-2.5 py-1.5">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  {m.contentText ? (
                    <p className="line-clamp-2 break-words text-xs text-[oklch(0.18_0.012_265)]">{m.contentText}</p>
                  ) : m.inkFileId ? (
                    <button type="button" onClick={() => openInkUrl(m.id)}
                      className="inline-flex items-center gap-1 text-xs font-semibold text-[#064ea2] hover:underline">
                      <ExternalLink size={11} strokeWidth={1.7} /> 查看墨迹原图
                    </button>
                  ) : (
                    <span className="text-xs italic text-[oklch(0.62_0.008_264)]">（空备忘）</span>
                  )}
                  <div className="mt-0.5 text-[10px] text-[oklch(0.62_0.008_264)]">
                    {new Date(m.createdAt).toLocaleString('zh-CN')}
                    {m.sourceDevice && ` · ${memoDeviceLabel(m.sourceDevice)}`}
                  </div>
                </div>
                <button type="button" onClick={() => handleDelete(m.id)} aria-label="删除备忘"
                  className="shrink-0 rounded p-1 text-[oklch(0.62_0.008_264)] hover:bg-red-50 hover:text-red-500">
                  <Trash2 size={12} strokeWidth={1.7} />
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
