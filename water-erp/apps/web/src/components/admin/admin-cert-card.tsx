"use client";

/**
 * 管理方加密证书页（§3.2，T17）—— 面向采购中心管理员的业务语言视图。
 * 供应商投递投标时系统用该证书上第一道锁（管理方证书），投标人的 U 盾再上第二道锁，
 * 开标现场按流程依次解密——开标前任何人（包括平台管理员）都无法看到投标内容。
 * 更换证书不影响已递交的投标（每份投标记录所用证书，解密自动配对）。
 * 公钥为公开物（供应商端投递前即拉取），页面仅展示指纹；机密私钥只在服务端保管目录。
 * 2026-08-31 视觉对齐 cgzxui：page-hero 标题卡 + 双锁流程条 + 证书状态卡。
 */

import { useCallback, useEffect, useState } from "react";
import { ChevronRight, Eye, KeyRound, Loader2, Lock, RefreshCw, ShieldAlert, ShieldCheck, Usb } from "lucide-react";
import { toast } from "sonner";
import { fetchCurrentUser } from "@/lib/api/auth";
import { fetchAdminCert, generateAdminCert, type AdminCertInfo } from "@/lib/api/admin-cert";

/** 双锁流程条：投标保密的三步（hero 第二行，替代大段说明文字） */
const LOCK_FLOW = [
  { icon: KeyRound, title: '第一道锁 · 管理方证书', desc: '投标人递交时，系统用本页证书加密投标文件' },
  { icon: Usb, title: '第二道锁 · 供应商 U 盾', desc: '供应商以自有 U 盾再封一层，双锁齐上' },
  { icon: Eye, title: '开标现场 · 依次解密', desc: '开标前任何人（含管理员）均无法查看内容' },
];

