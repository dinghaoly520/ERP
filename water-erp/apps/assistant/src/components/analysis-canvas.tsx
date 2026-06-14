'use client';

import { useState, useEffect, useRef } from 'react';
import { PanelRightOpen, PanelRightClose } from 'lucide-react';
import type { AssistantCard as AssistantCardType, AssistantCitation } from '@/lib/types';

export function AnalysisCanvas({
  cards,
  citations,
}: {
  cards: AssistantCardType[];
  citations: AssistantCitation[];
}) {
  const [open, setOpen] = useState(true);
  const prevCardCount = useRef(cards.length);
  const displayCards = cards.filter((c) => c.type !== 'actionPlan');

  // Auto-open when new cards arrive
  useEffect(() => {
    if (cards.length > prevCardCount.current) {
      setOpen(true);
    }
    prevCardCount.current = cards.length;
  }, [cards.length]);

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        style={{
          position: 'fixed',
          right: '12px',
          top: '12px',
          width: '38px',
          height: '38px',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: '999px',
          background: 'rgba(255,255,255,0.6)',
          border: '1px solid rgba(201,217,239,0.42)',
          backdropFilter: 'blur(10px)',
          WebkitBackdropFilter: 'blur(10px)',
          color: 'var(--text-secondary)',
          cursor: 'pointer',
          zIndex: 10,
        }}
      >
        <PanelRightOpen size={18} />
      </button>
    );
  }

  return (
    <div
      style={{
        width: '320px',
        minWidth: '320px',
        borderLeft: '1px solid rgba(201,217,239,0.42)',
        height: '100vh',
        overflowY: 'auto',
        padding: '20px',
        background: 'rgba(255,255,255,0.45)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
        <span style={{ fontSize: 'var(--font-md)', fontWeight: 700, color: 'var(--text-heading)' }}>
          分析画布
        </span>
        <button
          onClick={() => setOpen(false)}
          style={{
            width: '32px',
            height: '32px',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: '10px',
            cursor: 'pointer',
            color: 'var(--text-muted)',
          }}
        >
          <PanelRightClose size={16} />
        </button>
      </div>

      {displayCards.length === 0 && citations.length === 0 && (
        <p style={{ fontSize: 'var(--font-xs)', color: 'var(--text-muted)' }}>
          暂无图表。问一个分析问题来生成数据卡片。
        </p>
      )}

      {/* Cards */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {displayCards.map((card, i) => {
          if (card.type === 'metric') {
            return (
              <div
                key={i}
                style={{
                  padding: '14px 16px',
                  borderRadius: '16px',
                  background: 'linear-gradient(135deg, rgba(255,255,255,0.64) 0%, rgba(244,249,255,0.44) 100%)',
                  border: '1px solid rgba(201,217,239,0.38)',
                  boxShadow: '0 2px 10px rgba(19,36,62,0.03)',
                  backdropFilter: 'blur(6px)',
                  WebkitBackdropFilter: 'blur(6px)',
                }}
              >
                <div style={{ fontSize: 'var(--font-xs)', color: 'var(--text-muted)', marginBottom: '4px' }}>{card.title}</div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--font-2xl)', fontWeight: 700, color: 'var(--text-heading)' }}>
                  {card.value}
                  {card.trend && (
                    <span style={{ fontSize: 'var(--font-xs)', fontFamily: 'var(--font-sans)', marginLeft: '6px', color: card.trend.startsWith('+') ? 'var(--success)' : 'var(--error)' }}>
                      {card.trend}
                    </span>
                  )}
                </div>
              </div>
            );
          }
          if (card.type === 'table') {
            return (
              <div
                key={i}
                style={{
                  borderRadius: '16px',
                  overflow: 'hidden',
                  background: 'linear-gradient(135deg, rgba(255,255,255,0.64) 0%, rgba(244,249,255,0.44) 100%)',
                  border: '1px solid rgba(201,217,239,0.38)',
                  boxShadow: '0 2px 10px rgba(19,36,62,0.03)',
                }}
              >
                <div style={{ padding: '10px 16px', fontSize: 'var(--font-xs)', fontWeight: 700, color: 'var(--text-secondary)', background: 'rgba(240,245,255,0.5)', borderBottom: '1px solid rgba(201,217,239,0.3)' }}>
                  {card.title}
                </div>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--font-xs)' }}>
                    <thead>
                      <tr>
                        {card.columns.map((c: { key: string; label: string }) => (
                          <th key={c.key} style={{ fontWeight: 600, color: 'var(--text-secondary)', textAlign: 'left', padding: '6px 12px', borderBottom: '1px solid rgba(201,217,239,0.25)', whiteSpace: 'nowrap', background: 'rgba(248,251,255,0.6)' }}>
                            {c.label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {(card.rows as Array<Record<string, unknown>>).map((row, j) => (
                        <tr key={j}>
                          {card.columns.map((c: { key: string }) => (
                            <td key={c.key} style={{ padding: '6px 12px', borderBottom: '1px solid rgba(201,217,239,0.15)', whiteSpace: 'nowrap' }}>
                              {String(row[c.key] ?? '-')}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          }
          return null;
        })}
      </div>

      {/* Citations */}
      {citations.length > 0 && (
        <div style={{ marginTop: '16px' }}>
          <div style={{ fontSize: 'var(--font-xs)', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '8px' }}>引用来源</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
            {citations.map((cit, j) => (
              <span key={j} style={{ display: 'inline-block', padding: '2px 8px', borderRadius: '999px', fontSize: 'var(--font-xs)', color: 'var(--text-hint)', background: 'rgba(240,245,255,0.7)', border: '1px solid rgba(201,217,239,0.3)' }}>
                [{cit.type}] {cit.title}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
