"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import dayjs from "dayjs";
import { toast } from "sonner";
import {
  AlertTriangle,
  ArrowLeft,
  CircleCheck,
  Coins,
  Inbox,
  Lock,
} from "lucide-react";;
import { SpPageHero } from "@/components/sp-page-hero";
import { EmptyState, LoadingBlock, SpButton } from "@/components/ui";
import { useConfirm } from "@/components/use-confirm";
import { bidApi } from "@/lib/api/bid";
import { ApiError } from "@/lib/api";
import { useBidWebSocket } from "@/hooks/use-bid-websocket";
import { useLeaveGuard } from "@/hooks/use-leave-guard";
import { serverNowMs, syncServerClock } from "@water-erp/shared";
import "@/styles/pages/opening.css";

interface Round {
  id: string;
  roundNo: number;
  roundType: string;
  status: string;
  deadline: string | null;
}
interface Quote {
  id: string;
  bidSupplierId: string;
  quotePrice: string;
  status: string;
}
interface MyQuote {
  id: string;
  roundId: string;
  quotePrice: string;
  submittedAt: string;
  status: string;
}

const statusLabels: Record<string, string> = {
  pending: "待开放",
  open: "报价中",
  sealed: "已截止",
  published: "已公布",
  closed: "已结束",
};
const statusColors: Record<string, string> = {
  pending: "#909399",
  open: "#409eff",
  sealed: "#e6a23c",
  published: "#67c23a",
  closed: "#909399",
};

function formatTime(iso: string | null): string {
  return iso ? dayjs(iso).format("MM-DD HH:mm") : "—";
}

