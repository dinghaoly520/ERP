'use client';

/**
 * 邀请回执链接桥接页（2026-10-27 用户裁定：域名模式下邀请链接统一挂根域 ssyc.scsfjt.com）。
 * 短信里的链接形如 https://ssyc.scsfjt.com/rsvp?t=<token>——供应商与专家两个回执页共用该路径，
 * 本页按 token 依次探询两个公开校验端点（/api/expert/rsvp/verify、/api/supplier/rsvp/verify），
 * 命中即跳转对应门户的回执页（域名模式→对应子域 https；IP:端口模式→同 IP 换端口）。
 * 未命中/缺 token：展示无效提示（链接过期或非本平台签发）。
 */
import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { ShieldAlert } from 'lucide-react';
import { portalOriginForHost } from '@water-erp/config';

function RsvpBridgeInner() {
  const params = useSearchParams();
  const token = String(params.get('t') || '');
  const [phase, setPhase] = useState<'resolving' | 'invalid'>('resolving');

  useEffect(() => {
    if (!token) { setPhase('invalid'); return; }
    let alive = true;
    (async () => {
      const probe = async (path: string) => {
        try {
          const r = await fetch(`${path}?t=${encodeURIComponent(token)}`, { cache: 'no-store' });
          return r.ok;
        } catch { return false; }
      };
      const proto = window.location.protocol.replace(':', '');
      const target = (app: 'expert' | 'supplier') =>
        `${portalOriginForHost(app, window.location.hostname, proto)}/rsvp?t=${encodeURIComponent(token)}`;
      // 专家 token 探询在前（15 分钟短时效，抢跳优先级更高；供应商 token 24 小时窗口宽）
      if (await probe('/api/expert/rsvp/verify')) { if (alive) window.location.replace(target('expert')); return; }
      if (await probe('/api/supplier/rsvp/verify')) { if (alive) window.location.replace(target('supplier')); return; }
      if (alive) setPhase('invalid');
    })();
    return () => { alive = false; };
  }, [token]);

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div
        className="w-full max-w-md rounded-[20px] p-8 text-center"
        style={{
          background: 'linear-gradient(105deg, oklch(1 0 0 / 0.94) 0%, oklch(0.99 0.003 258 / 0.62) 35%, oklch(1 0 0 / 0.14) 70%)',
          boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.75), 2px 3px 8px oklch(0.55 0.03 258 / 0.1), -2px -2px 8px oklch(1 0 0 / 0.88)',
        }}
      >
        <div className="text-lg font-bold tracking-wide">蜀水云采</div>
        <div className="mt-1 text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">邀请回执</div>
        {phase === 'resolving' ? (
          <>
            <div className="mx-auto mt-6 h-6 w-6 animate-spin rounded-full border-2 border-sky-200 border-t-sky-600" />
            <p className="mt-4 text-sm text-slate-500">正在解析回执链接，请稍候…</p>
          </>
        ) : (
          <>
            <ShieldAlert size={30} strokeWidth={1.6} className="mx-auto mt-5 text-amber-500" />
            <p className="mt-3 text-sm font-semibold text-slate-700">回执链接无效或已过期</p>
            <p className="mt-2 text-xs leading-relaxed text-slate-500">
              链接可能超过有效期，或已被使用后失效。请联系采购工作人员重新发送邀请通知。
            </p>
          </>
        )}
      </div>
    </main>
  );
}

export default function RsvpBridgePage() {
  return (
    <Suspense fallback={null}>
      <RsvpBridgeInner />
    </Suspense>
  );
}
