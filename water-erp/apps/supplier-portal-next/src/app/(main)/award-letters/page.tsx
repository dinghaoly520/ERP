"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import dayjs from "dayjs";
import { toast } from "sonner";
import { Check, Clock, Download, Eye, FileText, Trophy } from "lucide-react";
import {
  awardLetterApi,
  awardLetterFileUrl,
  awardLetterProjectLabel,
  canSignAwardLetter,
  prioritizeAwardLetters,
  type AwardLetterDelivery,
} from "@/lib/api/award-letter";
import { SpPageHero } from "@/components/sp-page-hero";
import { EmptyState, SpButton } from "@/components/ui";
import "@/styles/pages/announcements.css";

function formatTime(iso: string | null): string {
  return iso ? dayjs(iso).format("YYYY-MM-DD HH:mm") : "—";
}

function AwardLetterListContent() {
  const searchParams = useSearchParams();
  const deliveryId = searchParams.get("deliveryId");
  const [letters, setLetters] = useState<AwardLetterDelivery[]>([]);
  const [loading, setLoading] = useState(true);
  const [signing, setSigning] = useState<string | null>(null);

  const fetchLetters = useCallback(async () => {
    setLoading(true);
    try {
      const res = await awardLetterApi.list();
      setLetters(prioritizeAwardLetters(res || [], deliveryId));
    } catch {
      toast.error("加载失败");
    } finally {
      setLoading(false);
    }
  }, [deliveryId]);

  useEffect(() => {
    fetchLetters();
  }, [fetchLetters]);

  async function handleSign(letter: AwardLetterDelivery) {
    if (!letter.letterAssetId || !letter.deliveredAt) return;
    setSigning(letter.id);
    try {
      await awardLetterApi.sign(letter.id, letter.letterAssetId, letter.deliveredAt);
      toast.success("签收成功");
      await fetchLetters();
    } catch {
      toast.error("签收失败，请重试");
    } finally {
      setSigning(null);
    }
  }

  async function handleView(letter: AwardLetterDelivery) {
    if (!letter.receivedAt && letter.letterAssetId && letter.deliveredAt) {
      try {
        const receipt = await awardLetterApi.markReceived(letter.id, letter.letterAssetId, letter.deliveredAt);
        setLetters((current) => current.map((item) => item.id === letter.id
          ? { ...item, receivedAt: receipt.receivedAt, receiptNo: receipt.receiptNo }
          : item));
      } catch {
        toast.warning("文件已打开，但查看回执暂未登记，请稍后重试");
      }
    }
  }

  return (
    <>
      <SpPageHero icon={Trophy} title="中标通知书" sub="查收并签收中标通知书" />

      <div className="mx-auto max-w-4xl p-4 sm:p-6" aria-busy={loading}>
        {!loading && letters.length === 0 ? (
          <EmptyState card icon={FileText} title="暂无中标通知书" />
        ) : (
          <div className="space-y-4">
            {letters.map((letter) => (
              <article
                key={letter.id}
                className={`award-card${letter.id === deliveryId ? " award-card--focused" : ""}`}
                aria-current={letter.id === deliveryId ? "true" : undefined}
              >
                <div className="award-card__header">
                  <div className="flex items-center gap-2">
                    <Trophy size={18} color="#059669" />
                    <span className="font-bold">{awardLetterProjectLabel(letter)}</span>
                  </div>
                  {letter.signedAt ? (
                    <span className="ann-tag ann-tag--light-success"><Check size={12} strokeWidth={2.5} />已签收</span>
                  ) : letter.deliveredAt ? (
                    <span className="ann-tag ann-tag--light-warning"><Clock size={12} strokeWidth={2} />待签收</span>
                  ) : (
                    <span className="ann-tag ann-tag--light-info">待推送</span>
                  )}
                </div>

                <div className="award-card__body">
                  <div className="space-y-2 text-sm text-gray-600">
                    {letter.content?.winnerName && (
                      <div>
                        <span className="text-gray-400">中标单位：</span>{letter.content.winnerName}
                      </div>
                    )}
                    {letter.content?.winnerPrice && (
                      <div>
                        <span className="text-gray-400">中标金额：</span>{letter.content.winnerPrice}
                      </div>
                    )}
                    <div>
                      <span className="text-gray-400">推送时间：</span>{formatTime(letter.deliveredAt)}
                    </div>
                    <div>
                      <span className="text-gray-400">查看状态：</span>{letter.receivedAt ? `已于 ${formatTime(letter.receivedAt)} 查看` : "尚未查看"}
                    </div>
                    {letter.signedAt && (
                      <div>
                        <span className="text-gray-400">签收时间：</span>{formatTime(letter.signedAt)}
                      </div>
                    )}
                  </div>

                  <div className="mt-4 flex flex-wrap justify-end gap-2">
                    {awardLetterFileUrl(letter.letterAssetId) ? (
                      <>
                        <a
                          className="neu-btn-soft inline-flex min-h-11 items-center gap-1.5"
                          href={awardLetterFileUrl(letter.letterAssetId)!}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={() => void handleView(letter)}
                        >
                          <Eye size={14} aria-hidden="true" />查看通知书
                        </a>
                        <a
                          className="neu-btn-soft inline-flex min-h-11 items-center gap-1.5"
                          href={awardLetterFileUrl(letter.letterAssetId)!}
                          download={letter.letterAsset?.originalName || "成交通知书"}
                          onClick={() => void handleView(letter)}
                        >
                          <Download size={14} aria-hidden="true" />下载
                        </a>
                      </>
                    ) : (
                      <span className="text-sm text-amber-700">采购端尚未附加通知书文件，暂不可签收</span>
                    )}
                    {canSignAwardLetter(letter) && (
                      <SpButton
                        variant="primary"
                        icon={Check}
                        loading={signing === letter.id}
                        onClick={() => handleSign(letter)}
                      >
                        签收确认
                      </SpButton>
                    )}
                  </div>

                  {letter.signedAt && (
                    <div className="mt-4 flex items-center gap-2 rounded-lg bg-green-50 p-3 text-sm text-green-700">
                      <Check size={14} />
                      <span>
                        已于 {formatTime(letter.signedAt)} 签收确认 · 回执编号 {letter.receiptNo}
                      </span>
                    </div>
                  )}
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

export default function AwardLetterListPage() {
  return (
    <Suspense fallback={<div className="mx-auto max-w-4xl p-4 sm:p-6" aria-busy="true" />}>
      <AwardLetterListContent />
    </Suspense>
  );
}
