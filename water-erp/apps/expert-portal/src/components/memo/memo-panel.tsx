'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { toast } from 'sonner';
import {
  Eraser, ExternalLink, Keyboard, Loader2, Maximize2, Minimize2, ZoomIn, ZoomOut,
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
  { value: '#064ea2', label: '蓝' },
  { value: '#000000', label: '黑' },
  { value: '#e74c3c', label: '红' },
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
  const [currentColor, setCurrentColor] = useState('#000000');
  const [currentWeight, setCurrentWeight] = useState(6);
  const [eraseMode, setEraseMode] = useState(false);
  const [eraserSize, setEraserSize] = useState(3);
  const [zoomLevel, setZoomLevel] = useState(1);
  const inlineCanvasRef = useRef<AtramentCanvasHandle>(null);
  const fullscreenCanvasRef = useRef<AtramentCanvasHandle>(null);
  // 全屏切换时暂存 blob，在新 canvas mount 后恢复
  const pendingBlob = useRef<Blob | null>(null);

  // 获取当前活跃的画布（全屏/内嵌）
  const activeCanvas = () => fullscreen ? fullscreenCanvasRef.current : inlineCanvasRef.current;

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

  // 切换得分点时自动保存当前画布 → 清屏 → 新得分点备忘自动加载
  const prevPointRef = useRef(scorePointId);
  const isFirstPoint = useRef(true);
  useEffect(() => {
    if (isFirstPoint.current) { isFirstPoint.current = false; return; }
    const prev = prevPointRef.current;
    // 异步保存到旧得分点
    (async () => {
      const c = activeCanvas();
      if (mode !== 'handwriting' || !c?.isEmpty || c.isEmpty()) return;
      try {
        const blob = await c.toBlob();
        if (blob) {
          await createMemo(projectId, {
            inkBlob: blob,
            sourceDevice: `${sourceDevice}_handwriting`,
            supplierId,
            scorePointId: prev,
          });
        }
      } catch { /* auto-save silent */ }
      c.clear();
    })().catch(() => {});
    prevPointRef.current = scorePointId;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scorePointId]);

  // 全屏切换后恢复暂存 blob
  useEffect(() => {
    if (!pendingBlob.current) return;
    const blob = pendingBlob.current;
    pendingBlob.current = null;
    // 等新 canvas mount
    const timer = setTimeout(async () => {
      const target = fullscreen ? fullscreenCanvasRef.current : inlineCanvasRef.current;
      await target?.restoreBlob(blob);
    }, 50);
    return () => clearTimeout(timer);
  }, [fullscreen]);

  const enterFullscreen = async () => {
    const blob = await inlineCanvasRef.current?.toBlob();
    if (blob) pendingBlob.current = blob;
    inlineCanvasRef.current?.clear();
    setFullscreen(true);
  };

  const exitFullscreen = async () => {
    const blob = await fullscreenCanvasRef.current?.toBlob();
    if (blob) pendingBlob.current = blob;
    fullscreenCanvasRef.current?.clear();
    setFullscreen(false);
  };

  const doSave = useCallback(async () => {
    if (saving) return;
    setSaving(true);
    try {
      if (mode === 'handwriting') {
        const c = activeCanvas();
        if (c?.isEmpty()) {
          toast.warning('请先在手写区书写内容');
          return;
        }
        const blob = await c?.toBlob();
        if (!blob) { toast.error('墨迹导出失败'); return; }
        await createMemo(projectId, {
          inkBlob: blob,
          sourceDevice: `${sourceDevice}_handwriting`,
          supplierId, scorePointId,
        });
        c?.clear();
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

  // 新拟态按钮共享样式（tooltip/inline 型——无外凸阴影，仅 hover/active 反馈）
  const btnBase = `rounded-lg border border-[oklch(0.92_0.004_265)] bg-[oklch(0.98_0.003_265)] px-1.5 ${padY} text-[10px] font-semibold
    transition-all duration-150
    shadow-[0_1px_0_oklch(1_0_0),inset_0_1px_0_oklch(1_0_0)]
    hover:shadow-[0_2px_0_oklch(0.92_0.004_265),inset_0_1px_0_oklch(1_0_0)]
    active:shadow-[inset_0_1px_3px_oklch(0.55_0.03_258_/_.12),inset_0_-1px_0_oklch(1_0_0_/_.5)] active:translate-y-px`;

  const sliderCls = `h-1 cursor-pointer appearance-none rounded-full
    bg-[oklch(0.92_0.004_265)]
    [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3
    [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:cursor-pointer
    [&::-webkit-slider-thumb]:shadow-[0_1px_2px_oklch(0.55_0.03_258_/_.15),inset_0_1px_0_oklch(1_0_0_/_.7)]`;

  const toolbar = (
    <div className="flex items-center gap-1.5">
      {/* 颜色 */}
      {COLORS.map(c => (
        <button
          key={c.value}
          type="button" title={c.label}
          onClick={() => { setCurrentColor(c.value); activeCanvas()?.setColor(c.value); }}
          className={`size-[10px] rounded-full transition-all duration-150
            shadow-[0_1px_1.5px_oklch(0.55_0.03_258_/_.12),inset_0_1px_0_oklch(1_0_0_/_.5)]
            hover:scale-110
            ${currentColor === c.value
              ? 'ring-2 ring-[#064ea2] ring-offset-1 ring-offset-white scale-110 shadow-[0_1px_2px_oklch(0.55_0.03_258_/_.2),inset_0_1px_0_oklch(1_0_0_/_.6)]'
              : ''}`}
          style={{ backgroundColor: c.value }}
        />
      ))}
      <span className="w-px h-3.5 bg-[oklch(0.88_0.005_264)]" />
      {/* 线宽滑块 */}
      <input type="range" min={2} max={12} value={currentWeight}
        onChange={e => { const v=Number(e.target.value); setCurrentWeight(v); activeCanvas()?.setWeight(v); }}
        className={`w-16 ${sliderCls} [&::-webkit-slider-thumb]:bg-[#064ea2]`}
        title="笔触粗细"
      />
      <span className="inline-flex items-center justify-center w-5 h-5 shrink-0">
        <span className="rounded-full transition-all duration-100"
          style={{ backgroundColor: currentColor, width: Math.max(2, currentWeight / 2), height: Math.max(2, currentWeight / 2) }} />
      </span>
      <span className="text-[10px] font-mono tabular-nums text-[oklch(0.45_0.01_264)] w-4 text-right">{currentWeight}</span>
      <span className="w-px h-3.5 bg-[oklch(0.88_0.005_264)]" />
      {/* 画笔/橡皮 */}
      <button
        type="button"
        onClick={() => { const next = !eraseMode; setEraseMode(next); activeCanvas()?.setMode(next ? 'erase' : 'draw'); if(next) activeCanvas()?.setEraserMul(eraserSize); }}
        className={`${btnBase} ${eraseMode ? 'text-amber-600 border-amber-200 bg-amber-50' : 'text-[oklch(0.45_0.01_265)]'}`}
      >
        <Eraser size={11} strokeWidth={1.5} />
      </button>
      {/* 橡皮大小（仅擦除模式） */}
      {eraseMode && (
        <>
          <input type="range" min={1} max={20} value={eraserSize}
            onChange={e => { const v=Number(e.target.value); setEraserSize(v); activeCanvas()?.setEraserMul(v); }}
            className={`w-14 ${sliderCls} [&::-webkit-slider-thumb]:bg-amber-500`}
            title="橡皮大小"
          />
          <span className="inline-flex items-center justify-center w-5 h-5 shrink-0">
            <span className="rounded-full border border-amber-400/60 transition-all duration-100"
              style={{ width: Math.max(3, eraserSize * 1.5), height: Math.max(3, eraserSize * 1.5) }} />
          </span>
          <span className="text-[10px] font-mono tabular-nums text-amber-600 w-4 text-right">{eraserSize}</span>
        </>
      )}
      <span className="w-px h-3.5 bg-[oklch(0.88_0.005_264)]" />
      {/* 撤销 */}
      <button type="button" onClick={() => activeCanvas()?.undo()}
        className={`${btnBase} text-[oklch(0.45_0.01_265)]`} title="撤销上一笔">
        <Undo2 size={11} strokeWidth={1.5} />
      </button>
      {/* 缩放 */}
      <button type="button"
        onClick={() => { const v = Math.max(0.5, zoomLevel - 0.25); setZoomLevel(v); activeCanvas()?.setZoom(v); }}
        className={`${btnBase} text-[oklch(0.45_0.01_265)]`}>
        <ZoomOut size={11} strokeWidth={1.5} />
      </button>
      <span className="text-[10px] font-mono tabular-nums text-[oklch(0.45_0.01_264)] w-[26px] text-center">{Math.round(zoomLevel * 100)}%</span>
      <button type="button"
        onClick={() => { const v = Math.min(3, zoomLevel + 0.25); setZoomLevel(v); activeCanvas()?.setZoom(v); }}
        className={`${btnBase} text-[oklch(0.45_0.01_265)]`}>
        <ZoomIn size={11} strokeWidth={1.5} />
      </button>
    </div>
  );

  const fullscreenOverlay = fullscreen && mode === 'handwriting'
    ? createPortal(
      <div className="fixed inset-0 z-50 flex flex-col bg-white"
        style={{ WebkitUserSelect: 'none', userSelect: 'none', WebkitTouchCallout: 'none' }}
        onContextMenu={e => e.preventDefault()}
        onTouchStart={e => e.preventDefault()}>
        <div className="flex items-center justify-between px-4 py-2 border-b border-[oklch(0.92_0.004_265)]">
          <div className="flex items-center gap-2 text-sm font-bold text-[oklch(0.18_0.012_265)]">
            <PenLine size={14} strokeWidth={1.5} />
            全屏手写{scorePointName ? ` · ${scorePointName}` : ''}
          </div>
          <div className="flex items-center gap-2">
            {toolbar}
            <button
              type="button" onClick={exitFullscreen}
              className="flex items-center gap-1 rounded-xl border border-[oklch(0.92_0.004_265)] bg-[oklch(0.98_0.003_265)] px-3 py-1.5 text-xs font-semibold text-[oklch(0.45_0.01_265)]
                shadow-[0_1px_0_oklch(1_0_0),inset_0_1px_0_oklch(1_0_0)]
                hover:shadow-[0_2px_0_oklch(0.92_0.004_265),inset_0_1px_0_oklch(1_0_0)]
                active:shadow-[inset_0_1px_3px_oklch(0.55_0.03_258_/_.12)] active:translate-y-px transition-all duration-150"
            >
              <Minimize2 size={13} strokeWidth={1.5} /> 退出全屏
            </button>
          </div>
        </div>
        <AtramentCanvas ref={fullscreenCanvasRef} width={800} height={560} className="flex-1 rounded-none border-0" />
        <div className="flex items-center gap-2 px-4 py-2 border-t border-[oklch(0.92_0.004_265)]">
          <button type="button" onClick={() => { activeCanvas()?.clear(); }}
            className="rounded-xl border border-[oklch(0.92_0.004_265)] bg-[oklch(0.98_0.003_265)] px-4 py-2 text-xs font-semibold text-[oklch(0.45_0.01_265)]
              shadow-[0_1px_0_oklch(1_0_0),inset_0_1px_0_oklch(1_0_0)]
              hover:shadow-[0_2px_0_oklch(0.92_0.004_265),inset_0_1px_0_oklch(1_0_0)]
              active:shadow-[inset_0_1px_3px_oklch(0.55_0.03_258_/_.12)] active:translate-y-px transition-all duration-150">
            清空</button>
          <button type="button" onClick={doSave} disabled={saving}
            className="flex flex-1 items-center justify-center gap-1 rounded-xl bg-[#064ea2] py-2.5 text-xs font-bold text-white
              shadow-[0_1px_0_oklch(0.3_0.05_264),inset_0_1px_0_oklch(1_0_0_/_.25)]
              hover:shadow-[0_2px_0_oklch(0.3_0.05_264),inset_0_1px_0_oklch(1_0_0_/_.3)]
              active:shadow-[inset_0_1px_3px_oklch(0.3_0.08_264_/_.4)] active:translate-y-px
              disabled:opacity-50 transition-all duration-150">
            {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} strokeWidth={1.5} />}
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
        <div className="flex items-center gap-0 rounded-xl border border-[oklch(0.92_0.004_265)] bg-[oklch(0.98_0.003_265)] p-0.5
          shadow-[inset_0_1px_2px_oklch(0.55_0.03_258_/_.06)]">
          <button type="button" onClick={() => setMode('handwriting')} aria-pressed={mode === 'handwriting'}
            className={`flex items-center gap-1 rounded-lg px-2.5 ${padY} text-xs font-semibold transition-all duration-150 ${
              mode === 'handwriting'
                ? 'bg-[#064ea2] text-white shadow-[0_1px_0_oklch(0.3_0.05_264),inset_0_1px_0_oklch(1_0_0_/_.2)]'
                : 'text-[oklch(0.55_0.01_264)] hover:text-[oklch(0.35_0.01_264)]'
            }`}>
            <PenLine size={12} strokeWidth={1.5} /> 手写
          </button>
          <button type="button" onClick={() => setMode('keyboard')} aria-pressed={mode === 'keyboard'}
            className={`flex items-center gap-1 rounded-lg px-2.5 ${padY} text-xs font-semibold transition-all duration-150 ${
              mode === 'keyboard'
                ? 'bg-[#064ea2] text-white shadow-[0_1px_0_oklch(0.3_0.05_264),inset_0_1px_0_oklch(1_0_0_/_.2)]'
                : 'text-[oklch(0.55_0.01_264)] hover:text-[oklch(0.35_0.01_264)]'
            }`}>
            <Keyboard size={12} strokeWidth={1.5} /> 键盘
          </button>
        </div>
      </div>

      <div className="flex min-h-0 flex-col">
        {mode === 'handwriting' ? (
          <div className="flex flex-col gap-2">
            {/* 工具栏 */}
            {toolbar}
            <div className="relative" style={{ WebkitUserSelect: 'none', userSelect: 'none' }}
              onContextMenu={e => e.preventDefault()}>
              <AtramentCanvas ref={inlineCanvasRef} height={compact ? 320 : 420} />
              <button type="button" onClick={enterFullscreen}
                className="absolute right-2 top-2 rounded-lg border border-[oklch(0.92_0.004_265)] bg-[oklch(0.98_0.003_265)]/80 p-1 text-[oklch(0.45_0.01_264)] transition-all duration-150
                  shadow-[0_1px_0_oklch(1_0_0),inset_0_1px_0_oklch(1_0_0)]
                  hover:text-[#064ea2] hover:shadow-[0_2px_0_oklch(0.92_0.004_265),inset_0_1px_0_oklch(1_0_0)]"
                title="全屏手写">
                <Maximize2 size={14} strokeWidth={1.5} />
              </button>
            </div>
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => activeCanvas()?.clear()}
                className="flex items-center gap-1 rounded-xl border border-[oklch(0.92_0.004_265)] bg-[oklch(0.98_0.003_265)] px-3 py-2 text-xs font-semibold text-[oklch(0.45_0.01_265)]
                  shadow-[0_1px_0_oklch(1_0_0),inset_0_1px_0_oklch(1_0_0)]
                  hover:shadow-[0_2px_0_oklch(0.92_0.004_265),inset_0_1px_0_oklch(1_0_0)]
                  active:shadow-[inset_0_1px_3px_oklch(0.55_0.03_258_/_.12)] active:translate-y-px transition-all duration-150">
                <Eraser size={12} strokeWidth={1.5} /> 清空
              </button>
              <button type="button" onClick={doSave} disabled={saving}
                className="flex flex-1 items-center justify-center gap-1 rounded-xl bg-[#064ea2] px-3 py-2.5 text-xs font-bold text-white
                  shadow-[0_1px_0_oklch(0.3_0.05_264),inset_0_1px_0_oklch(1_0_0_/_.25)]
                  hover:shadow-[0_2px_0_oklch(0.3_0.05_264),inset_0_1px_0_oklch(1_0_0_/_.3)]
                  active:shadow-[inset_0_1px_3px_oklch(0.3_0.08_264_/_.4)] active:translate-y-px
                  disabled:opacity-50 transition-all duration-150">
                {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} strokeWidth={1.5} />}
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
