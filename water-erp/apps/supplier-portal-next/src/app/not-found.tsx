"use client";

import Image from "next/image";

/**
 * 有意保留在 app/ 根级、不迁入 (main) 路由组：Next.js 仅根级 not-found 拦截未匹配 URL；
 * 路由组内 not-found 只承接组内路由 notFound() 抛出（本应用无任何调用），迁入组内会让
 * 全局 404 退化为 Next 默认页。根级文件不经过 (main)/layout（无 AppShell），故自带
 * 品牌头 + 返回导航最小壳，不再裸块。
 */
export default function NotFound() {
  return (
    <div className="app-root__content flex min-h-screen flex-col">
      <header className="flex items-center gap-2.5 px-6 py-4">
        <Image src="/logo.png" alt="智慧水发·蜀水云采" width={40} height={40} className="sp-brand-logo" priority />
        <strong className="sp-brand-title">智慧水发 · 蜀水云采</strong>
      </header>
      <main className="flex flex-1 items-center justify-center p-6">
        <div className="sp-error-block max-w-[420px]">
          <div className="sp-error-icon">404</div>
          <div className="sp-error-text">页面不存在</div>
          <div className="sp-error-desc">您访问的页面可能已被移除或地址有误。</div>
          <a href="/dashboard" className="neu-btn-primary no-underline">返回工作台</a>
        </div>
      </main>
    </div>
  );
}
