"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { CaOpeningDecryptCard } from "@/components/ca-opening-decrypt-card";
import { CaOpeningConfirmButton } from "@/components/ca-opening-confirm-button";
import { CaBidReuploadCard } from "@/components/ca-bid-reupload-card";
import { toast } from "sonner";
import dayjs from "dayjs";
import { CloudOff, Clock, Lock, MessageSquareOff, User, Wifi } from "lucide-react";
import { bidApi } from "@/lib/api/bid";
import { supplierApi, type OpeningRecordRow } from "@/lib/api/supplier";
// A-113：唱标字段动态渲染辅助（后端 opening-field-config.util.ts 的渲染镜像，含法定四列本页固定口径）
import {
  resolveOpeningFields,
  openingColumnLabel,
  openingColumnWidth,
  openingRecordCell,
  otherOpeningRows,
  formatOpeningAmount,
  formatBidSubmissionPrice,
  type OpeningFieldDef,
} from "@/lib/opening-fields";
import { openingHallApi } from "@/lib/api/opening-hall";
import { ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { useBidWebSocket } from "@/hooks/use-bid-websocket";
import { ChatPanel } from "@/components/chat-panel";
import { EmptyState, SpButton, SpDialog, SpTextarea } from "@/components/ui";
import "@/styles/pages/opening.css";
import "@/styles/pages/bid-components.css"; // ChatPanel（chat-panel / cp-*）样式

/** 唱标总表「状态」列短标签——BidOpeningRecord.confirmStatus 为 String 列（非 ConfirmStatus 枚举，
 *  该枚举属 BidSupplier.confirmStatus），实际写入域为中文状态：待供应商确认/供应商已确认/供应商提出异议/
 *  异议已处理-确认/异议已处理-退回，另有 legacy「待确认」与封拍卖轨建录 PENDING；未知值原串直出，不静默吞信息 */
const OPENING_CONFIRM_LABELS: Record<string, string> = {
  待供应商确认: "待确认",
  供应商已确认: "已确认",
  供应商提出异议: "有异议",
  "异议已处理-确认": "异议后确认",
  "异议已处理-退回": "异议后退回",
  待确认: "待确认",
  PENDING: "待确认",
  缺席视为确认: "缺席确认",
};

/** 解密状态枚举→中文标签（bidSupplier.decryptStatus：PENDING/RUNNING/SUCCESS/DANGER——显示层用，逻辑判定保留英文） */
const DECRYPT_STATUS_LABEL: Record<string, string> = {
  PENDING: "待解密",
  RUNNING: "解密中",
  SUCCESS: "解密成功",
  DANGER: "解密异常",
};

export default function OpeningHallPage() {
  const params = useParams<{ projectId: string }>();
  const projectId = params.projectId;
  // U3：ChatPanel 的 userId 取登录用户 User.id（消息 senderId = actor.userId，非 Supplier.id）
  const auth = useAuth();

  const [project, setProject] = useState<any>(null);
  const [record, setRecord] = useState<any>(null);
  const [records, setRecords] = useState<OpeningRecordRow[]>([]);
  // A-113：本项目唱标字段配置（随公开唱标表端点附带；开标前端点 400 → null，渲染处回退默认四列）
  const [fieldConfig, setFieldConfig] = useState<OpeningFieldDef[] | null>(null);
  const [checkedInAt, setCheckedInAt] = useState<string | null>(null);
  const [onlineCount, setOnlineCount] = useState(0);
  const [decryptStatus, setDecryptStatus] = useState<string>("");
  const [supplierId, setSupplierId] = useState("");
  const [supplierName, setSupplierName] = useState("");
  const [loadError, setLoadError] = useState(false);
  const [loadErrorMsg, setLoadErrorMsg] = useState("");
  const [profileError, setProfileError] = useState(false);
  const [bootstrapping, setBootstrapping] = useState(false);
  // 异议弹窗（ElMessageBox.prompt 的样式化等价）：textarea + 必填校验
  const [disputeOpen, setDisputeOpen] = useState(false);
  const [disputeReason, setDisputeReason] = useState("");
  const [disputeSubmitting, setDisputeSubmitting] = useState(false);

  // ── 聊天栏拖拽调宽：null = 默认比例（未拖过/已重置）；数值 = 用户拖定的像素宽（localStorage 持久化）──
  const [chatW, setChatW] = useState<number | null>(null);
  const hallRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const chatWRef = useRef<number | null>(null); // 落盘镜像：pointerup 与最后一次 move 可能同批，闭包读 state 会滞后
  const CHAT_W_KEY = "opening-hall-chat-w";
  const CHAT_W_MIN = 300;
  // 挂载后恢复上次宽度（放 effect 避免 SSR 水合不一致）
  useEffect(() => {
    const v = Number(localStorage.getItem(CHAT_W_KEY));
    if (Number.isFinite(v) && v >= CHAT_W_MIN) setChatW(v);
  }, []);
  function clampChatW(w: number, hallRect: DOMRect): number {
    return Math.min(Math.round(hallRect.width * 0.6), Math.max(CHAT_W_MIN, Math.round(w)));
  }
  function onResizeStart(e: React.PointerEvent<HTMLDivElement>) {
    draggingRef.current = true;
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* 合成事件无捕获也不影响：move 仍派发至把手 */ }
    document.body.classList.add("hall-resizing");
  }
  function onResizeMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!draggingRef.current || !hallRef.current) return;
    const rect = hallRef.current.getBoundingClientRect();
    const w = clampChatW(rect.right - e.clientX, rect);
    chatWRef.current = w;
    setChatW(w);
  }
  function onResizeEnd() {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    document.body.classList.remove("hall-resizing");
    if (chatWRef.current != null) localStorage.setItem(CHAT_W_KEY, String(chatWRef.current));
  }
  function resetChatW() {
    chatWRef.current = null;
    setChatW(null);
    localStorage.removeItem(CHAT_W_KEY);
  }
  function onResizeKey(e: React.KeyboardEvent<HTMLDivElement>) {
    // 键盘可达：← 右列加宽（把手左移）、→ 右列收窄；±24px。默认态基值取右列实测宽（而非视口一半，避免首按跳变）
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const hall = hallRef.current;
    if (!hall) return;
    const rect = hall.getBoundingClientRect();
    const rightEl = hall.querySelector<HTMLElement>(":scope > .right");
    const cur = chatW ?? (rightEl ? Math.round(rightEl.getBoundingClientRect().width) : Math.round(rect.width / 2));
    setChatW(clampChatW(cur + (e.key === "ArrowLeft" ? 24 : -24), rect));
  }

  // bootstrap 在 await 后要读最新 loadError/project——React 状态异步，用 ref 镜像
  const loadErrorRef = useRef(false);
  const projectRef = useRef<any>(null);
  const loadErrorMsgRef = useRef("");

  const stage: string = project?.stage ?? "";
  const isOpening = stage === "OPENING";

  /** 投递报价显示文本（P1-C：与唱标总表同口径——千分位+元 / 带单位原文直出；
      dual-v2 单位提示 → 「153.95 万元」，2026-09-14） */
  const submittedPriceText = formatBidSubmissionPrice(
    record?.submitted?.bidPrice,
    record?.submitted?.bidPriceInYuan,
    record?.submitted?.bidPriceUnit,
  );

  async function refresh() {
    // 失败保留上次成功数据（P1-8：勿抹成 null 令开标记录区静默消失）；首屏（project 为空）时由错误态 + 重试展示
    try {
      const [p, recRes, list] = await Promise.all([
        bidApi.getProject(projectId),
        supplierApi.getOpeningRecord(projectId)
          .then((r: unknown) => {
            setRecord(r);
            // 初始化 decryptStatus（后端权威值——WS 事件仅做后续更新，刷新后不初始化会致
            // DANGER 态补传卡不显示/SUCCESS 态误标已解密）
            const rr = r as { decryptResult?: string; decryptStatus?: string } | null;
            if (rr?.decryptStatus) setDecryptStatus(rr.decryptStatus);
            else if (rr?.decryptResult) setDecryptStatus(rr.decryptResult === '解密成功' ? 'SUCCESS' : rr.decryptResult);
          })
          .catch(() => { /* 拉取失败保留上次成功记录 */ }),
        // 开标前端点返回 400 OPENING_NOT_STARTED——捕获后置空列表，页面不报错
        supplierApi.getOpeningRecords(projectId).catch(() => null),
      ]);
      setProject(p);
      setRecords(list?.records ?? []);
      setFieldConfig(list?.fieldConfig?.fields ?? null);
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
    if (res) {
      setOnlineCount(res.onlineCount ?? 0);
      // B4-1（2026-09-30）：签到状态服务端权威——此前仅本地 state，刷新/重进大厅徽标丢失、
      // 按钮重现（后端 presence 已下发 myCheckInAt）
      if (res.myCheckInAt) setCheckedInAt(res.myCheckInAt);
    }
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

  // A-114 开标确认电子签名（口令弹窗 → 解锁 U盾 → canonical 签名 → 提交）已随 mock U盾轨
  // 下线（2026-10-13）；开标记录确认/补签随 dual-v3（SCCA，阶段 2）恢复。异议通道不受影响。

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
  // X-P2-09/SUP-P3-06：接回 connection/reconnectNow——重连即全量补拉（断连窗口错过的事件
  // 此前无任何补偿），顶栏渲染连接徽标与手动刷新按钮（对齐 :3007 任务板 O5/O6 口径）
  const { connection: wsConnection, reconnectNow: wsReconnectNow } = useBidWebSocket(projectId, () => ({
    onReconnected: () => {
      refresh().catch(() => {});
    },
    // refresh 内部已 try/catch（失败置标志、保留上次数据），.catch 仅作兜底，避免 unhandled rejection
    onStageChange: () => {
      refresh().catch(() => {});
    },
    onDecryptStatus: (d) => {
      // SUP-P3-02：载荷 supplierId 是 BidSupplier 行 id——此前比对 Supplier.id（profile.id）
      // 恒不相等、解密状态永不实时更新（只能靠 refresh 兜底）；本司行 id 从开标记录取
      const myRowId = record?.bidSupplierId;
      if (myRowId ? d.supplierId === myRowId : d.supplierId === supplierId) setDecryptStatus(d.decryptStatus);
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

  // 首屏加载失败（尚无项目数据）：错误态 + 重试
  if (loadError && !project) {
    return (
      <div className="hall">
        <div className="hall-error">
          <EmptyState role="alert" icon={CloudOff} title={loadErrorMsg || "加载开标大厅数据失败"}>
            <SpButton variant="primary" loading={bootstrapping} onClick={bootstrap}>
              重试
            </SpButton>
          </EmptyState>
        </div>
      </div>
    );
  }

  // 后端/种子数据实际写入 '待供应商确认'（bid.service.ts），旧页兼容 '待确认'，两者都接受
  // 确认/补签电子签名随 mock U盾轨下线（A-114，见上）；异议在待确认态开放，不受影响
  const canDispute = isOpening && !!record && (record.confirmStatus === "待确认" || record.confirmStatus === "待供应商确认");

  // A-113：两表同一 config 渲染——公开总表列序（config 缺失回退默认四列=现状渲染）、
  // 本司对比区动态字段增显行（仅 config 动态键且有值；无密封源不做比对，仅展示）
  const tableFields = useMemo(() => resolveOpeningFields(fieldConfig), [fieldConfig]);
  const myOtherRows = useMemo(() => otherOpeningRows(tableFields, record), [tableFields, record]);

  return (
    <div className="hall" ref={hallRef} style={chatW != null ? ({ "--chat-w": `${chatW}px` } as React.CSSProperties) : undefined}>
      <div className="left">
        <section className="hall-card">
          <header className="hall-card__header">
            <div className="head">
              <span className="name">{project?.name || "加载中…"}</span>
              <div className="meta">
                {/* C9（第四波）：解密窗口剩余倒计时——数据源同端 getProject.openingSession（旧实现不显示，供应商只能干等窗口状态） */}
                {isOpening && (project as any)?.openingSession?.decryptWindowEnd && (
                  <span className="presence">
                    <Clock size={14} strokeWidth={2} />
                    {new Date((project as any).openingSession.decryptWindowEnd).getTime() <= Date.now()
                      ? "解密窗口已结束"
                      : `解密窗口剩余 ${Math.max(0, Math.ceil((new Date((project as any).openingSession.decryptWindowEnd).getTime() - Date.now()) / 60000))} 分钟`}
                  </span>
                )}
                {/* 在线数：图标 + 等宽数字，左对齐（开标阶段状态由签到按钮/阶段提示条/聊天禁言条表达，不再单设徽标） */}
                <span className="presence">
                  <User size={14} strokeWidth={2} />
                  在线 <b className="num">{onlineCount}</b> 家
                </span>
                {/* X-P2-09/SUP-P3-06：连接状态徽标 + 手动刷新（断连期间数据静默陈旧，此前无任何指示） */}
                <span className="presence" style={{ color: wsConnection === "connected" ? undefined : "var(--danger)" }}>
                  <Wifi size={14} strokeWidth={2} />
                  {wsConnection === "connected" ? "实时" : wsConnection === "reconnecting" ? "重连中…" : "离线"}
                </span>
                <button type="button" className="neu-btn-xs" onClick={() => { wsReconnectNow(); refresh().catch(() => {}); }}>
                  刷新
                </button>
              </div>
            </div>
          </header>

          <div className="hall-card__body">
            <table className="hall-desc">
              <tbody>
                <tr>
                  <th>本司解密状态</th>
                  <td>{DECRYPT_STATUS_LABEL[decryptStatus] ?? (decryptStatus || record?.decryptResult || "—")}</td>
                </tr>
                {/* 2026-10-15 对比卡优化：唱标/投递六行合并为三行——一致只显示一值+绿徽标，
                    不一致显示两侧值+警示徽标（原「工期（投递）—」噪音消除） */}
                <tr>
                  <th>投标报价</th>
                  {/* P1-1：金额归一——裸数字千分位+元、带单位原文直出；dual 轨按 amountUnit 直出「153.95 万元」 */}
                  <td>
                    <span className={record?.submitted?.priceMismatch ? "mismatch" : undefined}>
                      {formatOpeningAmount(record?.amount, record?.amountUnit)}
                    </span>
                    {record?.submitted?.priceMismatch ? (
                      <>
                        <span className="hall-tag hall-tag--sm hall-tag--warning-plain ml-1.5">唱标 ≠ 投递 {submittedPriceText}</span>
                      </>
                    ) : record?.submitted?.bidPrice ? (
                      <span className="hall-tag hall-tag--sm ml-1.5 gap-1 bg-[color-mix(in_oklch,var(--success)_12%,transparent)] border-[color-mix(in_oklch,var(--success)_30%,transparent)] text-success">与投递一致</span>
                    ) : null}
                  </td>
                </tr>
                <tr>
                  <th>交货工期</th>
                  <td>
                    <span className={record?.submitted?.periodMismatch ? "mismatch" : undefined}>
                      {record?.period || "—"}
                    </span>
                    {record?.submitted?.periodMismatch ? (
                      <span className="hall-tag hall-tag--sm hall-tag--warning-plain ml-1.5">唱标 ≠ 投递 {record?.submitted?.deliveryPeriod || "—"}</span>
                    ) : record?.submitted?.deliveryPeriod ? (
                      <span className="hall-tag hall-tag--sm ml-1.5 gap-1 bg-[color-mix(in_oklch,var(--success)_12%,transparent)] border-[color-mix(in_oklch,var(--success)_30%,transparent)] text-success">与投递一致</span>
                    ) : null}
                  </td>
                </tr>
                <tr>
                  <th>质量承诺</th>
                  <td>
                    <span
                      className={
                        record?.submitted?.qualityCommitment && record?.qualityTarget != null && record.qualityTarget !== record.submitted.qualityCommitment
                          ? "mismatch"
                          : undefined
                      }
                    >
                      {record?.qualityTarget || "—"}
                    </span>
                    {record?.submitted?.qualityCommitment && record?.qualityTarget != null && record.qualityTarget !== record.submitted.qualityCommitment ? (
                      <span className="hall-tag hall-tag--sm hall-tag--warning-plain ml-1.5">唱标 ≠ 投递 {record.submitted.qualityCommitment}</span>
                    ) : record?.submitted?.qualityCommitment ? (
                      <span className="hall-tag hall-tag--sm ml-1.5 gap-1 bg-[color-mix(in_oklch,var(--success)_12%,transparent)] border-[color-mix(in_oklch,var(--success)_30%,transparent)] text-success">与投递一致</span>
                    ) : null}
                  </td>
                </tr>
                {/* A-113：动态唱标字段增显区（仅 config 含动态键且有值时渲染；无法定密封源不比对，仅展示） */}
                {myOtherRows.length > 0 && (
                  <>
                    <tr className="hall-desc__group">
                      <th colSpan={2}>其他唱标字段</th>
                    </tr>
                    {myOtherRows.map((r) => (
                      <tr key={r.key}>
                        <th>{r.label}</th>
                        <td>{r.value}</td>
                      </tr>
                    ))}
                  </>
                )}
                <tr>
                  <th>开标记录状态</th>
                  <td>
                    {record?.confirmStatus || "—"}
                    {/* A-114：已电子签名徽标（本人视图完整归档含 algorithm/verifiedAt；配色同本页 .presence 绿色药丸） */}
                    {record?.confirmSignature && (
                      <span
                        className="hall-tag hall-tag--sm ml-1.5 gap-1 bg-[color-mix(in_oklch,var(--success)_12%,transparent)] border-[color-mix(in_oklch,var(--success)_30%,transparent)] text-success"
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
              {/* dual-v3 解密（v3 轨；已解密→禁用态，状态可见不隐藏）+ DANGER 态补传按钮（同行同族） */}
              {isOpening && (record?.submitted as any)?.envelopeVersion === 'dual-v3'
                && String(decryptStatus).toUpperCase() !== 'DANGER' && (
                <CaOpeningDecryptCard
                  projectId={projectId}
                  onDecrypted={() => refresh()}
                  done={String(decryptStatus).toUpperCase() === 'SUCCESS' || record?.decryptResult === '解密成功'}
                />
              )}
              {isOpening && (record?.submitted as any)?.envelopeVersion === 'dual-v3'
                && String(decryptStatus).toUpperCase() === 'DANGER' && (
                <CaBidReuploadCard projectId={projectId} onReuploaded={() => refresh()} />
              )}
              {canDispute && (
                <SpButton warning onClick={() => setDisputeOpen(true)}>
                  提出异议
                </SpButton>
              )}
              {/* dual-v3 确认唱标（办法§30 开标记录经投标人确认；2026-10-14 补接线——
                  后端 confirmOpening 一直在，Next 大厅页此前无入口） */}
              {canDispute && (record?.submitted as any)?.envelopeVersion === 'dual-v3' && (
                <CaOpeningConfirmButton projectId={projectId} onConfirmed={() => refresh()} />
              )}
            </div>
            {!isOpening && stage && <div className="stage-hint">大厅互动仅在开标阶段开放。</div>}
          </div>
        </section>

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
                  {/* A-113：字段列按项目配置渲染（法定列沿用既有标签/列宽/取值，动态列取 customFields 空显 '—'） */}
                  {tableFields.map((f) => (
                    <th key={f.key} className={openingColumnWidth(f)}>
                      {openingColumnLabel(f)}
                    </th>
                  ))}
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
                    {tableFields.map((f) => (
                      <td key={f.key} className={openingColumnWidth(f)}>
                        {/* P1-1：法定金额列归一展示（裸数字千分位+元、带单位原文直出）；
                            dual-v2 行按 amountUnit 直出「153.95 万元」——公开表与本司区同口径（2026-09-14）；其余列取值口径不变 */}
                        {f.key === "amount"
                          ? formatOpeningAmount(openingRecordCell(f, row), row.amountUnit)
                          : openingRecordCell(f, row)}
                      </td>
                    ))}
                    <td className="w-status">{OPENING_CONFIRM_LABELS[row.confirmStatus] ?? row.confirmStatus}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {records.length === 0 && <div className="hall-table-empty">暂无唱标记录（开标后实时展示）</div>}
          </div>
        </section>
      </div>

      {/* 拖拽把手：左右拖调聊天栏宽，双击重置，←/→ 键盘微调（≤960px 纵排隐藏） */}
      <div
        className="hall-resizer"
        role="separator"
        aria-orientation="vertical"
        aria-label="拖动调整聊天栏宽度（双击重置）"
        tabIndex={0}
        onPointerDown={onResizeStart}
        onPointerMove={onResizeMove}
        onPointerUp={onResizeEnd}
        onPointerCancel={onResizeEnd}
        onDoubleClick={resetChatW}
        onKeyDown={onResizeKey}
      >
        <span className="hall-resizer__grip" />
      </div>

      <div className="right">
        {supplierId ? (
          <ChatPanel projectId={projectId} supplierId={supplierId} supplierName={supplierName} userId={auth.user?.id ?? ""} stage={stage} />
        ) : profileError ? (
          <section className="hall-card">
            <div className="hall-card__body">
              <EmptyState role="alert" icon={MessageSquareOff} title="会话加载失败">
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
          <div className="neu-btn-group">
            <SpButton onClick={() => setDisputeOpen(false)}>取消</SpButton>
            <SpButton variant="primary" loading={disputeSubmitting} disabled={!disputeReason.trim()} onClick={submitDispute}>
              提交
            </SpButton>
          </div>
        }
      >
        <SpTextarea
          value={disputeReason}
          onChange={(e) => setDisputeReason(e.target.value)}
          placeholder="请输入异议原因"
          autoFocus
        />
        {!disputeReason.trim() && <p className="mt-2 text-xs text-warning">请填写异议原因</p>}
      </SpDialog>
    </div>
  );
}
