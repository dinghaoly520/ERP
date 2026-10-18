"use client";

/**
 * A-143 评标澄清在线答复页：问题卡片 → 答复编辑器（文本+附件）→ 提交。
 * 原 U盾签名答复序列（口令弹窗 + adapter.sign）已随 mock U盾轨下线（2026-10-13），
 * 提交路径保留，签名随 dual-v3（SCCA，阶段 2）恢复。
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import dayjs from "dayjs";
import {
  ArrowLeft,
  FileText,
  Lock,
  MessageSquare,
  Trash2,
  TriangleAlert,
  UploadCloud,
} from "lucide-react";;
import { bidApi, type SupplierBidClarification } from "@/lib/api/bid";
import { uploadFile } from "@/lib/api/upload";
import { SpPageHero } from "@/components/sp-page-hero";
import * as scca from "@/utils/scca-ukey";
import { supplierApi } from "@/lib/api/supplier";
import { LoadingBlock, SpButton, SpTextarea } from "@/components/ui";
import "@/styles/pages/bids.css";

interface UploadedAttachment { fileAssetId: string; name: string; sha256: string }

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
  // dual-v3 P7 签署（阶段2 收尾）：PIN 输入（不落盘）
  const [pin, setPin] = useState("");
  const [signing, setSigning] = useState(false);

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

  function handleSubmit() {
    if (!active) return;
    if (reply.trim().length < 5) { toast.warning("答复内容至少 5 个字（5~5000 字）"); return; }
    if (reply.trim().length > 5000) { toast.warning("答复内容不能超过 5000 字"); return; }
    void doReply();
  }

  /** 提交答复（dual-v3 → 盾 P7 签名链；旧轨 → 空签照走） */
  async function doReply() {
    if (!active) return;
    const replyText = reply.trim();
    const attachmentIds = attachments.map((a) => a.fileAssetId);

    setSubmitting(true);
    setSigning(true);
    try {
      // 检测投递轨道——dual-v3 供应商必须走 P7 签名
      const sub = await supplierApi.getBidSubmission(projectId).catch(() => null);
      const isV3 = (sub as any)?.envelopeVersion === "dual-v3";

      if (isV3) {
        if (!pin) {
          toast.warning("请输入 U盾 PIN（澄清答复将以 SCCA CA P7 签名）");
          setSigning(false);
          return;
        }
        // ① 取 canonical → ② 盾枚举+PIN → ③ prepare → ④ 盾签 → ⑤ 提交
        const pl = await bidApi.getClarificationReplyPayload(projectId, active.id, {
          reply: replyText, attachmentIds,
        });
        const certs = await scca.listSccaCerts();
        const first = certs[0];
        if (!first) throw new Error("U盾内未找到证书——请插入 SCCA CA U盾");
        await scca.loginScca(first.container, pin);
        const prep = await supplierApi.caPrepare(projectId, "clarification");
        const signP7 = await scca.signSccaP7(first.container, pl.payload);
        await bidApi.submitClarificationReply(projectId, active.id, {
          reply: replyText, attachmentIds,
          operationId: prep.operationId,
          signatureFormat: "scca-pkcs7-base64",
          signP7,
        });
      } else {
        await bidApi.submitClarificationReply(projectId, active.id, {
          reply: replyText, attachmentIds,
        });
      }
      toast.success("澄清答复已提交");
      setActiveId(null);
      setPin("");
      await load();
    } catch (e: any) {
      if (!e?.status && e?.message) toast.error(e.message);
    } finally {
      setSubmitting(false);
      setSigning(false);
    }
  }

  return (
    <div className="page-container">
      <button type="button" className="neu-link back-link" onClick={() => router.push(`/bids/${projectId}`)}>
        <ArrowLeft size={14} strokeWidth={1.85} />返回项目详情
      </button>

      <SpPageHero
        icon={MessageSquare}
        title="评标澄清答复"
        sub="查看评标澄清问题并提交答复"
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
        <div className="bc-empty !py-12">暂无向贵司发出的评标澄清</div>
      ) : (
        <div className="neu-card mt-5">
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
                        placeholder="请输入澄清答复内容（5~5000 字，提交后不可修改）"
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
                        <SpButton variant="soft" onClick={() => setActiveId(null)}>取消</SpButton>
                        <SpButton
                          variant="primary"
                          loading={submitting}
                          disabled={uploading}
                          onClick={handleSubmit}
                        >
                          提交答复
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
    </div>
  );
}
