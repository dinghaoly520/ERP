'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { saveScoreTemplate } from '@/lib/api/bid';
import { Modal } from '@/components/workbench';

interface Props {
  open: boolean;
  onClose: () => void;
  projectId: string;
}

export function SaveTemplateDialog({ open, onClose, projectId }: Props) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  const handleClose = () => {
    setName('');
    onClose();
  };

  const handleSave = async () => {
    if (!name.trim()) {
      toast.error('请填写模板名称');
      return;
    }
    setBusy(true);
    try {
      await saveScoreTemplate(projectId, name.trim());
      toast.success('已保存为模板');
      setName('');
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '保存失败');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="存为评分模板"
      description="将当前项目的评分项与得分点保存为可复用模板。"
      size="sm"
      footer={
        <>
          <button onClick={handleClose} className="neu-btn-soft">
            取消
          </button>
          <button onClick={handleSave} disabled={busy} className="neu-btn-primary disabled:opacity-50">
            确认保存
          </button>
        </>
      }
    >
      <input
        type="text"
        autoFocus
        placeholder="模板名称（如：水务工程通用评分模板）"
        value={name}
        onChange={(e) => setName(e.target.value)}
        className="workbench-input w-full"
      />
    </Modal>
  );
}
