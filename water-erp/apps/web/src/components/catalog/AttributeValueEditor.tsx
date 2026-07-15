'use client';

import type { DynamicField } from '@/lib/attribute-template-utils';

interface Props {
  fields: DynamicField[];
  onChange: (fields: DynamicField[]) => void;
}

export function AttributeValueEditor({ fields, onChange }: Props) {
  if (fields.length === 0) return null;
  const setField = (templateId: number, value: string) => {
    onChange(fields.map(f => f.templateId === templateId ? { ...f, value } : f));
  };
  return (
    <div className="neu-card rounded-xl p-4">
      <h4 className="text-sm font-semibold text-[var(--foreground)] mb-3">品类属性</h4>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {fields.map(f => (
          <div key={f.templateId}>
            <label className="text-xs font-medium text-[var(--muted-foreground)] mb-1 block">
              {f.name} {f.required && <span className="text-[var(--danger)]">*</span>}
              {f.unit && <span className="text-[10px] ml-1">({f.unit})</span>}
            </label>
            {f.fieldType === 'SELECT' ? (
              <select value={f.value} onChange={e => setField(f.templateId, e.target.value)} className="neu-input w-full text-sm">
                <option value="">请选择{f.name}</option>
                {f.options?.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            ) : f.fieldType === 'BOOLEAN' ? (
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={f.value === 'true'} onChange={e => setField(f.templateId, e.target.checked ? 'true' : 'false')} />
                {f.name}
              </label>
            ) : f.fieldType === 'DATE' ? (
              <input type="date" value={f.value} onChange={e => setField(f.templateId, e.target.value)} className="neu-input w-full text-sm" />
            ) : f.fieldType === 'NUMBER' ? (
              <input type="number" step="any" value={f.value} onChange={e => setField(f.templateId, e.target.value)} className="neu-input w-full text-sm font-mono" placeholder={`请输入${f.name}`} />
            ) : (
              <input value={f.value} onChange={e => setField(f.templateId, e.target.value)} className="neu-input w-full text-sm" placeholder={`请输入${f.name}`} />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
