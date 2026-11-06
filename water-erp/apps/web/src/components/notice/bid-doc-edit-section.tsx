'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Upload } from 'lucide-react';
import { uploadBidDocument, updateBidDocumentConfig, confirmBidDocPayment, removeBidDocument } from '@/lib/api/announcement';
import type { BidDocumentManage } from '@/lib/api/announcement';
import { WaterBar } from '@/components/upload/water-bar';
import { getSupplierList } from '@/lib/api/supplier';
import type { Supplier } from '@/lib/types';
import { StatusBadge } from '@/components/workbench';
import { useConfirm } from '@/components/workbench/use-confirm';

/** 采购文件管理段（2026-11-06 自 notice/[id] 编辑页抽出共享）：
 *  采购公告（BID_NOTICE）与补遗公告（ADDENDUM 引用采购文件，2026-11-06 用户裁定）同链——
 *  加密上传 + 下载方式三卡（免费/解密/付费暂不支持）+ 邀请白名单 + 到账确认。
 *  ensureAnnId：新建页未保存草稿时按需自动建草稿再上传（附件/采购文件均不再要求先手工存草稿）。 */

/** 采购文件下载方式三卡（2026-11-05，与供应商邀请谈判配置同款设计）：
 *  免费 / 解密下载（随机 6 位密码，可刷新）/ 付费下载（暂不支持，禁用）。 */
