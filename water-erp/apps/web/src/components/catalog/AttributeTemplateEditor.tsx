'use client';

import { useState } from 'react';
import { Plus, X, GripVertical } from 'lucide-react';
import type { AttributeTemplate } from '@/lib/category-tree-utils';

const FIELD_TYPES = ['TEXT', 'NUMBER', 'SELECT', 'DATE', 'BOOLEAN'] as const;

interface TemplateForm { name: string; fieldKey: string; fieldType: string; required: boolean; options: string; unit: string; }
const EMPTY: TemplateForm = { name: '', fieldKey: '', fieldType: 'TEXT', required: false, options: '', unit: '' };

interface Props {
  open: boolean;
  onClose: () => void;
  templates: AttributeTemplate[];
  onSave: (data: { name: string; fieldKey: string; fieldType: string; required: boolean; options?: string[]; unit?: string; sortOrder: number }) => Promise<void>;
  onDelete: (id: number) => Promise<void>;
  categoryName?: string;
}

export function AttributeTemplateEditor({ open, onClose, templates, onSave, onDelete, categoryName }: Props) {
  const [form, setForm] = useState<TemplateForm>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  if (!open) return null;

  const submit = async () => {
    if (!form.name.trim() || !form.fieldKey.trim()) { setError('请填写属性名和字段键名'); return; }
    setSaving(true); setError('');
    try {
      await onSave({
        name: form.name.trim(), fieldKey: form.fieldKey.trim().toLowerCase().replace(/\s+/g, '_'),
        fieldType: form.fieldType, required: form.required,
        options: form.options ? form.options.split(',').map(s => s.trim()).filter(Boolean) : undefined,
        unit: form.unit.trim() || undefined, sortOrder: templates.length,
      });
      setForm(EMPTY);
    } catch (e: any) { setError(e.message || '保存失败'); }
    finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
      <div className="neu-card w-full max-w-lg rounded-2xl p-6 max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between mb-4">
          <div><h3 className="text-base font-semibold text-[var(--foreground)]">属性模板配置</h3>
          {categoryName && <p className="text-xs text-[var(--muted-foreground)]">品类：{categoryName}</p>}</div>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-[rgba(96,139,239,0.1)]"><X size={18} /></button>
        </div>
        <div className="mb-4 flex-1 overflow-y-auto">
          {templates.length === 0 ? (
            <p className="text-sm text-[var(--muted-foreground)] text-center py-4">暂无属性模板，在下方添加</p>
          ) : (
            <div className="flex flex-col gap-1">
              {templates.map(t => (
                <div key={t.id} className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[rgba(96,139,239,0.05)] text-sm">
                  <GripVertical size={14} className="text-[var(--muted-foreground)] flex-shrink-0" />
                  <span className="font-medium">{t.name}</span>
                  <code className="text-[10px] font-mono text-[var(--accent)]">{t.fieldKey}</code>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-[rgba(96,139,239,0.1)] text-[var(--accent)]">{t.fieldType}</span>
                  {t.required && <span className="text-[10px] text-red-400">必填</span>}
                  {t.unit && <span className="text-[10px] text-[var(--muted-foreground)]">{t.unit}</span>}
                  <button onClick={() => onDelete(t.id)} className="ml-auto p-0.5 rounded hover:bg-red-100 text-red-400"><X size={14} /></button>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="border-t border-[var(--border-color)] pt-4">
          <p className="text-xs font-semibold text-[var(--foreground)] mb-3">新增属性</p>
          <div className="grid grid-cols-2 gap-2">
            <div><label className="text-[10px] font-medium text-[var(--muted-foreground)]">属性名</label><input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} className="neu-input w-full text-xs" placeholder="直径" /></div>
            <div><label className="text-[10px] font-medium text-[var(--muted-foreground)]">字段键</label><input value={form.fieldKey} onChange={e => setForm(p => ({ ...p, fieldKey: e.target.value }))} className="neu-input w-full text-xs font-mono" placeholder="diameter" /></div>
            <div><label className="text-[10px] font-medium text-[var(--muted-foreground)]">类型</label><select value={form.fieldType} onChange={e => setForm(p => ({ ...p, fieldType: e.target.value }))} className="neu-input w-full text-xs">{FIELD_TYPES.map(t => <option key={t} value={t}>{t}</option>)}</select></div>
            <div><label className="text-[10px] font-medium text-[var(--muted-foreground)]">单位</label><input value={form.unit} onChange={e => setForm(p => ({ ...p, unit: e.target.value }))} className="neu-input w-full text-xs" placeholder="mm" /></div>
            {form.fieldType === 'SELECT' && (
              <div className="col-span-2"><label className="text-[10px] font-medium text-[var(--muted-foreground)]">选项（逗号分隔）</label><input value={form.options} onChange={e => setForm(p => ({ ...p, options: e.target.value }))} className="neu-input w-full text-xs" placeholder="8mm,10mm,12mm,16mm" /></div>
            )}
            <label className="flex items-center gap-1.5 text-xs"><input type="checkbox" checked={form.required} onChange={e => setForm(p => ({ ...p, required: e.target.checked }))} />必填</label>
          </div>
          {error && <p className="text-xs text-red-500 mt-2">{error}</p>}
          <button onClick={submit} disabled={saving} className="neu-btn-xs is-success mt-3 w-full">{saving ? '保存中...' : '添加属性'}</button>
        </div>
      </div>
    </div>
  );
}