export function AdminCertPage() {
  const [cert, setCert] = useState<AdminCertInfo | null | undefined>(undefined); // undefined = 加载中
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [denied, setDenied] = useState(false); // 非 admin（URL 直达侧栏不可见时兜底）

  const load = useCallback(() => {
    setLoading(true);
    fetchCurrentUser()
      .then((u) => {
        if (u.role !== "admin") {
          setDenied(true);
          setCert(null);
          return undefined;
        }
        return fetchAdminCert();
      })
      .then((c) => { if (c !== undefined) setCert(c); })
      .catch(() => setCert(undefined))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleGenerate = async () => {
    if (!window.confirm(
      "更换证书后，新的投标文件将立即改用新证书加密。\n" +
      "此前已递交的投标不受任何影响——系统保留旧钥匙，开标时照常解密。\n\n确认更换新证书？",
    )) return;
    setGenerating(true);
    try {
      await generateAdminCert();
      toast.success("证书已更换，新证书已生效");
      await load();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "更换证书失败");
    } finally {
      setGenerating(false);
    }
  };

  const activeDays = cert ? Math.max(0, Math.floor((Date.now() - new Date(cert.createdAt).getTime()) / 86_400_000)) : 0;

  return (
    <div className="space-y-5">
      {/* ══ 标题卡（page-hero）：图标井 + 标题 + 状态 pill + 刷新 ══ */}
      <div className="page-hero">
        <div className="page-hero__row">
          <div className="page-hero__left">
            <div className="page-hero__icon">
              <KeyRound size={17} strokeWidth={1.9} />
            </div>
            <div>
              <div className="page-hero__title">加密管理</div>
              <div className="page-hero__sub">投标文件加密所用的管理方证书——当前状态与更换</div>
            </div>
          </div>
          <div className="page-hero__right">
            {denied ? (
              <span className="page-hero__stat page-hero__stat--warn">无权限</span>
            ) : cert?.active ? (
              <span className="page-hero__stat page-hero__stat--info">
                <span className="h-1.5 w-1.5 rounded-full shrink-0 bg-[var(--success)]" />
                证书生效中
              </span>
            ) : (
              <span className="page-hero__stat page-hero__stat--warn">
                <span className="h-1.5 w-1.5 rounded-full shrink-0 bg-[var(--danger)]" />
                未配置
              </span>
            )}
            <button type="button" onClick={load} disabled={loading} className="neu-btn-xs" aria-label="刷新" title="刷新">
              <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
            </button>
          </div>
        </div>

        <div style={{ borderTop: "1px solid oklch(0.6 0.04 258 / 0.16)", paddingTop: "1rem" }} />

        {/* 行2：双锁流程条（横向三步） */}
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          {LOCK_FLOW.map((f, i) => (
            <div key={f.title} className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] text-[var(--accent)]"
                style={{ background: 'color-mix(in oklch, var(--accent) 8%, transparent)', boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.5)' }}>
                <f.icon size={14} strokeWidth={1.8} />
              </div>
              <div className="min-w-0">
                <div className="text-[11px] font-bold text-[color:var(--foreground)]">{f.title}</div>
                <div className="truncate text-[10px] leading-4 text-[var(--muted-foreground)]" title={f.desc}>{f.desc}</div>
              </div>
              {i < LOCK_FLOW.length - 1 && <ChevronRight size={13} className="ml-auto shrink-0 text-[var(--muted-foreground)] opacity-50" />}
            </div>
          ))}
        </div>
      </div>

      {/* ══ 证书状态卡 ══ */}
      {loading && cert === undefined ? (
        <div className="wb-panel flex items-center justify-center gap-2 py-12 text-[13px] text-[color:var(--muted-foreground)]">
          <Loader2 size={15} className="animate-spin" /> 读取证书中…
        </div>
      ) : denied ? (
        <div className="wb-panel flex items-center gap-2 px-5 py-6 text-[13px] font-semibold text-[var(--danger)]">
          <ShieldAlert size={15} strokeWidth={1.7} /> 无权查看——加密证书管理仅限系统管理员
        </div>
      ) : cert ? (
        <div className="wb-panel p-6 space-y-5">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-[11px] text-[var(--success)]"
                style={{ background: 'color-mix(in oklch, var(--success) 12%, transparent)', boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.5)' }}>
                <ShieldCheck size={16} strokeWidth={1.9} />
              </div>
              <div>
                <div className="text-sm font-bold text-[color:var(--foreground)]">当前生效证书</div>
                <div className="text-[11px] text-[var(--muted-foreground)]">已生效 {activeDays} 天 · 新投标递交即用此证书加密</div>
              </div>
            </div>
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-bold text-[var(--success)]"
              style={{ background: 'oklch(0.71_0.11_164 / 0.14)' }}>
              <ShieldCheck size={10} /> 生效中
            </span>
          </div>

          <hr className="wb-section-rule" />

          <dl className="grid gap-x-6 gap-y-3 text-[13px] sm:grid-cols-[88px_1fr]">
            <dt className="pt-0.5 text-[color:var(--muted-foreground)]">证书名称</dt>
            <dd className="min-w-0 break-all font-medium text-[color:var(--foreground)]">{cert.certDn}</dd>
            <dt className="pt-0.5 text-[color:var(--muted-foreground)]">证书编号</dt>
            <dd className="font-mono text-[12px] tabular-nums text-[color:var(--foreground)]">{cert.id}</dd>
            <dt className="pt-0.5 text-[color:var(--muted-foreground)]">启用日期</dt>
            <dd className="tabular-nums text-[color:var(--foreground)]">
              {new Date(cert.createdAt).toLocaleString("zh-CN", { hour12: false })}
            </dd>
            <dt className="pt-0.5 text-[color:var(--muted-foreground)]">证书指纹</dt>
            <dd className="font-mono text-[12px] tracking-tight text-[color:var(--accent-strong)]" title="用于辨识证书唯一性的短指纹">
              {cert.publicKey.slice(0, 12)}…{cert.publicKey.slice(-6)}
            </dd>
          </dl>

          <hr className="wb-section-rule" />

          <div className="flex flex-wrap items-start gap-3">
            <button
              type="button"
              onClick={handleGenerate}
              disabled={generating}
              className="neu-btn-primary flex items-center gap-1.5 !h-[34px] px-4 text-[12px]"
            >
              {generating ? <Loader2 size={12} className="animate-spin" /> : <Lock size={12} strokeWidth={1.7} />}
              {generating ? "更换中…" : "更换新证书"}
            </button>
            <p className="min-w-0 flex-1 pt-1 text-[11px] leading-relaxed text-[color:var(--muted-foreground)]">
              更换后新的投标改用新证书加密；此前已递交的投标不受影响——系统为每份投标记录所用证书，
              开标时凭对应的旧钥匙照常解密。解密钥匙只保存在服务器专用保管目录，任何页面、任何人都看不到、取不走。
            </p>
          </div>
        </div>
      ) : (
        <div className="wb-panel p-6 space-y-4">
          <div className="flex items-center gap-1.5 text-[13px] font-semibold text-[var(--danger)]">
            <ShieldAlert size={15} strokeWidth={1.7} /> 暂无生效证书（系统应已自动生成，请联系管理员检查服务端）
          </div>
          <button
            type="button"
            onClick={handleGenerate}
            disabled={generating}
            className="neu-btn-primary flex items-center gap-1.5 !h-[34px] px-4 text-[12px]"
          >
            {generating ? <Loader2 size={12} className="animate-spin" /> : <Lock size={12} strokeWidth={1.7} />}
            {generating ? "生成中…" : "生成管理方证书"}
          </button>
        </div>
      )}
    </div>
  );
}

/** 向后兼容：旧引用（如 :3007 侧栏复用）继续导出卡片形态 */
export { AdminCertPage as AdminCertCard };
