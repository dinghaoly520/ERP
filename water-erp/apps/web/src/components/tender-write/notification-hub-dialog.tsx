"use client";

import { useState, useEffect } from "react";
import { X, Mail, Table } from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";
import type { ReadyTenderDraft, ReadyTenderDocumentType } from "@/lib/types/tender-write";
import { NotificationLetterDialog } from "./notification-letter-dialog";
import { LedgerPreviewDialog } from "./ledger-preview-dialog";

const easeOutQuint: [number, number, number, number] = [0.22, 1, 0.36, 1];

function fadeIn(reducedMotion: boolean) {
  if (reducedMotion) {
    return { initial: {}, animate: {}, transition: { duration: 0 } };
  }
  return {
    initial: { opacity: 0, scale: 0.96 },
    animate: { opacity: 1, scale: 1 },
    transition: { duration: 0.3, ease: easeOutQuint },
  };
}

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
  const reducedMotion = useReducedMotion() ?? false;
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

  if (!isOpen) return null;

  return (
    <>
      {/* Selection step */}
      {!subDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <motion.div
            {...fadeIn(reducedMotion)}
            className="absolute inset-0 bg-[rgba(0,0,0,0.24)] backdrop-blur-sm"
            onClick={onClose}
          />
          <motion.div
            {...fadeIn(reducedMotion)}
            className="relative z-10 flex w-[520px] flex-col overflow-hidden rounded-[24px] bg-[var(--background)] shadow-[0_20px_60px_rgba(0,0,0,0.12)]"
          >
            {/* Header */}
            <div className="flex shrink-0 items-center justify-between px-6 py-4" style={{ borderBottom: "1px solid oklch(0.6 0.04 258 / 0.16)" }}>
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[rgba(94,126,189,0.76)]">
                  中标通知书
                </div>
                <h2 className="mt-1 text-[1.05rem] font-semibold tracking-[-0.03em] text-[color:var(--foreground)]">
                  选择操作
                </h2>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="neu-btn-xs"
              >
                <X size={18} />
              </button>
            </div>

            {/* Options */}
            <div className="flex flex-1 items-center justify-center p-8">
              <div className="grid gap-4 w-full max-w-lg">
                <button
                  type="button"
                  onClick={() => handleSelect("letter")}
                  className="group rounded-[22px] border border-white/60 bg-white/80 px-6 py-5 text-left transition-all duration-300 hover:border-[rgba(107,149,240,0.3)] hover:bg-[rgba(244,248,255,0.98)] hover:shadow-[0_12px_28px_rgba(59,89,143,0.1)]"
                >
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[rgba(92,181,150,0.1)]">
                      <Mail size={18} className="text-[rgba(78,150,124,0.9)]" />
                    </div>
                    <div>
                      <div className="text-[1.05rem] font-semibold tracking-[-0.02em] text-[color:var(--foreground)]">
                        中标通知书编制
                      </div>
                      <div className="mt-1.5 text-sm leading-6 text-[color:var(--muted-foreground)]">
                        上传定标审批表，自动识别中标信息，生成中标通知书并写入台账。
                      </div>
                    </div>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => handleSelect("ledger")}
                  className="group rounded-[22px] border border-white/60 bg-white/80 px-6 py-5 text-left transition-all duration-300 hover:border-[rgba(107,149,240,0.3)] hover:bg-[rgba(244,248,255,0.98)] hover:shadow-[0_12px_28px_rgba(59,89,143,0.1)]"
                >
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[rgba(107,149,240,0.1)]">
                      <Table size={18} className="text-[rgba(75,110,200,0.9)]" />
                    </div>
                    <div>
                      <div className="text-[1.05rem] font-semibold tracking-[-0.02em] text-[color:var(--foreground)]">
                        台账预览
                      </div>
                      <div className="mt-1.5 text-sm leading-6 text-[color:var(--muted-foreground)]">
                        查看、编辑中标通知书台账，支持新增、删除和导出。
                      </div>
                    </div>
                  </div>
                </button>
              </div>
            </div>
          </motion.div>
        </div>
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
