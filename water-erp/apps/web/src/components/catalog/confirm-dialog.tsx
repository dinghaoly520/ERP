'use client';

import { useEffect, useRef, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Modal } from '@/components/workbench';

/**
 * 全局新拟态对话框（confirm / prompt 二合一）。
 * 用法：
 *   import { confirmDialog, promptDialog, ConfirmHost } from '@/components/catalog/confirm-dialog';
 *   const ok = await confirmDialog({ message: '确认下架？', danger: true });
 *   const val = await promptDialog({ message: '议价反报价金额', required: true });
 * 在页面根部挂载一次 <ConfirmHost />。
 */

export interface ConfirmOptions {
  title?: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
}
export interface PromptOptions {
  title?: string;
  message?: string;
  placeholder?: string;
  defaultValue?: string;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
  required?: boolean;
  /** 数字输入：非空时校验为有效数字并返回字符串 */
  numeric?: boolean;
}

type Pending =
  | { kind: 'confirm'; opts: ConfirmOptions; resolve: (v: boolean) => void }
  | { kind: 'prompt'; opts: PromptOptions; resolve: (v: string | null) => void };

let openFn: ((p: Pending) => void) | null = null;

export function confirmDialog(opts: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => { openFn?.({ kind: 'confirm', opts, resolve }); });
}
export function promptDialog(opts: PromptOptions): Promise<string | null> {
  return new Promise((resolve) => { openFn?.({ kind: 'prompt', opts, resolve }); });
}

export function ConfirmHost() {
  const [pending, setPending] = useState<Pending | null>(null);
  const [value, setValue] = useState('');
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { openFn = setPending; return () => { openFn = null; }; }, []);

  // 打开 prompt 时初始化输入值并聚焦输入框
  useEffect(() => {
    if (!pending) return;
    setError('');
    if (pending.kind === 'prompt') {
      setValue(pending.opts.defaultValue ?? '');
      const t = setTimeout(() => inputRef.current?.focus(), 50);
      return () => clearTimeout(t);
    }
  }, [pending]);

  if (!pending) return null;

  const finish = (v: boolean | string | null) => {
    if (pending.kind === 'confirm') pending.resolve(v as boolean);
    else pending.resolve(v as string | null);
    setPending(null);
  };

  const submitPrompt = () => {
    if (pending.kind !== 'prompt') return;
    const v = value.trim();
    if (pending.opts.required && !v) { setError('请输入内容'); return; }
    if (pending.opts.numeric && v && Number.isNaN(Number(v))) { setError('请输入有效数字'); return; }
    finish(pending.opts.numeric && v === '' ? null : v);
  };

  const isPrompt = pending.kind === 'prompt';
  const pOpts = isPrompt ? pending.opts : null;
  const opts = pending.opts;
  const title = opts.title ?? (isPrompt ? '请输入' : '请确认');
  const confirmText = opts.confirmText ?? '确定';
  const danger = !!opts.danger;

  return (
    <Modal
      open={!!pending}
      onClose={() => finish(isPrompt ? null : false)}
      title={<span className="flex items-center gap-2">
        {danger && <AlertTriangle size={16} className="text-[var(--danger)]" />}
        {title}
      </span>}
      size="sm"
      footer={<>
        <button onClick={() => finish(isPrompt ? null : false)} className="neu-btn-soft">
          {opts.cancelText ?? '取消'}
        </button>
        <button
          onClick={isPrompt ? submitPrompt : () => finish(true)}
          className={`neu-btn-primary ${danger ? 'is-warning' : 'is-info'}`}
        >
          {confirmText}
        </button>
      </>}
    >
      {pending.kind === 'confirm' && (
        <p className="text-sm text-[var(--foreground)] leading-relaxed">{opts.message}</p>
      )}

      {isPrompt && pOpts && (
        <form
          onSubmit={(e) => { e.preventDefault(); submitPrompt(); }}
          className="flex flex-col gap-1"
        >
          {pOpts.message && <label className="text-xs font-medium text-[var(--muted-foreground)] mb-1">{pOpts.message}</label>}
          <input
            ref={inputRef}
            value={value}
            onChange={(e) => { setValue(e.target.value); setError(''); }}
            placeholder={pOpts.placeholder}
            inputMode={pOpts.numeric ? 'decimal' : undefined}
            className="neu-input w-full text-sm"
          />
          {error && <p className="text-xs text-[var(--danger)] mt-1">{error}</p>}
        </form>
      )}
    </Modal>
  );
}
