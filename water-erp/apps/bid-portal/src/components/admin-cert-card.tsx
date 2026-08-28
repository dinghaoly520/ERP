'use client';

import { useCallback, useEffect, useState } from 'react';
import { KeyRound, Loader, ShieldCheck } from 'lucide-react';
import { getAdminCert, generateAdminCert, type AdminCertInfo } from '@/lib/api';
import { toast } from 'sonner';

/* ═══ 管理方加密证书卡片（§3.2，T17；仅 admin 可见——挂于侧栏底部）═══
   双信封 v2 外层 K_admin 的公钥载体：供应商投递时用它包裹外层 DEK_A，
   开标时主持端解外层凭对应私钥（keystore 托管）。轮转 = 新证 active、旧证 inactive
   （旧私钥文件保留——历史信封仍可解）。 */

export default function AdminCertCard() {
  const [cert, setCert] = useState<AdminCertInfo | null | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setCert(await getAdminCert());
    } catch {
      setCert(undefined);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const handleGenerate = async () => {
    if (!window.confirm(
      '生成新的管理方加密证书将立即使当前证书失效（inactive）。\n' +
      '历史已提交信封不受影响——旧证书私钥仍保留，可正常解外层。\n\n确认生成新证书？',
    )) return;
    setGenerating(true);
    try {
      await generateAdminCert();
      toast.success('管理方加密证书已轮转，新证书已生效');
      await load();
    } catch (e: any) {
      toast.error(e?.message || '生成证书失败');
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="rounded-2xl border border-[oklch(0.5_0.1_258_/_0.28)] bg-[oklch(0.99_0.004_258_/_0.75)] p-3 shadow-[inset_0_1px_0_oklch(1_0_0_/_0.88),3px_3px_10px_oklch(0.52_0.04_258_/_0.16)] backdrop-blur-md">
      <div className="mb-2 flex items-center gap-1.5">
        <KeyRound size={13} strokeWidth={1.7} className="shrink-0 text-[var(--accent-strong)]" />
        <span className="truncate text-[11px] font-bold uppercase tracking-wider text-[color:var(--foreground)]">
          管理方加密证书
        </span>
        {cert?.active && (
          <span className="ml-auto inline-flex items-center gap-0.5 rounded-full bg-[oklch(0.71_0.11_164_/_0.16)] px-1.5 py-0.5 text-[9px] font-bold text-[var(--success)]">
            <ShieldCheck size={9} /> 生效中
          </span>
        )}
      </div>

      {loading && cert === undefined ? (
        <div className="flex items-center gap-1.5 py-1 text-[10px] text-[color:var(--muted-foreground)]">
          <Loader size={10} className="animate-spin" /> 读取中…
        </div>
      ) : cert ? (
        <div className="space-y-1">
          <div className="text-[10px] leading-relaxed text-[color:var(--muted-foreground)]">
            <div className="truncate" title={cert.certDn}>{cert.certDn}</div>
            <div className="font-mono tracking-tight" title={cert.publicKey}>
              公钥 {cert.publicKey.slice(0, 12)}…{cert.publicKey.slice(-6)}
            </div>
            <div>颁发 {new Date(cert.createdAt).toLocaleDateString('zh-CN')}</div>
          </div>
          <button
            type="button"
            onClick={handleGenerate}
            disabled={generating}
            className="neu-btn-soft is-warning mt-1 flex w-full items-center justify-center gap-1 !h-[30px] text-[10px] disabled:opacity-50"
          >
            {generating ? <Loader size={10} className="animate-spin" /> : <KeyRound size={10} strokeWidth={1.7} />}
            {generating ? '生成中…' : '生成新证书（轮转）'}
          </button>
        </div>
      ) : (
        <div className="space-y-1">
          <div className="text-[10px] text-[var(--danger)]">无 active 证书（服务端应已自举，请检查 API 日志）</div>
          <button
            type="button"
            onClick={handleGenerate}
            disabled={generating}
            className="neu-btn-soft is-warning mt-1 flex w-full items-center justify-center gap-1 !h-[30px] text-[10px] disabled:opacity-50"
          >
            {generating ? <Loader size={10} className="animate-spin" /> : <KeyRound size={10} strokeWidth={1.7} />}
            {generating ? '生成中…' : '生成管理方证书'}
          </button>
        </div>
      )}
    </div>
  );
}
