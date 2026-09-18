"use client";

/**
 * U盾管理 — vendor（U盘 CA 驱动中间件）唯一轨（2026-09-18 移除浏览器 mock 介质轨）。
 *  - 介质经 openUkey 走 VendorUKeyAdapter（:17999 中间件；自制 U盘自带驱动）
 *  - 绑定公开信息缓存键 `supplier_ukey_bound`（供投标提交页恢复 certSn 参考）
 */
import { useEffect, useRef, useState, type ComponentType } from "react";
import { toast } from "sonner";
import dayjs from "dayjs";
import {
  CalendarClock, FileLock, Lock, PenLine, ShieldCheck, TriangleAlert, Unlock,
} from "lucide-react";
import { VendorUKeyAdapter, type CertInfo } from "@water-erp/ukey";
import { openUkey } from "@/utils/ukey-factory";
import { isOwnCert } from "@/utils/ukey-cert-match";
import { useUkeyHealth } from "@/utils/use-ukey-health";
import { supplierApi } from "@/lib/api/supplier";
import { LoadingBlock, SpButton, SpInput } from "@/components/ui";
import { useConfirm } from "@/components/use-confirm";
import { CaSelftestDialog } from "@/components/profile/ca-selftest-dialog";
import { SpPageHero } from "@/components/sp-page-hero";
import "@/styles/pages/ukey.css";
import "@/styles/pages/shared.css"; // 卡片三件套/骨架屏基座（2026-09-02 去重抽出，跨页共用）

/** 绑定成功后在浏览器缓存证书公开信息（无任何私钥），供投标提交页恢复 certSn 参考 */
const BOUND_KEY = "supplier_ukey_bound";
interface BoundInfo { certSn: string; certDn: string; publicKey: string; certId: string }

/** 服务端绑定记录（与 Vue 版 ServerCertRow 一致） */
interface ServerCertRow {
  id: string; certSn: string; certDn: string; publicKey: string; alg: string;
  bindingStatus: "ACTIVE" | "REVOKED"; boundAt: string; revokedAt: string | null;
  /** D1v2（2026-09-17）：证书有效期；null=长期（存量介质/旧中间件实例生成） */
  notBefore: string | null; expiresAt: string | null;
}

/** 有效期展示文案（A-13）：未携带 → null（由调用方决定是否显示「长期」） */
function certValidityText(expiresAt?: string | null): string | null {
  if (!expiresAt) return null;
  const daysLeft = Math.ceil((dayjs(expiresAt).valueOf() - Date.now()) / 86400000);
  if (daysLeft < 0) return `已于 ${dayjs(expiresAt).format("YYYY-MM-DD")} 过期`;
  return `有效期至 ${dayjs(expiresAt).format("YYYY-MM-DD")}（剩 ${daysLeft} 天）`;
}

/** U盾在投标中的应用 — 静态指引（与系统实际行为对齐：双信封/开标解密/澄清签名/A-13 提醒） */
const UKEY_GUIDE: Array<{ icon: ComponentType<{ size?: number | string; className?: string; strokeWidth?: number }>; title: string; desc: string }> = [
  { icon: FileLock, title: "投标递交加密", desc: "双信封加密投递：技术与商务文件、报价分别密封，私钥全程不出 U盾。" },
  { icon: Unlock, title: "开标在线解密", desc: "开标大厅在线解密唱标；已投递标书依赖绑定时证书解密，请妥善保管介质。" },
  { icon: PenLine, title: "评标澄清签名", desc: "评标委员会发出澄清要求时，答复须经 U盾 电子签名后在线提交。" },
  { icon: CalendarClock, title: "证书到期提醒", desc: "到期前 30/7 天站内两档提醒；换证绑定自动撤销旧证，旧证解密依赖请留介质。" },
];

