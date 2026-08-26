"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import dayjs from "dayjs";
import { toast } from "sonner";
import { CircleX, Download, FileText, Info, Link as LinkIcon, Lock, ScrollText, TriangleAlert } from "lucide-react";
import { announcementApi } from "@/lib/api/announcement";
import { SpPageHero } from "@/components/sp-page-hero";
import { EmptyState, LoadingBlock, SpButton, SpDialog, SpInput } from "@/components/ui";
import "@/styles/pages/announcements.css";

const typeLabel: Record<string, string> = {
  BID_NOTICE: "采购公告", ADDENDUM: "补遗公告", PRE_WIN_NOTICE: "预成交公示", WIN_NOTICE: "成交公告",
  CONTRACT_NOTICE: "合同公告", PERFORMANCE_NOTICE: "履行结果公告", POLICY: "政策法规", PLATFORM: "平台通知",
};
const typeTagType: Record<string, string> = { BID_NOTICE: "primary", PRE_WIN_NOTICE: "success", WIN_NOTICE: "success", POLICY: "warning", PLATFORM: "info" };

// ── 结构化元数据字段定义（与采购管理工作台 :3005 保持一致）──
interface MetaField { key: string; label: string; area?: boolean; date?: boolean }
const ANNO_TYPE_META: Record<string, MetaField[]> = {
  BID_NOTICE: [
    { key: "projectCode", label: "项目编号" }, { key: "method", label: "招标方式" }, { key: "budget", label: "预算金额" },
    { key: "downloadDeadline", label: "采购文件下载时间" },
    { key: "deadline", label: "报名/投标截止", date: true }, { key: "openTime", label: "开标时间", date: true }, { key: "contact", label: "联系方式" },
    { key: "scope", label: "采购内容/范围", area: true }, { key: "qualification", label: "投标人资格要求", area: true },
  ],
  ADDENDUM: [
    { key: "projectCode", label: "项目编号" }, { key: "changes", label: "澄清/修改内容", area: true },
    { key: "newDeadline", label: "调整后递交截止", date: true },
  ],
  PRE_WIN_NOTICE: [
    { key: "projectCode", label: "项目编号" }, { key: "winner", label: "预成交供应商" }, { key: "amount", label: "预成交价格" },
    { key: "period", label: "工期/交货期/服务期限" }, { key: "publicityPeriod", label: "公示期" }, { key: "objection", label: "异议渠道", area: true },
  ],
  WIN_NOTICE: [
    { key: "projectCode", label: "项目编号" }, { key: "winner", label: "中标供应商" }, { key: "amount", label: "中标金额" },
    { key: "period", label: "工期/交货期" }, { key: "quality", label: "质量标准" }, { key: "experts", label: "评审专家" },
    { key: "publicityPeriod", label: "公示期" }, { key: "objection", label: "异议渠道", area: true },
  ],
  POLICY: [
    { key: "docNo", label: "文号" }, { key: "issuer", label: "发布机关" }, { key: "effectiveDate", label: "生效日期" },
    { key: "scope", label: "适用范围", area: true },
  ],
  PLATFORM: [
    { key: "impactScope", label: "影响范围" }, { key: "changes", label: "功能变化", area: true }, { key: "schedule", label: "时间安排" },
    { key: "guide", label: "操作指引", area: true }, { key: "support", label: "支持渠道" },
  ],
};
function fmtMeta(field: MetaField, raw: unknown): string {
  if (raw == null || raw === "") return "";
  if (field.date) {
    const d = new Date(raw as string);
    if (isNaN(d.getTime())) return "待定";
    return d.toLocaleDateString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
  }
  if ((field.key === "budget" || field.key === "amount") && raw) {
    const n = Number(raw);
    if (!isNaN(n) && n >= 10000) return (n / 10000).toFixed(0) + " 万元";
  }
  return String(raw);
}
function metaLabelColor(f: MetaField): string {
  if (f.key === "projectCode" || f.key === "docNo") return "var(--brand)";
  if (f.key === "budget" || f.key === "amount") return "var(--success)";
  if (f.date) return "var(--warning)";
  return "var(--muted-foreground)";
}
function scopeHint(scope: string): string {
  if (scope === "DESIGNATED") return "仅指定供应商可下载";
  if (scope === "INVITED") return "仅受邀供应商可下载";
  return "全库供应商可下载";
}

