'use client';

import { useEffect, useState } from 'react';
import { FileSignature, Printer, Upload } from 'lucide-react';
import {
  getOpeningSignStatus, generateOpeningSignPage, uploadOpeningSignScan, registerOpeningSign,
  type OpeningSignStatus,
} from '@/lib/api/bid';

/** P1-3①A：开标记录签字卡——唯一入口在「评标签字」tab（评标结束一次性打印、一次签完的运营口径）。
 * 未闭环才显示；扫描件到齐（主持人+监督人如有）自动登记并入包存档，无需手动「完成登记」。 */
export function OpeningSignBlock({ projectId }: { projectId: string }) {
  const [status, setStatus] = useState<OpeningSignStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const refresh = async (): Promise<OpeningSignStatus | null> => {
    try {
      const s = await getOpeningSignStatus(projectId);
      setStatus(s);
      return s;
    } catch { return null; }
  };
  useEffect(() => { void refresh(); }, [projectId]);

  if (!status?.hasSession) return null;
  const registered = !!status.registeredAt;
  if (registered) return null;

  const onGenerate = async () => {
    setBusy(true); setMsg('');
    try {
      const r = await generateOpeningSignPage(projectId);
      setMsg(`签字页已生成（校验码 ${r.sha256.slice(0, 8)}），请下载打印`);
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
      const label = role === 'host' ? '主持人' : '监督人';
      try {
        await uploadOpeningSignScan(projectId, role, file);
        const s = await refresh();
        // 到齐即自动登记（无监督人：主持人件即齐；有监督人：两者齐）——登记幂等，失败不丢上传态
        if (s?.hostScanUploaded && (!s.supervisor || s.supervisorScanUploaded)) {
          try {
            await registerOpeningSign(projectId);
            setMsg(`${label}签字已上传，登记完成，开标文件包已更新`);
          } catch (e: any) {
            setMsg(`${label}签字已上传；自动登记失败：${e?.response?.data?.error || e?.message || '请稍后重试'}`);
          }
          await refresh();
        } else {
          setMsg(`${label}签字已上传，等待监督人签字上传后自动登记`);
        }
      } catch (e: any) { setMsg(e?.response?.data?.error || '上传失败'); }
      finally { setBusy(false); }
    };
    input.click();
  };

  return (
    <div className="neu-card-static p-4">
      <div className="mb-2 flex items-center gap-2">
        <FileSignature size={16} strokeWidth={1.5} className="text-[var(--accent-strong)]" />
        <h3 className="text-sm font-semibold text-[color:var(--foreground)]">开标记录签字（办法第32条）</h3>
      </div>
      <p className="mb-3 text-xs text-[color:var(--muted-foreground)]">
        开标记录待签署。签字页可与评标签字包一并打印；扫描件在此上传，到齐后自动登记存档。
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={onGenerate} disabled={busy} className="neu-btn-soft !h-[34px] !text-xs">
          <Printer size={13} /> 下载签字页
        </button>
        <button type="button" onClick={() => onUpload('host')} disabled={busy} className="neu-btn-soft !h-[34px] !text-xs">
          <Upload size={13} /> 上传主持人签字{status.hostScanUploaded ? '✓' : ''}
        </button>
        {status.supervisor && (
          <button type="button" onClick={() => onUpload('supervisor')} disabled={busy} className="neu-btn-soft !h-[34px] !text-xs">
            <Upload size={13} /> 上传监督人签字{status.supervisorScanUploaded ? '✓' : ''}
          </button>
        )}
      </div>
      {msg && <p className="mt-2 text-xs text-[color:var(--muted-foreground)]">{msg}</p>}
    </div>
  );
}