function readBound(): BoundInfo | null {
  try {
    const raw = localStorage.getItem(BOUND_KEY);
    return raw ? JSON.parse(raw) as BoundInfo : null;
  } catch { return null; }
}
function writeBound(info: BoundInfo) {
  try { localStorage.setItem(BOUND_KEY, JSON.stringify(info)); } catch { /* 忽略 */ }
}
function clearBound() {
  try { localStorage.removeItem(BOUND_KEY); } catch { /* 忽略 */ }
}

export default function UkeyManagePage() {
  const { confirm, dialog } = useConfirm();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [profile, setProfile] = useState<any>(null);

  // ── U盾介质状态 ──
  const [password, setPassword] = useState("");
  const [opening, setOpening] = useState(false);
  const [ukey, setUkey] = useState<VendorUKeyAdapter | null>(null);
  // ── 中间件常驻监护（2026-09-17）：在线/版本/盾数/已解锁实时轮询 ──
  const health = useUkeyHealth(2000);
  // presence 派生（原 useUkeyPresence 语义；离线经去抖防闪跳，插回 ≤2s 即时恢复）
  const ukeyPresent = health === null ? null : health.online && health.shields > 0;
  const [ukeyCerts, setUkeyCerts] = useState<CertInfo[]>([]);
  // 厂商中间件会话倒计时（秒）：服务端空闲 TTL 的镜像，到期自动翻回锁定态
  const [lockCountdown, setLockCountdown] = useState<number | null>(null);

  // ── 服务端绑定记录 ──
  const [serverCerts, setServerCerts] = useState<ServerCertRow[]>([]);
  const [binding, setBinding] = useState(false);
  const [revoking, setRevoking] = useState(false);

  // ── 绑定公开信息缓存 ──
  const [boundInfo, setBoundInfo] = useState<BoundInfo | null>(null);
  // 异步回调里读最新值（Vue 响应式读取的等价物）
  const boundInfoRef = useRef<BoundInfo | null>(null);
  boundInfoRef.current = boundInfo;

  const companyName = profile?.name || "";
  const activeServerCert = serverCerts.find((c) => c.bindingStatus === "ACTIVE") ?? null;

  // 本企业证书过滤（2026-08-31）：演示中间件是全盾模型——槽内所有已发制盾都随解锁枚举，
  // 真实场景一台机器只插本企业盾。按后端 bindCert 的 DN↔企业名校验同口径过滤，他企盾
  // 不显示绑定入口（后端本就会 400 DN_MISMATCH，此处把防线前移到 UI，消除演示困惑）。
  // 口径实现抽 utils/ukey-cert-match（CA自检弹窗共用同一默认选证逻辑）。
  const ownCerts = ukeyCerts.filter((c) => isOwnCert(c.certDn, companyName));
  const otherCertCount = ukeyCerts.length - ownCerts.length;

  async function refreshServerCerts() {
    const res: any = await supplierApi.listMyCerts();
    setServerCerts(Array.isArray(res) ? res : []);
  }

  async function fetchProfile() {
    setProfile(await supplierApi.getProfile());
  }

  /* ═══ 初始加载 / 重试（onMounted）═══ */
  useEffect(() => {
    (async () => {
      try {
        await Promise.all([fetchProfile(), refreshServerCerts()]);
        setBoundInfo(readBound());
      } catch { setError(true); }
      finally { setLoading(false); }
    })();
  }, []);

  /* ═══ 解锁后中间件监护（2026-09-17 拍板：离线自动锁）═══
     拔盾(shields=0)/会话失效(unlocked=0)/离线(去抖后) → 与 TTL 到期同款清理 + 告知原因。
     unlocked=0 是粗粒度信号（全体盾会话皆灭），本盾单独过期由 TTL 倒计时兜底。
     坏观测须连续 2 次才锁：解锁成功那一刻 health 可能还是解锁前的陈旧快照
     （unlocked=0/shields=0/离线），单次观测即锁会在解锁后 ~2s 内误杀（2026-09-17 实测）。 */
  const badHealthPollRef = useRef(0);
  useEffect(() => {
    if (!ukey || !health) return;
    if (!health.online) { badHealthPollRef.current = 0; return; } // 离线已在 hook 内 3 次去抖，到达即真
    if (health.shields > 0 && health.unlocked > 0) { badHealthPollRef.current = 0; return; }
    if (++badHealthPollRef.current < 2) return;
    badHealthPollRef.current = 0;
    const reason = health.shields === 0 ? "U盾已拔出" : "U盾会话已失效";
    setUkey(null);
    setUkeyCerts([]);
    setPassword("");
    setLockCountdown(null);
    toast.warning(`${reason}，已自动锁定`);
  }, [health, ukey]);

  /* 离线监护单独一路：health.online=false 经 hook 3 次去抖，到达即真离线 → 立即锁 */
  useEffect(() => {
    if (!ukey || !health || health.online) return;
    setUkey(null);
    setUkeyCerts([]);
    setPassword("");
    setLockCountdown(null);
    toast.warning("U盾驱动服务离线，已自动锁定");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [health?.online, ukey]);

  /* ═══ 会话倒计时（厂商中间件空闲 TTL 镜像）：秒级刷新，到期自动翻回锁定态 ═══ */
  useEffect(() => {
    if (!ukey) { setLockCountdown(null); return; }
    const tick = () => setLockCountdown((ukey as unknown as { secondsUntilLock?: () => number | null }).secondsUntilLock?.() ?? null);
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [ukey]);

  useEffect(() => {
    if (lockCountdown === null || lockCountdown > 0 || !ukey) return;
    // 到期：与手动锁定同款清理（不发网络请求——服务端会话已按 TTL 惰性淘汰）
    setUkey(null);
    setUkeyCerts([]);
    setPassword("");
    setLockCountdown(null);
    toast.info("U盾空闲超时，已自动锁定");
  }, [lockCountdown, ukey]);

  async function retryLoad() {
    setError(false); setLoading(true);
    try {
      await Promise.all([fetchProfile(), refreshServerCerts()]);
      setBoundInfo(readBound());
    } catch { setError(true); }
    finally { setLoading(false); }
  }

  // ── 开锁 ──
  async function handleOpen() {
    if (!password) { toast.warning("请输入证书口令"); return; }
    setOpening(true);
    try {
      const { adapter } = await openUkey(password);
      setUkey(adapter);
      const certs = await adapter.listCertificates();
      setUkeyCerts(certs);
      if (certs.length > 0) toast.success("U盾已解锁");
      else toast.warning("U盾内未检测到证书，请联系 CA 服务机构办理");
    } catch (e: any) {
      toast.error(e?.message || "解锁失败：证书口令不符或 U盾损坏");
    } finally { setOpening(false); }
  }

  function lockUkey() {
    setUkey(null);
    setUkeyCerts([]);
    setPassword("");
  }

  // ── 绑定 ──
  async function handleBind(cert: CertInfo) {
    if (!cert.publicKey) { toast.error("证书缺少公钥，无法绑定"); return; }
    setBinding(true);
    try {
      const res: any = await supplierApi.bindCert({
        certSn: cert.certSn, certDn: cert.certDn, publicKey: cert.publicKey, alg: cert.alg ?? "SM2",
        ...(cert.notBefore ? { notBefore: cert.notBefore } : {}),
        ...(cert.notAfter ? { expiresAt: cert.notAfter } : {}),
      });
      // 换证语义：绑定新证时服务端自动把旧 ACTIVE 置 REVOKED——对旧证做幂等 revoke 查询
      // 依赖旧 certSn 的未开标提交数，警示保留旧介质
      const prevActive = serverCerts.find((c) => c.bindingStatus === "ACTIVE" && c.certSn !== cert.certSn);
      writeBound({ certSn: cert.certSn, certDn: cert.certDn, publicKey: cert.publicKey, certId: res?.cert?.id ?? "" });
      setBoundInfo(readBound());
      await Promise.all([refreshServerCerts(), fetchProfile()]);
      toast.success(`证书已绑定：${res?.cert?.certDn ?? cert.certDn}（主体与注册企业名称校验通过）`);
      if (prevActive) {
        try {
          const revoked: any = await supplierApi.revokeCert(prevActive.id);
          await refreshServerCerts();
          if (Number(revoked?.pendingSubmissions) > 0) {
            window.alert(
              `旧证书 ${prevActive.certSn} 仍有 ${revoked.pendingSubmissions} 个未开标提交依赖其解密，请保留旧 U盾或导出备份，直至开标结束。`,
            );
          }
        } catch { /* 幂等查询失败不阻断换证流程 */ }
      }
    } catch {
      /* 错误提示已由 API 层统一弹出（Vue 版此处读 axios response.data.error） */
    } finally { setBinding(false); }
  }

  // ── 解绑 ──
  async function handleRevoke(row: ServerCertRow) {
    if (!ukey) { toast.warning("请先解锁 U盾，再进行证书解绑"); return; }
    // 已迁移 useConfirm（取消直接返回，不再走 catch 的 error 分支）
    if (!(await confirm({ message: `确定解绑证书 ${row.certSn} 吗？解绑后该证书将无法再用于投标签名。`, danger: true }))) return;
    setRevoking(true);
    try {
      const res: any = await supplierApi.revokeCert(row.id);
      await refreshServerCerts();
      if (boundInfoRef.current?.certSn === row.certSn) { clearBound(); setBoundInfo(null); }
      if (Number(res?.pendingSubmissions) > 0) {
        // ElMessageBox.alert → window.alert（解绑警示）
        window.alert(`仍有 ${res.pendingSubmissions} 个未开标提交依赖此证书，请保留 U盾以便开标解密。`);
      } else {
        toast.success("证书已解绑");
      }
    } catch {
      /* 错误提示已由 API 层统一弹出（Vue 版此处区分 cancel/close 后静默） */
    } finally { setRevoking(false); }
  }

  // ── CA及签章测试（Tab1 加解密自检）──
  const [caTestVisible, setCaTestVisible] = useState(false);

  function certServerRow(certSn: string): ServerCertRow | undefined {
    return serverCerts.find((c) => c.certSn === certSn);
  }

  if (loading) {
    return <LoadingBlock />;
  }

  if (error) {
    return (
      <div className="sp-error-block">
        <div className="sp-error-icon"><TriangleAlert size={22} strokeWidth={1.75} /></div>
        <div className="sp-error-text">数据加载失败</div>
        <div className="sp-error-desc">网络或服务异常，请稍后重试</div>
        <SpButton variant="primary" onClick={() => void retryLoad()}>重新加载</SpButton>
      </div>
    );
  }

  return (
    <>
      <SpPageHero srTitle="U盾管理" />

      {/* ═══ KPI 概览行：介质 / 驱动 / 生效证书 / 绑定记录 ═══ */}
      <div className="ukey-kpi-row">
        <div className="kpi-card">
          <span className="kpi-card__label">介质状态</span>
          <span className="kpi-card__value" style={ukey ? { "--kpi-tone": "var(--success)" } as React.CSSProperties : undefined}>{ukey ? "已解锁" : "未解锁"}</span>
          <span className="kpi-card__sub">
            {ukey
              ? `${ownCerts.length} 张本企业证书${lockCountdown !== null ? ` · 剩 ${Math.floor(lockCountdown / 60)}:${String(lockCountdown % 60).padStart(2, "0")} 自动锁定` : ""}`
              : "CA 签发 U盾介质"}
          </span>
        </div>
        <div className="kpi-card" title="本机 CA 驱动服务（中间件）实时状态，2s 轮询">
          <span className="kpi-card__label">驱动服务</span>
          <span
            className="kpi-card__value"
            style={health ? ({ "--kpi-tone": health.online ? "var(--success)" : "var(--warning)" } as React.CSSProperties) : undefined}
          >
            {health === null ? "检测中" : health.online ? "在线" : "离线"}
          </span>
          <span className="kpi-card__sub">{health?.online ? `v${health.version || "—"} · ${health.shields} 盾 · ${health.unlocked} 已解锁` : "未检测到 U盾驱动服务"}</span>
        </div>
        <div className="kpi-card">
          <span className="kpi-card__label">生效证书</span>
          <span className="kpi-card__value" style={activeServerCert ? { "--kpi-tone": "var(--success)" } as React.CSSProperties : undefined}>{activeServerCert ? "已绑定" : "未绑定"}</span>
          <span className="kpi-card__sub">{activeServerCert ? `${activeServerCert.certSn} · ${certValidityText(activeServerCert.expiresAt) ?? "长期有效"}` : "解锁 U盾 后绑定证书用于投标签名"}</span>
        </div>
        <div className="kpi-card">
          <span className="kpi-card__label">平台绑定</span>
          <span className="kpi-card__value">{serverCerts.length}<small> 条</small></span>
          <span className="kpi-card__sub">{serverCerts.length > 0 ? `生效 ${serverCerts.filter((c) => c.bindingStatus === "ACTIVE").length} · 已撤销 ${serverCerts.filter((c) => c.bindingStatus === "REVOKED").length}` : "暂无绑定记录"}</span>
        </div>
      </div>

      <div className="ukey-grid">
        {/* ═══ 口令介质 ═══ */}
        <div className="neu-card ukey-card">
          <div className="card-header">
            <span className="card-title">U盾</span>
            <span className="inline-flex items-center gap-2">
              <SpButton variant="xs" icon={ShieldCheck} onClick={() => setCaTestVisible(true)}>CA及签章测试</SpButton>
              {ukey && <SpButton variant="xs" icon={Lock} onClick={lockUkey}>锁定</SpButton>}
            </span>
          </div>

          {ukeyPresent === false ? (
            <div className="ukey-empty">未检测到 U盾——请插入 U盾（插回后自动恢复）</div>
          ) : !ukey ? (
            <>
              <div className="open-row">
                <SpInput
                  type="password"
                  placeholder="输入证书口令（PIN）"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") void handleOpen(); }}
                  className="flex-1"
                />
                <SpButton variant="primary" icon={Unlock} loading={opening} onClick={() => void handleOpen()}>解锁</SpButton>
              </div>
            </>
          ) : (
            <>
              <div className="cert-toolbar">
                <span className="file-hint">证书由 CA 服务机构制发，此处枚举本企业 U盾内证书并绑定</span>
              </div>

              {ownCerts.length === 0 ? (
                <div className="ukey-empty">
                  {otherCertCount > 0
                    ? `U盾内未检测到本企业证书（已隐藏 ${otherCertCount} 张其他单位盾），请联系 CA 服务机构办理`
                    : "U盾内未检测到证书，请联系 CA 服务机构办理"}
                </div>
              ) : (
                <div className="cert-list">
                  {ownCerts.map((cert) => (
                    <div key={cert.certSn} className="cert-row">
                      <div className="cert-main">
                        <span className="cert-sn">{cert.certSn}</span>
                        <span className="cert-dn">{cert.certDn}</span>
                        {cert.notAfter && <span className="cert-time">{certValidityText(cert.notAfter)}</span>}
                      </div>
                      <div className="cert-actions">
                        {certServerRow(cert.certSn)?.bindingStatus === "ACTIVE" && (
                          <span className="ukey-tag ukey-tag--success">已绑定</span>
                        )}
                        {certServerRow(cert.certSn)?.bindingStatus === "REVOKED" && (
                          <span className="ukey-tag ukey-tag--info">已解绑</span>
                        )}
                        {/* fix round 1 ④：不因已有 ACTIVE 证书禁用——绑定新证即换证（服务端自动撤销旧证），
                            handleBind 的 prevActive 警示分支由此可达 */}
                        {certServerRow(cert.certSn)?.bindingStatus !== "ACTIVE" && (
                          <SpButton
                            variant="primary"
                            loading={binding}
                            title={activeServerCert ? "绑定后原生效证书自动撤销，留意换证警示" : ""}
                            onClick={() => void handleBind(cert)}
                          >
                            {activeServerCert ? "换证绑定" : "绑定"}
                          </SpButton>
                        )}
                      </div>
                    </div>
                  ))}
                  {otherCertCount > 0 && (
                    <div className="file-hint px-3 py-2">
                      已隐藏 {otherCertCount} 张其他单位证书
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          <div className="ukey-security-note">
            <ShieldCheck size={14} strokeWidth={1.75} />
            私钥由 U盾持有，浏览器不接触私钥材料；请妥善保管 U盾与管理码（PUK）。
          </div>
        </div>

        {/* ═══ 服务端绑定记录 ═══ */}
        <div className="neu-card ukey-card">
          <div className="card-header">
            <span className="card-title">平台绑定记录</span>
            <SpButton variant="link" onClick={() => void refreshServerCerts()}>刷新</SpButton>
          </div>

          {serverCerts.length === 0 ? (
            <div className="ukey-empty">
              暂无绑定记录。解锁 U盾 并枚举到本企业证书后，可在「U盾」卡片完成绑定关联。
            </div>
          ) : (
            <div className="cert-list">
              {serverCerts.map((row) => (
                <div key={row.id} className="cert-row server">
                  <div className="cert-main">
                    <span className="cert-sn">{row.certSn}</span>
                    <span className="cert-dn">{row.certDn}</span>
                    <span className="cert-time">
                      {row.bindingStatus === "ACTIVE"
                        ? `绑定于 ${dayjs(row.boundAt).format("YYYY-MM-DD HH:mm")}`
                        : `撤销于 ${row.revokedAt ? dayjs(row.revokedAt).format("YYYY-MM-DD HH:mm") : "--"}`}
                    </span>
                    <span className="cert-time">{certValidityText(row.expiresAt) ?? "有效期：长期（证书未携带）"}</span>
                  </div>
                  <div className="cert-actions">
                    <span className={`ukey-tag ${row.bindingStatus === "ACTIVE" ? "ukey-tag--success" : "ukey-tag--info"}`}>
                      {row.bindingStatus === "ACTIVE" ? "生效中" : "已撤销"}
                    </span>
                    {row.bindingStatus === "ACTIVE" && (
                      <SpButton danger loading={revoking} disabled={!ukey} onClick={() => void handleRevoke(row)}>解绑</SpButton>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ═══ U盾在投标中的应用 — 全宽指引卡（填实页面下段）═══ */}
      <div className="neu-card ukey-card ukey-guide">
        <div className="card-header">
          <span className="card-title">U盾在投标中的应用</span>
        </div>
        <div className="ukey-guide-grid">
          {UKEY_GUIDE.map((item) => (
            <div key={item.title} className="ukey-guide-item">
              <div className="ukey-guide-head">
                <span className="ukey-guide-ic"><item.icon size={14} strokeWidth={1.9} aria-hidden="true" /></span>
                <span className="ukey-guide-title">{item.title}</span>
              </div>
              <p className="ukey-guide-desc">{item.desc}</p>
            </div>
          ))}
        </div>
      </div>

      {dialog}

      {/* ═══ CA及签章测试（共享页面解锁会话；未解锁时弹窗内自行初始化）═══ */}
      <CaSelftestDialog
        open={caTestVisible}
        onClose={() => setCaTestVisible(false)}
        ukey={ukey}
        companyName={companyName}
      />
    </>
  );
}
