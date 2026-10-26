import AppShell from '@/components/app-shell';
import { ErrorBoundary } from '@/components/error-boundary';
import { SessionWatchdog } from '@/components/session-watchdog';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppShell>
      <ErrorBoundary>{children}</ErrorBoundary>
      {/* 单设备登录心跳（2026-09-20）：被顶下线/冻结 ≤15s 弹遮罩（仅已登录区域挂载） */}
      <SessionWatchdog />
    </AppShell>
  );
}
