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
      className="tender-btn tender-btn--blue"
      title="导入文件识别并自动填写"
    >
      <span className="tb-icon tb-icon--blue tb-anim-scan">
        <ScanText size={13} />
      </span>
      导入识别
    </button>
  );
}
