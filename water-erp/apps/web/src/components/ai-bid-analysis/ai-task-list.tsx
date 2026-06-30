'use client';

import { useEffect, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { Bot, Trash2, Clock, Users } from 'lucide-react';
import { aiBidAnalysisApi } from '@/lib/api/ai-bid-analysis';
import type { AiBidAnalysisTask } from '@/lib/types/ai-bid-analysis';
import {
  AI_BID_TASK_STATUS_LABELS,
  AI_BID_TASK_STATUS_COLORS,
} from '@/lib/types/ai-bid-analysis';
import AiCreateTaskDialog from './ai-create-task-dialog';

interface TaskListProps {
  onSelectTask: (id: string) => void;
}

export default function AiTaskList({ onSelectTask }: TaskListProps) {
  const [tasks, setTasks] = useState<AiBidAnalysisTask[]>([]);
  const [loading, setLoading] = useState(true);
  const prefersReducedMotion = useReducedMotion();

  const load = async () => {
    setLoading(true);
    try {
      setTasks(await aiBidAnalysisApi.getTasks());
    } catch {}
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const handleDelete = async (id: string) => {
    if (!confirm('确定要删除此任务吗？')) return;
    await aiBidAnalysisApi.deleteTask(id);
    load();
  };

  const fadeIn = (i: number) =>
    prefersReducedMotion
      ? {}
      : { initial: { opacity: 0, y: 10 }, animate: { opacity: 1, y: 0 }, transition: { delay: i * 0.03 } };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">投标文件分析任务</h2>
        <AiCreateTaskDialog onCreated={(taskId) => { load(); onSelectTask(taskId); }} />
      </div>

      {loading ? (
        <div className="text-center py-12 opacity-50">加载中...</div>
      ) : tasks.length === 0 ? (
        <div className="text-center py-12 opacity-50">
          <Bot className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p>暂无分析任务，点击"新建任务"开始</p>
        </div>
      ) : (
        <div className="grid gap-3">
          {tasks.map((task, i) => {
            const statusLabel = AI_BID_TASK_STATUS_LABELS[task.status] || task.status;
            const statusColor = AI_BID_TASK_STATUS_COLORS[task.status] || 'bg-gray-100 text-gray-700';
            return (
              <motion.div
                key={task.id}
                {...fadeIn(i)}
                className="rounded-xl p-4 cursor-pointer hover:opacity-80 transition-opacity flex items-center justify-between"
                style={{ background: 'var(--card)', border: '1px solid var(--border)' }}
                onClick={() => onSelectTask(task.id)}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3 mb-1">
                    <h3 className="font-medium truncate">{task.name}</h3>
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${statusColor}`}>
                      {statusLabel}
                    </span>
                  </div>
                  <div className="flex items-center gap-4 text-xs opacity-60">
                    {task.projectName && <span>{task.projectName}</span>}
                    <span className="flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {new Date(task.createdAt).toLocaleDateString()}
                    </span>
                    {task.bidders && (
                      <span className="flex items-center gap-1">
                        <Users className="w-3 h-3" />
                        {task.bidders.length} 家投标单位
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2 ml-4" onClick={(e) => e.stopPropagation()}>
                  <button
                    onClick={() => handleDelete(task.id)}
                    className="p-1.5 rounded-lg hover:bg-red-50 text-red-400 hover:text-red-600"
                    title="删除任务"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </motion.div>
            );
          })}
        </div>
      )}
    </div>
  );
}
