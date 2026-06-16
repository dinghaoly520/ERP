'use client';

import { Component, type ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface State { hasError: boolean; error: string | null; }

export class ErrorBoundary extends Component<{ children: ReactNode; fallback?: ReactNode }, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error) { return { hasError: true, error: error.message }; }

  render() {
    if (this.state.hasError) {
      return this.props.fallback || (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <AlertTriangle size={28} strokeWidth={1.5} className="text-[oklch(0.50_0.18_22)] mb-3" />
          <p className="text-sm font-semibold text-[oklch(0.18_0.012_265)] mb-1">页面出现错误</p>
          <p className="text-xs text-[oklch(0.62_0.008_264)] mb-4 max-w-md">{this.state.error}</p>
          <button onClick={() => { this.setState({ hasError: false, error: null }); window.location.reload(); }}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#064ea2] text-white text-xs font-bold hover:bg-[#054280] transition">
            <RefreshCw size={12} /> 重新加载
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
