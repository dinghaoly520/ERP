'use client';

import type { AssistantCard as AssistantCardType } from '@/lib/types';
import { ActionPlanCard } from './action-plan-card';

export function AssistantCard({
  card,
  onConfirm,
  onCancel,
}: {
  card: AssistantCardType;
  onConfirm?: (id: string) => void;
  onCancel?: (id: string) => void;
}) {
  switch (card.type) {
    case 'metric':
      return (
        <div
          className="rounded-lg border p-4"
          style={{ borderColor: 'var(--color-border)' }}
        >
          <div
            className="text-xs"
            style={{ color: 'var(--color-text-tertiary)' }}
          >
            {card.title}
          </div>
          <div
            className="text-2xl font-bold mt-1"
            style={{
              color: 'var(--color-blue-950)',
              fontFamily: "'Manrope', monospace",
            }}
          >
            {card.value}
            {card.trend && (
              <span
                className="text-xs ml-2"
                style={{
                  color: card.trend.startsWith('+')
                    ? 'var(--color-success)'
                    : 'var(--color-danger)',
                }}
              >
                {card.trend}
              </span>
            )}
          </div>
        </div>
      );

    case 'table':
      return (
        <div
          className="rounded-lg border overflow-hidden"
          style={{ borderColor: 'var(--color-border)' }}
        >
          <div
            className="px-4 py-2 text-xs font-semibold"
            style={{
              background: 'var(--color-bg)',
              color: 'var(--color-text-secondary)',
            }}
          >
            {card.title}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr
                  style={{ borderBottom: '1px solid var(--color-border)' }}
                >
                  {card.columns.map((c) => (
                    <th
                      key={c.key}
                      className="px-4 py-2 text-left font-medium whitespace-nowrap"
                    >
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(card.rows as Array<Record<string, unknown>>).map(
                  (row, i) => (
                    <tr
                      key={i}
                      style={{
                        borderBottom: '1px solid var(--color-border)',
                      }}
                    >
                      {card.columns.map((c) => (
                        <td
                          key={c.key}
                          className="px-4 py-2 whitespace-nowrap"
                        >
                          {String(row[c.key] ?? '-')}
                        </td>
                      ))}
                    </tr>
                  ),
                )}
              </tbody>
            </table>
          </div>
        </div>
      );

    case 'chart':
      return (
        <div
          className="rounded-lg border p-4"
          style={{ borderColor: 'var(--color-border)' }}
        >
          <div
            className="text-xs mb-2"
            style={{ color: 'var(--color-text-tertiary)' }}
          >
            {card.title}
          </div>
          <div
            className="h-40 flex items-center justify-center rounded text-xs"
            style={{
              background: 'var(--color-bg)',
              color: 'var(--color-text-tertiary)',
            }}
          >
            {card.chartType === 'line' && '📈 '}
            {card.chartType === 'bar' && '📊 '}
            {card.chartType === 'pie' && '🥧 '}
            {card.chartType} 图表
          </div>
        </div>
      );

    case 'actionPlan':
      return (
        <ActionPlanCard
          plan={card}
          onConfirm={onConfirm || (() => {})}
          onCancel={onCancel || (() => {})}
        />
      );

    default:
      return null;
  }
}
