/* =================================================================
   ca-login-card — CA 登录卡片（供应商门户登录页双入口之一）
   流程：探测→枚举→选证→挑战→PIN→签名→登录→remember session
   ================================================================= */
'use client';
import { useState, useCallback, useRef } from 'react';
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
      // 登录 U盾（PIN 仅在此刻使用，不入任何日志/URL）
      await scca.loginScca(selected.container, pin);
      // 签名挑战原文
      const signP7 = await scca.signSccaP7(selected.container, challengeData.toSign);
      // 清 PIN（用后即清）
      setPin('');
      // 提交登录
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
      // 写 session（rememberSupplierSession——同密码登录收尾）
      const { rememberSupplierSession } = await import('@/lib/session-store');
      rememberSupplierSession(data.access_token);
      // 跳转
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

  return (
    <div className="rounded-xl border bg-white/80 p-5 shadow-sm" data-testid="ca-login-card">
      <h3 className="mb-3 text-base font-semibold text-gray-900">CA 证书登录</h3>
      {step === 'idle' && (
        <button
          onClick={startCaLogin}
          className="w-full rounded-lg border border-blue-600 bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700"
        >
          插入 U盾，使用 CA 证书登录
        </button>
      )}
      {step === 'probing' && <p className="text-sm text-gray-500">正在检测 U盾…</p>}
      {step === 'select-cert' && (
        <div>
          <p className="mb-2 text-sm text-gray-600">选择证书：</p>
          {certs.map(c => (
            <button key={c.container} onClick={() => selectCert(c)}
              className="mb-2 w-full rounded-lg border px-3 py-2 text-left text-sm hover:bg-gray-50">
              <span className="font-medium">{c.displayName}</span>
              <span className="ml-2 text-xs text-gray-400">{c.container.slice(0, 12)}…</span>
            </button>
          ))}
          <button onClick={cancel} className="mt-2 text-xs text-gray-400 hover:text-gray-600">取消</button>
        </div>
      )}
      {step === 'challenge' && <p className="text-sm text-gray-500">正在获取登录挑战…</p>}
      {step === 'awaiting-pin' && (
        <div>
          <p className="mb-2 text-sm text-gray-600">请输入 U盾 PIN：</p>
          <input
            type="password"
            value={pin}
            onChange={e => setPin(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') submitPin(); }}
            className="mb-3 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            placeholder="PIN 码"
            autoFocus
          />
          <div className="flex gap-2">
            <button onClick={submitPin} disabled={!pin}
              className="flex-1 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
              签名并登录
            </button>
            <button onClick={cancel} className="rounded-lg border px-4 py-2 text-sm text-gray-600">取消</button>
          </div>
        </div>
      )}
      {step === 'verifying' && <p className="text-sm text-gray-500">正在验证签名…</p>}
      {step === 'success' && <p className="text-sm text-green-600">登录成功，正在跳转…</p>}
      {step === 'failed' && (
        <div>
          <p className="mb-2 text-sm text-red-600">{error}</p>
          <button onClick={startCaLogin} className="text-sm text-blue-600 hover:underline">重试</button>
          <button onClick={cancel} className="ml-3 text-xs text-gray-400">返回</button>
        </div>
      )}
    </div>
  );
}
