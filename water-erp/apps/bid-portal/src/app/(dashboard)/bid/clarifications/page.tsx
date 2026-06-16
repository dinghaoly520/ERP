'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import type { BidProjectDetail, BidClarification } from '@/lib/types';
import ProjectSelector from '@/components/project-selector';
import { TableSkeleton } from '@/components/skeleton';
import { toast } from 'sonner';
import { MessageSquare, Send, Plus, X, AlertTriangle } from 'lucide-react';
import { PageHero } from '@water-erp/ui';

export default function BidClarificationsPage() {
  const [projectId, setProjectId] = useState('');
  const [project, setProject] = useState<BidProjectDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [clarifications, setClarifications] = useState<BidClarification[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [question, setQuestion] = useState('');
  const [issuer, setIssuer] = useState('');
  const [supplierName, setSupplierName] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    api.get<{ id: string }[]>('/bid/projects').then(ps => {
      if (ps.length) setProjectId(ps[0].id);
    });
  }, []);

  const load = () => {
    if (!projectId) return;
    setLoading(true);
    setError(null);
    Promise.all([
      api.get<BidProjectDetail>(`/bid/projects/${projectId}`),
      api.get<BidClarification[]>(`/bid/projects/${projectId}/clarifications`).catch(() => []),
    ])
      .then(([p, cls]) => { setProject(p); setClarifications(cls); })
      .catch((e) => { setError(e?.message || '加载澄清数据失败'); toast.error(e?.message || '加载澄清数据失败'); })
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [projectId]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleCreate = async () => {
    if (!question.trim()) { toast.error('请输入澄清问题'); return; }
    if (!issuer.trim()) { toast.error('请输入发起人'); return; }
    if (!supplierName.trim()) { toast.error('请输入供应商名称'); return; }
    setSubmitting(true);
    try {
      await api.post(`/bid/projects/${projectId}/clarifications`, {
        question: question.trim(),
        issuer: issuer.trim(),
        supplierName: supplierName.trim(),
      });
      toast.success('澄清已发起');
      setShowForm(false);
      setQuestion('');
      setIssuer('');
      setSupplierName('');
      const updated = await api.get<BidClarification[]>(`/bid/projects/${projectId}/clarifications`);
      setClarifications(updated);
    } catch (e: any) {
      toast.error(e.message || '发起失败');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <TableSkeleton rows={6} cols={4} />;
  if (error) return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <AlertTriangle size={28} strokeWidth={1.5} className="text-[oklch(0.50_0.18_22)] mb-3" />
      <p className="text-sm font-semibold text-[oklch(0.18_0.012_265)]">{error}</p>
      <button onClick={load} className="mt-4 px-4 py-2 rounded-xl bg-[#064ea2] text-white text-xs font-bold hover:bg-[#054280] transition">重试</button>
    </div>
  );
  if (!project) return (
    <div className="text-[13px] text-[oklch(0.62_0.008_264)] text-center py-20">
      暂无项目数据
    </div>
  );

  return (
    <div className="space-y-6">
      <PageHero
        eyebrow="澄清答疑"
        tone="cyan"
        icon={<MessageSquare size={14} strokeWidth={1.5} />}
        title="澄清与答疑"
        description="发起澄清 · 供应商回复 · 全程留痕"
        actions={<ProjectSelector value={projectId} onChange={setProjectId} />}
      />

      {/* Action bar */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2 text-[12px] text-[oklch(0.55_0.01_264)]">
          <MessageSquare size={13} strokeWidth={1.5} />
          项目：{project.projectCode} — {project.name}
        </div>
        <button
          onClick={() => setShowForm(true)}
          className="flex items-center gap-1.5 px-4 py-2 bg-[oklch(0.42_0.14_260)] text-white text-[12px] font-semibold tracking-tight hover:bg-[oklch(0.50_0.16_258)] transition-colors"
        >
          <Plus size={13} strokeWidth={2} /> 发起澄清
        </button>
      </div>

      {/* Create Form Modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
          <div className="bg-white w-full max-w-[520px] border border-[oklch(0.91_0.006_264)] shadow-sm">
            <div className="flex items-center justify-between px-6 py-4 border-b border-[oklch(0.91_0.006_264)]">
              <h2 className="text-[13px] font-semibold text-[oklch(0.18_0.012_265)] tracking-tight"
                style={{ fontFamily: "'Manrope', system-ui, sans-serif" }}>
                发起澄清
              </h2>
              <button onClick={() => setShowForm(false)} className="text-[oklch(0.62_0.008_264)] hover:text-[oklch(0.18_0.012_265)] transition-colors">
                <X size={16} strokeWidth={1.5} />
              </button>
            </div>
            <div className="px-6 py-5 space-y-4">
              <div>
                <label className="block text-[11px] font-semibold text-[oklch(0.55_0.01_264)] uppercase tracking-wider mb-1.5">
                  发起人 <span className="text-[oklch(0.50_0.18_22)]">*</span>
                </label>
                <input value={issuer} onChange={e => setIssuer(e.target.value)}
                  placeholder="例：评标委员会"
                  className="w-full px-3 py-2 text-[13px] border border-[oklch(0.91_0.006_264)] bg-white focus:outline-none focus:border-[oklch(0.42_0.14_260)] transition-colors placeholder:text-[oklch(0.72_0.008_264)]" />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-[oklch(0.55_0.01_264)] uppercase tracking-wider mb-1.5">
                  供应商 <span className="text-[oklch(0.50_0.18_22)]">*</span>
                </label>
                <select value={supplierName} onChange={e => setSupplierName(e.target.value)}
                  className="w-full px-3 py-2 text-[13px] border border-[oklch(0.91_0.006_264)] bg-white focus:outline-none focus:border-[oklch(0.42_0.14_260)] transition-colors">
                  <option value="">选择供应商</option>
                  {project.suppliers.map(s => (
                    <option key={s.id} value={s.supplierName}>{s.supplierName}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-[oklch(0.55_0.01_264)] uppercase tracking-wider mb-1.5">
                  澄清问题 <span className="text-[oklch(0.50_0.18_22)]">*</span>
                </label>
                <textarea value={question} onChange={e => setQuestion(e.target.value)} rows={4}
                  placeholder="请输入需要供应商澄清的问题…"
                  className="w-full px-3 py-2 text-[13px] border border-[oklch(0.91_0.006_264)] bg-white focus:outline-none focus:border-[oklch(0.42_0.14_260)] transition-colors resize-none placeholder:text-[oklch(0.72_0.008_264)]" />
              </div>
            </div>
            <div className="px-6 py-4 border-t border-[oklch(0.91_0.006_264)] flex items-center justify-end gap-3">
              <button onClick={() => setShowForm(false)}
                className="px-4 py-2 text-[12px] font-semibold text-[oklch(0.55_0.01_264)] tracking-tight hover:text-[oklch(0.18_0.012_265)] transition-colors">
                取消
              </button>
              <button onClick={handleCreate} disabled={submitting}
                className="flex items-center gap-1.5 px-5 py-2 bg-[oklch(0.42_0.14_260)] text-white text-[12px] font-semibold tracking-tight hover:bg-[oklch(0.50_0.16_258)] transition-colors disabled:opacity-50">
                <Send size={13} strokeWidth={2} />
                {submitting ? '发送中…' : '发起澄清'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Clarifications Table */}
      <div className="bg-white border border-[oklch(0.91_0.006_264)]">
        <div className="px-5 py-4 border-b border-[oklch(0.91_0.006_264)]">
          <h2 className="text-[13px] font-semibold text-[oklch(0.18_0.012_265)] tracking-tight"
            style={{ fontFamily: "'Manrope', system-ui, sans-serif" }}>
            澄清记录
          </h2>
        </div>
        {clarifications.length === 0 ? (
          <div className="px-5 py-12 text-center text-[13px] text-[oklch(0.62_0.008_264)]">
            暂无澄清记录
          </div>
        ) : (
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-[oklch(0.91_0.006_264)] text-left text-[oklch(0.55_0.01_264)]">
                <th className="px-5 py-3 font-medium text-[11px] uppercase tracking-wider">发起人</th>
                <th className="px-5 py-3 font-medium text-[11px] uppercase tracking-wider">供应商</th>
                <th className="px-5 py-3 font-medium text-[11px] uppercase tracking-wider">问题</th>
                <th className="px-5 py-3 font-medium text-[11px] uppercase tracking-wider">回复</th>
                <th className="px-5 py-3 font-medium text-[11px] uppercase tracking-wider">时间</th>
              </tr>
            </thead>
            <tbody>
              {clarifications.map(c => (
                <tr key={c.id} className="border-b border-[oklch(0.94_0.004_264)] align-top">
                  <td className="px-5 py-3 text-[oklch(0.42_0.14_260)] font-medium">{c.issuer}</td>
                  <td className="px-5 py-3 text-[oklch(0.18_0.012_265)]">{c.supplierName}</td>
                  <td className="px-5 py-3 text-[oklch(0.18_0.012_265)] max-w-[300px]">{c.question}</td>
                  <td className="px-5 py-3 text-[oklch(0.55_0.01_264)] max-w-[300px]">
                    {c.reply || <span className="text-[oklch(0.72_0.008_264)]">待回复</span>}
                  </td>
                  <td className="px-5 py-3 text-[12px] text-[oklch(0.62_0.008_264)] font-mono whitespace-nowrap">
                    {new Date(c.createdAt).toLocaleString('zh-CN')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
