'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { getClassifications, createClassification, updateClassification, deleteClassification } from '@/lib/api/supplier';
import type { SupplierClassification } from '@/lib/types';
import { Modal } from '@/components/workbench';
import { Plus, Trash2, Check, X } from 'lucide-react';

interface Props {
  open: boolean;
  onClose: () => void;
}

export function ClassificationManagerDialog({ open, onClose }: Props) {
  const [classifications, setClassifications] = useState<SupplierClassification[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    try { setClassifications(await getClassifications()); } catch { toast.error('加载分类失败'); }
    setLoading(false);
  };
  useEffect(() => { if (open) load(); }, [open]);

  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editCode, setEditCode] = useState('');
  const [newName, setNewName] = useState('');
  const [newCode, setNewCode] = useState('');

  const handleCreate = async () => {
    if (!newName.trim()) { toast.error('请输入分类名称'); return; }
    setSaving(true);
    try {
      await createClassification({ name: newName.trim(), code: newCode.trim() || undefined });
      toast.success('分类已创建'); setNewName(''); setNewCode(''); load();
    } catch (e: any) { toast.error(e?.message || '创建失败'); }
    setSaving(false);
  };

  const handleUpdate = async (id: string) => {
    if (!editName.trim()) { toast.error('请输入分类名称'); return; }
    setSaving(true);
    try {
      await updateClassification(id, { name: editName.trim(), code: editCode.trim() || undefined });
      toast.success('分类已更新'); setEditId(null); load();
    } catch (e: any) { toast.error(e?.message || '更新失败'); }
    setSaving(false);
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`确定删除分类「${name}」？已关联供应商的分类无法删除。`)) return;
    try {
      await deleteClassification(id);
      toast.success('分类已删除'); load();
    } catch (e: any) { toast.error(e?.message || '删除失败'); }
  };

  if (!open) return null;

  return (
    <Modal open onClose={onClose} size="md" title="分类管理"
      description="管理供应商分类标签（如工程类、货物类、服务类），影响供应商选取匹配与看板分布"
      footer={<span className="text-xs text-[var(--muted-foreground)]">已关联供应商的分类无法删除</span>}
    >
      <div className="space-y-4">
        {/* 新建 */}
        <div className="flex items-end gap-2">
          <label className="flex-1 space-y-1">
            <span className="text-[10px] font-semibold text-[var(--muted-foreground)]">名称</span>
            <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="如 工程类" className="neu-input text-sm w-full" maxLength={50} />
          </label>
          <label className="w-[120px] space-y-1">
            <span className="text-[10px] font-semibold text-[var(--muted-foreground)]">编码（选填）</span>
            <input value={newCode} onChange={e => setNewCode(e.target.value)} placeholder="如 ENG" className="neu-input text-sm w-full" maxLength={20} />
          </label>
          <button onClick={handleCreate} disabled={saving || !newName.trim()} className="neu-btn-soft is-info !h-[38px] flex-shrink-0">
            <Plus size={13} />新增
          </button>
        </div>

        <hr className="wb-section-rule" />

        {/* 列表 */}
        <div className="max-h-[320px] overflow-y-auto space-y-1.5">
          {loading ? (
            <p className="text-center text-sm text-[var(--muted-foreground)] py-8">加载中...</p>
          ) : classifications.length === 0 ? (
            <p className="text-center text-sm text-[var(--muted-foreground)] py-8">暂无分类，请在输入框中创建</p>
          ) : classifications.map(c => (
            <div key={c.id} className="flex items-center gap-2 rounded-xl p-2.5" style={{ background: 'oklch(1 0 0 / 0.4)', boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.6)' }}>
              {editId === c.id ? (
                <>
                  <input value={editName} onChange={e => setEditName(e.target.value)} className="neu-input text-sm flex-1" maxLength={50} />
                  <input value={editCode} onChange={e => setEditCode(e.target.value)} className="neu-input text-sm w-[100px]" maxLength={20} placeholder="编码" />
                  <button onClick={() => handleUpdate(c.id)} disabled={saving} className="neu-btn-xs" title="确认"><Check size={12} /></button>
                  <button onClick={() => setEditId(null)} className="neu-btn-xs" title="取消"><X size={12} /></button>
                </>
              ) : (
                <>
                  <span className="flex-1 text-sm font-semibold text-[var(--foreground)]">{c.name}</span>
                  {c.code && <span className="text-[10px] font-mono text-[var(--muted-foreground)]">{c.code}</span>}
                  <span className="text-[10px] text-[var(--muted-foreground)] tabular-nums">{c._count?.suppliers ?? 0} 家</span>
                  <button onClick={() => { setEditId(c.id); setEditName(c.name); setEditCode(c.code ?? ''); }} className="neu-btn-xs" title="编辑">编辑</button>
                  <button onClick={() => handleDelete(c.id, c.name)} className="neu-btn-xs is-danger" title="删除"><Trash2 size={12} /></button>
                </>
              )}
            </div>
          ))}
        </div>
      </div>
    </Modal>
  );
}
