"use client";

import { useState, type FormEvent } from "react";
import dayjs from "dayjs";
import { BadgeCheck, CheckCircle2, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { prequalApi, type PrequalListItem } from "@/lib/api/prequal";
import { SpButton, SpDialog, SpTextarea } from "@/components/ui";

export function normalizeOptionalApplicationNote(note: string): string | undefined {
  return note.trim() || undefined;
}

function applicationRequirement(item: PrequalListItem): string {
  const scope = item.mode === "centralized" ? "集中资格预审，合格有效期内同品类免重复审查" : "单项资格预审，仅适用于本次预审事项";
  const method = item.method === "limited"
    ? `有限数量制，按评审结果择优确定前 ${item.limitedCount ?? "约定"} 名`
    : "合格制，满足公告规定的资格条件即可通过";
  return `${scope}；${method}`;
}

export function PrequalApplicationDialog({
  open,
  item,
  onClose,
  onSubmitted,
}: {
  open: boolean;
  item: PrequalListItem;
  onClose: () => void;
  onSubmitted: () => void | Promise<void>;
}) {
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  const requestClose = () => {
    if (!submitting) onClose();
  };

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!item || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await prequalApi.apply(item.id, normalizeOptionalApplicationNote(note));
      setSubmitted(true);
      toast.success("资格预审申请已提交");
      try {
        await onSubmitted();
      } catch {
        toast.warning("申请已提交，列表刷新失败，请稍后重试");
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "申请提交失败，请稍后重试");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <SpDialog
      open={open}
      onClose={requestClose}
      closeOnOverlay={!submitting}
      title="提交资格预审申请"
      subtitle="确认预审事项与审查要求后提交"
      icon={BadgeCheck}
      footer={(
        <>
          <SpButton onClick={requestClose} disabled={submitting}>{submitted ? "关闭" : "取消"}</SpButton>
          {!submitted && (
            <SpButton
              variant="primary"
              type="submit"
              form="prequal-application-form"
              loading={submitting}
            >
              确认提交
            </SpButton>
          )}
        </>
      )}
    >
      {submitted ? (
        <div className="flex items-start gap-3" role="status" aria-live="polite">
          <CheckCircle2 className="mt-0.5 shrink-0 text-emerald-600" size={20} aria-hidden="true" />
          <div className="min-w-0">
            <p className="font-semibold text-slate-900">申请已提交</p>
            <p className="mt-1 text-sm leading-6 text-slate-600">平台已受理本次申请，审查结果将通过站内消息通知。</p>
          </div>
        </div>
      ) : (
        <form id="prequal-application-form" className="space-y-5" onSubmit={submit} noValidate>
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-3 rounded-xl bg-slate-50 p-4 text-sm">
            <dt className="font-medium text-slate-500">预审项目</dt>
            <dd className="min-w-0 break-words font-semibold text-slate-900">{item.title}</dd>
            <dt className="font-medium text-slate-500">申请期限</dt>
            <dd className="min-w-0 break-words text-slate-700">当前开放申请，截止安排以资格预审公告为准</dd>
            <dt className="font-medium text-slate-500">合格有效期</dt>
            <dd className="min-w-0 break-words text-slate-700">
              {item.validUntil ? dayjs(item.validUntil).format("YYYY年MM月DD日") : "未单独设置，以公告约定为准"}
            </dd>
            <dt className="font-medium text-slate-500">审查要求</dt>
            <dd className="min-w-0 break-words leading-6 text-slate-700">{applicationRequirement(item)}</dd>
          </dl>

          <label className="block text-sm font-medium text-slate-800" htmlFor="prequal-application-note">
            补充说明 <span className="font-normal text-slate-500">（选填）</span>
          </label>
          <SpTextarea
            id="prequal-application-note"
            value={note}
            onChange={(event) => {
              setNote(event.target.value);
              setError(null);
            }}
            maxLength={500}
            rows={5}
            autoFocus
            aria-describedby="prequal-application-note-hint"
            placeholder="可填写主要业绩、资质能力或其他需要说明的内容；无补充内容可直接提交"
          />
          <div id="prequal-application-note-hint" className="-mt-3 flex justify-between gap-3 text-xs text-slate-500">
            <span>留空不会阻止提交</span>
            <span aria-label={`已输入 ${note.length} 个字`}>{note.length}/500</span>
          </div>

          {error && (
            <p className="flex items-start gap-2 text-sm text-red-700" role="alert">
              <TriangleAlert className="mt-0.5 shrink-0" size={16} aria-hidden="true" />
              <span>{error}</span>
            </p>
          )}
        </form>
      )}
    </SpDialog>
  );
}
