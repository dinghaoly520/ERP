'use client';

import { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { Archive, Plus, RefreshCw, GitCompare } from 'lucide-react';

interface CatalogVersion { id: number; name: string; version: string; effectiveAt: string; status: string; description?: string | null; createdAt: string; user?: { username: string; displayName: string } }
interface VersionDiff { versionA: string; versionB: string; added: any[]; removed: any[]; priceChanges: any[] }

async function fetchJSON<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { credentials: 'include', headers: init?.body ? { 'Content-Type': 'application/json' } : {}, ...init });
  if (!res.ok) { const d = await res.json().catch(() => null); throw new Error(d?.error || '请求失败'); }
  return res.json();
}

export default function VersionsPage() {
  const [versions, setVersions] = useState<CatalogVersion[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: '', version: '', effectiveAt: '', description: '' });
  const [diffA, setDiffA] = useState<number | null>(null);
  const [diffB, setDiffB] = useState<number | null>(null);
  const [diff, setDiff] = useState<VersionDiff | null>(null);
  const [saving, setSaving] = useState(false);

  const load = async () => { setLoading(true); try { setVersions(await fetchJSON<CatalogVersion[]>('/api/catalog/admin/versions')); } catch (e: any) { toast.error(e.message); } finally { setLoading(false); } };
  useEffect(() => { load(); }, []);

  const createVersion = async () => {
    if (!form.name || !form.version) { toast.error('请填写版本名称和版本号'); return; }
    setSaving(true);
    try { await fetchJSON('/api/catalog/admin/versions', { method: 'POST', body: JSON.stringify(form) }); toast.success('版本快照已创建'); setShowCreate(false); setForm({ name: '', version: '', effectiveAt: '', description: '' }); load(); }
    catch (e: any) { toast.error(e.message); } finally { setSaving(false); }
  };

  const changeStatus = async (id: number, status: string) => {
    try { await fetchJSON(`/api/catalog/admin/versions/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }); toast.success('状态已更新'); load(); }
    catch (e: any) { toast.error(e.message); }
  };

  const compare = async () => {
    if (!diffA || !diffB) return;
    try { setDiff(await fetchJSON<VersionDiff>(`/api/catalog/admin/versions/compare?a=${diffA}&b=${diffB}`)); } catch (e: any) { toast.error(e.message); }
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="page-hero">
        <div className="page-hero__row">
          <div className="page-hero__left"><div className="page-hero__icon"><Archive size={17} /></div>
            <div><div className="page-hero__title">目录版本</div><div className="page-hero__sub">管理年度目录版本快照，支持版本对比分析</div></div></div>
          <button onClick={() => setShowCreate(true)} className="neu-btn is-info"><Plus size={16} /> 创建版本</button>
        </div>
      </div>

      {showCreate && (
        <div className="neu-card rounded-2xl p-5">
          <h3 className="text-sm font-semibold mb-4">创建目录版本快照</h3>
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
            <div><label className="text-xs font-medium text-[var(--muted-foreground)]">版本名称</label><input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} className="neu-input w-full text-sm" placeholder="2026年度采购目录" /></div>
            <div><label className="text-xs font-medium text-[var(--muted-foreground)]">版本号</label><input value={form.version} onChange={e => setForm(p => ({ ...p, version: e.target.value }))} className="neu-input w-full text-sm" placeholder="v2026.1" /></div>
            <div><label className="text-xs font-medium text-[var(--muted-foreground)]">生效日期</label><input type="date" value={form.effectiveAt} onChange={e => setForm(p => ({ ...p, effectiveAt: e.target.value }))} className="neu-input w-full text-sm" /></div>
            <div><label className="text-xs font-medium text-[var(--muted-foreground)]">备注</label><input value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} className="neu-input w-full text-sm" placeholder="可选" /></div>
          </div>
          <div className="flex justify-end gap-2 mt-4">
            <button onClick={() => setShowCreate(false)} className="neu-btn-xs">取消</button>
            <button onClick={createVersion} disabled={saving} className="neu-btn-xs is-success">{saving ? '创建中...' : '创建快照'}</button>
          </div>
        </div>
      )}

      {loading ? <div className="flex items-center justify-center py-16"><RefreshCw size={24} className="animate-spin text-[var(--muted-foreground)]" /></div>
        : versions.length === 0 ? <div className="flex items-center justify-center py-16 text-sm text-[var(--muted-foreground)]">暂无版本记录，点击创建版本生成快照</div>
        : <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {versions.map(v => (
            <div key={v.id} className="neu-card rounded-2xl p-4 flex flex-col gap-2">
              <div className="flex items-center justify-between"><span className="text-sm font-bold text-[var(--foreground)]">{v.name}</span><span className={`text-[10px] px-2 py-0.5 rounded-full ${v.status === 'ACTIVE' ? 'bg-green-100 text-green-700' : v.status === 'ARCHIVED' ? 'bg-gray-100 text-gray-500' : 'bg-blue-100 text-blue-700'}`}>{v.status === 'ACTIVE' ? '生效' : v.status === 'ARCHIVED' ? '归档' : '草稿'}</span></div>
              <code className="text-xs font-mono text-[var(--accent)]">{v.version}</code>
              <div className="text-xs text-[var(--muted-foreground)]">{v.effectiveAt?.slice(0, 10)} · {v.user?.displayName || v.user?.username}</div>
              {v.description && <p className="text-xs text-[var(--muted-foreground)]">{v.description}</p>}
              <div className="flex gap-1 mt-auto pt-2">
                <button onClick={() => setDiffA(diffA === v.id ? null : v.id)} className={`neu-btn-xs ${diffA === v.id ? 'is-active' : ''}`}>A</button>
                <button onClick={() => setDiffB(diffB === v.id ? null : v.id)} className={`neu-btn-xs ${diffB === v.id ? 'is-active' : ''}`}>B</button>
                {v.status !== 'ACTIVE' && <button onClick={() => changeStatus(v.id, 'ACTIVE')} className="neu-btn-xs is-success ml-auto">生效</button>}
                {v.status !== 'ARCHIVED' && <button onClick={() => changeStatus(v.id, 'ARCHIVED')} className="neu-btn-xs ml-auto">归档</button>}
              </div>
            </div>
          ))}
        </div>}

      {(diffA && diffB) && (
        <div className="flex justify-center"><button onClick={compare} className="neu-btn is-info"><GitCompare size={16} /> 对比版本 A vs B</button></div>
      )}

      {diff && (
        <div className="neu-card rounded-2xl p-5">
          <h3 className="text-sm font-bold text-[var(--foreground)] mb-3">版本对比：{diff.versionA} → {diff.versionB}</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
            <div className="p-3 rounded-xl bg-green-50"><span className="font-semibold text-green-700">新增 {diff.added.length} 项</span><div className="mt-1 max-h-40 overflow-y-auto">{diff.added.map((i: any) => <div key={i.code} className="text-xs mt-0.5 font-mono">{i.code} {i.name}</div>)}</div></div>
            <div className="p-3 rounded-xl bg-red-50"><span className="font-semibold text-red-700">下架 {diff.removed.length} 项</span><div className="mt-1 max-h-40 overflow-y-auto">{diff.removed.map((i: any) => <div key={i.code} className="text-xs mt-0.5 font-mono">{i.code} {i.name}</div>)}</div></div>
            <div className="p-3 rounded-xl bg-orange-50"><span className="font-semibold text-orange-700">价格变化 {diff.priceChanges.length} 项</span><div className="mt-1 max-h-40 overflow-y-auto">{diff.priceChanges.map((i: any) => <div key={i.code} className="text-xs mt-0.5 font-mono">{i.code} ¥{i.oldPrice}→¥{i.referencePrice}</div>)}</div></div>
          </div>
        </div>
      )}
    </div>
  );
}
