'use client';

import { useRouter } from 'next/navigation';

export function FlowHeader({ label }: { label: string }) {
  const router = useRouter();
  return (
    <header className="flow-header">
      <div className="w-full px-[clamp(28px,4vw,72px)] flex items-center justify-between h-full">
        <a href="/" className="flex items-center gap-3 shrink-0">
          <img src="/assets/logo.png" alt="四川水发集团" className="h-[45px] w-auto object-contain" />
          <div className="flex flex-col leading-tight">
            <strong className="text-[#123a6e] text-xl tracking-[0.14em]" style={{ fontFamily: '"SimHei","黑体",sans-serif', fontWeight: 900 }}>四川水发集团</strong>
            <span className="text-[10px] text-[#8a96aa] tracking-[0.16em]">{label}</span>
          </div>
        </a>
        <button onClick={() => router.push('/')} className="flow-back">← 返回首页</button>
      </div>
    </header>
  );
}
