"use client";

import { AlertCircle } from "lucide-react";
import { Modal } from "@/components/workbench";

type LoginErrorDialogProps = {
  isOpen: boolean;
  message: string;
  onClose: () => void;
};

export function LoginErrorDialog({
  isOpen,
  message,
  onClose,
}: LoginErrorDialogProps) {
  return (
    <Modal open={isOpen} onClose={onClose} title="登录失败" size="sm"
      footer={<button onClick={onClose} className="neu-btn-primary">我知道了</button>}>
      <div className="flex items-start gap-2 text-[var(--danger)]">
        <AlertCircle size={18} strokeWidth={1.95} className="mt-[1px] shrink-0" />
        <div className="text-sm leading-7 text-[var(--foreground)]">{message}</div>
      </div>
    </Modal>
  );
}
