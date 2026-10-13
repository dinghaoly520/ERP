/* =================================================================
   ca-binding-wizard — SCCA CA 双证绑定向导（阶段1 Task10 补全）

   流程：近期密码验证(reauth) → 探测/枚举盾内双证 → bind-challenge →
         PIN 解锁 → 盾内签挑战 → bind 提交 → 刷新能力投影
   ================================================================= */
'use client';
import { useState, useCallback, useRef, useEffect } from 'react';
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

  // 挂载时查服务端绑定状态（能力投影——已绑定则显示详情而非「开始绑定」）
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

  const start = useCallback(async () => {
    const actionId = ++actionIdRef.current;
    setError('');
    setStep('reauth');
    setPassword('');
  }, []);

  const submitReauth = useCallback(async () => {
    if (!password) return;
    const actionId = ++actionIdRef.current;
    setError('');
    try {
      // 近期密码重证
      const proof = await supplierApi.caReauth({ password, action: 'bind' });
      if (actionId !== actionIdRef.current) return;
      proofRef.current = proof.credentialProofId;
      setPassword('');

      // 探测盾
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
      // 盾内登录 + 签挑战
      await scca.loginScca(selected.container, pin);
      const signP7 = await scca.signSccaP7(selected.container, challenge.toSign);
      setPin('');

      // 提交绑定（双证 PEM + P7 证明）
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
      setBound({ signingSerial: selected.sign.pem ? '（刚绑定）' : '' });
      onBound?.();
    } catch (e: any) {
      if (actionId !== actionIdRef.current) return;
      setPin('');
      setStep('failed');
      setError(e instanceof ApiError ? (e.message || '绑定失败') : (e?.message ?? '绑定失败'));
    }
  }, [selected, challenge, pin, onBound]);

  const cancel = useCallback(() => {
    actionIdRef.current++;
    setPin('');
    setPassword('');
    setStep('idle');
    setError('');
  }, []);

  return (
    <div className="rounded-xl border border-blue-200 bg-blue-50/50 p-5" data-testid="ca-binding-wizard">
      <h3 className="mb-1 text-base font-semibold text-gray-900">SCCA CA 证书绑定</h3>
      <p className="mb-3 text-xs text-gray-500">绑定四川CA 双证（签名证+加密证）后，可用 CA 证书登录与投标</p>

      {loadingBound && <p className="text-sm text-gray-400">查询绑定状态…</p>}
      {!loadingBound && bound && step !== 'success' && (
        <div className="rounded-lg border border-green-200 bg-green-50 p-3">
          <p className="mb-1 text-sm font-medium text-green-700">✅ 已绑定 SCCA CA 证书</p>
          {bound.signingSerial && bound.signingSerial !== '（刚绑定）' && (
            <p className="text-xs text-gray-600">
              签名证 {bound.signingSerial.slice(0, 12)}…{bound.signingSerial.slice(-4)}
              {bound.encryptionSerial ? ' · 加密证 ' + bound.encryptionSerial.slice(0, 12) + '…' : ''}
              {bound.notAfter ? ' · 有效期至 ' + new Date(bound.notAfter).toLocaleDateString('zh-CN') : ''}
            </p>
          )}
          <button onClick={start}
            className="mt-2 rounded-lg border border-green-600 px-3 py-1.5 text-xs font-medium text-green-700 hover:bg-green-100">
            更换证书（换绑）
          </button>
        </div>
      )}
      {!loadingBound && !bound && step === 'idle' && (
        <button onClick={start}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">
          开始绑定
        </button>
      )}

      {step === 'reauth' && (
        <div>
          <p className="mb-2 text-sm text-gray-600">请输入登录密码验证身份：</p>
          <input type="password" value={password} autoFocus
            onChange={e => setPassword(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') submitReauth(); }}
            className="mb-3 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            placeholder="登录密码" />
          <div className="flex gap-2">
            <button onClick={submitReauth} disabled={!password}
              className="flex-1 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
              验证并继续
            </button>
            <button onClick={cancel} className="rounded-lg border px-4 py-2 text-sm text-gray-600">取消</button>
          </div>
        </div>
      )}

      {step === 'probing' && <p className="text-sm text-gray-500">正在检测 U盾…</p>}

      {step === 'select-cert' && (
        <div>
          <p className="mb-2 text-sm text-gray-600">选择证书（签名证+加密证同容器）：</p>
          {certs.map(c => (
            <button key={c.container} onClick={() => selectCert(c)}
              className="mb-2 w-full rounded-lg border bg-white px-3 py-2 text-left text-sm hover:bg-gray-50">
              <span className="font-medium">{c.displayName}</span>
              <span className="ml-2 text-xs text-gray-400">{c.container.slice(0, 12)}…</span>
            </button>
          ))}
          <button onClick={cancel} className="mt-2 text-xs text-gray-400 hover:text-gray-600">取消</button>
        </div>
      )}

      {step === 'challenge' && <p className="text-sm text-gray-500">正在获取绑定挑战…</p>}

      {step === 'awaiting-pin' && (
        <div>
          <p className="mb-2 text-sm text-gray-600">请输入 U盾 PIN：</p>
          <input type="password" value={pin} autoFocus
            onChange={e => setPin(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') submitPin(); }}
            className="mb-3 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            placeholder="PIN 码" />
          <div className="flex gap-2">
            <button onClick={submitPin} disabled={!pin}
              className="flex-1 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
              签名并绑定
            </button>
            <button onClick={cancel} className="rounded-lg border px-4 py-2 text-sm text-gray-600">取消</button>
          </div>
        </div>
      )}

      {step === 'submitting' && <p className="text-sm text-gray-500">正在验证签名并写入绑定…</p>}
      {step === 'success' && <p className="text-sm font-medium text-green-600">✅ 绑定成功！可使用 CA 证书登录了</p>}
      {step === 'failed' && (
        <div>
          <p className="mb-2 text-sm text-red-600">{error}</p>
          <button onClick={start} className="text-sm text-blue-600 hover:underline">重试</button>
          <button onClick={cancel} className="ml-3 text-xs text-gray-400">返回</button>
        </div>
      )}
    </div>
  );
}
