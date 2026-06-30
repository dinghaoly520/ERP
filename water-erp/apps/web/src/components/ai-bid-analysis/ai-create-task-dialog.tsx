'use client';

import { useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { Plus } from 'lucide-react';
import { aiBidAnalysisApi } from '@/lib/api/ai-bid-analysis';

interface AiCreateTaskDialogProps {
  onCreated: (taskId: string) => void;
}

export default function AiCreateTaskDialog({ onCreated }: AiCreateTaskDialogProps) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [projectName, setProjectName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const prefersReducedMotion = useReducedMotion();

  const handleSubmit = async () => {
    if (!name.trim()) { setError('请输入任务名称'); return; }
    setLoading(true);
    setError('');
    try {
      const result = await aiBidAnalysisApi.createTask({ name: name.trim(), projectName: projectName || undefined });
      setName('');
      setProjectName('');
      setOpen(false);
      onCreated(result.id);
    } catch (err) {
      setError(String(err).replace('Error: ', ''));
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white"
        style={{ background: 'var(--accent)' }}
      >
        <Plus className="w-4 h-4" />
        新建任务
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-white/45 backdrop-blur-md">
          <motion.div
            initial={prefersReducedMotion ? {} : { opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="w-full max-w-md rounded-xl p-6 bg-white/95 border border-white/55 shadow-2xl"
          >
            <h3 className="text-lg font-semibold mb-5">新建投标文件分析任务</h3>

            <div className="space-y-3">
              <div>
                <label className="block text-sm mb-1 opacity-70">任务名称 *</label>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="例如：XX项目投标文件分析"
                  className="w-full px-3 py-2 rounded-lg text-sm"
                  style={{ background: 'var(--muted)', border: '1px solid var(--border)' }}
                />
              </div>
              <div>
                <label className="block text-sm mb-1 opacity-70">项目名称</label>
                <input
                  value={projectName}
                  onChange={(e) => setProjectName(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="关联的项目名称"
                  className="w-full px-3 py-2 rounded-lg text-sm"
                  style={{ background: 'var(--muted)', border: '1px solid var(--border)' }}
                />
              </div>
            </div>

            {error && <p className="mt-3 text-sm text-red-500">{error}</p>}

            <div className="flex justify-end gap-3 mt-5">
              <button
                onClick={() => setOpen(false)}
                className="px-4 py-2 rounded-lg text-sm opacity-70 hover:opacity-100"
              >
                取消
              </button>
              <button
                onClick={handleSubmit}
                disabled={loading}
                className="px-4 py-2 rounded-lg text-sm text-white font-medium"
                style={{ background: 'var(--accent)', opacity: loading ? 0.7 : 1 }}
              >
                {loading ? '创建中...' : '创建'}
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </>
  );
}