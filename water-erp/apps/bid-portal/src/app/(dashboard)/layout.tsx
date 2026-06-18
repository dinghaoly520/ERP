import AppShell from '@/components/app-shell';
import { ErrorBoundary } from '@/components/error-boundary';
import { BidProjectProvider } from '@/contexts/bid-project-context';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <BidProjectProvider>
      <AppShell>
        <ErrorBoundary>{children}</ErrorBoundary>
      </AppShell>
    </BidProjectProvider>
  );
}
