'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import './rsvp.css';

const fmt = (iso: string) => iso ? new Date(iso).toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';

interface RsvpView {
  expertName: string; major: string; expertRole: string;
  projectName: string; projectCode: string; procurementMethod: string;
  /** 2026-10-27 用户裁定：信息卡四项=所属公司/开标时间/开标地点/采购方式（删名称/编号/角色/专业/概况） */
  companyName?: string | null;
  openLocation?: string | null;
  openTime: string; status: string; expired: boolean; isLead: boolean;
  projectScope?: string | null;
  rsvpNo?: string; respondedAt?: string | null;
  /** N6：后端 rsvp/verify 已返回实际过期时间——过期态文案展示真实时刻，不再写死时长 */
  expiresAt?: string | null;
  /** 作答方（2026-10-21 口径对齐）：代回应/代变更的行不展示回执号；自答快照供双时刻展示 */
  invitationActorType?: 'EXPERT' | 'STAFF' | 'SYSTEM' | null;
  expertRespondedAt?: string | null;
  expertStatus?: 'confirmed' | 'declined' | null;
}

function ExpertRsvpPage() {
  const params = useSearchParams();
  const token = params.get('t') || '';
  const [view, setView] = useState<RsvpView | null>(null);
  const [phase, setPhase] = useState<'loading' | 'invalid' | 'ready'>('loading');
  const [errMsg, setErrMsg] = useState('');
  const [busy, setBusy] = useState(false);
  // ready 阶段的提交失败反馈（深检修正：与 invalid 阶段的 errMsg 分离）
  const [actionError, setActionError] = useState('');

  const load = useCallback(async () => {
    if (!token) { setPhase('invalid'); setErrMsg('缺少邀请凭证，请从通知中的链接重新打开。'); return; }
    try {
      const res = await fetch(`/api/expert/rsvp/verify?t=${encodeURIComponent(token)}`);
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e?.error || '链接无效'); }
      setView(await res.json()); setPhase('ready');
    } catch (e: any) { setPhase('invalid'); setErrMsg(e instanceof TypeError ? '网络异常，请稍后重试' : e?.message || '加载失败'); }
  }, [token]);
  useEffect(() => { load(); }, [load]);

  const respond = async (status: 'confirmed' | 'declined') => {
    if (busy) return; setBusy(true); setActionError('');
    try {
      const res = await fetch(`/api/expert/rsvp/respond?t=${encodeURIComponent(token)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) });
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e?.error || '操作失败'); }
      await load();
    } catch (e: any) {
      setActionError(e instanceof TypeError ? '网络异常，请稍后重试' : e?.message || '操作失败');
    }
    setBusy(false);
  };

  const isDone = view && (view.status === 'confirmed' || view.status === 'declined');
  const INFO = view ? [
    ['项目所属公司', view.companyName || '—'], ['开标时间', fmt(view.openTime)],
    ['开标地点', view.openLocation || '—'], ['采购方式', view.procurementMethod],
  ] : [];

  return (
    <main className="rv">
      <div className="rv-bg" aria-hidden="true" />
      <div className="rv-brand"><img src="/logo.png" alt="" className="rv-brand-mark" /><span className="rv-brand-name">蜀水云采 · 智慧水发</span></div>
      <section className="rv-panel">
        <div className="rv-card">
          <div className="rv-head">
            <span className="rv-brand-word">蜀水云采<span>·</span>智慧水发</span>
            <div className="rv-divider" aria-hidden="true">◆</div>
            <h1 className="rv-title">评审邀请确认</h1>
          </div>

          {phase === 'loading' && <div className="rv-state"><div className="rv-spin" /><p>正在核验邀请链接…</p></div>}

          {phase === 'invalid' && <div className="rv-state"><div className="rv-state-ico">!</div><p className="rv-state-msg">{errMsg}</p><p className="rv-hint">如有疑问，请联系四川省水利发展集团有限公司。</p></div>}

          {phase === 'ready' && view && (
            <>
              <div className="rv-to"><span className="rv-to-label">本邀请致</span><strong className="rv-to-name">{view.expertName}</strong></div>
              <dl className="rv-info">{INFO.map(([k, v]) => <div className="rv-info-row" key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>

              {view.expired && !isDone && (
                <p className="rv-warn">
                  {view.expiresAt ? `该邀请链接已于 ${fmt(view.expiresAt)} 过期` : '该邀请链接已过期'}，已自动视为无法参加。如有疑问请联系四川省水利发展集团有限公司。
                </p>
              )}

              {isDone ? (
                <div className={`rv-done ${view.status === 'confirmed' ? 'rv-done--accept' : 'rv-done--decline'}`}>
                  <div className="rv-done-badge">{view.status === 'confirmed' ? '✓ 已确认参加' : '✕ 已确认无法参加'}</div>
                  {/* 回执号=专家自答凭证（2026-10-21 口径）：工作人员代回应/代变更的行不展示 */}
                  {view.invitationActorType !== 'STAFF' && view.rsvpNo && (
                    <p style={{ marginTop: '10px', fontSize: '12px', color: '#999' }}>回执号：<strong style={{ fontFamily: 'monospace', letterSpacing: '0.1em', color: '#666' }}>{view.rsvpNo}</strong></p>
                  )}
                  {view.respondedAt && <p style={{ fontSize: '11px', color: '#bbb', marginTop: '2px' }}>{fmt(view.respondedAt)}</p>}
                  {/* 代变更场景（2026-10-21）：本人的自答时刻与原选择 + 采购方变更时刻一并展示 */}
                  {view.invitationActorType === 'STAFF' && view.expertRespondedAt && (
                    <p style={{ fontSize: '11px', color: '#bbb', marginTop: '2px', lineHeight: 1.7 }}>
                      您于 {fmt(view.expertRespondedAt)} 回执「{view.expertStatus === 'confirmed' ? '确认参加' : '无法参加'}」，
                      采购方于 {fmt(view.respondedAt || '')} 将其变更为当前状态。如有疑问请联系采购方。
                    </p>
                  )}
                </div>
              ) : view.expired ? null : (
                <div className="rv-actions">
                  <p className="rv-prompt">{view.expertRole === '候补' ? '请确认是否愿意作为候补待命：' : '请确认是否参加本次评审：'}</p>
                  {/* 提交失败内联反馈（深检修正：errMsg 原只在 invalid 阶段渲染，并发双击的
                      ALREADY_RESPONDED 等错误静默无感） */}
                  {actionError && <p className="rv-warn" style={{ marginBottom: '10px' }}>{actionError}</p>}
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
        <p className="rv-credit">蜀水云采 · 智慧水发 · 在线开评标</p>
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
