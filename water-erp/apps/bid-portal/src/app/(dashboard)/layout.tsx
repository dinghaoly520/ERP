import AppShell from '@/components/app-shell';
import { ErrorBoundary } from '@/components/error-boundary';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return <AppShell><ErrorBoundary>{children}</ErrorBoundary></AppShell>;
}
