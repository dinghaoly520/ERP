"use client";

/**
 * 管理方加密证书卡片（§3.2，T17）—— 小卡片模式，面向采购中心管理员（业务语言）。
 * 供应商投递投标时系统用该证书上第一道锁，开标时主持端凭配套钥匙解密；
 * 更换证书不影响已递交的投标（每份投标记录所用证书，解密自动配对）。
 * 公钥为公开物（供应商端投递前即拉取），卡片仅展示指纹；机密私钥只在服务端保管目录。
 */

import { useCallback, useEffect, useState } from "react";
import { KeyRound, Loader2, RefreshCw, ShieldAlert, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { fetchAdminCert, generateAdminCert, type AdminCertInfo } from "@/lib/api/admin-cert";

export function AdminCertCard() {
  const [cert, setCert] = useState<AdminCertInfo | null | undefined>(undefined); // undefined = 加载中
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    fetchAdminCert()
      .then(setCert)
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

  return (
    <div className="neu-card p-5">
      <div className="mb-4 flex items-center gap-2 border-b border-[color:var(--border)] pb-3">
        <ShieldCheck size={15} strokeWidth={1.7} className="text-[color:var(--accent-strong)]" />
        <h2 className="text-sm font-bold text-[color:var(--foreground)]">当前生效证书</h2>
        {cert?.active && (
          <span className="ml-auto inline-flex items-center gap-0.5 rounded-full bg-[oklch(0.71_0.11_164_/_0.16)] px-2 py-0.5 text-[10px] font-bold text-[var(--success)]">
            <ShieldCheck size={9} /> 生效中
          </span>
        )}
        <button type="button" onClick={load} disabled={loading} title="刷新" className="neu-btn-xs">
          <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
        </button>
      </div>

      {loading && cert === undefined ? (
        <div className="flex items-center justify-center gap-2 py-8 text-[13px] text-[color:var(--muted-foreground)]">
          <Loader2 size={14} className="animate-spin" /> 读取证书中…
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
              {new Date(cert.createdAt).toLocaleString("zh-CN", { hour12: false })}
            </dd>
            <dt className="text-[color:var(--muted-foreground)]">证书指纹</dt>
            <dd className="font-mono text-[12px] tracking-tight text-[color:var(--foreground)]" title="用于辨识证书唯一性的短指纹">
              {cert.publicKey.slice(0, 12)}…{cert.publicKey.slice(-6)}
            </dd>
          </dl>
          <div className="flex flex-wrap items-start gap-3 border-t border-[color:var(--border)] pt-3">
            <button
              type="button"
              onClick={handleGenerate}
              disabled={generating}
              className="neu-btn flex items-center gap-1.5 !h-[34px] px-4 text-[12px] disabled:opacity-50"
            >
              {generating ? <Loader2 size={12} className="animate-spin" /> : <KeyRound size={12} strokeWidth={1.7} />}
              {generating ? "更换中…" : "更换新证书"}
            </button>
            <p className="min-w-0 flex-1 pt-1 text-[11px] leading-relaxed text-[color:var(--muted-foreground)]">
              更换后新的投标改用新证书加密；此前已递交的投标不受影响——系统为每份投标记录所用证书，
              开标时凭对应的旧钥匙照常解密。解密钥匙只保存在服务器专用保管目录，任何页面、任何人都看不到、取不走。
            </p>
          </div>
        </div>
      ) : (
        <div className="space-y-3 py-2">
          <div className="flex items-center gap-1.5 text-[13px] font-semibold text-[var(--danger)]">
            <ShieldAlert size={14} strokeWidth={1.7} /> 暂无生效证书（系统应已自动生成，请联系管理员检查服务端）
          </div>
          <button
            type="button"
            onClick={handleGenerate}
            disabled={generating}
            className="neu-btn flex items-center gap-1.5 !h-[34px] px-4 text-[12px] disabled:opacity-50"
          >
            {generating ? <Loader2 size={12} className="animate-spin" /> : <KeyRound size={12} strokeWidth={1.7} />}
            {generating ? "生成中…" : "生成管理方证书"}
          </button>
        </div>
      )}
    </div>
  );
}
