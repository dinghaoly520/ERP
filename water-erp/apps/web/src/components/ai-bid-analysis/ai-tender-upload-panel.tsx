'use client';

import { useState } from 'react';
import { Upload, FileText, Loader2, Trash2, RefreshCw, Plus, Star } from 'lucide-react';
import { aiBidAnalysisApi } from '@/lib/api/ai-bid-analysis';
import type { AiBidAnalysisTask, AiTenderFile } from '@/lib/types/ai-bid-analysis';
import AiStagePanel from './ai-stage-panel';
import AiStatusBadge, { type AiStatusBadgeTone } from './ai-status-badge';

interface AiTenderUploadPanelProps {
  taskId: string;
  task: AiBidAnalysisTask;
  onChanged: () => void;
}

function getTenderFileStatus(file: AiTenderFile, task: AiBidAnalysisTask, isProcessing: boolean): { tone: AiStatusBadgeTone; label: string; pulse?: boolean } {
  const isParsed = file.isMain ? Boolean(task.requirements) : Boolean(file.text);
  if (isParsed) return { tone: 'ready', label: '已解析' };
  if (isProcessing) return { tone: 'processing', label: '处理中', pulse: true };
  // Task has been through processing but file still not parsed → parse failure
  const hasBeenProcessed = !['CREATED', 'TENDER_UPLOADING'].includes(task.status);
  if (hasBeenProcessed) return { tone: 'danger', label: '解析失败' };
  // File uploaded, waiting for analysis to start
  return { tone: 'info', label: '已上传' };
}

function getTenderFileRowClasses(tone: AiStatusBadgeTone, isMain: boolean) {
  if (tone === 'danger') return 'border-rose-200 bg-rose-50/80';
  if (isMain) return 'border-blue-200 bg-blue-50/80';
  return 'border-slate-200/80 bg-white/80';
}

export default function AiTenderUploadPanel({ taskId, task, onChanged }: AiTenderUploadPanelProps) {
  const [uploading, setUploading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [reparsingId, setReparsingId] = useState<string | null>(null);
  const [settingMainId, setSettingMainId] = useState<string | null>(null);

  const tenderFiles = task.tenderFiles || [];
  const hasMainFile = tenderFiles.some(f => f.isMain);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      await aiBidAnalysisApi.uploadTenderFile(taskId, file);
      onChanged();
    } catch (err) {
      console.error('上传招标文件失败:', err);
      alert('上传失败: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (fileId: string) => {
    if (!confirm('确定要删除此文件吗？')) return;
    setDeletingId(fileId);
    try {
      await aiBidAnalysisApi.deleteTenderFile(taskId, fileId);
      onChanged();
    } catch (err) {
      console.error('删除招标文件失败:', err);
      alert('删除失败: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setDeletingId(null);
    }
  };

  const handleReparse = async (fileId: string) => {
    setReparsingId(fileId);
    try {
      await aiBidAnalysisApi.reparseTenderFile(taskId, fileId);
      onChanged();
    } catch (err) {
      console.error('重新解析招标文件失败:', err);
      alert('重新解析失败: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setReparsingId(null);
    }
  };

  const handleSetMain = async (fileId: string) => {
    setSettingMainId(fileId);
    try {
      await aiBidAnalysisApi.setMainTenderFile(taskId, fileId);
      onChanged();
    } catch (err) {
      console.error('设置主文件失败:', err);
      alert('设置失败: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setSettingMainId(null);
    }
  };

  const reqStats = task.requirements ? {
    qualification: task.requirements.qualificationRequirements?.length || 0,
    technical: task.requirements.technicalRequirements?.length || 0,
    commercial: task.requirements.commercialRequirements?.length || 0,
  } : null;

  const isProcessing = task.status === 'TENDER_PROCESSING';

  return (
    <AiStagePanel
      title="招标资料"
      description="上传主文件与补充资料，用于提取资格、技术、商务与报价要求。"
      tone="blue"
      action={
        <div className="flex items-center gap-2">
          <input type="file" accept=".pdf,.doc,.docx" onChange={handleUpload} disabled={uploading} className="hidden" id="tender-upload-btn" />
          <label
            htmlFor="tender-upload-btn"
            className={`inline-flex cursor-pointer items-center gap-2 rounded-xl border border-blue-100 bg-blue-600 px-3 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-blue-700 ${uploading ? 'pointer-events-none opacity-60' : ''}`}
          >
            {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            {uploading ? '上传中...' : hasMainFile ? '补充文件' : '上传主文件'}
          </label>
        </div>
      }
    >
      {tenderFiles.length === 0 ? (
        <div className="rounded-[18px] border-2 border-dashed border-blue-200 bg-blue-50/60 p-8 text-center">
          <label htmlFor="tender-upload-btn" className="flex cursor-pointer flex-col items-center gap-3">
            <div className="rounded-2xl bg-white p-4 text-blue-600 shadow-sm">
              <Upload className="h-8 w-8" />
            </div>
            <div>
              <div className="text-base font-semibold text-slate-900">上传招标主文件</div>
              <p className="mt-1 text-sm text-slate-600">支持 PDF / DOC / DOCX，上传后系统会提取评分与资格要求。</p>
            </div>
          </label>
        </div>
      ) : (
        <div className="space-y-3">
          {tenderFiles.map((file) => {
            const status = getTenderFileStatus(file, task, isProcessing);
            const isMain = file.isMain;
            const parseFailed = status.tone === 'danger';

            return (
              <div key={file.id} className={`group rounded-2xl border p-4 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_16px_35px_rgba(15,23,42,0.08)] ${getTenderFileRowClasses(status.tone, isMain)}`}>
                <div className="flex items-start gap-3">
                  <div className="rounded-2xl bg-white p-2 text-blue-600 shadow-sm">
                    <FileText className="h-5 w-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate font-medium text-slate-900">{file.fileName}</span>
                      {isMain && <AiStatusBadge tone="info">主文件</AiStatusBadge>}
                      <AiStatusBadge tone={status.tone} pulse={status.pulse}>{status.label}</AiStatusBadge>
                    </div>
                    <p className="mt-1 text-xs text-slate-500">{isMain ? '用于生成核心招标要求' : '补充资料将参与文本解析与要求提取'}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    {!isMain && (
                      <button onClick={() => handleSetMain(file.id)} disabled={settingMainId === file.id} className="rounded-xl p-2 text-blue-500 transition-colors hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-50" title="设为主文件">
                        {settingMainId === file.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Star className="h-4 w-4" />}
                      </button>
                    )}
                    {parseFailed && (
                      <button onClick={() => handleReparse(file.id)} disabled={reparsingId === file.id} className="rounded-xl p-2 text-amber-500 transition-colors hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50" title="重新解析">
                        {reparsingId === file.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                      </button>
                    )}
                    <button onClick={() => handleDelete(file.id)} disabled={deletingId === file.id || isProcessing} className="rounded-xl p-2 text-rose-500 transition-colors hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-50" title="删除文件">
                      {deletingId === file.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}

          {reqStats && (
            <div className="grid gap-2 pt-1 text-xs text-slate-600 sm:grid-cols-3">
              <div className="rounded-xl bg-white/75 px-3 py-2">资质要求：<strong>{reqStats.qualification}</strong> 项</div>
              <div className="rounded-xl bg-white/75 px-3 py-2">技术要求：<strong>{reqStats.technical}</strong> 项</div>
              <div className="rounded-xl bg-white/75 px-3 py-2">商务要求：<strong>{reqStats.commercial}</strong> 项</div>
            </div>
          )}
        </div>
      )}
    </AiStagePanel>
  );
}
