'use client';

import { useState } from 'react';
import { saveScoreTemplate } from '@/lib/api/bid';
import Dialog from '@/components/dialog';
import { toast } from 'sonner';

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
    } catch (e: any) {
      toast.error(e?.message || '保存失败');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      title="存为评分模板"
      width="max-w-sm"
      footer={
        <>
          <button
            onClick={handleClose}
            className="rounded-xl border border-[#dce6f3] px-4 py-2 text-xs font-bold text-[#5a6d8a] transition hover:bg-[#f8fafc]"
          >
            取消
          </button>
          <button
            onClick={handleSave}
            disabled={busy}
            className="rounded-xl bg-[#064ea2] px-4 py-2 text-xs font-bold text-white transition hover:bg-[#054280] disabled:opacity-50"
          >
            确认保存
          </button>
        </>
      }
    >
      <p className="mb-3 text-sm text-[#5a6d8a]">将当前项目的评分项与得分点保存为可复用模板。</p>
      <input
        type="text"
        autoFocus
        placeholder="模板名称（如：水务工程通用评分模板）"
        value={name}
        onChange={(e) => setName(e.target.value)}
        className="workbench-input w-full"
      />
    </Dialog>
  );
}
