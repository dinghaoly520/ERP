"use client";

/**
 * U盾管理 — 四川CA（SCCA）专属（2026-10-14 全面适配）
 *  - 本机连接：SccaUKeyAdapter.probe（wss://localhost:36171），2s 轮询
 *  - 证书投影：GET /api/ca/capabilities（provider/credentialScheme/revision/activeBinding 双证）
 *  - 绑定链：CaBindingWizard（reauth→盾枚举→bind-challenge→PIN 签→bind）
 *  - 自检：SCCA 本机链（枚举→签名→密钥封装往返）
 *  mock 轨（VendorUKeyAdapter :17999 / supplier_ukey_bound 缓存 / legacy PoP 绑定）已全删。
 */
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import dayjs from "dayjs";
import {
  CalendarClock,
  KeyRound,
  ShieldCheck,
  TriangleAlert,
  Usb,
  LoaderCircle,
  FileLock,
} from "lucide-react";
import { supplierApi } from "@/lib/api/supplier";
import { ApiError } from "@/lib/api";
import { EmptyState, LoadingBlock } from "@/components/ui";
import { CaBindingWizard } from '@/components/ca-binding-wizard';
import { CaSelftestDialog } from "@/components/profile/ca-selftest-dialog";
import { SpPageHero } from "@/components/sp-page-hero";
import { probeScca } from "@/utils/scca-ukey";
import "@/styles/pages/ukey.css";
import "@/styles/pages/shared.css";

/** 能力投影（后端 GET /api/ca/capabilities 契约） */
interface CaCapabilities {
  provider: string;
  credentialScheme: string;
  caCredentialRevision: number;
  activeBinding: {
    id: string;
    kind: string;
    signingCert: { serialHex: string; subject: string; notAfter: string } | null;
    encryptionCert: { serialHex: string; subject: string; notAfter: string } | null;
  } | null;
  allowedActions: string[];
  allowedEnvelopeVersions: string[];
  disabledReasons: string[];
}

/** 证书卡内的主体名提取（DN 的 CN） */
function certCn(subject: string | undefined): string {
  if (!subject) return "—";
  const m = /CN=([^,]+)/.exec(subject);
  return m ? m[1] : subject;
}

/** 有效期剩余文案 */
function validityText(notAfter?: string): { text: string; expired: boolean } {
  if (!notAfter) return { text: "未提供", expired: false };
  const d = dayjs(notAfter);
  const dateStr = d.isValid() ? d.format("YYYY-MM-DD") : String(notAfter);
  const days = Math.ceil((d.valueOf() - Date.now()) / 86400000);
  if (days < 0) return { text: `已于 ${dateStr} 过期`, expired: true };
  return { text: `有效期至 ${dateStr}（剩 ${days} 天）`, expired: false };
}

/** 证书卡（签名/加密通用） */
function CertCard({ icon: Icon, title, serialHex, subject, notAfter }: {
  icon: typeof ShieldCheck; title: string; serialHex: string | null; subject: string | null; notAfter: string | null;
}) {
  const v = validityText(notAfter ?? undefined);
  return (
    <div className="neu-card flex flex-col gap-3 p-5">
      <div className="flex items-center gap-2.5">
        <span className="flex h-7 w-7 items-center justify-center rounded-[9px] bg-[var(--brand-soft)] text-[var(--brand)]">
          <Icon size={14} strokeWidth={1.9} />
        </span>
        <div>
          <div className="text-sm font-semibold text-[var(--ink)]">{title}</div>
          <div className="text-[11px] text-[var(--fg-3)]">{certCn(subject ?? undefined)}</div>
        </div>
      </div>
      <div className="ca-carved-box flex flex-col gap-1.5 rounded-[10px] bg-[var(--success-soft)] px-3 py-2.5">
        <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--fg-3)]">证书序列号</span>
        <span className="font-mono text-xs text-[var(--fg)] break-all">{serialHex ?? "未绑定"}</span>
      </div>
      <div className={`flex items-center gap-1.5 text-xs ${v.expired ? "text-[var(--danger)]" : "text-[var(--fg-2)]"}`}>
        <CalendarClock size={13} strokeWidth={1.9} className="shrink-0" />
        {v.text}
      </div>
    </div>
  );
}