export default function AnnouncementDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [announcement, setAnnouncement] = useState<any>(null);

  const [bidDoc, setBidDoc] = useState<any>(null);
  const [bidDocLoading, setBidDocLoading] = useState(false);
  const [paying, setPaying] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [payDialog, setPayDialog] = useState(false);
  const [paymentRef, setPaymentRef] = useState("");

  const isBidNotice = announcement?.type === "BID_NOTICE";

  const loadBidDoc = useCallback(async () => {
    if (!id || announcement?.type !== "BID_NOTICE") return;
    setBidDocLoading(true);
    try {
      setBidDoc(await announcementApi.getBidDocument(id));
    } catch {
      setBidDoc(null);
    }
    setBidDocLoading(false);
  }, [id, announcement?.type]);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(false);
    try {
      const a = await announcementApi.getPublic(id);
      setAnnouncement(a);
      if (a?.type === "BID_NOTICE") {
        setBidDocLoading(true);
        try {
          setBidDoc(await announcementApi.getBidDocument(id));
        } catch {
          setBidDoc(null);
        }
        setBidDocLoading(false);
      }
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  async function doPay() {
    if (!id) return;
    setPaying(true);
    try {
      await announcementApi.payBidDocument(id, paymentRef || undefined);
      toast.success("付款凭证已提交");
      setPayDialog(false);
      setPaymentRef("");
      await loadBidDoc();
    } catch (e: any) {
      toast.error(e?.message || "提交失败");
    }
    setPaying(false);
  }

  async function doDownload() {
    if (!id) return;
    setDownloading(true);
    try {
      const { blob, fileName } = await announcementApi.downloadBidDocument(id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      a.click();
      URL.revokeObjectURL(url);
      await loadBidDoc();
    } catch (e: any) {
      toast.error(e?.message || "下载失败");
    }
    setDownloading(false);
  }

  const metaFields = useMemo(() => {
    const meta = (announcement?.metadata || {}) as Record<string, unknown>;
    const fields = (ANNO_TYPE_META[announcement?.type] || []).filter((f) => meta[f.key]);
    return { short: fields.filter((f) => !f.area), area: fields.filter((f) => f.area), meta };
  }, [announcement]);

  return (
    <>
      <SpPageHero icon={ScrollText} title="公告详情" sub="阅读公告全文，采购公告可在此查阅并下载招标文件。" />

      <button type="button" className="flow-back ann-back" onClick={() => router.push("/announcements")}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="flow-back-arrow"><path d="M15 18l-6-6 6-6" /></svg>
        返回公告列表
      </button>

      {error ? (
        <div className="sp-error-block">
          <div className="sp-error-icon"><TriangleAlert size={22} strokeWidth={1.75} /></div>
          <div className="sp-error-text">数据加载失败</div>
          <div className="sp-error-desc">网络或服务异常，请稍后重试</div>
          <SpButton variant="primary" onClick={load}>重新加载</SpButton>
        </div>
      ) : loading && !announcement ? (
        <LoadingBlock />
      ) : announcement ? (
        <div className="ann-detail-card">
          <div className="detail-header">
            <span className={`ann-tag ann-tag--lg ann-tag--${typeTagType[announcement.type] || "info"}`}>
              {typeLabel[announcement.type] || announcement.type}
            </span>
            <div className="detail-meta">
              {announcement.isTop ? <span className="top-badge">置顶</span> : null}
              <span>发布时间：{dayjs(announcement.publishDate || announcement.createdAt).format("YYYY年MM月DD日 HH:mm")}</span>
              <span>阅读：{announcement.viewCount}次</span>
            </div>
          </div>
          <h1 className="detail-title">{announcement.title}</h1>
          <hr className="ann-divider" />

          {/* 结构化元数据（项目编号/招标方式/预算金额/时间等）—— 与采购管理工作台一致 */}
          {(metaFields.short.length > 0 || metaFields.area.length > 0) && (
            <div className="meta-block">
              {metaFields.short.length > 0 && (
                <div className="meta-chips">
                  {metaFields.short.map((f) => (
                    <span key={f.key} className="meta-chip">
                      <span className="meta-chip-label" style={{ color: metaLabelColor(f) }}>{f.label}</span>
                      <span className="meta-chip-value">{fmtMeta(f, metaFields.meta[f.key])}</span>
                    </span>
                  ))}
                </div>
              )}
              {metaFields.area.map((f) => (
                <div key={f.key} className="meta-area">
                  <span className="meta-area-label">{f.label}</span>
                  <p className="meta-area-text">{String(metaFields.meta[f.key])}</p>
                </div>
              ))}
            </div>
          )}

          <div className="detail-content" dangerouslySetInnerHTML={{ __html: announcement.content || "" }} />

          {announcement.relatedProjectCode ? (
            <>
              <hr className="ann-divider" />
              <div className="detail-related">
                <LinkIcon size={16} className="detail-related-icon" strokeWidth={1.75} />
                <span>关联项目：{announcement.relatedProjectCode}</span>
                <button type="button" className="detail-link-btn" onClick={() => router.push("/bids")}>查看项目</button>
              </div>
            </>
          ) : null}

          {isBidNotice && (
            <>
              <hr className="ann-divider" />
              <div className="bid-doc-section">
                {bidDocLoading ? (
                  <LoadingBlock />
                ) : bidDoc ? (
                  <>
                    <div className="bid-doc-head">
                      <Lock size={16} className="bid-doc-lock" strokeWidth={1.75} />
                      <strong>招标文件</strong>
                      <span className="bid-doc-title">{bidDoc.title}</span>
                      {bidDoc.requirePayment ? (
                        <span className="ann-tag ann-tag--sm ann-tag--warning">付费 ¥{bidDoc.price}</span>
                      ) : (
                        <span className="ann-tag ann-tag--sm ann-tag--success">免费</span>
                      )}
                    </div>
                    <p className="bid-doc-hint">{scopeHint(bidDoc.accessScope)}</p>
                    <div className="bid-doc-actions">
                      {!bidDoc.eligible ? (
                        <div className="ann-alert ann-alert--error">
                          <span className="ann-alert__icon"><CircleX size={16} strokeWidth={2} /></span>
                          无法下载：{bidDoc.reason}
                        </div>
                      ) : (
                        <>
                          {bidDoc.needPayment ? (
                            <>
                              <div className="ann-alert ann-alert--warning">
                                <span className="ann-alert__icon"><TriangleAlert size={16} strokeWidth={2} /></span>
                                该招标文件需付费下载
                              </div>
                              <SpButton variant="primary" onClick={() => setPayDialog(true)}>提交付款凭证</SpButton>
                            </>
                          ) : bidDoc.requirePayment && !bidDoc.paid ? (
                            <div className="ann-alert ann-alert--info">
                              <span className="ann-alert__icon"><Info size={16} strokeWidth={2} /></span>
                              付款凭证已提交，等待确认到账
                            </div>
                          ) : null}
                          {bidDoc.canDownload && (
                            <SpButton variant="primary" icon={Download} loading={downloading} onClick={doDownload}>
                              下载招标文件
                            </SpButton>
                          )}
                        </>
                      )}
                    </div>
                  </>
                ) : (
                  <EmptyState icon={FileText} title="暂无招标文件" />
                )}
              </div>
            </>
          )}
        </div>
      ) : null}

      <SpDialog
        open={payDialog}
        onClose={() => setPayDialog(false)}
        title="提交付款凭证"
        width={420}
        footer={
          <>
            <SpButton onClick={() => setPayDialog(false)}>取消</SpButton>
            <SpButton variant="primary" loading={paying} onClick={doPay}>提交</SpButton>
          </>
        }
      >
        <div className="ann-form-item">
          <label className="ann-form-item__label" htmlFor="ann-payment-ref">付款凭证/流水号</label>
          <SpInput id="ann-payment-ref" value={paymentRef} placeholder="如：银行流水号" onChange={(e) => setPaymentRef(e.target.value)} />
        </div>
      </SpDialog>
    </>
  );
}
