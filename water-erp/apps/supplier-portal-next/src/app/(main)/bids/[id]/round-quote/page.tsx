"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import dayjs from "dayjs";
import { toast } from "sonner";
import { AlertTriangle, ArrowLeft, CircleCheck, Coins, Inbox, Lock } from "lucide-react";
import { SpPageHero } from "@/components/sp-page-hero";
import { EmptyState, LoadingBlock, SpButton } from "@/components/ui";
import { bidApi } from "@/lib/api/bid";
import { ApiError } from "@/lib/api";
import { useBidWebSocket } from "@/hooks/use-bid-websocket";
import { useLeaveGuard } from "@/hooks/use-leave-guard";
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
  const quotePriceValid = quotePrice != null && Number.isFinite(quotePrice);

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
    setDeadlinePassed(new Date() > new Date(r.deadline));
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

  async function fetchData() {
    setLoading(true);
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
    } catch {
      toast.error("加载失败");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchData();
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
    if (!currentOpenRound || !myBidSupplierId || !quotePriceValid) return;
    const price = Math.round(quotePrice! * 100) / 100; // precision=2

    // 提交前确认弹窗——提醒供应商仔细核对价格（ElMessageBox.confirm → 原生 confirm）
    const confirmed = window.confirm(
      `请确认您的报价金额：\n\n¥${formatPrice(price)}\n\n提交后不可修改，请确保价格准确无误。`,
    );
    if (!confirmed) return; // 用户取消

    setSubmitting(true);
    try {
      await bidApi.submitQuote(projectId, currentOpenRound.id, {
        bidSupplierId: myBidSupplierId,
        quotePrice: price,
      });
      toast.success("报价已提交(密封)，不可修改");
      setQuotePriceText("");
      // 刷新我的报价状态
      await reloadMyQuotes();
    } catch (e: any) {
      // L4: P2002 唯一约束冲突（双 tab 并发）或后端 ALREADY_QUOTED → 友好提示
      const errMsg =
        e instanceof ApiError ? ((e.data as any)?.error ?? e.code) : undefined;
      if (errMsg === "ALREADY_QUOTED" || (e instanceof ApiError && e.status === 400)) {
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
      {/* 注：Vue 版传的是未声明的 subtitle prop（实际不渲染）；此处按组件契约传 sub 以呈现设计意图 */}
      <SpPageHero icon={Coins} title="多轮报价" sub="密封报价 · 谈判/竞价采购" />

      <div className="mx-auto max-w-3xl p-6">
        <div className="mb-4">
          <SpButton variant="link" icon={ArrowLeft} onClick={() => router.back()}>
            返回
          </SpButton>
        </div>

        {!loading && rounds.length === 0 ? (
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
                    <div className="mb-4 text-sm text-gray-500">截止时间: {formatTime(currentOpenRound.deadline)}</div>
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
                      <div className="rq-alert rq-alert--warning mb-4">
                        <AlertTriangle size={16} className="shrink-0" />
                        <span className="text-sm">报价提交后不可修改，请仔细核对金额后再提交。</span>
                      </div>

                      <div className="mb-4 flex items-center gap-4">
                        <label className="text-sm" style={{ width: 100, textAlign: "right" }}>
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
                    <span className="rounded bg-blue-100 px-2 py-0.5 text-xs font-bold text-blue-700">第 {r.roundNo} 轮</span>
                    <span
                      className="rq-tag rq-tag--sm"
                      style={statusColors[r.status] ? { color: statusColors[r.status], borderColor: statusColors[r.status] } : undefined}
                    >
                      {statusLabels[r.status]}
                    </span>
                    {r.deadline && <span className="text-xs text-gray-400">截止 {formatTime(r.deadline)}</span>}
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
                    <div className="overflow-hidden rounded-lg border border-gray-100">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="bg-gray-50 text-xs text-gray-500">
                            <th className="px-3 py-2 text-left font-semibold">排名</th>
                            <th className="px-3 py-2 text-left font-semibold">供应商</th>
                            <th className="px-3 py-2 text-right font-semibold">报价(元)</th>
                          </tr>
                        </thead>
                        <tbody>
                          {publishedQuotes[r.id].map((q, idx) => (
                            <tr
                              key={q.id}
                              className={`border-t border-gray-100${q.bidSupplierId === myBidSupplierId ? " bg-blue-50" : ""}`}
                            >
                              <td className="px-3 py-2 font-mono font-bold text-blue-600">{idx + 1}</td>
                              <td className={`px-3 py-2 font-medium${q.bidSupplierId === myBidSupplierId ? " text-blue-700" : ""}`}>
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
    </div>
  );
}
