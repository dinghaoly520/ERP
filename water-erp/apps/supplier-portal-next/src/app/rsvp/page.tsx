"use client";

/**
 * 采购邀请回执页（公开、无登录）：供应商从短信/邮件/站内信点开 ?t=<签名token>，
 * 页面校验后展示「本回执致：XX 公司」+ 关键信息，供其确认/拒绝参加；结果记入系统。
 */
import { Suspense, useCallback, useEffect, useState } from "react";
import Image from "next/image";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { verifyRsvp, respondRsvp, type RsvpView } from "@/lib/api/rsvp";
import { ApiError } from "@/lib/api";

const SUMMARY_LABEL: Record<string, string> = {
  项目名称: "采购项目", 项目编号: "项目编号", 采购方式: "采购方式", 采购类别: "采购类别",
  预算金额: "预算金额", 邀请方: "邀请方", 项目概况及采购内容: "项目概况及采购内容",
};

function RsvpInner() {
  const params = useSearchParams();
  const token = String(params.get("t") || "");

  const [phase, setPhase] = useState<"loading" | "invalid" | "ready">("loading");
  const [view, setView] = useState<RsvpView | null>(null);
  const [errMsg, setErrMsg] = useState("");

  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  // 提交后的本地回执结果（覆盖 view.status 以即时反馈）
  const [done, setDone] = useState<{ status: "ACCEPTED" | "DECLINED"; rsvpNo: string; respondedAt: string } | null>(null);

  const load = useCallback(async () => {
    setPhase("loading");
    if (!token) {
      setPhase("invalid");
      setErrMsg("缺少回执凭证，请从通知中的链接重新打开。");
      return;
    }
    try {
      const v = await verifyRsvp(token);
      setView(v);
      // 已回执：直接从 verify 数据初始化 done 状态（含回执号）
      if (v.status !== "PENDING" && v.respondedAt && v.rsvpNo) {
        setDone({ status: v.status, rsvpNo: v.rsvpNo, respondedAt: v.respondedAt });
      }
      setPhase("ready");
    } catch (e) {
      setPhase("invalid");
      const err = e instanceof ApiError ? e : null;
      const code = (err?.data as any)?.code;
      setErrMsg(
        code === "RSVP_EXPIRED"
          ? "该回执链接已超过24小时有效期，已自动视为放弃。如有疑问请致电四川水发集团采购中心。"
          : err?.message || "回执链接无效或已失效，请从最新通知中的链接打开。",
      );
    }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  async function submit(status: "ACCEPTED" | "DECLINED") {
    if (!view || submitting) return;
    setSubmitting(true);
    try {
      const r = await respondRsvp(token, status, note.trim() || undefined);
      setDone({ status: r.status, rsvpNo: r.rsvpNo, respondedAt: r.respondedAt });
      setView((v) => (v ? { ...v, status: r.status } : v));
      toast.success(status === "ACCEPTED" ? "已确认参加，感谢您的回执" : "已记录您的回执");
    } catch (e) {
      const err = e instanceof ApiError ? e : null;
      const code = (err?.data as any)?.code;
      toast.error(
        code === "RSVP_EXPIRED"
          ? "回执链接已超过24小时有效期，已自动视为放弃"
          : err?.message || "提交失败，请稍后重试",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="rv">
      <div className="rv-bg" aria-hidden="true" />
      <div className="rv-brand" aria-label="智慧水发 · 蜀水云采">
        <Image src="/logo.png" alt="" width={50} height={50} className="rv-brand-mark" priority />
        <span className="rv-brand-name">智慧水发 · 蜀水云采</span>
      </div>

      <section className="rv-panel">
        <div className="rv-card">
          <div className="rv-head">
            <div className="rv-brand-word">智慧水发<span className="rv-dot">·</span>蜀水云采</div>
            <div className="rv-divider" aria-hidden="true">◆</div>
            <h1 className="rv-title">采购邀请回执</h1>
          </div>

          {phase === "loading" && (
            <div className="rv-state">
              <div className="rv-spin" />
              <p>正在核验回执链接…</p>
            </div>
          )}

          {phase === "invalid" && (
            <div className="rv-state rv-state--err">
              <div className="rv-state-ico">!</div>
              <p className="rv-state-msg">{errMsg}</p>
              <p className="rv-hint">如有疑问，请联系邀请方（四川水发集团采购中心）。</p>
            </div>
          )}

          {phase === "ready" && view && (
            <>
              {/* 致：供应商名称（高亮，便于核对是否为本企业） */}
              <div className="rv-to">
                <span className="rv-to-label">本回执致</span>
                <strong className="rv-to-name">{view.supplierName || "—"}</strong>
              </div>

              <h2 className="rv-subject">{view.title}</h2>

              <dl className="rv-info">
                {Object.entries(view.summary || {}).map(([key, val]) =>
                  val && key !== "响应截止" ? (
                    <div key={key} className="rv-info-row">
                      <dt>{SUMMARY_LABEL[key] || key}</dt>
                      <dd>{val}</dd>
                    </div>
                  ) : null,
                )}
              </dl>

              {view.expired && (
                <p className="rv-warn">该回执链接已超过24小时有效期，已自动视为放弃。如有疑问请致电四川水发集团采购中心。</p>
              )}

              {/* 已回执 / 提交后：展示结果 */}
              {done || view.status !== "PENDING" ? (
                <div className={`rv-done ${done?.status === "DECLINED" || view.status === "DECLINED" ? "is-declined" : "is-accepted"}`}>
                  <div className="rv-done-badge">
                    {(done?.status || view.status) === "ACCEPTED" ? "✓ 已确认参加" : "✕ 已确认无法参加"}
                  </div>
                  <p className="rv-done-meta">
                    回执号 <strong>#{done?.rsvpNo || "—"}</strong>
                    · 回执时间{" "}
                    {done?.respondedAt
                      ? new Date(done.respondedAt).toLocaleString("zh-CN")
                      : view.respondedAt
                        ? new Date(view.respondedAt).toLocaleString("zh-CN")
                        : "—"}
                  </p>
                  {!view.expired && <p className="rv-hint">如需变更，可于响应截止前再次点击通知中的链接修改。</p>}
                </div>
              ) : (
                <div className="rv-actions">
                  <p className="rv-prompt">请确认贵司是否参加本次采购邀请：</p>
                  <div className="rv-btns">
                    <button type="button" className="rv-btn rv-btn--accept" disabled={submitting} onClick={() => submit("ACCEPTED")}>确认参加</button>
                    <button type="button" className="rv-btn rv-btn--decline" disabled={submitting} onClick={() => submit("DECLINED")}>无法参加</button>
                  </div>
                  <label className="rv-note-label">备注（选填，如档期冲突、资质说明等）</label>
                  <textarea className="rv-note" rows={3} maxLength={500} placeholder="可补充说明，便于采购方了解情况…" value={note} onChange={(e) => setNote(e.target.value)} />
                  <p className="rv-privacy">本链接仅贵司有效，24小时内有效；您的选择将被记录，逾期未点击视为自动放弃。</p>
                </div>
              )}
            </>
          )}
        </div>
      </section>
    </main>
  );
}

export default function RsvpPage() {
  return (
    <Suspense>
      <RsvpInner />
    </Suspense>
  );
}
