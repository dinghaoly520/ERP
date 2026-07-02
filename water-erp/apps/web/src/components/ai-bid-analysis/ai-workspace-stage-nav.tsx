'use client';

import { CheckCircle2, Circle, Loader2 } from 'lucide-react';
import type { AiWorkspaceStageItem, AiWorkspaceStageKey } from '@/lib/types/ai-bid-analysis';

interface AiWorkspaceStageNavProps {
  stages: AiWorkspaceStageItem[];
  activeTab: AiWorkspaceStageKey;
  onTabChange: (stage: AiWorkspaceStageKey) => void;
}

export function AiWorkspaceStageNav({ stages, activeTab, onTabChange }: AiWorkspaceStageNavProps) {
  return (
    <nav className="flex flex-wrap gap-2">
      {stages.map((stage) => {
        const getIcon = () => {
          if (stage.completed) return <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />;
          if (stage.active) return <Loader2 className="w-3.5 h-3.5 animate-spin" style={{ color: 'var(--accent)' }} />;
          return <Circle className="w-3.5 h-3.5 opacity-30" />;
        };

        const isActive = stage.key === activeTab;

        return (
          <button
            key={stage.key}
            onClick={() => stage.enabled && onTabChange(stage.key)}
            disabled={!stage.enabled}
            className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
              isActive
                ? 'text-white'
                : stage.enabled
                  ? 'hover:opacity-80'
                  : 'opacity-40 cursor-not-allowed'
            }`}
            style={{
              background: isActive ? 'var(--accent)' : 'var(--muted)',
              border: isActive ? 'none' : '1px solid var(--border)',
            }}
          >
            {getIcon()}
            <span>{stage.label}</span>
          </button>
        );
      })}
    </nav>
  );
}