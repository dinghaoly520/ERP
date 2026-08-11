'use client';

import { useState } from 'react';
import { createPortal } from 'react-dom';
import { CheckCircle2, AlertTriangle, X } from 'lucide-react';

export interface SyncConflictItem {
  key: string;
  scoreItemName: string;
  localVal: { score?: number; passed?: boolean | null; reason?: string | null };
  remoteVal: { score?: number; passed?: boolean | null; reason?: string | null };
  remoteDevice: 'tablet' | 'desktop';
}

export interface SyncNewItem {
  key: string;
  scoreItemName: string;
  val: { score?: number; passed?: boolean | null; reason?: string | null };
  sourceDevice: 'tablet' | 'desktop';
}

interface Props {
  open: boolean;
  newItems: SyncNewItem[];
  conflictItems: SyncConflictItem[];
  localDevice: 'tablet' | 'desktop';
  onConfirm: (resolved: Record<string, 'local' | 'remote'>) => void;
  onClose: () => void;
}

function formatVal(v: { score?: number; passed?: boolean | null }): string {
  if (v.passed === true) return '通过';
  if (v.passed === false) return '不通过';
  return `${v.score ?? 0}分`;
}

export function SyncConflictModal({ open, newItems, conflictItems, localDevice, onConfirm, onClose }: Props) {
  const [choices, setChoices] = useState<Record<string, 'local' | 'remote'>>({});
  if (!open) return null;

  const remoteLabel = localDevice === 'desktop' ? '平板端' : '桌面端';
  const localLabel = localDevice === 'desktop' ? '桌面' : '平板';

  const setAll = (choice: 'local' | 'remote') => {
    const next: Record<string, 'local' | 'remote'> = {};
    for (const c of conflictItems) next[c.key] = choice;
    setChoices(next);
  };

  const handleConfirm = () => {
    // 默认全部 local
    const resolved: Record<string, 'local' | 'remote'> = {};
    for (const c of conflictItems) resolved[c.key] = choices[c.key] ?? 'local';
    onConfirm(resolved);
  };

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center px-6"
      style={{ background: 'oklch(0.2 0.02 258 / 0.4)', backdropFilter: 'blur(2px)' }}
      onClick={onClose}>
      <div className="w-full max-w-[520px] rounded-[20px] bg-white"
        style={{ boxShadow: '3px 4px 16px oklch(0.46 0.07 258 / 0.18)' }}
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4"
          style={{ borderBottom: '1px solid oklch(0.6 0.04 258 / 0.12)' }}>
          <h3 className="text-sm font-bold text-[var(--foreground)]">
            同步草稿 — 来自{remoteLabel}
          </h3>
          <button type="button" onClick={onClose}
            className="text-[var(--muted-foreground)] hover:text-[var(--foreground)]">
            <X size={16} />
          </button>
        </div>

        <div className="max-h-[60vh] overflow-y-auto px-5 py-4">
          {/* 新增项 */}
          {newItems.length > 0 && (
            <div className="mb-4">
              <div className="mb-2 flex items-center gap-1.5 text-xs font-bold text-[var(--success)]">
                <CheckCircle2 size={14} /> 新增（{newItems.length} 项）— 已自动合并
              </div>
              <div className="space-y-1">
                {newItems.map(n => (
                  <div key={n.key} className="rounded-[8px] bg-[oklch(0.975_0.012_258/0.4)] px-3 py-1.5 text-xs">
                    <span className="text-[var(--muted-foreground)]">{n.scoreItemName}</span>
                    <span className="ml-2 font-bold text-[var(--foreground)]">{formatVal(n.val)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 冲突项 */}
          {conflictItems.length > 0 && (
            <div>
              <div className="mb-2 flex items-center gap-1.5 text-xs font-bold text-[var(--warning)]">
                <AlertTriangle size={14} /> 变更（{conflictItems.length} 项）— 请确认
              </div>
              <div className="space-y-2">
                {conflictItems.map(c => (
                  <div key={c.key} className="rounded-[10px] border border-[oklch(0.6_0.04_258/0.1)] px-3 py-2">
                    <div className="mb-1.5 text-xs font-semibold text-[var(--foreground)]">{c.scoreItemName}</div>
                    <div className="flex items-center gap-4">
                      <label className="flex cursor-pointer items-center gap-1.5 text-xs">
                        <input type="radio" name={c.key}
                          checked={(choices[c.key] ?? 'local') === 'local'}
                          onChange={() => setChoices(prev => ({ ...prev, [c.key]: 'local' }))}
                          className="accent-[var(--accent-strong)]"
                        />
                        <span className="text-[var(--muted-foreground)]">{localLabel}</span>
                        <span className="font-bold text-[var(--foreground)]">{formatVal(c.localVal)}</span>
                      </label>
                      <label className="flex cursor-pointer items-center gap-1.5 text-xs">
                        <input type="radio" name={c.key}
                          checked={choices[c.key] === 'remote'}
                          onChange={() => setChoices(prev => ({ ...prev, [c.key]: 'remote' }))}
                          className="accent-[var(--accent-strong)]"
                        />
                        <span className="text-[var(--muted-foreground)]">{remoteLabel}</span>
                        <span className="font-bold text-[var(--foreground)]">{formatVal(c.remoteVal)}</span>
                      </label>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between px-5 py-4"
          style={{ borderTop: '1px solid oklch(0.6 0.04 258 / 0.12)' }}>
          <button type="button" onClick={() => setAll('local')}
            className="text-xs font-semibold text-[var(--muted-foreground)] hover:text-[var(--foreground)]">
            全部采用{localLabel}
          </button>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => setAll('remote')}
              className="text-xs font-semibold text-[var(--muted-foreground)] hover:text-[var(--foreground)]">
              全部采用{remoteLabel}
            </button>
            <button type="button" onClick={handleConfirm}
              className="neu-btn-primary !h-9 !px-4 !text-xs">
              确认
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