function formatPrice(p: string | number): string {
  return Number(p).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function RoundQuotePage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const projectId = params.id;
  const { confirm, dialog } = useConfirm();

  const [loading, setLoading] = useState(true);
  const [rounds, setRounds] = useState<Round[]>([]);
  const [publishedQuotes, setPublishedQuotes] = useState<Record<string, Quote[]>>({});
  const [myQuotes, setMyQuotes] = useState<Record<string, MyQuote>>({}); // roundId → 我的报价
  const [myBidSupplierId, setMyBidSupplierId] = useState<string>("");
  const [quotePriceText, setQuotePriceText] = useState<string>(""); // el-input-number 的输入态
  const [submitting, setSubmitting] = useState(false);
  // M4: 客户端截止倒计时
  const [deadlinePassed, setDeadlinePassed] = useState(false);

  // el-input-number(min=0.01, precision=2) → 原生 number 输入 + parseFloat（空串视为未填）
  const quotePrice = quotePriceText.trim() === "" ? undefined : parseFloat(quotePriceText);
  // SUP-P2-04：>0 前置（min=0.01 是 HTML 属性不设防；服务端 DTO 同口径）
  const quotePriceValid = quotePrice != null && Number.isFinite(quotePrice) && quotePrice > 0;

  const currentOpenRound = rounds.find((r) => r.status === "open");
  const currentOpenMyQuote = currentOpenRound ? myQuotes[currentOpenRound.id] : undefined;

  // checkDeadline 由 10s 定时器触发，需读最新轮次——ref 镜像避免闭包过期
  const openRoundRef = useRef<Round | undefined>(currentOpenRound);
  openRoundRef.current = currentOpenRound;

  function checkDeadline() {
    const r = openRoundRef.current;
    if (!r?.deadline) {
      setDeadlinePassed(false);
      return;
    }
    setDeadlinePassed(serverNowMs() > new Date(r.deadline).getTime());
  }

  // 轮次状态实时：开轮/封轮/发布结果（round:status:change）→ 重载轮次与报价
  // （handlers 为每渲染取最新闭包的 getter，fetchData 直接引用即可）
  useBidWebSocket(projectId, () => ({
    onRoundStatusChange: () => {
      fetchData().catch(() => {});
    },
  }));

  async function reloadMyQuotes() {
    try {
      const list = (await bidApi.getMyQuotes(projectId)) as MyQuote[];
      const map: Record<string, MyQuote> = {};
      for (const q of list ?? []) map[q.roundId] = q;
      setMyQuotes(map);
      return map;
    } catch {
      /* ignore */
    }
  }

  // B4-1（2026-09-30）：非项目成员显式无权态——此前 403 NOT_PROJECT_MEMBER 被当成
  // 「无轮次」空态渲染 + toast「加载失败」，把「无权查看」伪装成「没有轮次」
  const [noAccess, setNoAccess] = useState(false);

  async function fetchData() {
    setLoading(true);
    setNoAccess(false);
    try {
      const res = await bidApi.listRounds(projectId);
      const list = (res ?? []) as Round[];
      setRounds(list);

      // 获取当前供应商在此项目中的 BidSupplier ID
      try {
        const bs = await bidApi.getMyBidSupplier(projectId);
        setMyBidSupplierId(bs?.id ?? "");
      } catch {
        /* 非项目成员则保持为空 */
      }

      // 获取我的全部报价历史
      await reloadMyQuotes();

      // Load published round quotes
      for (const r of list) {
        if (r.status === "published" || r.status === "closed") {
          try {
            const q = (await bidApi.getRoundQuotes(projectId, r.id)) as Quote[];
            setPublishedQuotes((prev) => ({ ...prev, [r.id]: q }));
          } catch {
            /* ignore */
          }
        }
      }
    } catch (e: unknown) {
      if (e instanceof ApiError && (e.data as any)?.code === "NOT_PROJECT_MEMBER") setNoAccess(true);
      // 其余失败全局层已统一 toast；无权不弹错（成员资格本就可能无）
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchData();
    void syncServerClock().then(checkDeadline);
    // M4: 每 10 秒检查截止时间
    const t = setInterval(checkDeadline, 10000);
    checkDeadline();
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // L8: 输入价格后导航离开提示（Vue onBeforeRouteLeave → useLeaveGuard）
  useLeaveGuard(
    () => quotePriceValid && !submitting && !currentOpenMyQuote,
    "您已输入报价但尚未提交，确定离开吗？",
  );

  async function handleSubmit() {
    if (!currentOpenRound || !quotePriceValid) return;
    if (!myBidSupplierId) { toast.warning("未取得本项目投标资格，无法提交报价"); return; } // B4-1：静默 return → 明确反馈
    const price = Math.round(quotePrice! * 100) / 100; // precision=2

    // 提交前确认弹窗——提醒供应商仔细核对价格（已迁移 useConfirm）
    const confirmed = await confirm({
      message: `请确认您的报价金额：\n\n¥${formatPrice(price)}\n\n提交后不可修改，请确保价格准确无误。`,
    });
    if (!confirmed) return; // 用户取消

    setSubmitting(true);
    try {
      await bidApi.submitQuote(projectId, currentOpenRound.id, {
        bidSupplierId: myBidSupplierId,
        quotePrice: price,
      }, { silent: true }); // B4-1：错误由本 catch 单一出口提示，避免与全局拦截器双弹
      toast.success("报价已提交(密封)，不可修改");
      setQuotePriceText("");
      // 刷新我的报价状态
      await reloadMyQuotes();
    } catch (e: any) {
      // L4: P2002 唯一约束冲突（双 tab 并发）或后端 ALREADY_QUOTED → 友好提示
      const errMsg =
        e instanceof ApiError ? ((e.data as any)?.error ?? e.code) : undefined;
      // SUP-P2-05：仅 ALREADY_QUOTED 显示「已提交」话术——此前一切 400（截止/不在名单/
      // 已废标）都被误报成「本轮已提交报价」且与全局 toast 双弹
      if (e instanceof ApiError && e.code === "ALREADY_QUOTED") {
        toast.warning("本轮已提交报价，不可重复提交");
      } else {
        toast.error(errMsg || "提交失败");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      {/* 注：Vue 版传的是未声明的 subtitle prop（实际不渲染）；装饰组合已删，页面名仅存 sr-only */}
      <SpPageHero icon={Coins} title="多轮报价" sub="查看与响应采购发起的多轮报价" />

      <div className="mx-auto max-w-3xl p-6">
        <div className="mb-4">
          <SpButton variant="link" icon={ArrowLeft} onClick={() => router.back()}>
            返回
          </SpButton>
        </div>

        {!loading && noAccess ? (
          // B4-1：无权≠没有轮次——此前 403 被渲染成下方空态误导非成员以为无轮次
          <EmptyState icon={Inbox} title="您不是本项目的报价成员" desc="多轮报价仅对本项目受邀/已投递供应商开放，如有疑问请联系采购中心。" />
        ) : !loading && rounds.length === 0 ? (
          <EmptyState icon={Inbox} title="暂无报价轮次" />
        ) : (
          <div className="space-y-4">
            {loading && rounds.length === 0 && <LoadingBlock />}

            {/* 当前开放轮次 */}
            {currentOpenRound && (
              <section className="rq-card rq-card--open">
                <header className="rq-card__header">
                  <div className="flex items-center justify-between">
                    <span className="font-bold">第 {currentOpenRound.roundNo} 轮报价</span>
                    <span className="rq-tag">{statusLabels[currentOpenRound.status]}</span>
                  </div>
                </header>

                <div className="rq-card__body">
                  {currentOpenRound.deadline && (
                    <div className="mb-4 text-sm text-muted-foreground">截止时间: {formatTime(currentOpenRound.deadline)}</div>
                  )}

                  {/* 已提交：锁定状态 */}
                  {currentOpenMyQuote ? (
                    <div className="rq-alert rq-alert--success mb-2">
                      <CircleCheck size={16} className="shrink-0" />
                      <div className="flex w-full items-center justify-between">
                        <span className="text-sm">
                          已提交报价：<strong className="font-mono text-base">¥{formatPrice(currentOpenMyQuote.quotePrice)}</strong>
                          {" · "}
                          {formatTime(currentOpenMyQuote.submittedAt)}
                        </span>
                        <span className="rq-tag rq-tag--sm rq-tag--info-plain">已锁定 · 不可修改</span>
                      </div>
                    </div>
                  ) : (
                    <>
                      {/* 未提交：报价输入 */}
                      {deadlinePassed && (
                        // B4-1（2026-09-30）：截止只灰按钮不给原因——卡片仍显「报价中」+可输入框+灰按钮，
                        // 用户无从得知为何提交不了（主持人未封轮时 round 仍 open，前端倒计时已过）
                        <div className="rq-alert rq-alert--warning mb-4">
                          <AlertTriangle size={16} className="shrink-0" />
                          <span className="text-sm">本轮报价已截止（{formatTime(currentOpenRound?.deadline ?? null)}），无法再提交，等待主持人封轮/公布。</span>
                        </div>
                      )}
                      <div className={`rq-alert rq-alert--warning mb-4${deadlinePassed ? " hidden" : ""}`}>
                        <AlertTriangle size={16} className="shrink-0" />
                        <span className="text-sm">报价提交后不可修改，请仔细核对金额后再提交。</span>
                      </div>

                      <div className="mb-4 flex items-center gap-4">
                        <label className="w-[100px] text-right text-sm">
                          报价(元)
                        </label>
                        <input
                          type="number"
                          className="rq-input-number"
                          min={0.01}
                          step={0.01}
                          placeholder="请输入报价金额"
                          value={quotePriceText}
                          onChange={(e) => setQuotePriceText(e.target.value)}
                        />
                      </div>

                      <div className="flex justify-end">
                        <SpButton
                          variant="primary"
                          icon={Lock}
                          loading={submitting}
                          disabled={!quotePriceValid || deadlinePassed}
                          onClick={handleSubmit}
                        >
                          提交密封报价
                        </SpButton>
                      </div>
                    </>
                  )}
                </div>
              </section>
            )}

            {/* 各轮次状态 */}
            {rounds.map((r) => (
              <section key={r.id} className="rq-card rq-card--plain">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="rounded bg-[var(--accent-soft)] px-2 py-0.5 text-xs font-bold text-[var(--brand)]">第 {r.roundNo} 轮</span>
                    <span
                      className="rq-tag rq-tag--sm"
                      style={statusColors[r.status] ? { color: statusColors[r.status], borderColor: statusColors[r.status] } : undefined}
                    >
                      {statusLabels[r.status]}
                    </span>
                    {r.deadline && <span className="text-xs text-muted-foreground">截止 {formatTime(r.deadline)}</span>}
                  </div>
                  {/* sealed 轮次：已提交标记 */}
                  {r.status === "sealed" && myQuotes[r.id] && (
                    <span className="flex items-center gap-1 text-xs text-amber-600">
                      <Lock size={14} /> 已提交（密封中）
                    </span>
                  )}
                </div>

                {/* 已公布轮次: 报价排名 */}
                {(r.status === "published" || r.status === "closed") && publishedQuotes[r.id]?.length ? (
                  <div className="mt-3">
                    <div className="overflow-hidden rounded-lg border border-[var(--hairline)]">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="bg-[var(--surface)] text-xs text-muted-foreground">
                            <th className="px-3 py-2 text-left font-semibold">排名</th>
                            <th className="px-3 py-2 text-left font-semibold">供应商</th>
                            <th className="px-3 py-2 text-right font-semibold">报价(元)</th>
                          </tr>
                        </thead>
                        <tbody>
                          {publishedQuotes[r.id].map((q, idx) => (
                            <tr
                              key={q.id}
                              className={`border-t border-[var(--hairline)]${q.bidSupplierId === myBidSupplierId ? " bg-[var(--accent-soft)]" : ""}`}
                            >
                              <td className="px-3 py-2 font-mono font-bold text-[var(--brand)]">{idx + 1}</td>
                              <td className={`px-3 py-2 font-medium${q.bidSupplierId === myBidSupplierId ? " text-[var(--brand)]" : ""}`}>
                                {q.bidSupplierId === myBidSupplierId ? "本企业" : "其他供应商"}
                              </td>
                              <td className="px-3 py-2 text-right font-mono font-semibold">{formatPrice(q.quotePrice)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ) : null}
              </section>
            ))}
          </div>
        )}
      </div>
      {dialog}
    </div>
  );
}
