'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { FaceRecognition } from '@/components/face-recognition';

/**
 * 平板端人脸识别核验页（仅 UI 占位，不做实际功能）
 *
 * 登录后独立页面：显示人脸识别取景框 → 点击开始 → 模拟扫描 → 通过后自动跳转平板落地页
 */
export default function TabletFaceVerifyPage() {
  const router = useRouter();
  const [userName, setUserName] = useState<string>('');

  useEffect(() => {
    // 获取当前登录用户信息
    fetch('/api/auth/me', { headers: { 'X-Portal': 'expert' }, credentials: 'include' })
      .then((r) => {
        if (r.status === 401) { router.replace('/login'); return null; }
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((u) => {
        if (!u) return;
        setUserName(u.displayName?.trim() || u.username || '专家');
      })
      .catch(() => {
        // 获取失败不阻塞流程，继续显示核验界面
      });
  }, [router]);

  const handleSuccess = () => {
    router.replace('/tablet');
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-6">
      <div className="w-full max-w-[400px]">
        {/* 品牌标识 */}
        <div className="mb-8 text-center">
          <img
            src="/assets/logo.png"
            alt="智慧水发 · 蜀水云采"
            className="mx-auto h-12 w-auto object-contain"
          />
          <h1 className="mt-3 text-lg font-bold tracking-[-0.01em] text-[var(--foreground)]">
            专家评标 · 平板工作台
          </h1>
          <p className="mt-1 text-xs text-[var(--muted-foreground)]">
            请先完成人脸识别核验
          </p>
        </div>

        {/* 人脸识别组件 */}
        <div className="neu-card-static p-6">
          <FaceRecognition
            userName={userName || undefined}
            onSuccess={handleSuccess}
          />
        </div>

        {/* 底部提示 */}
        <p className="mt-6 text-center text-[11px] text-[var(--muted-foreground)]">
          核验通过后将自动进入评标工作台
        </p>
      </div>
    </div>
  );
}