export default function UkeyManagePage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [caps, setCaps] = useState<CaCapabilities | null>(null);

  // ── 本机连接（SCCA 中间件 wss://localhost:36171，2s 轮询）──
  const [sccaOnline, setSccaOnline] = useState<boolean | null>(null);
  const pollRef = useRef(0);

  async function refreshCaps() {
    try {
      setCaps(await supplierApi.caCapabilities());
    } catch { /* 查询失败保持旧值 */ }
  }

  useEffect(() => {
    (async () => {
      try {
        await refreshCaps();
      } catch { setError(true); }
      finally { setLoading(false); }
    })();
  }, []);

  useEffect(() => {
    let alive = true;
    let bad = 0;
    const tick = async () => {
      const online = await probeScca().catch(() => false);
      if (!alive) return;
      if (!online) { bad++; } else { bad = 0; }
      setSccaOnline(bad < 3 ? online : false); // 3 次连续离线才翻转——防瞬断闪跳
    };
    tick();
    const timer = setInterval(tick, 2000);
    return () => { alive = false; clearInterval(timer); };
  }, []);

  const isBound = caps?.provider === 'scca' && caps?.activeBinding?.kind === 'ca';
  const binding = caps?.activeBinding;

  if (loading) return <LoadingBlock />;
  if (error) return <EmptyState icon={TriangleAlert} title="加载失败" desc="请刷新页面重试" />;

  return (
    <>
      <SpPageHero icon={KeyRound} title="U盾管理" sub="四川CA 数字证书与 U盾管理" />

      {/* ═══ KPI 行：本机连接 / 绑定状态 / 签名证 / 加密证 ═══ */}
      <div className="ukey-kpi-row">
        <div className="kpi-card">
          <span className="kpi-card__label">本机连接</span>
          <span className="kpi-card__value" style={sccaOnline ? { "--kpi-tone": "var(--success)" } as React.CSSProperties : undefined}>
            {sccaOnline === null ? "检测中" : sccaOnline ? "证书助手在线" : "未连接"}
          </span>
          <span className="kpi-card__sub">{sccaOnline ? "wss://localhost:36171" : "请启动证书助手并插入 U盾"}</span>
        </div>
        <div className="kpi-card">
          <span className="kpi-card__label">绑定状态</span>
          <span className="kpi-card__value" style={isBound ? { "--kpi-tone": "var(--success)" } as React.CSSProperties : undefined}>
            {isBound ? "已绑定" : "未绑定"}
          </span>
          <span className="kpi-card__sub">{isBound ? `修订 v${caps?.caCredentialRevision ?? 0}` : "绑定后可用 CA 证书登录与投标"}</span>
        </div>
        <div className="kpi-card">
          <span className="kpi-card__label">签名证书</span>
          <span className="kpi-card__value text-sm font-bold tracking-tight">
            {binding?.signingCert ? binding.signingCert.serialHex.slice(0, 10) + "…" : "—"}
          </span>
          <span className="kpi-card__sub">{validityText(binding?.signingCert?.notAfter ?? undefined).text}</span>
        </div>
        <div className="kpi-card">
          <span className="kpi-card__label">加密证书</span>
          <span className="kpi-card__value text-sm font-bold tracking-tight">
            {binding?.encryptionCert ? binding.encryptionCert.serialHex.slice(0, 10) + "…" : "—"}
          </span>
          <span className="kpi-card__sub">{validityText(binding?.encryptionCert?.notAfter ?? undefined).text}</span>
        </div>
      </div>

      {/* ═══ 绑定向导（未绑定→绑定；已绑定→详情+换绑）═══ */}
      <div className="mb-6 mt-4">
        <CaBindingWizard onBound={() => { refreshCaps(); }} />
      </div>

      {/* ═══ 双证书卡 ═══ */}
      <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <CertCard
          icon={ShieldCheck} title="签名证书"
          serialHex={binding?.signingCert?.serialHex ?? null}
          subject={binding?.signingCert?.subject ?? null}
          notAfter={binding?.signingCert?.notAfter ?? null}
        />
        <CertCard
          icon={FileLock} title="加密证书"
          serialHex={binding?.encryptionCert?.serialHex ?? null}
          subject={binding?.encryptionCert?.subject ?? null}
          notAfter={binding?.encryptionCert?.notAfter ?? null}
        />
      </div>

      {/* ═══ SCCA 自检 ═══ */}
      <div className="mb-6">
        <CaSelftestDialog
          onRefresh={refreshCaps}
          trigger={
            <button className="neu-btn-soft gap-2">
              <Usb size={15} strokeWidth={1.9} />
              连接与加解密自检
            </button>
          }
        />
      </div>

      {/* ═══ 未绑定提示 ═══ */}
      {!isBound && (
        <div className="flex items-start gap-2 rounded-[10px] bg-[var(--warning-soft)] px-3 py-2.5 text-sm text-[var(--warning)]">
          <TriangleAlert size={15} className="mt-0.5 shrink-0" strokeWidth={1.9} />
          <span>尚未绑定 SCCA CA 证书——完成上方绑定后，即可使用 CA 证书登录供应商门户并参与双信封投标（dual-v3 随阶段 2 开放）。</span>
        </div>
      )}
    </>
  );
}
