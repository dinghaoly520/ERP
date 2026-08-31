"use client";

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { toast } from "sonner";
import dayjs from "dayjs";
import { CloudOff, KeyRound, Lock, MessageSquareOff, ShieldCheck, User } from "lucide-react";
import { openUkey } from "@/utils/ukey-factory";
import type { UKeyAdapter } from "@water-erp/ukey";
import { bidApi } from "@/lib/api/bid";
import { supplierApi } from "@/lib/api/supplier";
import { openingHallApi } from "@/lib/api/opening-hall";
import { ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { useBidWebSocket } from "@/hooks/use-bid-websocket";
import { ChatPanel } from "@/components/chat-panel";
import { EmptyState, SpButton, SpDialog, SpInput, SpTextarea } from "@/components/ui";
import { OpeningDecryptCard } from "@/components/opening-decrypt-card";
import "@/styles/pages/opening.css";
import "@/styles/pages/bid-components.css"; // ChatPanel（chat-panel / cp-*）样式

/** 服务端绑定记录（仅取签名所需公开字段）——与回执卡/澄清答复页同源 */
interface ServerCertRow { certSn: string; bindingStatus: string }

/** 本地缓存的绑定证书序列号（U盾管理页绑定成功后写入；仅公开信息）——与回执卡/澄清答复页同源 */
function boundCertSn(): string {
  try {
    const raw = localStorage.getItem("supplier_ukey_bound");
    return raw ? (JSON.parse(raw)?.certSn ?? "") : "";
  } catch { return ""; }
}

export default function OpeningHallPage() {
  const params = useParams<{ projectId: string }>();
  const projectId = params.projectId;
  // U3：ChatPanel 的 userId 取登录用户 User.id（消息 senderId = actor.userId，非 Supplier.id）
  const auth = useAuth();

  const [project, setProject] = useState<any>(null);
  const [record, setRecord] = useState<any>(null);
  const [records, setRecords] = useState<any[]>([]);
  const [checkedInAt, setCheckedInAt] = useState<string | null>(null);
  const [onlineCount, setOnlineCount] = useState(0);
  const [decryptStatus, setDecryptStatus] = useState<string>("");
  const [supplierId, setSupplierId] = useState("");
  const [supplierName, setSupplierName] = useState("");
  const [loadError, setLoadError] = useState(false);
  const [loadErrorMsg, setLoadErrorMsg] = useState("");
  const [profileError, setProfileError] = useState(false);
  const [profileSm2PublicKey, setProfileSm2PublicKey] = useState("");
  const [bootstrapping, setBootstrapping] = useState(false);
  // 异议弹窗（ElMessageBox.prompt 的样式化等价）：textarea + 必填校验
  const [disputeOpen, setDisputeOpen] = useState(false);
  const [disputeReason, setDisputeReason] = useState("");
  const [disputeSubmitting, setDisputeSubmitting] = useState(false);

  // ── 开标确认电子签名（A-114，序列克隆回执卡 A-101）：口令弹窗 → 解锁 U盾 → canonical 签名 → 提交 ──
  const [confirming, setConfirming] = useState(false);
  // ── U盾会话（克隆回执卡/澄清答复页：口令仅内存持有，解锁一次覆盖本页确认/补签）──
  const [ukeyAdapter, setUkeyAdapter] = useState<UKeyAdapter | null>(null);
  const [ukeyCertSn, setUkeyCertSn] = useState("");
  const [ukeyPassword, setUkeyPassword] = useState("");
  const [ukeyOpening, setUkeyOpening] = useState(false);
  const [ukeyDialogVisible, setUkeyDialogVisible] = useState(false);
  const pendingSignRef = useRef(false);
  /** U盾会话快照 ref——解锁后同一事件闭包内立即签名，useState 异步更新会读到空值 */
  const ukeySessionRef = useRef<{ adapter: UKeyAdapter; certSn: string } | null>(null);
  /** 平台 ACTIVE 绑定证书 SN（U盾内证书的兜底匹配；空 = 未绑定，签名时给出引导） */
  const [activeServerCertSn, setActiveServerCertSn] = useState("");

  // bootstrap 在 await 后要读最新 loadError/project——React 状态异步，用 ref 镜像
  const loadErrorRef = useRef(false);
  const projectRef = useRef<any>(null);
  const loadErrorMsgRef = useRef("");

  const stage: string = project?.stage ?? "";
  const isOpening = stage === "OPENING";

  /** 投递报价显示文本：有唱标锚点时归一为元（与唱标总表「报价（元）」单位统一）；
   *  未唱标回落投递表单口径（<10000 万元、≥10000 元，见 BidSubmit formatBidPrice） */
  const submittedPriceText = (() => {
    const s = record?.submitted;
    if (!s?.bidPrice) return "—";
    if (s.bidPriceInYuan != null) return `${s.bidPriceInYuan} 元`;
    const n = Number(s.bidPrice);
    if (!Number.isFinite(n)) return "—";
    return n >= 10000 ? `${s.bidPrice} 元` : `${s.bidPrice} 万元`;
  })();

  async function refresh() {
    // 失败保留上次成功数据，仅置标志；首屏（project 为空）时由错误态 + 重试展示
    try {
      const [p, r, list] = await Promise.all([
        bidApi.getProject(projectId),
        supplierApi.getOpeningRecord(projectId).catch(() => null),
        // 开标前端点返回 400 OPENING_NOT_STARTED——捕获后置空列表，页面不报错
        supplierApi.getOpeningRecords(projectId).catch(() => null),
      ]);
      setProject(p);
      setRecord(r);
      setRecords(list ?? []);
      setLoadError(false);
      loadErrorRef.current = false;
      projectRef.current = p;
    } catch (e: any) {
      setLoadError(true);
      loadErrorRef.current = true;
      const msg = e instanceof ApiError ? e.message : e?.message || "加载开标大厅数据失败";
      setLoadErrorMsg(msg);
      loadErrorMsgRef.current = msg;
    }
  }

  /** @returns 是否加载失败（profileError）——供 retryProfile/bootstrap 提示 */
  async function loadProfile(): Promise<boolean> {
    try {
      const profile = await supplierApi.getProfile();
      setSupplierId(profile?.id ?? "");
      setSupplierName(profile?.name ?? "");
      setProfileSm2PublicKey(profile?.sm2PublicKey ?? "");
      const err = !profile?.id;
      setProfileError(err);
      return err;
    } catch {
      setProfileError(true);
      return true;
    }
  }

  async function retryProfile() {
    setProfileError(false);
    const err = await loadProfile();
    if (err) toast.error("加载供应商信息失败，会话暂不可用");
  }

  /** 首屏加载逻辑：挂载与「重试」共用 */
  async function bootstrap() {
    setBootstrapping(true);
    await Promise.all([loadProfile(), refresh(), loadPresence()]);
    setBootstrapping(false);
    if (loadErrorRef.current && !projectRef.current) toast.error(loadErrorMsgRef.current);
  }

  async function loadPresence() {
    const res = await openingHallApi.presence(projectId).catch(() => null);
    if (res) setOnlineCount(res.onlineCount ?? 0);
  }

  async function checkIn() {
    try {
      const res = await openingHallApi.checkIn(projectId);
      setCheckedInAt(res?.checkInAt ?? null);
      toast.success("签到成功");
    } catch {
      // U5：业务错误消息已由全局 API 层统一弹出，此处不重复提示
    }
  }

  // ══ A-114 开标确认电子签名（序列克隆回执卡 A-101）：口令弹窗 → 解锁 U盾 → canonical 签名 → 提交 ══

  /** 确认开标记录 / 补签确认（同一入口：服务端按记录态自动分辨 confirm/resign） */
  function handleConfirmSign() {
    if (!ukeyAdapter) {
      // 先解锁 U盾（口令对话框），解锁成功后凭 pendingSignRef 自动续签——与回执卡同序列
      pendingSignRef.current = true;
      setUkeyPassword("");
      setUkeyDialogVisible(true);
      return;
    }
    void doConfirmSign();
  }

  /** 口令确认 → 解锁 U盾 → 选定平台绑定证书 → 续跑挂起的确认/补签 */
  async function handleUkeyOpen() {
    if (!ukeyPassword) { toast.warning("请输入证书口令"); return; }
    setUkeyOpening(true);
    try {
      const { adapter } = await openUkey(ukeyPassword);
      const certs = await adapter.listCertificates();
      // 选中平台已绑定证书：优先本地缓存的 certSn（U盾管理页绑定后写入），兜底服务端 ACTIVE 绑定记录
      const cert = certs.find((c) => c.certSn === boundCertSn()) || certs.find((c) => c.certSn === activeServerCertSn);
      if (!cert) throw new Error("U盾内未找到与平台绑定的证书，请先到「U盾管理」页绑定");
      setUkeyAdapter(adapter);
      setUkeyCertSn(cert.certSn);
      ukeySessionRef.current = { adapter, certSn: cert.certSn };
      setUkeyPassword("");
      setUkeyDialogVisible(false);
      toast.success(`U盾已解锁（${cert.certSn}）`);
      if (pendingSignRef.current) { pendingSignRef.current = false; await doConfirmSign(); }
    } catch (e: any) {
      toast.error(e?.message || "U盾解锁失败");
    } finally {
      setUkeyOpening(false);
    }
  }

  /** 取 canonical（服务端以 DB 为准重建）→ U盾签名 → 提交（确认/补签单端点双语义，幂等） */
  async function doConfirmSign() {
    const session = ukeySessionRef.current;
    if (!session) return;
    const resign = record?.confirmStatus === "供应商已确认";
    setConfirming(true);
    try {
      const { canonical } = await supplierApi.getOpeningConfirmPayload(projectId);
      const signature = await session.adapter.sign(session.certSn, canonical);
      await supplierApi.confirmOpening(projectId, signature);
      toast.success(resign ? "开标确认电子签名已补签" : "已确认开标记录（已电子签名）");
      await refresh();
    } catch (e: any) {
      const code = e?.code ?? (e?.data as Record<string, unknown> | undefined)?.code;
      if (code === "SM2_PUBLIC_KEY_MISSING") toast.error("请先在 U盾管理页绑定数字证书");
      else if (code === "OPENING_CONFIRM_SIGNATURE_INVALID") toast.error("签名验证失败，请重试");
      else if (!e?.status && e?.message) toast.error(e.message); // 本地签名异常兜底；403/400 等已由 API 层全局 toast
    } finally {
      setConfirming(false);
    }
  }

  async function submitDispute() {
    const reason = disputeReason.trim();
    if (!reason) return; // 输入校验：请填写异议原因
    setDisputeSubmitting(true);
    try {
      await supplierApi.disputeOpening(projectId, reason);
      toast.success("异议已提交，请等待主持人处理");
      setDisputeOpen(false);
      setDisputeReason("");
      await refresh();
    } catch {
      // U5：业务错误消息已由全局 API 层统一弹出，此处不重复提示
    } finally {
      setDisputeSubmitting(false);
    }
  }

  // 实时事件 → UI：阶段流转/唱标更新→refresh；解密仅认本司；在场计数直写；
  // 异议处理结果 toast（确认/退回）。handlers 每渲染取最新闭包（详见 use-bid-websocket.ts）
  useBidWebSocket(projectId, () => ({
    // refresh 内部已 try/catch（失败置标志、保留上次数据），.catch 仅作兜底，避免 unhandled rejection
    onStageChange: () => {
      refresh().catch(() => {});
    },
    onDecryptStatus: (d) => {
      if (d.supplierId === supplierId) setDecryptStatus(d.decryptStatus);
    },
    onHallPresence: (d) => {
      setOnlineCount(d.onlineCount);
    },
    onOpeningDisputeResolved: (d) => {
      toast.info(d.confirm ? `异议已处理（确认）：${d.result}` : `异议已处理（退回）：${d.result}`);
      refresh().catch(() => {});
    },
    // 唱标录入/更新 → 实时刷新开标记录（此前无此事件，唱标后供应商页不更新，只能手动刷新）
    onOpeningRecordUpdated: () => {
      refresh().catch(() => {});
    },
  }));

  useEffect(() => {
    bootstrap();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 平台绑定证书（供 U盾内证书匹配兜底；失败不阻塞浏览，签名时按解锁结果报错）——与回执卡/澄清答复页同源
  useEffect(() => {
    if (!record?.confirmStatus) return;
    supplierApi.listMyCerts()
      .then((rows: ServerCertRow[]) => {
        const cert = rows.find((r) => r.bindingStatus === "ACTIVE");
        if (cert) setActiveServerCertSn(cert.certSn);
      })
      .catch(() => { /* 列表加载失败已全局 toast；解锁时兜底报错 */ });
  }, [record?.confirmStatus]);

  // 首屏加载失败（尚无项目数据）：错误态 + 重试
  if (loadError && !project) {
    return (
      <div className="hall">
        <div className="hall-error">
          <EmptyState icon={CloudOff} title={loadErrorMsg || "加载开标大厅数据失败"}>
            <SpButton variant="primary" loading={bootstrapping} onClick={bootstrap}>
              重试
            </SpButton>
          </EmptyState>
        </div>
      </div>
    );
  }

  // 后端/种子数据实际写入 '待供应商确认'（bid.service.ts），旧页兼容 '待确认'，两者都接受
  const canConfirm = isOpening && record && (record.confirmStatus === "待确认" || record.confirmStatus === "待供应商确认");
  // A-114 补签：已确认但未电子签名（本人视图 record.confirmSignature 为完整归档）——同一签名流，服务端按 resign 处理
  const canResign = isOpening && record?.confirmStatus === "供应商已确认" && !record?.confirmSignature;

  return (
    <div className="hall">
      <div className="left">
        <section className="hall-card">
          <header className="hall-card__header">
            <div className="head">
              <span className="name">{project?.name || "加载中…"}</span>
              <div className="meta">
                {/* 在线数：图标 + 等宽数字，左对齐（开标阶段状态由签到按钮/阶段提示条/聊天禁言条表达，不再单设徽标） */}
                <span className="presence">
                  <User size={14} strokeWidth={2} />
                  在线 <b className="num">{onlineCount}</b> 家
                </span>
              </div>
            </div>
          </header>

          <div className="hall-card__body">
            <table className="hall-desc">
              <tbody>
                <tr>
                  <th>本司解密状态</th>
                  <td>{decryptStatus || record?.decryptResult || "—"}</td>
                </tr>
                <tr>
                  <th>唱标金额</th>
                  <td>{record?.amount != null ? `${record.amount} 元` : "—"}</td>
                </tr>
                <tr>
                  <th>投递报价</th>
                  <td>
                    <span className={record?.submitted?.priceMismatch ? "mismatch" : undefined}>{submittedPriceText}</span>
                    {record?.submitted?.priceMismatch && (
                      <span className="hall-tag hall-tag--sm hall-tag--warning-plain" style={{ marginLeft: 6 }}>
                        与唱标不一致
                      </span>
                    )}
                  </td>
                </tr>
                <tr>
                  <th>工期（唱标）</th>
                  <td>{record?.period || "—"}</td>
                </tr>
                <tr>
                  <th>工期（投递）</th>
                  <td>
                    <span className={record?.submitted?.periodMismatch ? "mismatch" : undefined}>
                      {record?.submitted?.deliveryPeriod || "—"}
                    </span>
                    {record?.submitted?.periodMismatch && (
                      <span className="hall-tag hall-tag--sm hall-tag--warning-plain" style={{ marginLeft: 6 }}>
                        与唱标不一致
                      </span>
                    )}
                  </td>
                </tr>
                <tr>
                  <th>质量承诺（唱标）</th>
                  <td>{record?.qualityTarget || "—"}</td>
                </tr>
                {record?.submitted?.qualityCommitment && (
                  <tr>
                    <th>质量承诺（投递）</th>
                    <td>
                      <span
                        className={
                          record.qualityTarget != null && record.qualityTarget !== record.submitted.qualityCommitment
                            ? "mismatch"
                            : undefined
                        }
                      >
                        {record.submitted.qualityCommitment}
                      </span>
                    </td>
                  </tr>
                )}
                <tr>
                  <th>开标记录状态</th>
                  <td>
                    {record?.confirmStatus || "—"}
                    {/* A-114：已电子签名徽标（本人视图完整归档含 algorithm/verifiedAt；配色同本页 .presence 绿色药丸） */}
                    {record?.confirmSignature && (
                      <span
                        className="hall-tag hall-tag--sm"
                        style={{ marginLeft: 6, gap: 4, background: "#f0f9eb", borderColor: "#e1f3d8", color: "#529b2e" }}
                      >
                        <Lock size={12} strokeWidth={1.75} />
                        已电子签名（{record.confirmSignature.algorithm ?? "SM2/SM3"}
                        {record.confirmSignature.verifiedAt
                          ? ` · ${dayjs(record.confirmSignature.verifiedAt).format("YYYY-MM-DD HH:mm")}`
                          : ""}）
                      </span>
                    )}
                  </td>
                </tr>
                {record?.handleResult && (
                  <tr>
                    <th>异议处理结果</th>
                    <td>{record.handleResult}</td>
                  </tr>
                )}
              </tbody>
            </table>

            <div className="actions">
              {isOpening && !checkedInAt ? (
                <SpButton variant="primary" onClick={checkIn}>
                  签到
                </SpButton>
              ) : checkedInAt ? (
                <span className="hall-tag hall-tag--info">已签到 {new Date(checkedInAt).toLocaleTimeString("zh-CN")}</span>
              ) : null}
              {canConfirm && (
                <>
                  <SpButton variant="primary" success icon={ShieldCheck} loading={confirming} onClick={handleConfirmSign}>
                    确认开标记录
                  </SpButton>
                  <SpButton warning onClick={() => setDisputeOpen(true)}>
                    提出异议
                  </SpButton>
                </>
              )}
              {canResign && (
                <SpButton icon={ShieldCheck} loading={confirming} onClick={handleConfirmSign}>
                  补签确认（U盾）
                </SpButton>
              )}
              {ukeyAdapter && (canConfirm || canResign) && <span className="ukey-ok">U盾已解锁（{ukeyCertSn}）</span>}
            </div>
            {!isOpening && stage && <div className="stage-hint">大厅互动仅在开标阶段开放。</div>}
          </div>
        </section>

        {/* ═══ 双信封 v2：解密我的投标（OPENING 阶段轮询 opening-package；旧轨自动隐藏）═══ */}
        <OpeningDecryptCard
          projectId={projectId}
          isOpening={isOpening}
          submitted={!!record?.submitted}
          profileSm2PublicKey={profileSm2PublicKey}
          onDecrypted={() => { refresh().catch(() => {}); }}
        />

        {/* 唱标记录总表：自开标起向本项目全体投标人公开（《电子招标投标办法》第30条），
             WS opening:record:updated → refresh() 实时更新；本司行按 bidSupplierId 高亮 */}
        <section className="hall-card records-card">
          <header className="hall-card__header">
            <div className="records-head">
              <span className="records-title">唱标记录（全部投标人）</span>
              <span className="records-count">{records.length} 条</span>
            </div>
          </header>
          <div className="hall-card__body">
            <table className="hall-table">
              <thead>
                <tr>
                  <th className="col-supplier w-supplier">供应商</th>
                  <th className="w-amount">报价（元）</th>
                  <th className="w-period">工期</th>
                  <th className="w-quality">质量目标</th>
                  <th className="w-bond">保证金</th>
                  <th className="w-status">状态</th>
                </tr>
              </thead>
              <tbody>
                {records.map((row) => (
                  <tr key={row.id}>
                    <td className="col-supplier w-supplier">
                      <span>{row.supplierName}</span>
                      {row.bidSupplierId === record?.bidSupplierId && (
                        <span className="hall-tag hall-tag--sm hall-tag--info self-tag">本司</span>
                      )}
                    </td>
                    <td className="w-amount">{row.amount}</td>
                    <td className="w-period">{row.period}</td>
                    <td className="w-quality">{row.qualityTarget}</td>
                    <td className="w-bond">{row.bondStatus}</td>
                    <td className="w-status">{row.confirmStatus}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {records.length === 0 && <div className="hall-table-empty">暂无唱标记录（开标后实时展示）</div>}
          </div>
        </section>
      </div>

      <div className="right">
        {supplierId ? (
          <ChatPanel projectId={projectId} supplierId={supplierId} supplierName={supplierName} userId={auth.user?.id ?? ""} />
        ) : profileError ? (
          <section className="hall-card">
            <div className="hall-card__body">
              <EmptyState icon={MessageSquareOff} title="会话加载失败">
                <SpButton variant="primary" onClick={retryProfile}>
                  重试
                </SpButton>
              </EmptyState>
            </div>
          </section>
        ) : (
          <section className="hall-card">
            <div className="hall-card__body">
              <div className="empty">加载供应商信息中…</div>
            </div>
          </section>
        )}
      </div>

      {/* 提出开标异议（ElMessageBox.prompt 等价：textarea + 必填校验） */}
      <SpDialog
        open={disputeOpen}
        onClose={() => setDisputeOpen(false)}
        title="提出开标异议"
        icon={MessageSquareOff}
        footer={
          <>
            <SpButton onClick={() => setDisputeOpen(false)}>取消</SpButton>
            <SpButton variant="primary" loading={disputeSubmitting} disabled={!disputeReason.trim()} onClick={submitDispute}>
              提交
            </SpButton>
          </>
        }
      >
        <SpTextarea
          value={disputeReason}
          onChange={(e) => setDisputeReason(e.target.value)}
          placeholder="请输入异议原因"
          autoFocus
        />
        {!disputeReason.trim() && <p style={{ marginTop: 8, fontSize: 12, color: "#e6a23c" }}>请填写异议原因</p>}
      </SpDialog>

      {/* ═══ U盾口令对话框（克隆回执卡 A-101：解锁后自动续跑挂起的开标确认/补签签名，A-114）═══ */}
      <SpDialog
        open={ukeyDialogVisible}
        onClose={() => setUkeyDialogVisible(false)}
        title="证书口令验证"
        subtitle="开标确认电子签名需解锁 U盾证书"
        icon={KeyRound}
        width={420}
        footer={
          <>
            <SpButton variant="soft" onClick={() => setUkeyDialogVisible(false)}>取消</SpButton>
            <SpButton variant="primary" loading={ukeyOpening} onClick={handleUkeyOpen}>解锁并签名</SpButton>
          </>
        }
      >
        <p className="text-xs leading-relaxed text-[var(--muted-foreground)] mb-2.5">
          即将对本开标记录（唱标信息快照：报价/工期/质量目标等）进行 U盾电子签名，签名后随确认结果归档留痕。
        </p>
        <label className="reg-label">证书口令</label>
        <SpInput
          type="password"
          value={ukeyPassword}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setUkeyPassword(e.target.value)}
          placeholder="输入证书口令"
          onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => { if (e.key === "Enter") void handleUkeyOpen(); }}
        />
        <p className="text-xs mt-3 text-[var(--fg-2)]">口令仅本次会话使用，不会保存。</p>
      </SpDialog>
    </div>
  );
}
