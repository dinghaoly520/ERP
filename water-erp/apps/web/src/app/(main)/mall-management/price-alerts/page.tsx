'use client';

import { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { Bell, BellOff, Check, Plus, X, RefreshCw, PenLine } from 'lucide-react';
import { listAlertRules, listAlerts, createAlertRule, updateAlertRule, deleteAlertRule, toggleAlertRule, type AlertRule, type AlertRecord } from '@/lib/api/catalog-admin';
import { confirmDialog, ConfirmHost } from '@/components/catalog/confirm-dialog';

const ALERT_TYPE_LABELS: Record<string, string> = { PRICE_SURGE: '涨幅预警', PRICE_DROP: '跌幅预警', EXPIRING: '即将过期', DEVIATION: '偏离均值' };

export default function PriceAlertsPage() {
  const [tab, setTab] = useState<'rules' | 'alerts'>('rules');
  const [rules, setRules] = useState<AlertRule[]>([]);
  const [alerts, setAlerts] = useState<AlertRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [ruleForm, setRuleForm] = useState<{ name: string; alertType: string; threshold: number } | null>(null);
  const [editingRule, setEditingRule] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  const loadRules = async () => {
    try { setRules(await listAlertRules()); } catch (e: any) { toast.error(e.message); }
  };
  const loadAlerts = async () => {
    try { setAlerts(await listAlerts()); } catch (e: any) { toast.error(e.message); }
  };

  useEffect(() => { setLoading(true); (tab === 'rules' ? loadRules() : loadAlerts()).finally(() => setLoading(false)); }, [tab]);

  const saveRule = async () => {
    if (!ruleForm) return;
    if (!ruleForm.name.trim()) { toast.error('请填写规则名称'); return; }
    setSaving(true);
    try {
      if (editingRule) await updateAlertRule(editingRule, ruleForm);
      else await createAlertRule(ruleForm);
      toast.success(editingRule ? '规则已更新' : '规则已创建');
      setRuleForm(null); setEditingRule(null); loadRules();
    } catch (e: any) { toast.error(e.message); } finally { setSaving(false); }
  };

  const doToggleRule = async (rule: AlertRule) => {
    try { await toggleAlertRule(rule.id); loadRules(); } catch (e: any) { toast.error(e.message); }
  };
  const doDeleteRule = async (id: number) => { if (!(await confirmDialog({ message: '确认删除此预警规则？', danger: true, confirmText: '删除' }))) return; try { await deleteAlertRule(id); loadRules(); } catch (e: any) { toast.error(e.message); } };

  return (
    <div className="flex flex-col gap-5">
      <ConfirmHost />
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
              <button onClick={() => { setRuleForm({ name: '', alertType: 'PRICE_SURGE', threshold: 10 }); setEditingRule(null); }} className="neu-btn-xs is-info"><Plus size={14} /> 新增</button>
            </div>
            {ruleForm && (
              <div className="p-4 border-b border-[var(--border-color)]">
                <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                  <div className="sm:col-span-2">
                    <label className="text-xs font-medium text-[var(--muted-foreground)] block mb-1">规则名称</label>
                    <input value={ruleForm.name} onChange={e => setRuleForm({ ...ruleForm, name: e.target.value })} placeholder="如：钢材涨幅监控" className="neu-input w-full text-sm" />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-[var(--muted-foreground)] block mb-1">预警类型</label>
                    <select value={ruleForm.alertType} onChange={e => setRuleForm({ ...ruleForm, alertType: e.target.value })} className="neu-input w-full text-sm">
                      {Object.entries(ALERT_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs font-medium text-[var(--muted-foreground)] block mb-1">阈值{ruleForm.alertType === 'EXPIRING' ? '（天）' : '（%）'}</label>
                    <input type="number" value={ruleForm.threshold} onChange={e => setRuleForm({ ...ruleForm, threshold: Number(e.target.value) })} className="neu-input w-full text-sm" />
                  </div>
                </div>
                <div className="flex justify-end gap-2 mt-3">
                  <button onClick={() => { setRuleForm(null); setEditingRule(null); }} className="neu-btn-xs">取消</button>
                  <button onClick={saveRule} disabled={saving} className="neu-btn-xs is-success">{saving ? '保存中...' : '保存'}</button>
                </div>
              </div>
            )}
            <div className="overflow-x-auto">
              <table className="neu-table w-full">
                <thead><tr><th>规则名称</th><th className="text-center">预警类型</th><th className="text-center">阈值</th><th className="text-center">适用品类</th><th className="text-center">状态</th><th className="text-center">操作</th></tr></thead>
                <tbody>
                  {rules.length === 0 ? <tr><td colSpan={6} className="text-center py-8 text-sm text-[var(--muted-foreground)]">暂无预警规则</td></tr>
                    : rules.map(r => (
                      <tr key={r.id}>
                        <td className="font-medium">{r.name}</td>
                        <td className="text-center"><span className="text-xs px-2 py-0.5 rounded bg-[var(--accent-tint-strong)] text-[var(--accent)]">{ALERT_TYPE_LABELS[r.alertType] || r.alertType}</span></td>
                        <td className="text-center tabular-nums font-mono">{r.alertType === 'EXPIRING' ? `${r.threshold}天` : `${r.threshold}%`}</td>
                        <td className="text-center text-sm text-[var(--muted-foreground)]">{r.category?.name || '全部品类'}</td>
                        <td className="text-center">{r.enabled ? <span className="text-[var(--success)] text-xs font-semibold">启用</span> : <span className="text-[var(--muted-foreground)] text-xs">停用</span>}</td>
                        <td className="text-center">
                          <button onClick={() => doToggleRule(r)} aria-label="切换规则状态" className="neu-btn-xs">{r.enabled ? <BellOff size={12} /> : <Bell size={12} />}</button>
                          <button onClick={() => { setRuleForm({ name: r.name, alertType: r.alertType, threshold: r.threshold }); setEditingRule(r.id); }} aria-label="编辑规则" className="neu-btn-xs ml-1"><PenLine size={12} /></button>
                          <button onClick={() => doDeleteRule(r.id)} aria-label="删除规则" className="neu-btn-xs is-warning ml-1"><X size={12} /></button>
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
                      <tr key={a.id} className={a.isRead ? '' : 'bg-[var(--accent-tint)]'}>
                        <td className="text-xs text-[var(--muted-foreground)]">{new Date(a.createdAt).toLocaleString('zh-CN')}</td>
                        <td><span className="font-medium">{a.catalogItem?.name || '—'}</span><div className="text-[10px] font-mono text-[var(--accent)]">{a.catalogItem?.code}</div></td>
                        <td className="text-xs">{a.rule?.name || '—'}</td>
                        <td className="text-sm">{a.message}</td>
                        <td className="text-center tabular-nums font-mono text-sm">{a.triggerValue}</td>
                        <td className="text-center">{a.isResolved ? <Check size={14} className="text-[var(--success)] inline" /> : <span className="text-xs text-[var(--warning)]">待处理</span>}</td>
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
