"use client";

/**
 * U盾管理 — 移植自 Vue supplier-portal profile/UkeyManage.vue（100% 功能忠实）。
 * 介质与口令逻辑走 @water-erp/ukey 的 MockUKeyAdapter：
 *  - storage 适配 localStorage，与 Vue 版同键同逻辑（keystore 键 `mock-ukey-keystore`）
 *  - 绑定公开信息缓存键 `supplier_ukey_bound`（供投标提交页恢复 certSn 参考）
 * 差异仅为框架等价替换：ElMessage→sonner toast、ElMessageBox→window.confirm/alert。
 */
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import dayjs from "dayjs";
import {
  Download, KeyRound, Lock, Plus, ShieldCheck, TriangleAlert, Unlock, Upload,
} from "lucide-react";
import { MockUKeyAdapter, VendorUKeyAdapter, type CertInfo, type StorageLike } from "@water-erp/ukey";
import { UKEY_STRICT, detectUkey, openUkey, type UkeyKind } from "@/utils/ukey-factory";
import { useUkeyPresence } from "@/utils/use-ukey-presence";
import { supplierApi } from "@/lib/api/supplier";
import { LoadingBlock, SpButton, SpDialog, SpInput } from "@/components/ui";
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
}

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

/** MockUKeyAdapter 的 storage 适配（仅口令加密后的 keystore 落 localStorage） */
const ukeyStorage: StorageLike = {
  getItem: (k) => localStorage.getItem(k),
  setItem: (k, v) => localStorage.setItem(k, v),
  removeItem: (k) => localStorage.removeItem(k),
};

