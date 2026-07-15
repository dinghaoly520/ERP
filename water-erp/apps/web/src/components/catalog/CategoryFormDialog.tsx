'use client';

import { useState, useEffect } from 'react';
import { Modal } from '@/components/workbench';

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

  const submit = async () => {
    if (!data.name.trim()) { setError('请输入节点名称'); return; }
    setSaving(true); setError('');
    try { await onSave(data); onClose(); } catch (e: any) { setError(e.message || '保存失败'); }
    finally { setSaving(false); }
  };

  return (
    <Modal open={open} onClose={onClose} title={title} size="sm"
      footer={<>
        <button onClick={onClose} className="neu-btn-soft">取消</button>
        <button onClick={submit} disabled={saving} className="neu-btn-primary is-info">{saving ? '保存中...' : '保存'}</button>
      </>}>
      <div>
        <label className="text-xs font-medium text-[var(--muted-foreground)] mb-1 block">名称 <span className="text-[var(--danger)]">*</span></label>
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
      {error && <p className="text-xs text-[var(--danger)]">{error}</p>}
    </Modal>
  );
}
