'use client';

import { X } from 'lucide-react';
import type { ReactNode } from 'react';

interface DialogProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  footer?: ReactNode;
  width?: string; // default 'max-w-lg'
}

export default function Dialog({ open, onClose, title, children, footer, width = 'max-w-lg' }: DialogProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />

      {/* Panel */}
      <div className={`relative w-full ${width} mx-4 glass-card rounded-2xl shadow-[0_24px_80px_rgba(15,47,87,0.18)]`}>
        {/* Header */}
        {title && (
          <div className="flex items-center justify-between px-6 py-4 border-b border-[#edf2f7]">
            <h2 className="text-base font-black text-[#18243a]">{title}</h2>
            <button
              onClick={onClose}
              className="rounded-xl p-1.5 text-[#94a3b8] hover:bg-[#f8fafc] hover:text-[#18243a] transition"
            >
              <X size={16} strokeWidth={1.5} />
            </button>
          </div>
        )}

        {/* Body */}
        <div className="px-6 py-4">{children}</div>

        {/* Footer */}
        {footer && (
          <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-[#edf2f7]">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
