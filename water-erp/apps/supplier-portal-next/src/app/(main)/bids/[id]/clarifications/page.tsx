"use client";

/**
 * A-143 评标澄清在线答复页：问题卡片 → 答复编辑器（文本+附件）→ U盾口令解锁 → 对服务端
 * reply-payload 返回的 canonical 串签名 → 提交（前端不自行拼接签名文本）。
 * U盾会话与签名序列克隆自 bids/[id]/submit/page.tsx：
 *  - ukeyDialogVisible 口令弹窗 + pendingReplyRef 挂起续跑 + ukeySessionRef 快照
 *  - 证书选择：优先本地缓存 supplier_ukey_bound.certSn（U盾管理页绑定后写入），
 *    兜底服务端 ACTIVE 绑定记录（supplierApi.listMyCerts）
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import dayjs from "dayjs";
import {
  ArrowLeft, FileText, KeyRound, Lock, MessageSquareReply, ShieldCheck, Trash2, TriangleAlert, UploadCloud,
} from "lucide-react";
import { bidApi, type SupplierBidClarification } from "@/lib/api/bid";
import { supplierApi } from "@/lib/api/supplier";
import { uploadFile } from "@/lib/api/upload";
import { SpPageHero } from "@/components/sp-page-hero";
import { LoadingBlock, SpButton, SpDialog, SpInput, SpTextarea } from "@/components/ui";
import { openUkey } from "@/utils/ukey-factory";
import type { UKeyAdapter } from "@water-erp/ukey";
import "@/styles/pages/bids.css";

interface UploadedAttachment { fileAssetId: string; name: string; sha256: string }

/** 服务端绑定记录（仅取答复所需公开字段） */
interface ServerCertRow { certSn: string; bindingStatus: string }

/** 本地缓存的绑定证书序列号（U盾管理页绑定成功后写入；仅公开信息）——与 submit 页同源 */
function boundCertSn(): string {
  try {
    const raw = localStorage.getItem("supplier_ukey_bound");
    return raw ? (JSON.parse(raw)?.certSn ?? "") : "";
  } catch { return ""; }
}

