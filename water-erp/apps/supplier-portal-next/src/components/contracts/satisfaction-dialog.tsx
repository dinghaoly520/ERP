"use client";

import { useEffect, useState } from "react";
import { MessageSquareHeart, Star, TriangleAlert } from "lucide-react";
import { submitSatisfaction } from "@/lib/performance-client";
import { validateSatisfaction } from "@/lib/contract-forms";
import { SpButton, SpDialog, SpTextarea } from "@/components/ui";

interface SatisfactionDialogProps {
  open: boolean;
  projectCode: string | null;
  contractCode?: string;
  onClose: () => void;
  onComplete?: () => void;
}

export function SatisfactionDialog({ open, projectCode, contractCode, onClose, onComplete }: SatisfactionDialogProps) {
  const [score, setScore] = useState(0);
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setScore(0);
      setComment("");
      setSubmitting(false);
      setError(null);
    }
  }, [open, projectCode]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const validationError = validateSatisfaction(score);
    if (validationError || !projectCode) {
      setError(validationError || "缺少项目编号");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await submitSatisfaction({ projectCode, score, comment: comment.trim() || undefined });
      onComplete?.();
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "评价提交失败，请重试");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <SpDialog
      open={open}
      onClose={onClose}
      title="采购服务满意度评价"
      subtitle={`${contractCode || "合同"} · 项目 ${projectCode || "—"}`}
      icon={MessageSquareHeart}
      closeOnOverlay={!submitting}
      footer={(
        <>
          <SpButton onClick={onClose} disabled={submitting}>取消</SpButton>
          <SpButton variant="primary" type="submit" form="satisfaction-form" loading={submitting}>提交评价</SpButton>
        </>
      )}
    >
      <form id="satisfaction-form" className="space-y-5" onSubmit={submit}>
        <fieldset>
          <legend className="text-sm font-semibold">整体满意度（必选）</legend>
          <div className="mt-3 grid grid-cols-5 gap-2">
            {[1, 2, 3, 4, 5].map((value) => (
              <label key={value} className="cursor-pointer rounded-xl border border-slate-200 p-2 text-center has-[:checked]:border-blue-600 has-[:checked]:bg-blue-50">
                <input
                  className="sr-only"
                  type="radio"
                  name="satisfaction-score"
                  value={value}
                  checked={score === value}
                  onChange={() => { setScore(value); setError(null); }}
                />
                <Star className="mx-auto" size={18} fill={score >= value ? "currentColor" : "none"} aria-hidden="true" />
                <span className="mt-1 block text-xs">{value} 分</span>
              </label>
            ))}
          </div>
        </fieldset>
        <label className="block text-sm font-semibold">
          意见建议（选填）
          <SpTextarea
            className="mt-2 w-full"
            value={comment}
            maxLength={500}
            onChange={(event) => setComment(event.target.value)}
            placeholder="可填写对流程、服务或系统体验的建议"
          />
          <span className="mt-1 block text-right text-xs font-normal text-slate-500">{comment.length}/500</span>
        </label>
        {error && (
          <p className="flex items-start gap-2 text-sm text-red-700" role="alert">
            <TriangleAlert className="mt-0.5 shrink-0" size={16} aria-hidden="true" />{error}
          </p>
        )}
      </form>
    </SpDialog>
  );
}
