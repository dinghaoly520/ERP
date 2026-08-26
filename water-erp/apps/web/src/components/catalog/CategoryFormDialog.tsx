'use client';

import { useState, useEffect } from 'react';
import { Modal } from '@/components/workbench';

interface CategoryFormData { name: string; code: string; isLeaf: boolean; icon: string; centralizedLevel: string; centralizedThreshold: string; }

/** 提交载荷：阈值字符串转数值（null=未设） */
export type CategoryFormPayload = Omit<CategoryFormData, 'centralizedThreshold'> & { centralizedThreshold: number | null };

interface Props {
  open: boolean;
  onClose: () => void;
  onSave: (data: CategoryFormPayload) => Promise<void>;
  initial?: CategoryFormData;
  title?: string;
}

export function CategoryFormDialog({ open, onClose, onSave, initial, title = '新增品类节点' }: Props) {
  const [data, setData] = useState<CategoryFormData>({ name: '', code: '', isLeaf: false, icon: '', centralizedLevel: 'centralized', centralizedThreshold: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { if (initial) setData(initial); }, [initial]);

  const submit = async () => {
    if (!data.name.trim()) { setError('请输入节点名称'); return; }
    setSaving(true); setError('');
    try {
      await onSave({
        ...data,
        centralizedThreshold: data.centralizedThreshold ? Number(data.centralizedThreshold) : null,
      });
      onClose();
    } catch (e: any) { setError(e.message || '保存失败'); }
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
      {/* B2（GB/T 43711 4.1.1.3）：目录分级——集中/分散 + 分级金额阈值 */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-medium text-[var(--muted-foreground)] mb-1 block">采购组织分级</label>
          <select value={data.centralizedLevel} onChange={e => setData(p => ({ ...p, centralizedLevel: e.target.value }))} className="neu-input w-full text-sm">
            <option value="centralized">集中采购</option>
            <option value="decentralized">分散采购</option>
          </select>
        </div>
        <div>
          <label className="text-xs font-medium text-[var(--muted-foreground)] mb-1 block">分级金额阈值（元）</label>
          <input type="number" value={data.centralizedThreshold} onChange={e => setData(p => ({ ...p, centralizedThreshold: e.target.value }))} className="neu-input w-full text-sm" placeholder="预算≥阈值走集中" />
        </div>
      </div>
      {error && <p className="text-xs text-[var(--danger)]">{error}</p>}
    </Modal>
  );
}
