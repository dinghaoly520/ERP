"use client";

export default function NotFound() {
  return (
    <div className="app-root__content flex min-h-screen items-center justify-center p-6">
      <div className="sp-error-block" style={{ maxWidth: 420 }}>
        <div className="sp-error-icon">404</div>
        <div className="sp-error-text">页面不存在</div>
        <div className="sp-error-desc">您访问的页面可能已被移除或地址有误。</div>
        <a href="/dashboard" className="neu-btn-primary" style={{ textDecoration: "none" }}>返回工作台</a>
      </div>
    </div>
  );
}
