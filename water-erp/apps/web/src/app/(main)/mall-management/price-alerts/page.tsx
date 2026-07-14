'use client';

import { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { Bell, BellOff, Check, Plus, X, RefreshCw } from 'lucide-react';

interface AlertRule { id: number; name: string; alertType: string; threshold: number; enabled: boolean; category?: { id: number; name: string } | null; }
interface AlertRecord { id: number; message: string; alertType: string; triggerValue: number; isRead: boolean; isResolved: boolean; createdAt: string; catalogItem?: { code: string; name: string } | null; rule?: { name: string } | null; }

const ALERT_TYPE_LABELS: Record<string, string> = { PRICE_SURGE: '涨幅预警', PRICE_DROP: '跌幅预警', EXPIRING: '即将过期', DEVIATION: '偏离均值' };

async function fetchJSON<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { credentials: 'include', headers: init?.body ? { 'Content-Type': 'application/json' } : {}, ...init });
  if (!res.ok) { const d = await res.json().catch(() => null); throw new Error(d?.error || '请求失败'); }
  return res.json();
}

export default function PriceAlertsPage() {
  const [tab, setTab] = useState<'rules' | 'alerts'>('rules');
  const [rules, setRules] = useState<AlertRule[]>([]);
  const [alerts, setAlerts] = useState<AlertRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const loadRules = async () => {
    try { setRules(await fetchJSON<AlertRule[]>('/api/catalog/admin/alert-rules')); } catch (e: any) { toast.error(e.message); }
  };
  const loadAlerts = async () => {
    try { setAlerts(await fetchJSON<AlertRecord[]>('/api/catalog/admin/alerts')); } catch (e: any) { toast.error(e.message); }
  };

  useEffect(() => { setLoading(true); (tab === 'rules' ? loadRules() : loadAlerts()).finally(() => setLoading(false)); }, [tab]);

  const toggleRule = async (rule: AlertRule) => {
    try { await fetchJSON(`/api/catalog/admin/alert-rules/${rule.id}/toggle`, { method: 'PATCH' }); loadRules(); } catch (e: any) { toast.error(e.message); }
  };
  const deleteRule = async (id: number) => { if (!confirm('确认删除此规则？')) return; try { await fetchJSON(`/api/catalog/admin/alert-rules/${id}`, { method: 'DELETE' }); loadRules(); } catch (e: any) { toast.error(e.message); } };

  return (
    <div className="flex flex-col gap-5">
      <div className="page-hero">
        <div className="page-hero__row">
          <div className="page-hero__left">
            <div className="page-hero__icon"><Bell size={17} /></div>
            <div><div className="page-hero__title">价格预警</div><div className="page-hero__sub">配置价格预警规则，查看触发的预警记录</div></div>
          </div>
        </div>
      </div>
      <div className="neu-tab-bar">
        <button onClick={() => setTab('rules')} className={`neu-tab ${tab === 'rules' ? 'is-active' : ''}`}>预警规则</button>
        <button onClick={() => setTab('alerts')} className={`neu-tab ${tab === 'alerts' ? 'is-active' : ''}`}>预警记录</button>
      </div>
      {loading ? <div className="flex items-center justify-center py-16"><RefreshCw size={24} className="animate-spin text-[var(--muted-foreground)]" /></div>
        : tab === 'rules' ? (
          <div className="neu-card rounded-2xl">
            <div className="p-4 border-b border-[var(--border-color)] flex items-center justify-between">
              <span className="text-sm font-semibold text-[var(--foreground)]">预警规则</span>
              <button className="neu-btn-xs is-success"><Plus size={14} /> 新增</button>
            </div>
            <div className="overflow-x-auto">
              <table className="neu-table w-full">
                <thead><tr><th>规则名称</th><th className="text-center">预警类型</th><th className="text-center">阈值</th><th className="text-center">适用品类</th><th className="text-center">状态</th><th className="text-center">操作</th></tr></thead>
                <tbody>
                  {rules.length === 0 ? <tr><td colSpan={6} className="text-center py-8 text-sm text-[var(--muted-foreground)]">暂无预警规则</td></tr>
                    : rules.map(r => (
                      <tr key={r.id}>
                        <td className="font-medium">{r.name}</td>
                        <td className="text-center"><span className="text-xs px-2 py-0.5 rounded bg-[rgba(96,139,239,0.1)] text-[var(--accent)]">{ALERT_TYPE_LABELS[r.alertType] || r.alertType}</span></td>
                        <td className="text-center tabular-nums font-mono">{r.alertType === 'EXPIRING' ? `${r.threshold}天` : `${r.threshold}%`}</td>
                        <td className="text-center text-sm text-[var(--muted-foreground)]">{r.category?.name || '全部品类'}</td>
                        <td className="text-center">{r.enabled ? <span className="text-green-600 text-xs font-semibold">启用</span> : <span className="text-gray-400 text-xs">停用</span>}</td>
                        <td className="text-center">
                          <button onClick={() => toggleRule(r)} className="neu-btn-xs">{r.enabled ? <BellOff size={12} /> : <Bell size={12} />}</button>
                          <button onClick={() => deleteRule(r.id)} className="neu-btn-xs is-warning ml-1"><X size={12} /></button>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <div className="neu-card rounded-2xl">
            <div className="overflow-x-auto">
              <table className="neu-table w-full">
                <thead><tr><th>时间</th><th>目录项</th><th>预警规则</th><th>预警消息</th><th className="text-center">触发值</th><th className="text-center">状态</th></tr></thead>
                <tbody>
                  {alerts.length === 0 ? <tr><td colSpan={6} className="text-center py-8 text-sm text-[var(--muted-foreground)]">暂无预警记录</td></tr>
                    : alerts.map(a => (
                      <tr key={a.id} className={a.isRead ? '' : 'bg-[rgba(96,139,239,0.04)]'}>
                        <td className="text-xs text-[var(--muted-foreground)]">{new Date(a.createdAt).toLocaleString('zh-CN')}</td>
                        <td><span className="font-medium">{a.catalogItem?.name || '—'}</span><div className="text-[10px] font-mono text-[var(--accent)]">{a.catalogItem?.code}</div></td>
                        <td className="text-xs">{a.rule?.name || '—'}</td>
                        <td className="text-sm">{a.message}</td>
                        <td className="text-center tabular-nums font-mono text-sm">{a.triggerValue}</td>
                        <td className="text-center">{a.isResolved ? <Check size={14} className="text-green-500 inline" /> : <span className="text-xs text-orange-500">待处理</span>}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
    </div>
  );
}
