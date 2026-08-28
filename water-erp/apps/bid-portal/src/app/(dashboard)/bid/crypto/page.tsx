'use client';

/**
 * 加密管理 —— 管理方加密证书（双信封 v2 外层 K_admin 公钥载体）+ 双信封体系/密钥托管说明。
 * 读：admin + bid_host（现场可确认当前加密用的是哪把公钥）；轮转/生成：仅 admin。
 * 原侧栏底部 AdminCertCard（T17，4092b80a）已于 2026-08-28 并入本页。
 */

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  KeyRound,
  Loader,
  RefreshCw,
  ShieldCheck,
  Copy,
  Layers,
  ShieldAlert,
  HardDrive,
} from 'lucide-react';
import { getAdminCert, generateAdminCert, api, type AdminCertInfo } from '@/lib/api';

export default function CryptoManagePage() {
  const [cert, setCert] = useState<AdminCertInfo | null | undefined>(undefined); // undefined = 加载中
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [role, setRole] = useState<string>('');

  const load = useCallback(() => {
    setLoading(true);
    getAdminCert()
      .then(setCert)
      .catch(() => setCert(undefined))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    void load();
    api.get<{ role: string }>('/auth/me')
      .then(u => setRole(u?.role ?? ''))
      .catch(() => setRole(''));
  }, [load]);

  const isAdmin = role === 'admin';

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
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : '生成失败');
    } finally {
      setGenerating(false);
    }
  };

  const copyPk = async () => {
    if (!cert?.publicKey) return;
    try {
      await navigator.clipboard.writeText(cert.publicKey);
      toast.success('公钥已复制到剪贴板');
    } catch {
      toast.error('复制失败，请手动选择复制');
    }
  };

  return (
    <div className="space-y-5">
      {/* ── 页头 ── */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="flex items-center gap-2 text-lg font-bold text-[color:var(--foreground)]">
            <KeyRound size={18} strokeWidth={1.7} className="shrink-0 text-[color:var(--accent-strong)]" />
            加密管理
          </h1>
          <p className="mt-0.5 text-[13px] text-[color:var(--muted-foreground)]">
            管理方加密证书与双信封密钥托管——投标保密性的公钥载体与轮转留痕
          </p>
        </div>
        <button type="button" onClick={load} disabled={loading} title="刷新" className="neu-btn-xs">
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* ── 管理方加密证书（主功能区）── */}
      <section className="neu-card-static p-5">
        <div className="mb-4 flex items-center gap-2 border-b border-[color:var(--border)] pb-3">
          <ShieldCheck size={15} strokeWidth={1.7} className="text-[color:var(--accent-strong)]" />
          <h2 className="text-sm font-bold text-[color:var(--foreground)]">管理方加密证书</h2>
          {cert?.active && (
            <span className="ml-auto inline-flex items-center gap-0.5 rounded-full bg-[oklch(0.71_0.11_164_/_0.16)] px-2 py-0.5 text-[10px] font-bold text-[var(--success)]">
              <ShieldCheck size={9} /> 生效中
            </span>
          )}
        </div>

        {loading && cert === undefined ? (
          <div className="flex items-center gap-2 py-8 justify-center text-[13px] text-[color:var(--muted-foreground)]">
            <Loader size={14} className="animate-spin" /> 读取证书中…
          </div>
        ) : cert ? (
          <div className="space-y-4">
            <dl className="grid gap-x-6 gap-y-2.5 text-[13px] sm:grid-cols-[96px_1fr]">
              <dt className="text-[color:var(--muted-foreground)]">证书主体</dt>
              <dd className="min-w-0 break-all font-medium text-[color:var(--foreground)]" title={cert.certDn}>{cert.certDn}</dd>
              <dt className="text-[color:var(--muted-foreground)]">证书 ID</dt>
              <dd className="font-mono text-[12px] text-[color:var(--foreground)]">{cert.id}</dd>
              <dt className="text-[color:var(--muted-foreground)]">颁发日期</dt>
              <dd className="text-[color:var(--foreground)]">
                {new Date(cert.createdAt).toLocaleString('zh-CN', { hour12: false })}
              </dd>
            </dl>
            <div>
              <div className="mb-1 flex items-center gap-2">
                <span className="text-[13px] text-[color:var(--muted-foreground)]">SM2 公钥</span>
                <button
                  type="button"
                  onClick={copyPk}
                  className="neu-btn-xs !h-6 !px-2 text-[10px]"
                  title="复制完整公钥"
                >
                  <Copy size={11} strokeWidth={1.7} /> 复制
                </button>
              </div>
              <div className="break-all rounded-[10px] border border-[color:var(--border)] bg-[color:var(--muted)] px-3 py-2.5 font-mono text-[11px] leading-relaxed tracking-tight text-[color:var(--foreground)]">
                {cert.publicKey}
              </div>
            </div>
            {isAdmin ? (
              <div className="flex items-start gap-2 border-t border-[color:var(--border)] pt-3">
                <button
                  type="button"
                  onClick={handleGenerate}
                  disabled={generating}
                  className="neu-btn-soft is-warning flex items-center gap-1.5 !h-[34px] px-4 text-[12px] disabled:opacity-50"
                >
                  {generating ? <Loader size={12} className="animate-spin" /> : <KeyRound size={12} strokeWidth={1.7} />}
                  {generating ? '生成中…' : '生成新证书（轮转）'}
                </button>
                <p className="ml-1 pt-1 text-[11px] leading-relaxed text-[color:var(--muted-foreground)]">
                  轮转 = 新证置 active、旧证全部 inactive；旧私钥文件保留，历史信封按
                  <span className="mx-1 font-mono">envelope.adminCertId</span>
                  定位旧私钥仍可解外层。
                </p>
              </div>
            ) : (
              <p className="border-t border-[color:var(--border)] pt-3 text-[11px] text-[color:var(--muted-foreground)]">
                仅 admin 可轮转证书；当前为只读视图。
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-3 py-2">
            <div className="flex items-center gap-1.5 text-[13px] font-semibold text-[var(--danger)]">
              <ShieldAlert size={14} strokeWidth={1.7} /> 无 active 证书（服务端应已自举，请检查 API 日志）
            </div>
            {isAdmin && (
              <button
                type="button"
                onClick={handleGenerate}
                disabled={generating}
                className="neu-btn-soft is-warning flex items-center gap-1.5 !h-[34px] px-4 text-[12px] disabled:opacity-50"
              >
                {generating ? <Loader size={12} className="animate-spin" /> : <KeyRound size={12} strokeWidth={1.7} />}
                {generating ? '生成中…' : '生成管理方证书'}
              </button>
            )}
          </div>
        )}
      </section>

      {/* ── 双信封体系说明 ── */}
      <section className="neu-card-static p-5">
        <div className="mb-3 flex items-center gap-2 border-b border-[color:var(--border)] pb-3">
          <Layers size={15} strokeWidth={1.7} className="text-[color:var(--accent-strong)]" />
          <h2 className="text-sm font-bold text-[color:var(--foreground)]">双信封体系</h2>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-[12px] border border-[color:var(--border)] p-3.5">
            <p className="text-[13px] font-bold text-[color:var(--foreground)]">外层 · 管理方信封（C_outer）</p>
            <p className="mt-1.5 text-[12px] leading-relaxed text-[color:var(--muted-foreground)]">
              供应商投递时用<b className="text-[color:var(--foreground)]">本页管理方公钥</b>（SM2）包裹外层
              DEK_A。开标时主持端凭对应私钥剥外层——只能解到 C_inner，平台开标前不可读投标内容。
            </p>
          </div>
          <div className="rounded-[12px] border border-[color:var(--border)] p-3.5">
            <p className="text-[13px] font-bold text-[color:var(--foreground)]">内层 · 供应商信封（C_inner）</p>
            <p className="mt-1.5 text-[12px] leading-relaxed text-[color:var(--muted-foreground)]">
              供应商 U 盾（SM2/SM4）加密的投标明文载体，保密屏障在内层——供应商解密窗口内自行解密
              上传，管理方与平台均无法代解。
            </p>
          </div>
        </div>
      </section>

      {/* ── 密钥托管与备份 ── */}
      <section className="neu-card-static p-5">
        <div className="mb-3 flex items-center gap-2 border-b border-[color:var(--border)] pb-3">
          <HardDrive size={15} strokeWidth={1.7} className="text-[color:var(--accent-strong)]" />
          <h2 className="text-sm font-bold text-[color:var(--foreground)]">密钥托管与备份</h2>
        </div>
        <ul className="space-y-2 text-[12px] leading-relaxed text-[color:var(--muted-foreground)]">
          <li className="flex gap-2">
            <ShieldAlert size={13} strokeWidth={1.7} className="mt-0.5 shrink-0 text-[var(--warning)]" />
            <span>管理方私钥落盘于服务端 <span className="font-mono">ADMIN_KEYSTORE_DIR</span> 目录（每证一文件），<b className="text-[color:var(--foreground)]">不在数据库/MinIO 备份内——必须将该目录独立纳入备份</b>，丢失即历史信封外层永久不可解。</span>
          </li>
          <li className="flex gap-2">
            <ShieldCheck size={13} strokeWidth={1.7} className="mt-0.5 shrink-0 text-[var(--success)]" />
            <span>轮转后旧私钥文件保留至其覆盖的全部提交归档，历史信封按 <span className="font-mono">envelope.adminCertId</span> 定位旧私钥照常解密。</span>
          </li>
          <li className="flex gap-2">
            <KeyRound size={13} strokeWidth={1.7} className="mt-0.5 shrink-0 text-[color:var(--accent-strong)]" />
            <span>生产环境私钥应对应加密机/HSM 托管；当前为本地 keystore 模拟。</span>
          </li>
        </ul>
      </section>
    </div>
  );
}
