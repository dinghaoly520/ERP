'use client';

import { ExternalLink } from 'lucide-react';

export default function CentralCatalogPage() {
  const handleOpen = () => {
    window.open('http://localhost:3003', '_blank');
  };

  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-6">
      <div className="text-center">
        <h2 className="text-xl font-semibold text-[color:var(--foreground)]">
          集中采购目录
        </h2>
        <p className="mt-2 text-sm text-[color:var(--muted-foreground)]">
          点击下方按钮跳转至信息门户查看集中采购目录
        </p>
      </div>
      <button
        type="button"
        onClick={handleOpen}
        className="neu-btn-soft"
      >
        <ExternalLink size={16} />
        打开集中采购目录
      </button>
    </div>
  );
}
