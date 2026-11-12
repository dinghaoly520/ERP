'use client';

import { useState } from 'react';
import { FileDown, Loader2 } from 'lucide-react';
import { Modal } from '@/components/workbench';

export type TenderExportFormat = 'docx' | 'pdf';

type Props = {
  open: boolean;
  /** 导出执行中（确认按钮转圈禁用） */
  busy?: boolean;
  onClose: () => void;
  onConfirm: (format: TenderExportFormat) => void;
};

/**
 * 导出格式选择弹窗（2026-11-12 用户裁定：导出采购文件时可选 Word/PDF）。
 * 独立编写页与项目编写弹窗共用；PDF 由服务器 LibreOffice 转换，未配置时自动回退 Word
 * （响应头 X-Export-Format 标记实际格式，调用方据此提示）。
 */
export function TenderExportFormatDialog({ open, busy, onClose, onConfirm }: Props) {
  const [format, setFormat] = useState<TenderExportFormat>('docx');

  return (
    <Modal
      open={open}
      onClose={busy ? () => {} : onClose}
      icon={<FileDown size={14} />}
      title="导出采购文件"
      description="选择导出格式"
      footer={
        <div className="neu-btn-group flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={busy} className="neu-btn-soft">
            取消
          </button>
          <button
            type="button"
            onClick={() => onConfirm(format)}
            disabled={busy}
            className="neu-btn-primary !h-[38px] gap-1.5"
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : <FileDown size={14} />}
            确认导出
          </button>
        </div>
      }
    >
      <div
        className="neu-segment"
        role="group"
        aria-label="导出格式"
        data-count="2"
        data-index={format === 'docx' ? '0' : '1'}
        style={{ '--segs': 2 } as React.CSSProperties}
      >
        <span className="neu-segment-thumb" aria-hidden="true" />
        <button
          type="button"
          className="neu-segment-btn"
          aria-pressed={format === 'docx'}
          onClick={() => setFormat('docx')}
        >
          Word 文档
        </button>
        <button
          type="button"
          className="neu-segment-btn"
          aria-pressed={format === 'pdf'}
          onClick={() => setFormat('pdf')}
        >
          PDF 文档
        </button>
      </div>
    </Modal>
  );
}
