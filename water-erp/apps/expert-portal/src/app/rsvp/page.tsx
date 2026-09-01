'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import './rsvp.css';

const fmt = (iso: string) => iso ? new Date(iso).toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';

interface RsvpView {
  expertName: string; major: string; expertRole: string;
  projectName: string; projectCode: string; procurementMethod: string;
  openTime: string; status: string; expired: boolean; isLead: boolean;
  projectScope?: string | null;
  rsvpNo?: string; respondedAt?: string | null;
  /** N6：后端 rsvp/verify 已返回实际过期时间——过期态文案展示真实时刻，不再写死时长 */
  expiresAt?: string | null;
}

function ExpertRsvpPage() {
  const params = useSearchParams();
  const token = params.get('t') || '';
  const [view, setView] = useState<RsvpView | null>(null);
  const [phase, setPhase] = useState<'loading' | 'invalid' | 'ready'>('loading');
  const [errMsg, setErrMsg] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!token) { setPhase('invalid'); setErrMsg('缺少邀请凭证，请从通知中的链接重新打开。'); return; }
    try {
      const res = await fetch(`/api/expert/rsvp/verify?t=${encodeURIComponent(token)}`);
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e?.error || '链接无效'); }
      setView(await res.json()); setPhase('ready');
    } catch (e: any) { setPhase('invalid'); setErrMsg(e?.message || '加载失败'); }
  }, [token]);
  useEffect(() => { load(); }, [load]);

  const respond = async (status: 'confirmed' | 'declined') => {
    if (busy) return; setBusy(true);
    try {
      const res = await fetch(`/api/expert/rsvp/respond?t=${encodeURIComponent(token)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) });
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e?.error || '操作失败'); }
      await load();
    } catch (e: any) { setErrMsg(e?.message); }
    setBusy(false);
  };

  const isDone = view && (view.status === 'confirmed' || view.status === 'declined');
  const INFO = view ? [
    ['采购方式', view.procurementMethod], ['开标时间', fmt(view.openTime)],
    ['评审专业', view.major], ['专家角色', view.expertRole === '正选' ? '正选评审专家' : '候补评审专家'],
  ] : [];

  return (
    <main className="rv">
      <div className="rv-bg" aria-hidden="true" />
      <div className="rv-brand"><img src="/logo.png" alt="" className="rv-brand-mark" /><span className="rv-brand-name">智慧水发 · 蜀水云采</span></div>
      <section className="rv-panel">
        <div className="rv-card">
          <div className="rv-head">
            <span className="rv-brand-word">智慧水发<span>·</span>蜀水云采</span>
            <div className="rv-divider" aria-hidden="true">◆</div>
            <h1 className="rv-title">评审邀请确认</h1>
          </div>

          {phase === 'loading' && <div className="rv-state"><div className="rv-spin" /><p>正在核验邀请链接…</p></div>}

          {phase === 'invalid' && <div className="rv-state"><div className="rv-state-ico">!</div><p className="rv-state-msg">{errMsg}</p><p className="rv-hint">如有疑问，请联系四川省水利发展集团有限公司。</p></div>}

          {phase === 'ready' && view && (
            <>
              <div className="rv-to"><span className="rv-to-label">本邀请致</span><strong className="rv-to-name">{view.expertName}</strong></div>
              <h2 className="rv-subject">{view.projectName}</h2>
              <p className="rv-code">编号：{view.projectCode}</p>
              <dl className="rv-info">{INFO.map(([k, v]) => <div className="rv-info-row" key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>

              {view.projectScope && (
                <div style={{ marginBottom: '16px', padding: '12px 14px', borderRadius: '10px', background: 'oklch(0.97 0.01 252)', fontSize: '13px', lineHeight: '1.6', color: '#555' }}>
                  <div style={{ fontSize: '11px', fontWeight: 700, color: '#999', marginBottom: '4px' }}>项目概况及采购内容</div>
                  {view.projectScope}
                </div>
              )}

              {view.expired && !isDone && (
                <p className="rv-warn">
                  {view.expiresAt ? `该邀请链接已于 ${fmt(view.expiresAt)} 过期` : '该邀请链接已过期'}，已自动视为无法参加。如有疑问请联系四川省水利发展集团有限公司。
                </p>
              )}

              {isDone ? (
                <div className={`rv-done ${view.status === 'confirmed' ? 'rv-done--accept' : 'rv-done--decline'}`}>
                  <div className="rv-done-badge">{view.status === 'confirmed' ? '✓ 已确认参加' : '✕ 已确认无法参加'}</div>
                  {view.rsvpNo && <p style={{ marginTop: '10px', fontSize: '12px', color: '#999' }}>回执号：<strong style={{ fontFamily: 'monospace', letterSpacing: '0.1em', color: '#666' }}>{view.rsvpNo}</strong></p>}
                  {view.respondedAt && <p style={{ fontSize: '11px', color: '#bbb', marginTop: '2px' }}>{fmt(view.respondedAt)}</p>}
                </div>
              ) : view.expired ? null : (
                <div className="rv-actions">
                  <p className="rv-prompt">{view.expertRole === '候补' ? '请确认是否愿意作为候补待命：' : '请确认是否参加本次评审：'}</p>
                  <div className="rv-btns">
                    <button className="rv-btn rv-btn--accept" disabled={busy} onClick={() => respond('confirmed')}>
                      {busy ? '提交中…' : view.expertRole === '候补' ? '愿意待命' : '确认参加'}
                    </button>
                    <button className="rv-btn rv-btn--decline" disabled={busy} onClick={() => respond('declined')}>
                      无法参加
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
        <p className="rv-credit">智慧水发 · 蜀水云采 · 在线开评标</p>
      </section>
    </main>
  );
}

// Next 16 CSR bailout：useSearchParams 须处于 Suspense 边界内方可静态预渲染；
// 本文件为 client page，force-dynamic 不生效，故以包装组件提供边界（2026-08-14 修 build:expert 既有红）。
export default function RsvpPage() {
  return (
    <Suspense fallback={null}>
      <ExpertRsvpPage />
    </Suspense>
  );
}
