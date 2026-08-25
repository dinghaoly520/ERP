'use client';

import { useEffect, useState } from 'react';
import { FileSignature, Printer, Upload, ClipboardCheck, CheckCircle2 } from 'lucide-react';
import {
  getOpeningSignStatus, generateOpeningSignPage, uploadOpeningSignScan, registerOpeningSign,
  type OpeningSignStatus,
} from '@/lib/api/bid';

/** P1-3①A：开标记录签字块——生成签字页 → 打印签字 → 扫描回传 → 登记闭环（进开标文件包哈希链）。
 * 显示条件：完成开标（handoverAt 存在）后。 */
export function OpeningSignBlock({ projectId }: { projectId: string }) {
  const [status, setStatus] = useState<OpeningSignStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const refresh = async () => {
    try { setStatus(await getOpeningSignStatus(projectId)); } catch { /* 静默 */ }
  };
  useEffect(() => { void refresh(); }, [projectId]);

  if (!status?.hasSession) return null;
  const registered = !!status.registeredAt;

  const onGenerate = async () => {
    setBusy(true); setMsg('');
    try {
      const r = await generateOpeningSignPage(projectId);
      setMsg(`签字页已生成（sha256=${r.sha256.slice(0, 12)}…），请下载打印`);
      window.open(r.downloadUrl, '_blank');
    } catch (e: any) { setMsg(e?.response?.data?.error || '生成失败'); }
    finally { setBusy(false); }
  };

  const onUpload = (role: 'host' | 'supervisor') => {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = 'application/pdf,image/*';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      setBusy(true); setMsg('');
      try {
        await uploadOpeningSignScan(projectId, role, file);
        setMsg(`${role === 'host' ? '主持人' : '监督人'}扫描已上传`);
        await refresh();
      } catch (e: any) { setMsg(e?.response?.data?.error || '上传失败'); }
      finally { setBusy(false); }
    };
    input.click();
  };

  const onRegister = async () => {
    setBusy(true); setMsg('');
    try {
      const r = await registerOpeningSign(projectId);
      setMsg(r.alreadyRegistered ? '此前已登记' : `签字登记闭环（包 sha256=${(r.packageSha256 ?? '').slice(0, 12)}…）`);
      await refresh();
    } catch (e: any) { setMsg(e?.response?.data?.error || '登记失败'); }
    finally { setBusy(false); }
  };

  return (
    <div className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--card)] p-4">
      <div className="mb-2 flex items-center gap-2">
        <FileSignature size={16} strokeWidth={1.5} className="text-[var(--primary)]" />
        <h3 className="text-sm font-semibold text-[color:var(--foreground)]">开标记录签字（办法第32条）</h3>
        {registered && (
          <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-[oklch(0.71_0.11_164_/_0.15)] px-2 py-0.5 text-[11px] font-semibold text-[oklch(0.45_0.1_155)]">
            <CheckCircle2 size={12} /> 已登记 {new Date(status.registeredAt!).toLocaleString('zh-CN')}
          </span>
        )}
      </div>
      <p className="mb-3 text-xs text-[color:var(--muted-foreground)]">
        纸面签字过渡方案：生成签字页 → 打印 → 主持人{status.supervisor ? '/监督人' : ''}手写签字 → 扫描回传 → 登记闭环（扫描件哈希进开标文件包）。
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={onGenerate} disabled={busy || registered} className="neu-btn-soft !h-[34px] !text-xs">
          <Printer size={13} /> 生成/下载签字页
        </button>
        <button type="button" onClick={() => onUpload('host')} disabled={busy || registered} className="neu-btn-soft !h-[34px] !text-xs">
          <Upload size={13} /> 主持人扫描{status.hostScanUploaded ? '✓' : ''}
        </button>
        {status.supervisor && (
          <button type="button" onClick={() => onUpload('supervisor')} disabled={busy || registered} className="neu-btn-soft !h-[34px] !text-xs">
            <Upload size={13} /> 监督人扫描{status.supervisorScanUploaded ? '✓' : ''}
          </button>
        )}
        <button type="button" onClick={onRegister} disabled={busy || registered || !status.hostScanUploaded} className="neu-btn-primary !h-[34px] !text-xs">
          <ClipboardCheck size={13} /> 登记闭环
        </button>
      </div>
      {msg && <p className="mt-2 text-xs text-[color:var(--muted-foreground)]">{msg}</p>}
    </div>
  );
}
