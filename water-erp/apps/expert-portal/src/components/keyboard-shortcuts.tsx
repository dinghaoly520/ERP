'use client';

import { useEffect, useState } from 'react';
import { X, Keyboard } from 'lucide-react';

const SHORTCUTS = [
  { keys: '?', desc: '显示快捷键帮助', category: '全局' },
  { keys: 'Esc', desc: '关闭弹窗 / 面板', category: '全局' },
  { keys: 'Tab', desc: '切换评分项（正向）', category: '专家打分' },
  { keys: 'Shift + Tab', desc: '切换评分项（逆向）', category: '专家打分' },
  { keys: '↑↓', desc: '增减当前评分值', category: '专家打分' },
  { keys: '←→', desc: '微调评分滑块', category: '专家打分' },
  { keys: 'Enter', desc: '提交当前供应商评分', category: '专家打分' },
  { keys: '1→6', desc: '切换评审步骤', category: '评审向导' },
];

const OPENING_SHORTCUTS = [
  { keys: 'D', desc: '解密', category: '开标大厅' },
  { keys: 'B', desc: '批量解密', category: '开标大厅' },
  { keys: 'R', desc: '刷新数据', category: '开标大厅' },
  { keys: 'M', desc: '切换大屏模式', category: '开标大厅' },
  { keys: 'S', desc: '切换音效', category: '开标大厅' },
];

export function useKeyboardShortcuts() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === '?' && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) {
        e.preventDefault();
        setShow(prev => !prev);
      }
      if (e.key === 'Escape' && show) setShow(false);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [show]);

  const panel = show ? (
    <div className="fixed inset-0 z-[60] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/20" onClick={() => setShow(false)} />
      <div className="relative bg-white rounded-2xl border border-[#dce6f3] p-6 w-full max-w-lg mx-4 shadow-[0_24px_80px_rgba(15,47,87,0.15)]">
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-sm font-black text-[#18243a] flex items-center gap-2"><Keyboard size={14} /> 键盘快捷键</h3>
          <button onClick={() => setShow(false)} className="text-[#8a99ad] hover:text-[#18243a]"><X size={16} /></button>
        </div>
        <div className="space-y-4">
          {[{ label: '专家评分平台', items: SHORTCUTS }, { label: '在线开评标系统', items: [...SHORTCUTS, ...OPENING_SHORTCUTS] }].map(group => (
            <div key={group.label}>
              <h4 className="text-[11px] font-bold uppercase tracking-wider text-[#5a6d8a] mb-2">{group.label}</h4>
              <div className="space-y-1">
                {group.items.map(s => (
                  <div key={s.keys + s.desc} className="flex items-center justify-between text-xs py-1">
                    <span className="text-[oklch(0.55_0.01_264)]">{s.desc}</span>
                    <span className="font-mono font-bold text-[oklch(0.18_0.012_265)] bg-[oklch(0.98_0.005_264)] px-2 py-0.5 rounded border border-[oklch(0.91_0.006_264)]">{s.keys}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
        <p className="mt-4 text-[10px] text-[oklch(0.62_0.008_264)] text-center">按 <kbd className="font-mono">?</kbd> 随时调出此面板</p>
      </div>
    </div>
  ) : null;

  return { show, panel };
}
