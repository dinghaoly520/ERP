'use client';

import { useEffect, useCallback } from 'react';
import { X, Download } from 'lucide-react';
import styles from './chart-lightbox.module.css';

export function ChartLightbox({
  imageUrl,
  onClose,
}: {
  imageUrl: string | null;
  onClose: () => void;
}) {
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    },
    [onClose],
  );

  useEffect(() => {
    if (!imageUrl) return;
    document.addEventListener('keydown', handleKeyDown);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = '';
    };
  }, [imageUrl, handleKeyDown]);

  if (!imageUrl) return null;

  const handleDownload = () => {
    const a = document.createElement('a');
    a.href = imageUrl;
    a.download = `chart-${Date.now()}.png`;
    a.click();
  };

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div className={styles.content} onClick={(e) => e.stopPropagation()}>
        <button
          className={styles.closeBtn}
          onClick={onClose}
          type="button"
          aria-label="关闭"
        >
          <X size={18} strokeWidth={1.8} />
        </button>
        <img
          src={imageUrl}
          alt="图表放大视图"
          className={styles.image}
        />
        <div className={styles.actions}>
          <button
            className={styles.actionBtn}
            onClick={handleDownload}
            type="button"
          >
            <Download size={14} strokeWidth={1.8} />
            下载 PNG
          </button>
        </div>
      </div>
    </div>
  );
}
