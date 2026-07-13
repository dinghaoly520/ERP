'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTenderReview, useReviewOps } from './use-tender-review';
import {
  ChevronUp,
  ChevronDown,
  Loader2,
  CircleStop,
  Trash2,
  FileText,
} from 'lucide-react';

export default function TaskQueueBar() {
  const { runningTasks } = useTenderReview();
  const { stopTask, deleteTask } = useReviewOps();
  const [expanded, setExpanded] = useState(true);

  if (runningTasks.length === 0) {
    return null;
  }

  return (
    <div className="wb-panel rounded-[16px] overflow-hidden shrink-0">
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between p-3 hover:bg-[color-mix(in_oklch,var(--muted)_15%,transparent)] transition-colors"
      >
        <div className="flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin text-[var(--accent)]" />
          <span className="text-sm font-medium text-[var(--foreground)]">
            进行中的任务 ({runningTasks.length})
          </span>
        </div>
        {expanded ? (
          <ChevronDown className="h-4 w-4 text-[var(--muted-foreground)]" />
        ) : (
          <ChevronUp className="h-4 w-4 text-[var(--muted-foreground)]" />
        )}
      </button>

      {/* Task list */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="border-t border-white/10"
          >
            <div className="p-2 space-y-1">
              {runningTasks.map((task) => (
                <div
                  key={task.id}
                  className="flex items-center justify-between gap-3 p-2 rounded-[12px] bg-white/[0.02]"
                >
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <FileText className="h-4 w-4 text-[var(--muted-foreground)] shrink-0" />
                    <span className="text-sm text-[var(--foreground)] truncate">
                      {task.documentName}
                    </span>
                    <span className="text-xs text-[var(--muted-foreground)] shrink-0">
                      {task.reviewMode === 'strict' ? '严格审查' : '通用审查'}
                    </span>
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => stopTask(task.id)}
                      className="p-1.5 rounded-lg text-[var(--muted-foreground)] hover:text-[var(--accent)] hover:bg-[var(--accent)]/10 transition-colors"
                      title="停止任务"
                    >
                      <CircleStop className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => deleteTask(task.id)}
                      className="p-1.5 rounded-lg text-[var(--muted-foreground)] hover:text-[rgba(230,129,102,1)] hover:bg-[rgba(230,129,102,0.12)] transition-colors"
                      title="删除任务"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
