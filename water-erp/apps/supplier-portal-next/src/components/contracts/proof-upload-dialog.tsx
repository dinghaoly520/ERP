"use client";

import { useEffect, useState } from "react";
import { FileUp, TriangleAlert } from "lucide-react";
import { contractApi, type SpContractFulfillment } from "@/lib/api/contract";
import { uploadFile } from "@/lib/api/upload";
import { validateProofFile } from "@/lib/contract-forms";
import { SpButton, SpDialog, SpProgress } from "@/components/ui";

interface ProofUploadDialogProps {
  open: boolean;
  contractId: string | null;
  contractCode?: string;
  fulfillment: SpContractFulfillment | null;
  onClose: () => void;
  onComplete: () => Promise<void> | void;
}

export function ProofUploadDialog({
  open,
  contractId,
  contractCode,
  fulfillment,
  onClose,
  onComplete,
}: ProofUploadDialogProps) {
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setFile(null);
      setProgress(0);
      setSubmitting(false);
      setError(null);
    }
  }, [open, fulfillment?.id]);

  function chooseFile(nextFile: File | null) {
    setFile(nextFile);
    setProgress(0);
    setError(nextFile ? validateProofFile(nextFile) : null);
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file || !contractId || !fulfillment) {
      setError("请选择履约证明文件");
      return;
    }
    const validationError = validateProofFile(file);
    if (validationError) {
      setError(validationError);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const asset = await uploadFile(file, "contract_document", setProgress);
      await contractApi.attachProof(contractId, fulfillment.id, asset.id);
      await onComplete();
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "上传失败，请重试");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <SpDialog
      open={open}
      onClose={onClose}
      title={fulfillment?.proofAssetId ? "替换履约证明" : "上传履约证明"}
      subtitle={`${contractCode || "合同"} · ${fulfillment?.title || "履约节点"}`}
      icon={FileUp}
      closeOnOverlay={!submitting}
      footer={(
        <>
          <SpButton onClick={onClose} disabled={submitting}>取消</SpButton>
          <SpButton
            variant="primary"
            type="submit"
            form="contract-proof-upload-form"
            loading={submitting}
            disabled={!file || Boolean(error)}
          >
            {fulfillment?.proofAssetId ? "上传并替换" : "上传并挂接"}
          </SpButton>
        </>
      )}
    >
      <form id="contract-proof-upload-form" className="space-y-4" onSubmit={submit}>
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
          支持 PDF、Word、JPG、PNG，单个文件不超过 50 MB。上传成功后将作为该履约节点的审计凭证。
        </div>
        <label className="block text-sm font-medium" htmlFor="contract-proof-file">
          选择文件
        </label>
        <input
          id="contract-proof-file"
          className="block min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-1.5"
          type="file"
          accept=".pdf,.doc,.docx,.jpg,.jpeg,.png,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,image/jpeg,image/png"
          onChange={(event) => chooseFile(event.target.files?.[0] ?? null)}
          disabled={submitting}
        />
        {file && (
          <p className="text-sm text-slate-600">
            已选择：<strong>{file.name}</strong> · {(file.size / 1024 / 1024).toFixed(2)} MB
          </p>
        )}
        {submitting && <SpProgress value={progress} label={`正在上传 ${file?.name || "履约证明"}`} />}
        {error && (
          <p className="flex items-start gap-2 text-sm text-red-700" role="alert">
            <TriangleAlert className="mt-0.5 shrink-0" size={16} aria-hidden="true" />{error}
          </p>
        )}
      </form>
    </SpDialog>
  );
}
