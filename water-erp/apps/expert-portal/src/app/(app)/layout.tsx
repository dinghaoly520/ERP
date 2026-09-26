import AppShell from '@/components/app-shell';
import { ErrorBoundary } from '@/components/error-boundary';
import { SessionWatchdog } from '@/components/session-watchdog';
import { RealtimeNotifications } from '@/components/notification/realtime-notifications';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppShell>
      <ErrorBoundary>{children}</ErrorBoundary>
      {/* 单设备登录心跳（2026-09-20）：被顶下线/冻结 ≤15s 弹遮罩（仅已登录区域挂载） */}
      <SessionWatchdog />
      {/* 全局实时通知（2026-09-26）：新站内通知右下角即时弹出，无需刷新 */}
      <RealtimeNotifications />
    </AppShell>
  );
}
