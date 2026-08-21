"use client";

import { useCallback, useEffect, useState } from "react";
import dayjs from "dayjs";
import { toast } from "sonner";
import { Check, Clock, FileText, Trophy } from "lucide-react";
import { awardLetterApi } from "@/lib/api/award-letter";
import { SpPageHero } from "@/components/sp-page-hero";
import { EmptyState, SpButton } from "@/components/ui";
import "@/styles/pages/announcements.css";

interface AwardLetterDelivery {
  id: string;
  projectId: string;
  supplierName: string;
  content: { winnerName?: string; winnerPrice?: string; projectName?: string } | null;
  letterAssetId: string | null;
  deliveredAt: string | null;
  receivedAt: string | null;
  signedAt: string | null;
  signedBy: string | null;
  createdAt: string;
}

function formatTime(iso: string | null): string {
  return iso ? dayjs(iso).format("YYYY-MM-DD HH:mm") : "—";
}

export default function AwardLetterListPage() {
  const [letters, setLetters] = useState<AwardLetterDelivery[]>([]);
  const [loading, setLoading] = useState(true);
  const [signing, setSigning] = useState<string | null>(null);

  const fetchLetters = useCallback(async () => {
    setLoading(true);
    try {
      const res = await awardLetterApi.list();
      setLetters((res as AwardLetterDelivery[]) || []);
    } catch {
      toast.error("加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchLetters();
  }, [fetchLetters]);

  async function handleSign(id: string) {
    setSigning(id);
    try {
      await awardLetterApi.sign(id);
      toast.success("签收成功");
      await fetchLetters();
    } catch {
      toast.error("签收失败，请重试");
    } finally {
      setSigning(null);
    }
  }

  async function handleView(letter: AwardLetterDelivery) {
    if (!letter.receivedAt) {
      try { await awardLetterApi.markReceived(letter.id); } catch { /* 静默 */ }
    }
  }

  return (
    <>
      <SpPageHero icon={Trophy} title="中标通知书" sub="查收并签收中标通知书" />

      <div className="mx-auto max-w-4xl p-6">
        {!loading && letters.length === 0 ? (
          <EmptyState icon={FileText} title="暂无中标通知书" />
        ) : (
          <div className="space-y-4">
            {letters.map((letter) => (
              <div key={letter.id} className="award-card" onClick={() => handleView(letter)}>
                <div className="award-card__header">
                  <div className="flex items-center gap-2">
                    <Trophy size={18} color="#059669" />
                    <span className="font-bold">{letter.content?.projectName || "中标通知书"}</span>
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
                    {letter.signedAt && (
                      <div>
                        <span className="text-gray-400">签收时间：</span>{formatTime(letter.signedAt)}
                      </div>
                    )}
                  </div>

                  {!letter.signedAt && letter.deliveredAt && (
                    <div className="mt-4 flex justify-end">
                      <SpButton
                        variant="primary"
                        icon={Check}
                        loading={signing === letter.id}
                        onClick={(e) => { e.stopPropagation(); handleSign(letter.id); }}
                      >
                        签收确认
                      </SpButton>
                    </div>
                  )}

                  {letter.signedAt && (
                    <div className="mt-4 flex items-center gap-2 rounded-lg bg-green-50 p-3 text-sm text-green-700">
                      <Check size={14} />
                      <span>已于 {formatTime(letter.signedAt)} 签收确认</span>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
