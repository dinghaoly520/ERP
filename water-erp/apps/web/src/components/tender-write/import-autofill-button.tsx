'use client';

import { ScanText } from 'lucide-react';

export function ImportAutofillButton({
  disabled,
  onClick,
}: {
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="neu-btn-soft"
      title="导入文件识别并自动填写"
    >
      <ScanText size={14} />
      导入识别
    </button>
  );
}
