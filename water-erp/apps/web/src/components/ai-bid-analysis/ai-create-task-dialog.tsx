'use client';

import { useState } from 'react';
import { Plus } from 'lucide-react';
import { Modal } from '@/components/workbench';
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
        className="neu-btn-primary flex items-center gap-2"
      >
        <Plus className="w-4 h-4" />
        新建任务
      </button>

      <Modal open={open} onClose={() => setOpen(false)} title="新建投标文件分析任务" size="sm"
        footer={<>
          <button onClick={() => setOpen(false)} className="neu-btn-soft">取消</button>
          <button onClick={handleSubmit} disabled={loading} className="neu-btn-primary">{loading ? '创建中...' : '创建'}</button>
        </>}>
        <div>
          <label className="block text-sm mb-1 text-[var(--muted-foreground)]">任务名称 *</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="例如：XX项目投标文件分析"
            className="neu-input w-full text-sm"
          />
        </div>
        <div>
          <label className="block text-sm mb-1 text-[var(--muted-foreground)]">项目名称</label>
          <input
            value={projectName}
            onChange={(e) => setProjectName(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="关联的项目名称"
            className="neu-input w-full text-sm"
          />
        </div>
        {error && <p className="text-sm text-red-500">{error}</p>}
      </Modal>
    </>
  );
}