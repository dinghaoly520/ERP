"use client";

import { useEffect, useState } from "react";
import { Paperclip, Trophy } from "lucide-react";
import { toast } from "sonner";
import { SpButton, SpDateInput, SpDialog, SpInput, SpTextarea } from "@/components/ui";
import { supplierApi } from "@/lib/api/supplier";

/**
 * 履约资产 → 主体业绩 转入弹窗（2026-10-30，spec：
 * 2026-10-30-supplier-own-archive-style-performance-transfer-design.md）。
 *
 * 两处入口共用：合同类自存档案卡「转入业绩」/ 平台合同履行台账完成节点「转入业绩」。
 * 提交走既有 performances 变更申请审批链（fieldName=performances 整表 JSON 替换），
 * :3005 审批中心批准后生效——不新造数据通道；同字段已有 PENDING 时后端
 * DUPLICATE_PENDING_CHANGE（api 包装层全局 toast 中文文案，此处不再弹）。
 */

export interface PerformanceTransferSeed {
  projectName: string;
  clientName: string;
  contractAmount: string;
  signDate: string; // YYYY-MM-DD 或 ""
  description: string;
  proofFiles: { name: string; url: string }[];
}

export function PerformanceTransferDialog({
  seed,
  onClose,
}: {
  seed: PerformanceTransferSeed | null;
  onClose: () => void;
}) {
  const [form, setForm] = useState<PerformanceTransferSeed | null>(seed);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  // 打开（seed 变化）时重置表单与默认理由
  useEffect(() => {
    setForm(seed);
    setReason(seed ? `履约档案转入：${seed.projectName}` : "");
  }, [seed]);

  if (!seed || !form) return null;
  const cur = form; // 闭包内提交用（渲染期已收窄的非空快照）

  const set = (k: keyof PerformanceTransferSeed, v: string) =>
    setForm((f) => (f ? { ...f, [k]: v } : f));

  async function submit() {
    if (!cur.projectName.trim()) { toast.warning("请填写项目名称"); return; }
    setBusy(true);
    try {
      // 提交时即时拉当前业绩，防陈旧覆盖（整表替换语义下必须基于最新行 append）
      const profile = await supplierApi.getProfile();
      const rows: unknown[] = Array.isArray(profile?.performances) ? profile.performances : [];
      await supplierApi.createChangeRequest({
        fieldName: "performances",
        fieldLabel: "主体业绩",
        newValue: JSON.stringify([
          ...rows,
          {
            projectName: cur.projectName.trim(),
            clientName: cur.clientName.trim(),
            contractAmount: cur.contractAmount.trim(),
            signDate: cur.signDate,
            description: cur.description.trim(),
            proofFiles: cur.proofFiles,
          },
        ]),
        reason: reason.trim() || undefined,
      });
      toast.success("已提交业绩变更申请，待采购中心审批后生效");
      onClose();
    } catch {
      /* 全局 toast：DUPLICATE_PENDING_CHANGE 等业务错误由 api 包装层呈现 */
    } finally {
      setBusy(false);
    }
  }

  return (
    <SpDialog
      open={seed !== null}
      onClose={onClose}
      title="转入主体业绩"
      subtitle="提交后将生成业绩变更申请，经采购中心审批后计入企业资料（投标可用）"
      icon={Trophy}
      width={560}
      footer={
        <>
          <SpButton onClick={onClose}>取消</SpButton>
          <SpButton variant="primary" loading={busy} onClick={submit}>{busy ? "提交中…" : "提交申请"}</SpButton>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1.5 text-[13px] font-bold">
            项目名称 <i className="not-italic text-danger">*</i>
            <SpInput value={form.projectName} placeholder="如：XX项目" onChange={(e) => set("projectName", e.target.value)} />
          </label>
          <label className="flex flex-col gap-1.5 text-[13px] font-bold">
            客户名称
            <SpInput value={form.clientName} placeholder="如：四川水发集团" onChange={(e) => set("clientName", e.target.value)} />
          </label>
          <label className="flex flex-col gap-1.5 text-[13px] font-bold">
            合同金额
            <SpInput value={form.contractAmount} placeholder="如：86 万元" onChange={(e) => set("contractAmount", e.target.value)} />
          </label>
          <label className="flex flex-col gap-1.5 text-[13px] font-bold">
            签订日期
            <SpDateInput value={form.signDate} onChange={(e) => set("signDate", e.target.value)} />
          </label>
        </div>
        <label className="flex flex-col gap-1.5 text-[13px] font-bold">
          业绩说明
          <SpTextarea rows={2} value={form.description} placeholder="选填" onChange={(e) => set("description", e.target.value)} />
        </label>
        <div className="flex flex-col gap-1.5">
          <span className="text-[13px] font-bold">证明文件（随业绩一并提交，不可在此增删）</span>
          {form.proofFiles.length === 0 ? (
            <span className="text-xs text-[var(--fg-2)]">无证明文件——可在来源处先上传后再转入</span>
          ) : (
            <div className="flex flex-wrap gap-2">
              {form.proofFiles.map((f, i) => (
                <a
                  key={`${f.url}-${i}`}
                  className="oa-file-chip"
                  href={f.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={f.name}
                >
                  <Paperclip size={11} />
                  <span>{f.name}</span>
                </a>
              ))}
            </div>
          )}
        </div>
        <label className="flex flex-col gap-1.5 text-[13px] font-bold">
          变更原因
          <SpTextarea rows={2} value={reason} placeholder="审批人可见" onChange={(e) => setReason(e.target.value)} />
        </label>
      </div>
    </SpDialog>
  );
}
