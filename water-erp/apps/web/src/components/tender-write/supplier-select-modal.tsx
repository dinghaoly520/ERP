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
    <div className="fixed inset-0 z-[550] flex items-center justify-center">
      <div
        className="absolute inset-0"
        style={{ background: 'oklch(0.975 0.012 258 / 0.6)', backdropFilter: 'blur(3px)' }}
        onClick={onClose}
      />
      <div
        className="relative z-10 mx-5 w-full max-w-[520px] max-h-[80vh] overflow-y-auto rounded-[22px] p-6"
        style={{
          background: 'linear-gradient(170deg, oklch(1 0 0 / 0.97), oklch(0.99 0.003 258 / 0.72))',
          boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.9), 3px 4px 18px oklch(0.46 0.07 258 / 0.18), -3px -3px 10px oklch(1 0 0 / 0.94)',
        }}
      >
        {/* 标题栏 */}
        <div className="flex items-start justify-between gap-3 mb-4">
          <div className="flex items-center gap-2.5">
            <div
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[11px]"
              style={{
                background: 'color-mix(in oklch, var(--accent) 14%, transparent)',
                boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.6), 2px 2px 3px oklch(0.55 0.03 258 / 0.08)',
              }}
            >
              <Building2 size={17} className="text-[var(--accent)]" />
            </div>
            <div>
              <span className="text-sm font-semibold tracking-[-0.02em] text-[color:var(--foreground)]">
                供应商抽选
              </span>
              <div className="text-[11px] text-[color:var(--muted-foreground)]">
                AI 分析项目需求，推荐匹配供应商
              </div>
            </div>
          </div>
          <button type="button" onClick={onClose} className="neu-btn-xs shrink-0">
            <X size={16} />
          </button>
        </div>

        {/* 内容区 */}
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
          <>
            <div className="space-y-2 mb-4">
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

            {/* 底部操作 */}
            <div className="flex items-center justify-between gap-3 pt-3" style={{ borderTop: '1px solid oklch(0.6 0.04 258 / 0.12)' }}>
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
                <button type="button" onClick={handleConfirm} disabled={!selected} className="neu-btn-primary !h-[34px] !text-xs">
                  <Check size={14} /> 确认填入
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
