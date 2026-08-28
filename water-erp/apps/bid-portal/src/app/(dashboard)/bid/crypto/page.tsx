'use client';

/**
 * 加密管理 —— 管理方加密证书 + 投标保密机制说明（面向开标管理员/监督的业务语言）。
 * 读：admin + bid_host；轮转/生成：仅 admin。
 * 原侧栏底部 AdminCertCard（T17，4092b80a）已于 2026-08-28 并入本页。
 * 注：公钥本身是公开物（供应商投递前即从本接口拉取用于加密），页面仅展示指纹不展示全量——
 * 管理场景无完整公钥需求；机密是服务端私钥，从不离开服务器。
 */

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  KeyRound,
  Loader,
  RefreshCw,
  ShieldCheck,
  FileLock2,
  Landmark,
  Unlock,
  ShieldAlert,
} from 'lucide-react';
import { getAdminCert, generateAdminCert, api, type AdminCertInfo } from '@/lib/api';

/* 流程三步（业务语言，无密码学术语） */
const FLOW = [
  {
    icon: FileLock2,
    title: '① 投标时上锁',
    text: '投标人递交投标文件时，系统用这份证书给文件上第一道锁，同时投标人自己的 U 相再上第二道锁。',
  },
  {
    icon: Landmark,
    title: '② 开标前密封',
    text: '双重上锁的文件全程密封保管，任何人（包括平台管理员）在开标前都无法看到投标内容。',
  },
  {
    icon: Unlock,
    title: '③ 开标时开锁',
    text: '开标现场按流程解密：先由主持端解开第一道锁，再由投标人在解密窗口解开自己的锁，文件方可阅读。',
  },
];

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
      '更换证书后，新的投标文件将立即改用新证书加密。\n' +
      '此前已递交的投标不受任何影响——系统保留旧钥匙，开标时照常解密。\n\n确认更换新证书？',
    )) return;
    setGenerating(true);
    try {
      await generateAdminCert();
      toast.success('证书已更换，新证书已生效');
      await load();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : '生成失败');
    } finally {
      setGenerating(false);
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
            投标文件加密所用的管理方证书——当前状态、更换与保密机制说明
          </p>
        </div>
        <button type="button" onClick={load} disabled={loading} title="刷新" className="neu-btn-xs">
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* ── 当前证书 ── */}
      <section className="neu-card-static p-5">
        <div className="mb-4 flex items-center gap-2 border-b border-[color:var(--border)] pb-3">
          <ShieldCheck size={15} strokeWidth={1.7} className="text-[color:var(--accent-strong)]" />
          <h2 className="text-sm font-bold text-[color:var(--foreground)]">当前生效证书</h2>
          {cert?.active && (
            <span className="ml-auto inline-flex items-center gap-0.5 rounded-full bg-[oklch(0.71_0.11_164_/_0.16)] px-2 py-0.5 text-[10px] font-bold text-[var(--success)]">
              <ShieldCheck size={9} /> 生效中
            </span>
          )}
        </div>

        {loading && cert === undefined ? (
          <div className="flex items-center justify-center gap-2 py-8 text-[13px] text-[color:var(--muted-foreground)]">
            <Loader size={14} className="animate-spin" /> 读取证书中…
          </div>
        ) : cert ? (
          <div className="space-y-4">
            <dl className="grid gap-x-6 gap-y-2.5 text-[13px] sm:grid-cols-[88px_1fr]">
              <dt className="text-[color:var(--muted-foreground)]">证书名称</dt>
              <dd className="min-w-0 break-all font-medium text-[color:var(--foreground)]">{cert.certDn}</dd>
              <dt className="text-[color:var(--muted-foreground)]">证书编号</dt>
              <dd className="font-mono text-[12px] text-[color:var(--foreground)]">{cert.id}</dd>
              <dt className="text-[color:var(--muted-foreground)]">启用日期</dt>
              <dd className="text-[color:var(--foreground)]">
                {new Date(cert.createdAt).toLocaleString('zh-CN', { hour12: false })}
              </dd>
              <dt className="text-[color:var(--muted-foreground)]">证书指纹</dt>
              <dd className="font-mono text-[12px] tracking-tight text-[color:var(--foreground)]" title="用于辨识证书唯一性的短指纹">
                {cert.publicKey.slice(0, 12)}…{cert.publicKey.slice(-6)}
              </dd>
            </dl>
            {isAdmin ? (
              <div className="flex flex-wrap items-start gap-3 border-t border-[color:var(--border)] pt-3">
                <button
                  type="button"
                  onClick={handleGenerate}
                  disabled={generating}
                  className="neu-btn-soft is-warning flex items-center gap-1.5 !h-[34px] px-4 text-[12px] disabled:opacity-50"
                >
                  {generating ? <Loader size={12} className="animate-spin" /> : <KeyRound size={12} strokeWidth={1.7} />}
                  {generating ? '更换中…' : '更换新证书'}
                </button>
                <p className="min-w-0 flex-1 pt-1 text-[11px] leading-relaxed text-[color:var(--muted-foreground)]">
                  更换后新的投标改用新证书加密；此前已递交的投标不受影响——系统为每份投标记录所用证书，
                  开标时凭对应的旧钥匙照常解密。
                </p>
              </div>
            ) : (
              <p className="border-t border-[color:var(--border)] pt-3 text-[11px] text-[color:var(--muted-foreground)]">
                证书由系统管理员统一维护，此处为只读查看。
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-3 py-2">
            <div className="flex items-center gap-1.5 text-[13px] font-semibold text-[var(--danger)]">
              <ShieldAlert size={14} strokeWidth={1.7} /> 暂无生效证书（系统应已自动生成，请联系管理员检查服务端）
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

      {/* ── 投标保密机制（业务语言三步）── */}
      <section className="neu-card-static p-5">
        <div className="mb-4 flex items-center gap-2 border-b border-[color:var(--border)] pb-3">
          <ShieldCheck size={15} strokeWidth={1.7} className="text-[color:var(--accent-strong)]" />
          <h2 className="text-sm font-bold text-[color:var(--foreground)]">投标文件是怎样保密的</h2>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          {FLOW.map(({ icon: Icon, title, text }) => (
            <div key={title} className="rounded-[12px] border border-[color:var(--border)] p-3.5">
              <p className="flex items-center gap-1.5 text-[13px] font-bold text-[color:var(--foreground)]">
                <Icon size={14} strokeWidth={1.7} className="text-[color:var(--accent-strong)]" /> {title}
              </p>
              <p className="mt-1.5 text-[12px] leading-relaxed text-[color:var(--muted-foreground)]">{text}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── 安全须知（简短业务语言）── */}
      <section className="neu-card-static p-5">
        <div className="mb-3 flex items-center gap-2 border-b border-[color:var(--border)] pb-3">
          <ShieldAlert size={15} strokeWidth={1.7} className="text-[var(--warning)]" />
          <h2 className="text-sm font-bold text-[color:var(--foreground)]">安全须知</h2>
        </div>
        <ul className="space-y-2 text-[12px] leading-relaxed text-[color:var(--muted-foreground)]">
          <li className="flex gap-2">
            <ShieldAlert size={13} strokeWidth={1.7} className="mt-0.5 shrink-0 text-[var(--warning)]" />
            <span>解密钥匙（私钥）只保存在服务器专用保管目录，<b className="text-[color:var(--foreground)]">任何页面、任何人都看不到、取不走</b>；该目录已列入运维备份清单，请勿在服务器上自行清理。</span>
          </li>
          <li className="flex gap-2">
            <ShieldCheck size={13} strokeWidth={1.7} className="mt-0.5 shrink-0 text-[var(--success)]" />
            <span>更换证书不影响历史投标——每份投标都记录了加密时所用的证书，开标时系统自动用对应的钥匙解密。</span>
          </li>
        </ul>
      </section>
    </div>
  );
}
