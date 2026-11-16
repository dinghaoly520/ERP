'use client';

import { useEffect, useRef, useState } from 'react';
import { Building2, Loader2, X, Check, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { recommendSuppliersForProject } from '@/lib/api/project-management';

type Props = {
  isOpen: boolean;
  onClose: () => void;
  projectId: string;
  onSelect: (supplierName: string) => void;
};

export function SupplierSelectModal({ isOpen, onClose, projectId, onSelect }: Props) {
  const [loading, setLoading] = useState(false);
  const [suppliers, setSuppliers] = useState<Array<{ name: string; reason: string; matchScore: number }>>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const loadedRef = useRef(false);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  // 打开时自动加载推荐结果
  useEffect(() => {
    if (!isOpen || !projectId) return;
    if (loadedRef.current) return;
    loadedRef.current = true;
    setLoading(true);
    setError(null);
    setSelected(null);
    setSuppliers([]);
    recommendSuppliersForProject(projectId)
      .then((res) => {
        setSuppliers(res.suppliers || []);
        if (!res.suppliers?.length) setError('AI 未返回推荐结果，请检查项目是否已包含足够的采购信息');
      })
      .catch((e) => setError(e instanceof Error ? e.message : '推荐请求失败'))
      .finally(() => setLoading(false));
  }, [isOpen, projectId]);

  // 重置缓存 flag
  useEffect(() => {
    if (!isOpen) loadedRef.current = false;
  }, [isOpen]);

  const handleConfirm = () => {
    if (!selected) {
      toast.error('请先选择一家供应商');
      return;
    }
    onSelect(selected);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[550] flex items-center justify-center p-4">
      <div className="wb-overlay-backdrop" onClick={onClose} />
      <div className="wb-modal-shell relative z-10 flex w-full max-w-[520px] flex-col overflow-hidden">
        {/* A 版图标井头部（2026-11-16 全系统推广） */}
        <div className="flex shrink-0 items-start justify-between gap-4 px-6 pb-4 pt-6">
          <div className="flex min-w-0 items-start gap-3">
            <span className="neu-icon-well mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[9px] text-[var(--accent)]">
              <Building2 size={14} />
            </span>
            <div className="min-w-0">
              <h2 className="text-lg font-bold tracking-[-0.02em] text-[color:var(--foreground)]">供应商抽选</h2>
              <p className="mt-1 text-xs text-[color:var(--muted-foreground)]">AI 分析项目需求，推荐匹配供应商</p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="neu-btn-xs shrink-0">
            <X size={16} />
          </button>
        </div>
        <div className="mx-6 h-px shrink-0 bg-[oklch(0.6_0.04_258_/_0.16)]" />

        {/* 内容区 */}
        <div className="min-h-0 flex-1 overflow-y-auto px-6 pt-4 pb-4">
        {loading ? (
          <div className="flex flex-col items-center gap-3 py-12">
            <Loader2 size={24} className="animate-spin text-[var(--accent)]" />
            <span className="text-sm text-[var(--muted-foreground)]">AI 正在分析项目文档，推荐匹配供应商…</span>
          </div>
        ) : error ? (
          <div className="rounded-xl px-4 py-4 text-sm text-[color:var(--danger)]"
            style={{ background: 'color-mix(in oklch, var(--danger) 8%, transparent)' }}>
            {error}
          </div>
        ) : (
            <div className="space-y-2">
              {suppliers.map((s, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setSelected(s.name)}
                  className={`w-full text-left rounded-[14px] px-4 py-3.5 transition-all duration-200 ${
                    selected === s.name
                      ? 'ring-2 ring-[var(--accent)]/40'
                      : ''
                  }`}
                  style={{
                    background: selected === s.name
                      ? 'color-mix(in oklch, var(--accent) 8%, oklch(1 0 0 / 0.8))'
                      : 'oklch(1 0 0 / 0.48)',
                    boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.55), 1px 1px 3px oklch(0.55 0.03 258 / 0.06)',
                  }}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[7px] text-[10px] font-extrabold text-white"
                        style={{ background: 'linear-gradient(135deg, oklch(0.52 0.16 258), oklch(0.45 0.14 258))' }}>
                        {i + 1}
                      </span>
                      <span className="text-sm font-bold text-[color:var(--foreground)] truncate">{s.name}</span>
                    </div>
                    <span className="shrink-0 text-[11px] font-bold tabular-nums"
                      style={{ color: s.matchScore >= 85 ? 'var(--success)' : s.matchScore >= 70 ? 'var(--warning)' : 'var(--muted-foreground)' }}>
                      {s.matchScore}%
                    </span>
                  </div>
                  {s.reason && (
                    <div className="mt-1.5 ml-8 text-[11px] leading-snug text-[color:var(--muted-foreground)]">
                      {s.reason}
                    </div>
                  )}
                </button>
              ))}
            </div>
        )}
        </div>

        {/* 底部操作（非加载/错误态；A 版底栏分割线，2026-11-16 全系统推广） */}
        {!loading && !error && (
          <div className="shrink-0 px-6 pb-4 pt-3">
            <hr className="wb-section-rule mb-3" />
            <div className="flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => { loadedRef.current = false; setLoading(true); setError(null); setSelected(null); setSuppliers([]);
                  recommendSuppliersForProject(projectId)
                    .then((res) => { setSuppliers(res.suppliers || []); if (!res.suppliers?.length) setError('AI 未返回推荐结果'); })
                    .catch((e) => setError(e instanceof Error ? e.message : '推荐请求失败'))
                    .finally(() => setLoading(false));
                }}
                className="neu-btn-xs gap-1.5"
              >
                <Sparkles size={13} /> 重新推荐
              </button>
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-[color:var(--muted-foreground)]">
                  {selected ? `已选：${selected}` : '请点击选择一家供应商'}
                </span>
                <button type="button" onClick={handleConfirm} disabled={!selected} className="neu-btn-primary !h-[38px]">
                  <Check size={14} /> 确认填入
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