export function DownloadModePicker({ mode, password, onMode, onPassword }: {
  mode: 'free' | 'encrypted';
  password: string;
  onMode: (m: 'free' | 'encrypted') => void;
  onPassword: (p: string) => void;
}) {
  const genPwd = () => String(Math.floor(100000 + Math.random() * 900000));
  const options = [
    { value: 'free' as const, label: '免费下载', desc: '供应商可直接下载' },
    { value: 'encrypted' as const, label: '解密下载', desc: '供应商需输入密码才能下载' },
  ];
  return (
    <div className="space-y-1.5">
      <div className="grid grid-cols-3 gap-1.5">
        {options.map(m => (
          <label key={m.value} className={`flex cursor-pointer items-start gap-1.5 rounded-lg px-2 py-2 transition ${mode === m.value ? 'ring-1 ring-[var(--accent)]/40' : ''}`}
            style={{ background: 'oklch(1 0 0 / 0.48)', boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.5)' }}>
            <input type="radio" name="bidDocDownloadMode" checked={mode === m.value}
              onChange={() => { onMode(m.value); if (m.value === 'encrypted' && !password) onPassword(genPwd()); }}
              className="accent-[var(--accent)] mt-0.5 shrink-0" />
            <span className="min-w-0">
              <span className="block text-[11px] font-semibold text-[var(--foreground)]">{m.label}</span>
              <span className="block text-[10px] leading-tight text-[var(--muted-foreground)]">{m.desc}</span>
            </span>
          </label>
        ))}
        <label className="flex cursor-not-allowed items-start gap-1.5 rounded-lg px-2 py-2 opacity-55"
          style={{ background: 'oklch(1 0 0 / 0.48)', boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.5)' }}>
          <input type="radio" disabled className="accent-[var(--accent)] mt-0.5 shrink-0" />
          <span className="min-w-0">
            <span className="block text-[11px] font-semibold text-[var(--muted-foreground)]">付费下载</span>
            <span className="block text-[10px] leading-tight text-[var(--muted-foreground)]">暂不支持</span>
          </span>
        </label>
      </div>
      {mode === 'encrypted' && (
        <div className="flex items-center gap-2 rounded-lg px-2.5 py-1.5" style={{ background: 'color-mix(in oklch, var(--accent) 8%, transparent)' }}>
          <span className="text-[11px] font-bold text-[var(--foreground)] shrink-0">下载密码</span>
          <code className="text-xs font-mono tabular-nums tracking-[0.15em] text-[var(--accent-strong)]">{password || '—'}</code>
          <span className="text-[10px] text-[var(--muted-foreground)]">请线下告知受邀供应商</span>
          <button type="button" onClick={() => onPassword(genPwd())} className="neu-btn-xs ml-auto">刷新</button>
        </div>
      )}
    </div>
  );
}

export function BidDocEditSection({ annId, bidDoc, onChanged, ensureAnnId, heading = '采购文件' }: {
  annId: string | null;
  bidDoc: BidDocumentManage | null;
  onChanged: () => void;
  /** annId 为空时调用以自动落草稿（新建页），返回公告 id；不可用返回 null */
  ensureAnnId?: () => Promise<string | null>;
  heading?: string;
}) {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [supplierSearch, setSupplierSearch] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [scope, setScope] = useState<"OPEN" | "INVITED">(bidDoc?.accessScope || "OPEN");
  const [dlMode, setDlMode] = useState<'free' | 'encrypted'>(bidDoc?.downloadMode === 'encrypted' ? 'encrypted' : 'free');
  const [dlPassword, setDlPassword] = useState(bidDoc?.downloadPassword || '');
  const [selected, setSelected] = useState<string[]>(bidDoc?.allowedSupplierIds || []);
  const [busy, setBusy] = useState(false);
  const [docUpPct, setDocUpPct] = useState<number | null>(null); // 采购文件加密上传字节进度（2026-11-06）
  const { confirm, dialog } = useConfirm();
  useEffect(() => { if (scope === "INVITED") getSupplierList({ status: "APPROVED", search: supplierSearch || undefined, pageSize: 50 }).then(r => setSuppliers(r.items)).catch(() => {}); }, [scope, supplierSearch]);
  // 外部配置刷新（onChanged 重拉 bidDoc）时回显下载方式
  useEffect(() => {
    setDlMode(bidDoc?.downloadMode === 'encrypted' ? 'encrypted' : 'free');
    if (bidDoc?.downloadPassword) setDlPassword(bidDoc.downloadPassword);
  }, [bidDoc?.downloadMode, bidDoc?.downloadPassword]);

  const doUpload = async () => {
    if (!file) { toast.error("请选择采购文件"); return; }
    if (dlMode === 'encrypted' && !dlPassword) { toast.error("解密下载需先设置下载密码"); return; }
    // 新建页未保存过草稿：先自动落草稿再上传（2026-11-06 附件/采购文件不再要求先手工存草稿）
    let targetId = annId;
    if (!targetId && ensureAnnId) targetId = await ensureAnnId();
    if (!targetId) { toast.error("请先保存草稿"); return; }
    setBusy(true);
    setDocUpPct(0);
    try {
      await uploadBidDocument(targetId, file, { title: file.name, accessScope: scope, requirePayment: false, allowedSupplierIds: scope === "INVITED" ? selected : undefined, downloadMode: dlMode, downloadPassword: dlMode === 'encrypted' ? dlPassword : undefined }, {
        onProgress: (l, t) => setDocUpPct(t > 0 ? Math.round((l / t) * 100) : 0),
      });
      toast.success("已加密上传"); setFile(null); setDocUpPct(null); onChanged();
    } catch (e: any) { toast.error(e?.message || "上传失败"); }
    finally { setBusy(false); setDocUpPct(null); }
  };
  const saveConfig = async () => {
    if (!bidDoc || !annId) return;
    if (dlMode === 'encrypted' && !dlPassword) { toast.error("解密下载需先设置下载密码"); return; }
    setBusy(true);
    try { await updateBidDocumentConfig(annId, { accessScope: scope, requirePayment: false, allowedSupplierIds: scope === "INVITED" ? selected : undefined, downloadMode: dlMode, downloadPassword: dlMode === 'encrypted' ? dlPassword : undefined }); toast.success("配置已保存"); onChanged(); }
    catch (e: any) { toast.error(e?.message || "保存失败"); }
    finally { setBusy(false); }
  };
  const confirmPay = async (id: string) => { if (!annId) return; try { await confirmBidDocPayment(annId, id); toast.success("已确认"); onChanged(); } catch (e: any) { toast.error(e?.message || "失败"); } };
  const removeDoc = async () => { if (!bidDoc || !annId || !(await confirm({ message: "删除？", danger: true }))) return; try { await removeBidDocument(annId); toast.success("已删除"); onChanged(); } catch (e: any) { toast.error(e?.message || "失败"); } };

  return (
    <div className="neu-table-card p-4 text-sm w-full max-w-[640px]">
      <span className="text-xs font-bold tracking-[0.06em] uppercase text-[var(--muted-foreground)]">{heading}</span>
      <span className="ml-2 text-[10px] text-[var(--muted-foreground)]">AES-256 加密</span>

      {bidDoc ? (
        /* 已上传状态 */
        <div className="mt-3 space-y-3">
          <div className="flex items-center justify-between rounded-[8px] bg-[var(--surface)] px-3 py-2 shadow-[inset_0_1px_0_oklch(1_0_0/0.5),1px_1px_2px_oklch(0.55_0.03_258/0.05),-1px_-1px_1px_oklch(1_0_0/0.6)]">
            <div className="min-w-0"><p className="break-words text-[0.85rem] font-bold text-[var(--foreground)] leading-snug">🔒 {bidDoc.title}</p><p className="text-[11px] text-[var(--muted-foreground)]">{bidDoc.fileName} · {(bidDoc.fileSize / 1024).toFixed(0)} KB · {bidDoc.downloadCount} 次</p></div>
            <button onClick={removeDoc} className="neu-btn-xs is-danger ml-2 shrink-0">删除</button>
          </div>
          <div className="space-y-1.5">
            <select value={scope} onChange={e => setScope(e.target.value as any)} className="neu-input text-sm"><option value="OPEN">公开</option><option value="INVITED">邀请</option></select>
            <DownloadModePicker mode={dlMode} password={dlPassword} onMode={setDlMode} onPassword={setDlPassword} />
          </div>
          {scope === "INVITED" && (
            <div>
              <div className="flex items-center justify-between mb-1"><span className="text-[11px] text-[var(--muted-foreground)]">已选 {selected.length} 家</span><input value={supplierSearch} onChange={e => setSupplierSearch(e.target.value)} placeholder="搜索供应商" className="neu-input !h-7 w-32 px-2 text-[11px]" /></div>
              <div className="max-h-32 overflow-y-auto rounded-lg bg-[var(--surface)] shadow-[inset_1px_1px_3px_oklch(0.55_0.03_258/0.08),inset_-1px_-1px_3px_oklch(1_0_0/0.5)]">
                {suppliers.map(s => (<label key={s.id} className="flex items-center gap-2 px-3 py-1.5 text-[0.8rem] hover:bg-[var(--muted)] cursor-pointer"><input type="checkbox" checked={selected.includes(s.id)} onChange={() => setSelected(prev => prev.includes(s.id) ? prev.filter(x => x !== s.id) : [...prev, s.id])} className="accent-[var(--accent)]" /><span className="text-[var(--foreground)] truncate">{s.name}</span></label>))}
              </div>
            </div>
          )}
          <button onClick={saveConfig} disabled={busy} className="neu-btn-soft w-full justify-center disabled:opacity-50">{busy ? "保存中..." : "保存配置"}</button>
          {bidDoc.accesses.length > 0 && (
            <div className="rounded-lg bg-[var(--surface)] p-2 shadow-[inset_0_1px_0_oklch(1_0_0/0.4),inset_1px_1px_3px_oklch(0.55_0.03_258/0.06),inset_-1px_-1px_3px_oklch(1_0_0/0.5)]">
              <span className="text-[10px] font-bold uppercase tracking-[0.06em] text-[var(--muted-foreground)]">到账确认</span>
              {bidDoc.accesses.map(a => (
                <div key={a.supplierId} className="flex items-center justify-between py-1 text-[0.8rem]">
                  <span className="truncate text-[var(--foreground)]">{a.supplierName}{a.paymentRef && <span className="ml-1 text-[var(--muted-foreground)]">凭证:{a.paymentRef}</span>}</span>
                  {bidDoc.requirePayment ? (a.paid ? <StatusBadge tone="green">已付</StatusBadge> : <button onClick={() => confirmPay(a.supplierId)} className="neu-btn-xs is-success">确认</button>) : <span className="text-[var(--muted-foreground)]">{a.downloadCount} 次</span>}
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        /* 上传表单 */
        <div className="mt-3 space-y-2.5">
          {/* 文件选择 - 虚线拖放区 */}
          <label className="neu-drop-zone">
            <Upload size={14} className="text-[var(--muted-foreground)] mb-1" />
            <span className="text-[0.75rem] font-medium text-[var(--muted-foreground)]">{file ? file.name : "选择采购文件"}</span>
            <span className="mt-0.5 text-[0.65rem] text-[var(--muted-foreground)]/60">{file ? `${(file.size / 1024).toFixed(0)} KB` : "点击浏览或拖拽上传（标题默认取文件名）"}</span>
            <input type="file" className="hidden" onChange={e => setFile(e.target.files?.[0] || null)} />
          </label>

          <div className="space-y-1.5">
            <select value={scope} onChange={e => setScope(e.target.value as any)} className="neu-input text-sm"><option value="OPEN">公开</option><option value="INVITED">邀请</option></select>
            <DownloadModePicker mode={dlMode} password={dlPassword} onMode={setDlMode} onPassword={setDlPassword} />
          </div>

          {scope === "INVITED" && (
            <div>
              <div className="flex items-center justify-between mb-1"><span className="text-[11px] text-[var(--muted-foreground)]">已选 {selected.length} 家</span><input value={supplierSearch} onChange={e => setSupplierSearch(e.target.value)} placeholder="搜索供应商" className="neu-input !h-7 w-32 px-2 text-[11px]" /></div>
              <div className="max-h-32 overflow-y-auto rounded-lg bg-[var(--surface)] shadow-[inset_1px_1px_3px_oklch(0.55_0.03_258/0.08),inset_-1px_-1px_3px_oklch(1_0_0/0.5)]">
                {suppliers.map(s => (<label key={s.id} className="flex items-center gap-2 px-3 py-1.5 text-[0.8rem] hover:bg-[var(--muted)] cursor-pointer"><input type="checkbox" checked={selected.includes(s.id)} onChange={() => setSelected(prev => prev.includes(s.id) ? prev.filter(x => x !== s.id) : [...prev, s.id])} className="accent-[var(--accent)]" /><span className="text-[var(--foreground)] truncate">{s.name}</span></label>))}
              </div>
            </div>
          )}

          <button onClick={doUpload} disabled={busy || !file} className="neu-btn-soft w-full justify-center disabled:opacity-40">{busy ? `加密上传中${docUpPct != null ? ` ${docUpPct}%` : '...'}` : "加密上传"}</button>
          {docUpPct != null && (
            <div className="flex items-center gap-2">
              <WaterBar pct={docUpPct} state="uploading" />
              <span className="shrink-0 font-mono text-[11px] font-bold tabular-nums text-[var(--accent)]">{docUpPct}%</span>
            </div>
          )}
        </div>
      )}
      {dialog}
    </div>
  );
}
