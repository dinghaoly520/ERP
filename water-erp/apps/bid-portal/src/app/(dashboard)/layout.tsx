import AppShell from '@/components/app-shell';
import { ErrorBoundary } from '@/components/error-boundary';
import { BidProjectProvider } from '@/contexts/bid-project-context';
import { RealtimeNotifications } from '@/components/notification/realtime-notifications';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <BidProjectProvider>
      <AppShell>
        <ErrorBoundary>{children}</ErrorBoundary>
        {/* 全局实时通知（2026-09-26）：新站内通知右下角即时弹出，铃铛负责历史与角标 */}
        <RealtimeNotifications />
      </AppShell>
    </BidProjectProvider>
  );
}
