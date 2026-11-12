"use client";

import { useState } from "react";
import { FileCheck2 } from "lucide-react";
import { toast } from "sonner";
import { SpDialog, SpButton } from "./ui";
import { bidApi } from "@/lib/api/bid";

/** 确认参与意向弹窗（2026-11-12 履约闭环）：红色警示+不可撤回说明。
 *  确认成功 toast + onConfirmed 回调（调用方自行刷新本地状态），失败由 API 层全局 toast。 */
export function BidIntentDialog({
  open, projectId, projectName, onClose, onConfirmed,
}: {
  open: boolean;
  projectId: string;
  projectName?: string | null;
  onClose: () => void;
  onConfirmed: (confirmedAt: string) => void;
}) {
  const [busy, setBusy] = useState(false);

  async function doConfirm() {
    setBusy(true);
    try {
      const r = await bidApi.confirmIntent(projectId);
      toast.success("已确认参与意向");
      onConfirmed(r?.confirmedAt ?? new Date().toISOString());
      onClose();
    } catch {
      /* API 层已全局错误 toast（INTENT_NOT_APPLICABLE / INTENT_STAGE_CLOSED 等按码提示） */
    } finally {
      setBusy(false);
    }
  }

  return (
    <SpDialog
      open={open}
      onClose={onClose}
      title="确认参与意向"
      subtitle={projectName ?? undefined}
      icon={FileCheck2}
      width={440}
      footer={
        <>
          <SpButton variant="soft" onClick={onClose}>取消</SpButton>
          <SpButton variant="primary" loading={busy} onClick={doConfirm}>确认参与</SpButton>
        </>
      }
    >
      <p className="sp-intent-warn">若多次确认投标意向却未参与，则可能会被移入黑名单。</p>
      <p className="sp-intent-note">确认后不可撤回；确认参与意向后方可投递标书。</p>
    </SpDialog>
  );
}
