import type { CorrectionDiffResult, CorrectionDiffSection } from '@/lib/api/supplier';

const KIND_META: Record<string, { text: string; cls: string }> = {
  added: { text: '新增', cls: 'text-[var(--success)]' },
  removed: { text: '移除', cls: 'text-[var(--danger)]' },
};

function DiffRows({ section }: { section: CorrectionDiffSection }) {
  return (
    <div className="flex flex-col">
      {section.items.map((it, i) => (
        <div key={i} className="flex flex-wrap items-baseline gap-x-2 border-b border-[color-mix(in_oklch,var(--muted-foreground)_12%,transparent)] py-1.5 text-xs last:border-b-0">
          {it.kind === 'modified' ? (
            <>
              <span className="font-medium text-[var(--foreground)]">{it.rowLabel}{it.fieldLabel ? `·${it.fieldLabel}` : ''}</span>
              {it.fileReplaced ? (
                <span className="rounded-full bg-[color-mix(in_oklch,var(--warning)_14%,transparent)] px-1.5 py-px text-[10px] font-bold text-[var(--warning)]">文件已更换</span>
              ) : (
                <>
                  <span className="text-[var(--muted-foreground)] line-through">{it.oldValue}</span>
                  <span className="text-[var(--accent)]">→</span>
                  <span className="font-semibold text-[var(--foreground)]">{it.newValue}</span>
                </>
              )}
            </>
          ) : (
            <>
              <span className={`rounded-full px-1.5 py-px text-[10px] font-bold ${KIND_META[it.kind]?.cls ?? ''}`}
                style={{ background: 'color-mix(in oklch, currentColor 12%, transparent)' }}>{KIND_META[it.kind]?.text}</span>
              <span className="font-medium text-[var(--foreground)]">{it.rowLabel}</span>
            </>
          )}
        </div>
      ))}
    </div>
  );
}

/** 补正变更清单行区（2026-11-24）：无本轮/无变化项渲染 null；外层容器由调用面自定 */
export function CorrectionDiffList({ diff }: { diff: CorrectionDiffResult | null }) {
  const sections = (diff?.sections ?? []).filter((s) => s.items.length > 0);
  if (!diff?.hasRound || sections.length === 0) return null;
  return (
    <div className="flex flex-col gap-2.5">
      {sections.map((sec) => (
        <div key={sec.key}>
          <div className="mb-1 text-[11px] font-bold text-[var(--muted-foreground)]">{sec.label}</div>
          <DiffRows section={sec} />
        </div>
      ))}
    </div>
  );
}
