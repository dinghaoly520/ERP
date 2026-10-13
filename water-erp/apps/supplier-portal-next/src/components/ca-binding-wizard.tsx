/* =================================================================
   ca-binding-wizard — SCCA CA 双证绑定向导（cgzxui 化 2026-10-14）
   流程：近期密码验证(reauth) → 探测/枚举盾内双证 → bind-challenge →
         PIN 解锁 → 盾内签挑战 → bind 提交 → 刷新能力投影
   视觉：.neu-card + .neu-btn-soft/primary 三态 + .neu-input + 凸起选择行
   ================================================================= */
'use client';
import { useState, useCallback, useRef, useEffect } from 'react';
import { Usb, ShieldCheck, KeyRound, LoaderCircle, ChevronRight, X, RefreshCw } from 'lucide-react';
import * as scca from '@/utils/scca-ukey';
import type { SccaDualCert } from '@water-erp/ukey';
import { supplierApi } from '@/lib/api/supplier';
import { ApiError } from '@water-erp/client';

type Step = 'idle' | 'reauth' | 'probing' | 'select-cert' | 'challenge' | 'awaiting-pin' | 'submitting' | 'success' | 'failed';

export function CaBindingWizard({ onBound }: { onBound?: () => void }) {
  const [step, setStep] = useState<Step>('idle');
  const [password, setPassword] = useState('');
  const [pin, setPin] = useState('');
  const [certs, setCerts] = useState<SccaDualCert[]>([]);
  const [selected, setSelected] = useState<SccaDualCert | null>(null);
  const [error, setError] = useState('');
  const [challenge, setChallenge] = useState<{ challengeId: string; toSign: string } | null>(null);
  const [bound, setBound] = useState<{ id?: string; signingSerial?: string; encryptionSerial?: string; notAfter?: string } | null>(null);
  const [loadingBound, setLoadingBound] = useState(true);
  const proofRef = useRef<string>('');
  const actionIdRef = useRef(0);

  // 挂载时查服务端绑定状态（已绑定→详情+换绑入口）
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const caps = await supplierApi.caCapabilities();
        if (!alive) return;
        if (caps?.provider === 'scca' && caps?.activeBinding?.kind === 'ca') {
          setBound({
            id: caps.activeBinding.id,
            signingSerial: caps.activeBinding.signingCert?.serialHex,
            encryptionSerial: caps.activeBinding.encryptionCert?.serialHex,
            notAfter: caps.activeBinding.signingCert?.notAfter,
          });
        }
      } catch { /* 查询失败保持未绑定视图 */ }
      if (alive) setLoadingBound(false);
    })();
    return () => { alive = false; };
  }, []);

  const start = useCallback(() => {
    actionIdRef.current++;
    setError('');
    setPassword('');
    setStep('reauth');
  }, []);

  const submitReauth = useCallback(async () => {
    if (!password) return;
    const actionId = ++actionIdRef.current;
    setError('');
    try {
      const proof = await supplierApi.caReauth({ password, action: 'bind' });
      if (actionId !== actionIdRef.current) return;
      proofRef.current = proof.credentialProofId;
      setPassword('');

      setStep('probing');
      const online = await scca.probeScca();
      if (actionId !== actionIdRef.current) return;
      if (!online) { setStep('failed'); setError('未检测到 U盾——请插入并启动证书助手'); return; }
      const list = await scca.listSccaCerts();
      if (actionId !== actionIdRef.current) return;
      if (!list.length) { setStep('failed'); setError('U盾内未找到证书'); return; }
      setCerts(list);
      setStep('select-cert');
    } catch (e: any) {
      if (actionId !== actionIdRef.current) return;
      setStep('failed');
      const apiErr = e instanceof ApiError ? e : null;
      const data = (e as any)?.data;
      if (apiErr && data?.code === 'SESSION_REPLACED') {
        setError('登录已过期（账号在其他设备登录）——请刷新页面重新登录后再试');
      } else {
        setError(apiErr ? (apiErr.message || '密码验证失败') : (e?.message ?? '操作失败'));
      }
    }
  }, [password]);

  const selectCert = useCallback(async (cert: SccaDualCert) => {
    const actionId = ++actionIdRef.current;
    setSelected(cert);
    setError('');
    setStep('challenge');
    try {
      const res = await supplierApi.caBindChallenge(proofRef.current, cert.sign.pem, cert.enc.pem);
      if (actionId !== actionIdRef.current) return;
      setChallenge({ challengeId: res.challengeId, toSign: res.toSign });
      setStep('awaiting-pin');
    } catch (e: any) {
      if (actionId !== actionIdRef.current) return;
      setStep('failed');
      setError(e instanceof ApiError ? (e.message || '获取绑定挑战失败') : (e?.message ?? '获取绑定挑战失败'));
    }
  }, []);

  const submitPin = useCallback(async () => {
    if (!selected || !challenge || !pin) return;
    const actionId = ++actionIdRef.current;
    setStep('submitting');
    setError('');
    try {
      await scca.loginScca(selected.container, pin);
      const signP7 = await scca.signSccaP7(selected.container, challenge.toSign);
      setPin('');

      const result = await supplierApi.caBind({
        credentialScheme: 'scca-pkcs7',
        challengeId: challenge.challengeId,
        signP7,
        credentialProofId: proofRef.current,
        signCertPem: selected.sign.pem,
        encCertPem: selected.enc.pem,
        expectedActiveBindingId: bound?.id ?? null,
      });
      if (actionId !== actionIdRef.current) return;
      setStep('success');
      setBound({ signingSerial: '（刚绑定）' });
      onBound?.();
      void result;
    } catch (e: any) {
      if (actionId !== actionIdRef.current) return;
      setPin('');
      setStep('failed');
      setError(e instanceof ApiError ? (e.message || '绑定失败') : (e?.message ?? '绑定失败'));
    }
  }, [selected, challenge, pin, bound, onBound]);

  const cancel = useCallback(() => {
    actionIdRef.current++;
    setPin('');
    setPassword('');
    setStep('idle');
    setError('');
  }, []);

  const certName = (c: SccaDualCert) => {
    const m = /CN=([^,]+)/.exec(c.displayName);
    return m ? m[1] : c.displayName;
  };

  return (
    <div className="neu-card p-5" data-testid="ca-binding-wizard">
      <div className="mb-3 flex items-center gap-2.5">
        <span className="flex h-7 w-7 items-center justify-center rounded-[9px] bg-[var(--brand-soft)] text-[var(--brand)]">
          <ShieldCheck size={14} strokeWidth={1.9} />
        </span>
        <div>
          <div className="text-sm font-semibold text-[var(--ink)]">SCCA CA 证书绑定</div>
          <div className="text-[11px] text-[var(--fg-3)]">四川CA 双证（签名证 + 加密证）——绑定后可用 CA 证书登录</div>
        </div>
      </div>

      {loadingBound && <div className="py-2 text-sm text-[var(--fg-3)]">查询绑定状态…</div>}

      {!loadingBound && bound && step !== 'success' && (
        <div className="rounded-xl bg-[var(--success-soft)] p-4" style={{ boxShadow: "inset 0 1px 0 oklch(1 0 0 / 0.5)" }}>
          <div className="mb-1 flex items-center gap-2 text-sm font-semibold text-[var(--success)]">
            <ShieldCheck size={15} strokeWidth={1.9} />
            已绑定 SCCA CA 证书
          </div>
          {bound.signingSerial && bound.signingSerial !== '（刚绑定）' && (
            <div className="text-xs text-[var(--fg-2)]">
              签名证 <span className="font-mono">{bound.signingSerial.slice(0, 12)}…{bound.signingSerial.slice(-4)}</span>
              {bound.encryptionSerial ? <> · 加密证 <span className="font-mono">{bound.encryptionSerial.slice(0, 12)}…</span></> : null}
              {bound.notAfter ? <> · 有效期至 {new Date(bound.notAfter).toLocaleDateString('zh-CN')}</> : null}
            </div>
          )}
          <button onClick={start} className="neu-btn-xs mt-3 justify-center gap-1.5">
            <RefreshCw size={12} strokeWidth={1.9} />
            更换证书（换绑）
          </button>
        </div>
      )}

      {!loadingBound && !bound && step === 'idle' && (
        <button onClick={start} className="neu-btn-soft w-full justify-center gap-2">
          <Usb size={15} strokeWidth={1.9} />
          开始绑定
        </button>
      )}

      {step === 'reauth' && (
        <div>
          <div className="mb-2 text-sm text-[var(--fg-2)]">请输入登录密码验证身份：</div>
          <input type="password" value={password} autoFocus
            onChange={e => setPassword(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') submitReauth(); }}
            className="neu-input mb-3 font-mono"
            placeholder="登录密码" autoComplete="current-password" />
          <div className="neu-btn-group w-full">
            <button onClick={submitReauth} disabled={!password}
              className="neu-btn-primary flex-1 justify-center gap-2 disabled:opacity-50">
              <KeyRound size={15} strokeWidth={1.9} />
              验证并继续
            </button>
            <button onClick={cancel} className="neu-btn-soft justify-center">取消</button>
          </div>
        </div>
      )}

      {step === 'probing' && (
        <div className="flex items-center gap-2.5 py-2 text-sm text-[var(--fg-2)]">
          <LoaderCircle size={15} className="animate-spin" strokeWidth={1.9} />
          正在检测 U盾…
        </div>
      )}

      {step === 'select-cert' && (
        <div>
          <div className="mb-2 text-sm text-[var(--fg-2)]">选择证书（签名证+加密证同容器）：</div>
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
          正在获取绑定挑战…
        </div>
      )}

      {step === 'awaiting-pin' && (
        <div>
          <div className="mb-2 text-sm text-[var(--fg-2)]">请输入 U盾 PIN：</div>
          <input type="password" value={pin} autoFocus
            onChange={e => setPin(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') submitPin(); }}
            className="neu-input mb-3 font-mono"
            placeholder="PIN 码" autoComplete="one-time-code" />
          <div className="neu-btn-group w-full">
            <button onClick={submitPin} disabled={!pin}
              className="neu-btn-primary flex-1 justify-center gap-2 disabled:opacity-50">
              <ShieldCheck size={15} strokeWidth={1.9} />
              签名并绑定
            </button>
            <button onClick={cancel} className="neu-btn-soft justify-center">取消</button>
          </div>
        </div>
      )}

      {step === 'submitting' && (
        <div className="flex items-center gap-2.5 py-2 text-sm text-[var(--fg-2)]">
          <LoaderCircle size={15} className="animate-spin" strokeWidth={1.9} />
          正在验证签名并写入绑定…
        </div>
      )}

      {step === 'success' && (
        <div className="flex items-center gap-2 py-2 text-sm font-medium text-[var(--success)]">
          <ShieldCheck size={15} strokeWidth={1.9} />
          绑定成功！可使用 CA 证书登录了
        </div>
      )}

      {step === 'failed' && (
        <div>
          <div className="mb-3 flex items-start gap-2 rounded-[10px] bg-[var(--danger-soft)] px-3 py-2.5 text-sm text-[var(--danger)]">
            <X size={15} className="mt-0.5 shrink-0" strokeWidth={1.9} />
            <span>{error}</span>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={start} className="neu-btn-xs justify-center">重试</button>
            <button onClick={cancel} className="text-xs text-[var(--fg-3)] transition-colors hover:text-[var(--fg)]">返回</button>
          </div>
        </div>
      )}
    </div>
  );
}
