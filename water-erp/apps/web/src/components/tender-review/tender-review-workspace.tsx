'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { useTenderReview } from './tender-review-context';
import KbNavSidebar from './kb-nav-sidebar';
import ReviewWorkspaceContent from './review-workspace-content';
import TaskQueueBar from './task-queue-bar';
import { Loader2, Database } from 'lucide-react';

export default function TenderReviewWorkspace() {
  const { loading, error } = useTenderReview();
  const [rightPanelWidth, setRightPanelWidth] = useState(384);
  const [isResizing, setIsResizing] = useState(false);
  const [isHoveringEdge, setIsHoveringEdge] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isResizing || !containerRef.current) return;
    const containerRect = containerRef.current.getBoundingClientRect();
    const newWidth = containerRect.right - e.clientX;
    const clampedWidth = Math.min(Math.max(newWidth, 280), 480);
    setRightPanelWidth(clampedWidth);
  }, [isResizing]);

  const handleMouseUp = useCallback(() => {
    setIsResizing(false);
  }, []);

  useEffect(() => {
    if (isResizing) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    } else {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    }
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isResizing, handleMouseMove, handleMouseUp]);

  const handleEdgeMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
  }, []);

  const handleEdgeMouseEnter = useCallback(() => {
    setIsHoveringEdge(true);
  }, []);

  const handleEdgeMouseLeave = useCallback(() => {
    if (!isResizing) {
      setIsHoveringEdge(false);
    }
  }, [isResizing]);

  // Loading state
  if (loading.kbs && loading.tasks) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-8rem)]">
        <Loader2 className="h-8 w-8 animate-spin text-[var(--accent)]" />
      </div>
    );
  }

  // Error state
  if (error.kbs && error.tasks) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-8rem)]">
        <div className="text-center text-[var(--muted-foreground)]">
          <p className="text-lg mb-2">加载失败</p>
          <p className="text-sm">{error.kbs}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[calc(100vh-5rem)] gap-3">
      {/* Main layout: Center workspace + Right panel */}
      <div ref={containerRef} className="flex flex-1 gap-3 min-h-0 relative">
        {/* Center - Main workspace */}
        <div className="flex-1 min-w-0">
          <ReviewWorkspaceContent />
        </div>

        {/* Resize edge zone */}
        <div
          onMouseDown={handleEdgeMouseDown}
          onMouseEnter={handleEdgeMouseEnter}
          onMouseLeave={handleEdgeMouseLeave}
          className="absolute top-0 bottom-0 w-4 -translate-x-1/2 z-10 cursor-col-resize"
          style={{ left: `calc(100% - ${rightPanelWidth}px)` }}
        >
          {/* Visual indicator */}
          {(isHoveringEdge || isResizing) && (
            <div className="h-full w-1 bg-[var(--accent)]/50 rounded-full transition-opacity" />
          )}
        </div>

        {/* Right sidebar - Stats & KB navigation */}
        <KbNavSidebar width={rightPanelWidth} />
      </div>

      {/* Bottom - Task queue bar */}
      <TaskQueueBar />
    </div>
  );
}