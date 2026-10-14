/* =================================================================
   ca-login-card — CA 证书登录卡片（cgzxui 化 2026-10-14）
   流程：探测→枚举→选证→挑战→PIN→签名→登录→remember session
   视觉：.neu-card 玻璃卡 + .neu-btn-soft 三态 + .neu-input 内凹输入
         + --danger-soft 色调警示（无边框/无 bg-* 反模式/无 emoji）
   ================================================================= */
'use client';
import { useState, useCallback, useRef } from 'react';
import { Usb, ShieldCheck, X, ChevronRight, LoaderCircle } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import * as scca from '@/utils/scca-ukey';
import type { SccaDualCert } from '@water-erp/ukey';

type Step = 'idle' | 'probing' | 'select-cert' | 'challenge' | 'awaiting-pin' | 'verifying' | 'success' | 'failed';

export function CaLoginCard({ redirect }: { redirect?: string }) {
  const { login: _pw } = useAuth();
  const [step, setStep] = useState<Step>('idle');
  const [certs, setCerts] = useState<SccaDualCert[]>([]);
  const [selected, setSelected] = useState<SccaDualCert | null>(null);
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [challengeData, setChallengeData] = useState<{ challengeId: string; toSign: string } | null>(null);
  const actionIdRef = useRef(0);

  const startCaLogin = useCallback(async () => {
    const actionId = ++actionIdRef.current;
    setError('');
    setStep('probing');
    try {
      const online = await scca.probeScca();
      if (actionId !== actionIdRef.current) return;
      if (!online) { setStep('failed'); setError('未检测到 U盾——请插入 SCCA CA U盾并启动证书助手'); return; }
      const list = await scca.listSccaCerts();
      if (actionId !== actionIdRef.current) return;
      if (!list.length) { setStep('failed'); setError('U盾内未找到证书'); return; }
      setCerts(list);
      setStep('select-cert');
    } catch (e: any) {
      if (actionId !== actionIdRef.current) return;
      setStep('failed'); setError(e?.message ?? 'U盾探测失败');
    }
  }, []);

  const selectCert = useCallback(async (cert: SccaDualCert) => {
    const actionId = ++actionIdRef.current;
    setSelected(cert);
    setError('');
    setStep('challenge');
    try {
      const res = await fetch('/api/auth/ca/challenge', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ provider: 'scca', signCertPem: cert.sign.pem }),
      });
      if (actionId !== actionIdRef.current) return;
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: '挑战请求失败' }));
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }
      const data = await res.json();
      setChallengeData({ challengeId: data.challengeId, toSign: data.toSign });
      setStep('awaiting-pin');
    } catch (e: any) {
      if (actionId !== actionIdRef.current) return;
      setStep('failed'); setError(e?.message ?? '获取挑战失败');
    }
  }, []);

  const submitPin = useCallback(async () => {
    if (!selected || !challengeData || !pin) return;
    const actionId = ++actionIdRef.current;
    setStep('verifying');
    setError('');
    try {
      await scca.loginScca(selected.container, pin);
      const signP7 = await scca.signSccaP7(selected.container, challengeData.toSign);
      setPin('');
      const res = await fetch('/api/auth/ca/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ challengeId: challengeData.challengeId, signP7 }),
      });
      if (actionId !== actionIdRef.current) return;
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: '登录失败' }));
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }
      const data = await res.json();
      setStep('success');
      const { rememberSupplierSession } = await import('@/lib/session-store');
      rememberSupplierSession(data.access_token);
      const target = redirect ?? '/dashboard';
      window.location.href = target;
    } catch (e: any) {
      if (actionId !== actionIdRef.current) return;
      setPin('');
      setStep('failed'); setError(e?.message ?? '签名验证失败');
    }
  }, [selected, challengeData, pin, redirect]);

  const cancel = useCallback(() => {
    actionIdRef.current++;
    setPin('');
    setStep('idle');
    setError('');
  }, []);

  const certName = (c: SccaDualCert) => {
    // DN 内 CN= 企业名提取（展示用；归属以后端校验为准）
    const m = /CN=([^,]+)/.exec(c.displayName);
    return m ? m[1] : c.displayName;
  };

  return (
    <div className="neu-card p-5" data-testid="ca-login-card">
      {/* 卡头：图标 + 标题 */}
      <div className="mb-3 flex items-center gap-2.5">
        <span className="flex h-7 w-7 items-center justify-center rounded-[9px] bg-[var(--brand-soft)] text-[var(--brand)]">
          <Usb size={14} strokeWidth={1.9} />
        </span>
        <div>
          <div className="text-sm font-semibold text-[var(--ink)]">CA 证书登录</div>
          <div className="text-[11px] text-[var(--fg-3)]">四川CA U盾数字证书</div>
        </div>
      </div>

      {step === 'idle' && (
        <button onClick={startCaLogin}
          className="neu-btn-soft w-full justify-center gap-2">
          <Usb size={15} strokeWidth={1.9} />
          插入 U盾，使用 CA 证书登录
        </button>
      )}

      {step === 'probing' && (
        <div className="flex items-center gap-2.5 py-2 text-sm text-[var(--fg-2)]">
          <LoaderCircle size={15} className="animate-spin" strokeWidth={1.9} />
          正在检测 U盾…
        </div>
      )}

      {step === 'select-cert' && (
        <div>
          <div className="mb-2 text-sm text-[var(--fg-2)]">选择证书：</div>
          <div className="flex flex-col gap-2">
            {certs.map(c => (
              <button key={c.container} onClick={() => selectCert(c)}
                className="group flex items-center justify-between gap-3 rounded-xl px-3.5 py-2.5 text-left text-sm text-[var(--fg)]
                  transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]
                  [box-shadow:inset_0_1px_0_oklch(1_0_0/0.7),2px_2px_4px_oklch(0.55_0.03_258/0.1),-1px_-1px_3px_oklch(1_0_0/0.85)]
                  hover:-translate-y-px hover:[box-shadow:inset_0_1px_0_oklch(1_0_0/0.8),3px_3px_6px_oklch(0.55_0.03_258/0.14),-2px_-2px_5px_oklch(1_0_0/0.9)]
                  active:translate-y-0 active:[box-shadow:inset_2px_2px_5px_oklch(0.55_0.03_258/0.15),inset_-2px_-2px_5px_oklch(1_0_0/0.5)]
                  motion-reduce:transition-none">
                <span className="truncate font-medium">{certName(c)}</span>
                <span className="flex items-center gap-1.5 text-xs text-[var(--fg-3)]">
                  <span className="font-mono">{c.container.slice(0, 12)}…</span>
                  <ChevronRight size={14} className="transition-transform group-hover:translate-x-0.5" />
                </span>
              </button>
            ))}
          </div>
          <button onClick={cancel} className="mt-3 text-xs text-[var(--fg-3)] transition-colors hover:text-[var(--fg)]">取消</button>
        </div>
      )}

      {step === 'challenge' && (
        <div className="flex items-center gap-2.5 py-2 text-sm text-[var(--fg-2)]">
          <LoaderCircle size={15} className="animate-spin" strokeWidth={1.9} />
          正在获取登录挑战…
        </div>
      )}

      {step === 'awaiting-pin' && (
        <div>
          <div className="mb-2 text-sm text-[var(--fg-2)]">请输入 U盾 PIN：</div>
          <input
            type="password"
            value={pin}
            onChange={e => setPin(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') submitPin(); }}
            className="neu-input mb-3 font-mono"
            placeholder="PIN 码"
            autoComplete="one-time-code"
            autoFocus
          />
          <div className="neu-btn-group w-full">
            <button onClick={submitPin} disabled={!pin}
              className="neu-btn-primary flex-1 justify-center gap-2 disabled:opacity-50">
              <ShieldCheck size={15} strokeWidth={1.9} />
              签名并登录
            </button>
            <button onClick={cancel} className="neu-btn-soft justify-center">取消</button>
          </div>
        </div>
      )}

      {step === 'verifying' && (
        <div className="flex items-center gap-2.5 py-2 text-sm text-[var(--fg-2)]">
          <LoaderCircle size={15} className="animate-spin" strokeWidth={1.9} />
          正在验证签名…
        </div>
      )}

      {step === 'success' && (
        <div className="flex items-center gap-2 py-2 text-sm font-medium text-[var(--success)]">
          <ShieldCheck size={15} strokeWidth={1.9} />
          登录成功，正在跳转…
        </div>
      )}

      {step === 'failed' && (
        <div>
          <div className="mb-3 flex items-start gap-2 rounded-[10px] bg-[var(--danger-soft)] px-3 py-2.5 text-sm text-[var(--danger)]">
            <X size={15} className="mt-0.5 shrink-0" strokeWidth={1.9} />
            <span>{error}</span>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={startCaLogin} className="neu-btn-xs justify-center">重试</button>
            <button onClick={cancel} className="text-xs text-[var(--fg-3)] transition-colors hover:text-[var(--fg)]">返回</button>
          </div>
        </div>
      )}
    </div>
  );
}