export default function BidClarificationsPage() {
  const router = useRouter();
  const params = useParams();
  const projectId = params.id as string;

  const [items, setItems] = useState<SupplierBidClarification[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  // ── 答复编辑（同卡片就地展开；一次只编辑一条）──
  const [activeId, setActiveId] = useState<string | null>(null);
  const active = useMemo(() => items.find((c) => c.id === activeId) ?? null, [items, activeId]);
  const [reply, setReply] = useState("");
  const [attachments, setAttachments] = useState<UploadedAttachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // ── U盾会话（克隆 submit 页：口令仅内存持有，解锁一次覆盖本页全部答复签名）──
  const [ukeyAdapter, setUkeyAdapter] = useState<UKeyAdapter | null>(null);
  const [ukeyCertSn, setUkeyCertSn] = useState("");
  const [ukeyPassword, setUkeyPassword] = useState("");
  const [ukeyOpening, setUkeyOpening] = useState(false);
  const [ukeyDialogVisible, setUkeyDialogVisible] = useState(false);
  const pendingReplyRef = useRef(false);
  /** U盾会话快照 ref——解锁后同一事件闭包内立即 doReply，useState 异步更新会读到空值 */
  const ukeySessionRef = useRef<{ adapter: UKeyAdapter; certSn: string } | null>(null);
  /** 平台 ACTIVE 绑定证书 SN（U盾内证书的兜底匹配；空 = 未绑定，答复时给出引导） */
  const [activeServerCertSn, setActiveServerCertSn] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setItems(await bidApi.listMyBidClarifications(projectId));
      setLoadError(false);
    } catch {
      setLoadError(true); // API 层已全局错误 toast
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { void load(); }, [load]);

  // 平台绑定证书（供 U盾内证书匹配；失败不阻塞浏览，签名时按解锁结果报错）
  useEffect(() => {
    supplierApi.listMyCerts()
      .then((rows: ServerCertRow[]) => {
        const cert = rows.find((r) => r.bindingStatus === "ACTIVE");
        if (cert) setActiveServerCertSn(cert.certSn);
      })
      .catch(() => { /* 列表加载失败已全局 toast；解锁时兜底报错 */ });
  }, []);

  async function retryLoad() {
    setLoadError(false);
    setLoading(true);
    try {
      setItems(await bidApi.listMyBidClarifications(projectId));
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }

  const pendingCount = items.filter((c) => c.status === "待回复").length;

  function startReply(c: SupplierBidClarification) {
    setActiveId(c.id);
    setReply("");
    setAttachments([]);
  }

  async function handleUpload(files: FileList | null) {
    if (!files?.length) return;
    const room = 5 - attachments.length;
    if (room <= 0) { toast.warning("附件最多 5 个"); return; }
    setUploading(true);
    try {
      const next: UploadedAttachment[] = [];
      for (const f of Array.from(files).slice(0, room)) {
        const res = await uploadFile(f, "clarification_reply");
        next.push({ fileAssetId: res.id, name: res.originalName, sha256: res.sha256 });
      }
      setAttachments((prev) => [...prev, ...next]);
    } catch { /* uploadFile 已 toast */ }
    finally { setUploading(false); }
  }

  function removeAttachment(fileAssetId: string) {
    setAttachments((prev) => prev.filter((a) => a.fileAssetId !== fileAssetId));
  }

  function handleSignSubmit() {
    if (!active) return;
    if (reply.trim().length < 5) { toast.warning("答复内容至少 5 个字（5~5000 字）"); return; }
    if (reply.trim().length > 5000) { toast.warning("答复内容不能超过 5000 字"); return; }
    if (!ukeyAdapter) {
      // 先解锁 U盾（口令对话框），解锁成功后凭 pendingReplyRef 自动继续提交——与 submit 页同序列
      pendingReplyRef.current = true;
      setUkeyPassword("");
      setUkeyDialogVisible(true);
      return;
    }
    void doReply();
  }

  /** 口令确认 → 解锁 U盾 → 选定平台绑定证书 → 续跑挂起的答复 */
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
      if (pendingReplyRef.current) { pendingReplyRef.current = false; await doReply(); }
    } catch (e: any) {
      toast.error(e?.message || "U盾解锁失败");
    } finally {
      setUkeyOpening(false);
    }
  }

  /** 取 canonical → U盾签名 → 提交（签名对象 = 服务端返回串；API 错误已全局 toast） */
  async function doReply() {
    const session = ukeySessionRef.current;
    if (!active || !session) return;
    const body = {
      reply: reply.trim(),
      attachmentIds: attachments.map((a) => a.fileAssetId),
      certSn: session.certSn,
    };
    setSubmitting(true);
    try {
      const { payload } = await bidApi.getClarificationReplyPayload(projectId, active.id, body);
      const signature = await session.adapter.sign(session.certSn, payload);
      await bidApi.submitClarificationReply(projectId, active.id, { ...body, signature });
      toast.success("澄清答复已签名提交");
      setActiveId(null);
      await load();
    } catch (e: any) {
      // API 错误由 API 层全局 toast；此处兜底本地签名/组包异常
      if (!e?.status && e?.message) toast.error(e.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="page-container">
      <button type="button" className="neu-link back-link" onClick={() => router.push(`/bids/${projectId}`)}>
        <ArrowLeft size={14} strokeWidth={1.85} />返回项目详情
      </button>

      <SpPageHero
        icon={MessageSquareReply}
        title="评标澄清答复"
        sub="对评标委员会寻址贵司的澄清问题在线答复，经 U盾电子签名后提交（A-143）"
        actions={pendingCount > 0 ? <span className="b-tag b-tag--warning">{pendingCount} 条待答复</span> : undefined}
      />

      {loading ? (
        <LoadingBlock />
      ) : loadError ? (
        <div className="sp-error-block">
          <div className="sp-error-icon"><TriangleAlert size={22} strokeWidth={1.75} /></div>
          <div className="sp-error-text">澄清列表加载失败</div>
          <div className="sp-error-desc">网络或服务异常，请稍后重试</div>
          <SpButton variant="primary" onClick={retryLoad}>重新加载</SpButton>
        </div>
      ) : items.length === 0 ? (
        <div className="bc-empty" style={{ padding: "48px 0" }}>暂无寻址贵司的评标澄清</div>
      ) : (
        <div className="neu-card" style={{ marginTop: 20 }}>
          <div className="cq-list">
            {items.map((c) => (
              <div key={c.id} className="cq-item">
                <div className="cq-head">
                  <span className={`b-tag ${c.status === "待回复" ? "b-tag--warning" : "b-tag--success"}`}>{c.status}</span>
                  <span className="cq-issuer">{c.issuer}</span>
                  <span className="cq-time">{dayjs(c.createdAt).format("YYYY-MM-DD HH:mm")}</span>
                </div>
                <div className="cq-text">{c.question}</div>

                {c.status === "待回复" ? (
                  activeId === c.id ? (
                    <div className="cq-editor">
                      <SpTextarea
                        rows={5}
                        maxLength={5000}
                        value={reply}
                        onChange={(e) => setReply(e.target.value)}
                        placeholder="请输入澄清答复内容（5~5000 字，提交时经 U盾电子签名，提交后不可修改）"
                      />
                      <div className="cq-att-list">
                        {attachments.map((a) => (
                          <span key={a.fileAssetId} className="cq-att-item">
                            <FileText size={13} strokeWidth={1.75} />
                            <span className="cq-att-name" title={a.sha256 ? `SHA-256 ${a.sha256.slice(0, 16)}…` : undefined}>{a.name}</span>
                            <button type="button" className="cq-att-del" onClick={() => removeAttachment(a.fileAssetId)} title="移除附件">
                              <Trash2 size={13} strokeWidth={1.75} />
                            </button>
                          </span>
                        ))}
                        {attachments.length < 5 && (
                          <label className="cq-upzone">
                            <input
                              type="file"
                              multiple
                              hidden
                              onChange={(e) => {
                                void handleUpload(e.target.files);
                                e.target.value = "";
                              }}
                            />
                            <UploadCloud size={14} strokeWidth={1.75} /> {uploading ? "上传中…" : "上传附件（≤5）"}
                          </label>
                        )}
                      </div>
                      <div className="cq-actions">
                        <span className="cq-actions-hint">
                          {ukeyAdapter ? `U盾已解锁（${ukeyCertSn}）` : "提交时需输入证书口令解锁 U盾"}
                        </span>
                        <SpButton variant="soft" onClick={() => setActiveId(null)}>取消</SpButton>
                        <SpButton
                          variant="primary"
                          icon={ShieldCheck}
                          loading={submitting}
                          disabled={uploading}
                          onClick={handleSignSubmit}
                        >
                          U盾签名并提交
                        </SpButton>
                      </div>
                    </div>
                  ) : (
                    <div className="cq-actions">
                      <SpButton variant="soft" onClick={() => startReply(c)}>答复</SpButton>
                    </div>
                  )
                ) : (
                  <>
                    <div className="cq-reply"><span className="b-tag b-tag--info">答复</span><span>{c.reply}</span></div>
                    {c.replyAttachmentIds?.length ? (
                      <div className="cq-att-list">
                        {c.replyAttachmentIds.map((a) => (
                          <a
                            key={a.fileAssetId}
                            className="cq-att-item"
                            href={`/api/upload/files/${a.fileAssetId}`}
                            target="_blank"
                            rel="noopener"
                          >
                            <FileText size={13} strokeWidth={1.75} /> {a.name}
                          </a>
                        ))}
                      </div>
                    ) : null}
                    {c.replyChannel === "online" && c.replySignature ? (
                      <div className="cq-sig">
                        <Lock size={12} strokeWidth={1.75} />
                        已电子签名（{c.replySignature.algorithm ?? "SM2/SM3"}
                        {c.replySignature.certSn ? ` · 证书 ${c.replySignature.certSn.slice(-8)}` : ""}
                        {c.replySignature.verifiedAt ? ` · 验签 ${dayjs(c.replySignature.verifiedAt).format("MM-DD HH:mm")}` : ""}）
                      </div>
                    ) : c.replyChannel === "offline" ? (
                      <div className="cq-sig">
                        <FileText size={12} strokeWidth={1.75} />
                        主持人线下登记{c.replyOfflineReason ? `：${c.replyOfflineReason}` : ""}
                      </div>
                    ) : null}
                  </>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ═══ U盾口令对话框（克隆 submit 页：解锁后自动续跑挂起的答复提交）═══ */}
      <SpDialog
        open={ukeyDialogVisible}
        onClose={() => setUkeyDialogVisible(false)}
        title="证书口令验证"
        subtitle="评标澄清答复需解锁 U盾证书完成电子签名"
        icon={KeyRound}
        width={420}
        footer={
          <>
            <SpButton variant="soft" onClick={() => setUkeyDialogVisible(false)}>取消</SpButton>
            <SpButton variant="primary" loading={ukeyOpening} onClick={handleUkeyOpen}>解锁并签名</SpButton>
          </>
        }
      >
        <p className="cq-pin-hint">
          即将对答复内容（服务端返回的规范化文本{attachments.length > 0 ? "及附件清单" : ""}）进行 U盾电子签名，提交后不可修改。
        </p>
        <label className="reg-label">证书口令</label>
        <SpInput
          type="password"
          value={ukeyPassword}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setUkeyPassword(e.target.value)}
          placeholder="输入证书口令"
          onKeyDown={(e: React.KeyboardEvent) => { if (e.key === "Enter") void handleUkeyOpen(); }}
        />
        <p className="text-xs mt-3 text-[var(--fg-2)]">口令仅本次会话使用，不会保存。</p>
      </SpDialog>
    </div>
  );
}
