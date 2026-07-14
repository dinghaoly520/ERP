'use client';

import { useState, useEffect } from 'react';
import { X } from 'lucide-react';

interface CategoryFormData { name: string; code: string; isLeaf: boolean; icon: string; }

interface Props {
  open: boolean;
  onClose: () => void;
  onSave: (data: CategoryFormData) => Promise<void>;
  initial?: CategoryFormData;
  title?: string;
}

export function CategoryFormDialog({ open, onClose, onSave, initial, title = '新增品类节点' }: Props) {
  const [data, setData] = useState<CategoryFormData>({ name: '', code: '', isLeaf: false, icon: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { if (initial) setData(initial); }, [initial]);
  if (!open) return null;

  const submit = async () => {
    if (!data.name.trim()) { setError('请输入节点名称'); return; }
    setSaving(true); setError('');
    try { await onSave(data); onClose(); } catch (e: any) { setError(e.message || '保存失败'); }
    finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
      <div className="neu-card w-full max-w-sm rounded-2xl p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-semibold text-[var(--foreground)]">{title}</h3>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-[rgba(96,139,239,0.1)]"><X size={18} /></button>
        </div>
        <div className="flex flex-col gap-3">
          <div>
            <label className="text-xs font-medium text-[var(--muted-foreground)] mb-1 block">名称 <span className="text-red-400">*</span></label>
            <input value={data.name} onChange={e => setData(p => ({ ...p, name: e.target.value }))} className="neu-input w-full text-sm" placeholder="如：钢材" />
          </div>
          <div>
            <label className="text-xs font-medium text-[var(--muted-foreground)] mb-1 block">编码</label>
            <input value={data.code} onChange={e => setData(p => ({ ...p, code: e.target.value }))} className="neu-input w-full text-sm" placeholder="如：STEEL" />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={data.isLeaf} onChange={e => setData(p => ({ ...p, isLeaf: e.target.checked }))} className="rounded" />
            叶子节点（可挂载目录项）
          </label>
          {error && <p className="text-xs text-red-500">{error}</p>}
          <div className="flex justify-end gap-2 mt-2">
            <button onClick={onClose} className="neu-btn-xs">取消</button>
            <button onClick={submit} disabled={saving} className="neu-btn-xs is-info">{saving ? '保存中...' : '保存'}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
