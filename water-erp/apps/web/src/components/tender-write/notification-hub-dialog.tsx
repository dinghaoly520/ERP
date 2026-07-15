"use client";

import { useState, useEffect } from "react";
import { Mail, Table } from "lucide-react";
import type { ReadyTenderDraft, ReadyTenderDocumentType } from "@/lib/types/tender-write";
import { Modal } from "@/components/workbench";
import { NotificationLetterDialog } from "./notification-letter-dialog";
import { LedgerPreviewDialog } from "./ledger-preview-dialog";

type SubDialog = "letter" | "ledger" | null;

export function NotificationHubDialog({
  isOpen,
  tenderType,
  tenderDraft,
  onClose,
}: {
  isOpen: boolean;
  tenderType: ReadyTenderDocumentType;
  tenderDraft: ReadyTenderDraft;
  onClose: () => void;
}) {
  const [subDialog, setSubDialog] = useState<SubDialog>(null);

  useEffect(() => {
    if (!isOpen) {
      setSubDialog(null);
    }
  }, [isOpen]);

  const handleSelect = (type: SubDialog) => {
    setSubDialog(type);
  };

  const handleSubClose = () => {
    setSubDialog(null);
    onClose();
  };

  return (
    <>
      {/* Selection step */}
      {!subDialog && (
        <Modal
          open={isOpen}
          onClose={onClose}
          title="选择操作"
          description="中标通知书"
          size="md"
        >
          <div className="grid gap-4">
            <button
              type="button"
              onClick={() => handleSelect("letter")}
              className="group flex items-start gap-4 rounded-[16px] border border-transparent px-5 py-4 text-left bg-[oklch(1_0_0_/_0.55)] backdrop-blur-[16px] transition-[transform,box-shadow] duration-300 [box-shadow:var(--cs)] hover:[box-shadow:var(--csh)] hover:-translate-y-0.5"
              style={{ "--cs": "inset 0 1px 0 oklch(1 0 0 / 0.7), 2px 2px 6px oklch(0.55 0.03 258 / 0.12), -2px -2px 6px oklch(1 0 0 / 0.85)", "--csh": "inset 0 1px 0 oklch(1 0 0 / 0.85), 4px 4px 10px oklch(0.45 0.08 258 / 0.1), -2px -2px 8px oklch(1 0 0 / 0.9)" } as React.CSSProperties}
            >
              <div className="neu-icon-well flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] text-[color:var(--success)] transition-transform duration-300 group-hover:scale-105">
                <Mail size={18} />
              </div>
              <div className="min-w-0">
                <div className="text-[0.95rem] font-semibold tracking-[-0.02em] text-[color:var(--foreground)]">
                  中标通知书编制
                </div>
                <div className="mt-1 text-xs leading-5 text-[color:var(--muted-foreground)]">
                  上传定标审批表，自动识别中标信息，生成中标通知书并写入台账。
                </div>
              </div>
            </button>

            <button
              type="button"
              onClick={() => handleSelect("ledger")}
              className="group flex items-start gap-4 rounded-[16px] border border-transparent px-5 py-4 text-left bg-[oklch(1_0_0_/_0.55)] backdrop-blur-[16px] transition-[transform,box-shadow] duration-300 [box-shadow:var(--cs)] hover:[box-shadow:var(--csh)] hover:-translate-y-0.5"
              style={{ "--cs": "inset 0 1px 0 oklch(1 0 0 / 0.7), 2px 2px 6px oklch(0.55 0.03 258 / 0.12), -2px -2px 6px oklch(1 0 0 / 0.85)", "--csh": "inset 0 1px 0 oklch(1 0 0 / 0.85), 4px 4px 10px oklch(0.45 0.08 258 / 0.1), -2px -2px 8px oklch(1 0 0 / 0.9)" } as React.CSSProperties}
            >
              <div className="neu-icon-well flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] text-[color:var(--accent)] transition-transform duration-300 group-hover:scale-105">
                <Table size={18} />
              </div>
              <div className="min-w-0">
                <div className="text-[0.95rem] font-semibold tracking-[-0.02em] text-[color:var(--foreground)]">
                  台账预览
                </div>
                <div className="mt-1 text-xs leading-5 text-[color:var(--muted-foreground)]">
                  查看、编辑中标通知书台账，支持新增、删除和导出。
                </div>
              </div>
            </button>
          </div>
        </Modal>
      )}

      {/* Sub dialogs */}
      {subDialog === "letter" && (
        <NotificationLetterDialog
          isOpen={true}
          tenderType={tenderType}
          tenderDraft={tenderDraft}
          onClose={handleSubClose}
        />
      )}

      {subDialog === "ledger" && (
        <LedgerPreviewDialog
          isOpen={true}
          onClose={handleSubClose}
        />
      )}
    </>
  );
}
