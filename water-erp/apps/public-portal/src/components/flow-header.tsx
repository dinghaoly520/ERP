'use client';

import { useRouter } from 'next/navigation';

export function FlowHeader({ label }: { label: string }) {
  const router = useRouter();
  return (
    <header className="flow-header">
      <div className="w-full px-[clamp(28px,4vw,72px)] flex items-center justify-between h-full">
        <a href="/" className="flex items-center gap-3 shrink-0">
          <img src="/assets/logo.png" alt="四川省水利发展集团有限公司" className="h-[45px] w-auto object-contain" />
          <div className="flex flex-col leading-tight">
            <strong className="text-[#123a6e] text-xl tracking-[0.14em]" style={{ fontFamily: '"SimHei","黑体",sans-serif', fontWeight: 900 }}>四川省水利发展集团有限公司</strong>
          </div>
        </a>
        <button onClick={() => router.push('/')} className="flow-back">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="flow-back-arrow"><path d="M15 18l-6-6 6-6"/></svg>
          返回首页
        </button>
      </div>
    </header>
  );
}
