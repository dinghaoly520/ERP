'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { saveScoreTemplate } from '@/lib/api/bid';
import { Modal } from '@/components/workbench';

interface Props {
  open: boolean;
  onClose: () => void;
  projectId: string;
  /** A-147：当前项目维度（宿主传入，与保存时服务端快照同源）；仅作只读提示，不参与提交 */
  procurementMethod?: string;
  projectCategory?: string;
}

export function SaveTemplateDialog({ open, onClose, projectId, procurementMethod, projectCategory }: Props) {
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
      {/* A-147：维度由服务端保存时自动快照（防篡改，用户不可改），此处仅只读提示 */}
      <p className="mt-3 text-xs leading-relaxed text-[#8a96aa]">
        保存时将自动记录维度：采购方式 {procurementMethod || '—'} · 项目类型 {projectCategory || '—'}
        <br />
        （通用模板可跨项目复用；应用端不按维度硬拦）
      </p>
    </Modal>
  );
}