export default function UkeyManagePage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [profile, setProfile] = useState<any>(null);

  // ── U盾介质状态 ──
  const [password, setPassword] = useState("");
  const [opening, setOpening] = useState(false);
  const [ukey, setUkey] = useState<MockUKeyAdapter | VendorUKeyAdapter | null>(null);
  const [ukeyKind, setUkeyKind] = useState<UkeyKind>("mock");
  const [mwOffline, setMwOffline] = useState(false); // vendor 探测不到 → 顶部提示条
  const ukeyPresent = useUkeyPresence(true); // 严格模式:轮询中间件在线且有盾(插回 ≤2s 自动恢复)
  const [ukeyCerts, setUkeyCerts] = useState<CertInfo[]>([]);
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);
  // 厂商中间件会话倒计时（秒）：服务端空闲 TTL 的镜像，到期自动翻回锁定态
  const [lockCountdown, setLockCountdown] = useState<number | null>(null);
  const [importPassword, setImportPassword] = useState("");
  const importFileRef = useRef<HTMLInputElement | null>(null);

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
  const ownCerts = ukeyCerts.filter((c) => {
    if (!companyName) return false;
    const cn = /(?:^|,)\s*cn\s*=\s*([^,]*)/i.exec(c.certDn || "")?.[1] ?? "";
    const norm = (s: string) => (s || "").replace(/[\s（）()·]/g, "").replace(/(有限责任公司|股份有限公司|有限公司|集团)/g, "");
    return norm(cn).includes(norm(companyName));
  });
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
        const kind = await detectUkey();
        setUkeyKind(kind);
        setMwOffline(kind === "mock");
      } catch { setError(true); }
      finally { setLoading(false); }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* dev 提示：模拟 U盾轨道的启动命令只进控制台，不上 UI（正式环境 UKEY_STRICT 下本轨道不可达） */
  useEffect(() => {
    if (mwOffline && !UKEY_STRICT) {
      console.warn("[dev] 未检测到 U盾中间件——启动：pnpm dev:ukey-mw（发行：ukeymw issue --cn 企业名）");
    }
  }, [mwOffline]);

  /* ═══ 会话倒计时（厂商中间件空闲 TTL 镜像）：秒级刷新，到期自动翻回锁定态 ═══ */
  useEffect(() => {
    if (!ukey || typeof ukey.secondsUntilLock !== "function") { setLockCountdown(null); return; }
    const tick = () => setLockCountdown(ukey.secondsUntilLock!());
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
      const { kind, adapter } = await openUkey(password);
      setUkeyKind(kind);
      setMwOffline(kind === "mock");
      setUkey(adapter);
      const certs = await adapter.listCertificates();
      setUkeyCerts(certs);
      if (certs.length > 0) toast.success("U盾已解锁");
      else if (kind === "mock") toast.success("已创建空 U盾（尚未生成证书）");
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

  // ── 新建证书 ──
  async function handleCreateCert() {
    if (!ukey) { toast.warning("请先解锁 U盾"); return; }
    if (!(ukey instanceof MockUKeyAdapter)) {
      toast.warning("请在 CA 服务机构办理证书");
      return;
    }
    if (!companyName) { toast.warning("未能获取企业名称，请稍后重试"); return; }
    setCreating(true);
    try {
      const cert = await ukey.createCertificate(companyName);
      setUkeyCerts(await ukey.listCertificates());
      toast.success(`已生成证书 ${cert.certSn}`);
    } catch (e: any) { toast.error(e?.message || "生成证书失败"); }
    finally { setCreating(false); }
  }

  // ── 绑定 ──
  async function handleBind(cert: CertInfo) {
    if (!cert.publicKey) { toast.error("证书缺少公钥，无法绑定"); return; }
    setBinding(true);
    try {
      const res: any = await supplierApi.bindCert({ certSn: cert.certSn, certDn: cert.certDn, publicKey: cert.publicKey, alg: cert.alg ?? "SM2" });
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
    if (UKEY_STRICT && !ukey) { toast.warning("请先解锁 U盾，再进行证书解绑"); return; }
    // ElMessageBox.confirm → window.confirm（取消直接返回，不再走 catch 的 error 分支）
    if (!window.confirm(`确定解绑证书 ${row.certSn} 吗？解绑后该证书将无法再用于投标签名。`)) return;
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

  // ── 导出介质文件 ──
  const [exportVisible, setExportVisible] = useState(false);
  const [exportPassword, setExportPassword] = useState("");
  const [exportPassword2, setExportPassword2] = useState("");
  const [exporting, setExporting] = useState(false);

  function closeExport() {
    // fix round 1 ⑦：关闭后清空口令，口令不残留
    setExportVisible(false);
    setExportPassword("");
    setExportPassword2("");
  }

  async function handleExport() {
    if (!ukey) { toast.warning("请先解锁 U盾"); return; }
    if (!(ukey instanceof MockUKeyAdapter)) {
      toast.warning("请在 CA 服务机构办理证书");
      return;
    }
    if (exportPassword.length < 6) { toast.warning("导出口令至少 6 位"); return; }
    if (exportPassword !== exportPassword2) { toast.warning("两次输入的口令不一致"); return; }
    setExporting(true);
    try {
      const content = await ukey.exportFile(exportPassword);
      const blob = new Blob([content], { type: "application/octet-stream" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const safe = (companyName || "supplier").replace(/[\\/:*?"<>|]/g, "_");
      a.download = `U盾备份-${safe}-${dayjs().format("YYYYMMDD")}.ukey`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setExportVisible(false);
      toast.success("备份文件已导出，请妥善保管（私钥仅以口令加密形态包含其中）");
    } catch (e: any) { toast.error(e?.message || "导出失败"); }
    finally { setExporting(false); }
  }

  // ── 导入介质文件 ──
  async function handleImportFile(ev: React.ChangeEvent<HTMLInputElement>) {
    const input = ev.target;
    const file = input.files?.[0];
    if (!file) return;
    // vendor 模式下导入区块已隐藏；此处按介质种类再拦一道（导入时介质必未开锁，不能走 instanceof）
    if (ukeyKind !== "mock") {
      toast.warning("请在 CA 服务机构办理证书");
      input.value = "";
      return;
    }
    if (!importPassword) { toast.warning("请输入该备份文件的导出口令"); input.value = ""; return; }
    setImporting(true);
    try {
      const text = await file.text();
      const uk = await MockUKeyAdapter.importFile(text, importPassword, ukeyStorage);
      setUkey(uk);
      setPassword(importPassword);
      setUkeyCerts(await uk.listCertificates());
      toast.success(`备份导入成功（${ukeyCerts.length || (await uk.listCertificates()).length} 张证书）`);
    } catch (e: any) { toast.error(e?.message || "导入失败：口令不符或文件损坏"); }
    finally {
      setImporting(false);
      input.value = "";
      setImportPassword(""); // fix round 1 ⑦：口令用完即清
    }
  }

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
      <SpPageHero
        icon={KeyRound}
        title="U盾管理"
        sub="管理投标加密证书与 U盾。证书绑定后，标书将以双层加密信封投递，报价密封至开标时揭示。"
        actions={ukey ? (
          <SpButton icon={Lock} onClick={lockUkey}>锁定</SpButton>
        ) : undefined}
      >
      </SpPageHero>

      {!UKEY_STRICT && mwOffline && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 16, padding: "10px 14px", borderRadius: 10, fontSize: 13, color: "#e6a23c", background: "#fdf6ec", border: "1px solid #faecd8" }}>
          <TriangleAlert size={14} strokeWidth={1.75} style={{ flexShrink: 0 }} />
          <span>未检测到 U盾驱动服务——当前使用浏览器内置模拟 U盾（仅供系统联调演示，正式投标请安装 U盾驱动）</span>
        </div>
      )}

      <div className="ukey-grid">
        {/* ═══ 口令介质 ═══ */}
        <div className="neu-card ukey-card">
          <div className="card-header">
            <span className="card-title">U盾</span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
              <span className={`ukey-tag ${ukeyKind === "vendor" ? "ukey-tag--success" : "ukey-tag--info"}`}>
                {UKEY_STRICT || ukeyKind === "vendor" ? "U盾" : "模拟 U盾"}
              </span>
              <span className={`ukey-state${ukey ? " open" : ""}`}>
                {ukey
                  ? `已解锁 · ${ownCerts.length} 张本企业证书${lockCountdown !== null ? ` · 剩余 ${Math.floor(lockCountdown / 60)}:${String(lockCountdown % 60).padStart(2, "0")} 自动锁定` : ""}`
                  : "未解锁"}
              </span>
            </span>
          </div>

          {UKEY_STRICT && ukeyPresent === false ? (
            <div className="ukey-empty">未检测到 U盾——请插入 U盾（插回后自动恢复）</div>
          ) : !ukey ? (
            <>
              <div className="open-row">
                <SpInput
                  type="password"
                  placeholder={ukeyKind === "vendor" ? "输入证书口令（PIN）" : "输入 U盾口令（首次使用将自动创建）"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") void handleOpen(); }}
                  style={{ flex: 1 }}
                />
                <SpButton variant="primary" icon={Unlock} loading={opening} onClick={() => void handleOpen()}>解锁</SpButton>
              </div>
              {ukeyKind === "mock" && (
                <>
                  <div className="file-hint">已有导出文件？</div>
                  <div className="import-row">
                    <SpInput
                      type="password"
                      placeholder="备份文件口令"
                      value={importPassword}
                      onChange={(e) => setImportPassword(e.target.value)}
                      style={{ flex: 1 }}
                    />
                    <SpButton icon={Upload} loading={importing} onClick={() => importFileRef.current?.click()}>导入备份</SpButton>
                    <input ref={importFileRef} type="file" accept=".ukey" style={{ display: "none" }} onChange={(e) => void handleImportFile(e)} />
                  </div>
                </>
              )}
            </>
          ) : (
            <>
              <div className="cert-toolbar">
                {ukeyKind === "mock" ? (
                  <>
                    <SpButton icon={Plus} loading={creating} onClick={() => void handleCreateCert()}>生成演示证书</SpButton>
                    <SpButton icon={Download} onClick={() => setExportVisible(true)}>导出备份</SpButton>
                    <span className="file-hint">证书主体名称自动使用注册企业名称，并校验与企业名一致</span>
                  </>
                ) : (
                  <span className="file-hint">证书由 CA 服务机构制发，此处枚举本企业 U盾内证书并绑定</span>
                )}
              </div>

              {ownCerts.length === 0 ? (
                <div className="ukey-empty">
                  {ukeyKind === "vendor"
                    ? otherCertCount > 0
                      ? `U盾内未检测到本企业证书（已隐藏 ${otherCertCount} 张其他单位盾），请联系 CA 服务机构办理`
                      : "U盾内未检测到证书，请联系 CA 服务机构办理"
                    : `U盾内暂无证书，点击「生成演示证书」创建`}
                </div>
              ) : (
                <div className="cert-list">
                  {ownCerts.map((cert) => (
                    <div key={cert.certSn} className="cert-row">
                      <div className="cert-main">
                        <span className="cert-sn">{cert.certSn}</span>
                        <span className="cert-dn">{cert.certDn}</span>
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
                    <div className="file-hint" style={{ padding: "8px 12px" }}>
                      已隐藏 {otherCertCount} 张其他单位证书
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          <div className="ukey-security-note">
            <ShieldCheck size={14} strokeWidth={1.75} />
            {ukeyKind === "vendor"
              ? "私钥由 U盾持有，浏览器不接触私钥材料；请妥善保管 U盾与管理码（PUK）。"
              : "私钥仅以口令加密形态存储于浏览器，永不明文落盘；请导出备份并妥善保管，否则将无法解密已投递标书。"}
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
              暂无绑定记录。解锁 U盾并生成证书后，点击「绑定」完成企业身份与证书的关联。
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
                  </div>
                  <div className="cert-actions">
                    <span className={`ukey-tag ${row.bindingStatus === "ACTIVE" ? "ukey-tag--success" : "ukey-tag--info"}`}>
                      {row.bindingStatus === "ACTIVE" ? "生效中" : "已撤销"}
                    </span>
                    {row.bindingStatus === "ACTIVE" && (
                      <SpButton danger loading={revoking} disabled={UKEY_STRICT && !ukey} onClick={() => void handleRevoke(row)}>解绑</SpButton>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ═══ 导出口令对话框（关闭即销毁并清空口令，口令不残留）═══ */}
      <SpDialog
        open={exportVisible}
        onClose={closeExport}
        title="导出备份"
        width={420}
        footer={
          <>
            <SpButton onClick={closeExport}>取消</SpButton>
            <SpButton variant="primary" loading={exporting} onClick={() => void handleExport()}>导出下载</SpButton>
          </>
        }
      >
        <p className="export-desc">导出备份包含全部证书（私钥经口令加密）。可跨浏览器/跨设备导入，请妥善保管。</p>
        <div className="export-form">
          <div className="export-form-row">
            <label>新口令</label>
            <SpInput
              type="password"
              placeholder="至少 6 位"
              value={exportPassword}
              onChange={(e) => setExportPassword(e.target.value)}
            />
          </div>
          <div className="export-form-row">
            <label>确认口令</label>
            <SpInput
              type="password"
              placeholder="再次输入"
              value={exportPassword2}
              onChange={(e) => setExportPassword2(e.target.value)}
            />
          </div>
        </div>
      </SpDialog>
    </>
  );
}
