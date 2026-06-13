'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';

const PROCUREMENT_TYPES = ['货物', '工程', '服务'];
const PROCUREMENT_METHODS = ['公开招标', '邀请招标', '竞争性谈判', '单一来源'];

export default function NewProcurementPage() {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    title: '',
    procurementType: PROCUREMENT_TYPES[0],
    procurementMethod: PROCUREMENT_METHODS[0],
    budget: '',
    description: '',
  });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setSubmitting(true);

    try {
      await api.post('/procurement', {
        ...form,
        budget: form.budget ? Number(form.budget) : undefined,
      });
      router.push('/procurement');
    } catch (err: any) {
      setError(err?.message || '创建失败');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="max-w-2xl mx-auto">
      <div className="mb-6">
        <button onClick={() => router.push('/procurement')} className="text-sm text-[#064ea2] hover:underline mb-2 inline-block">
          ← 返回采购列表
        </button>
        <h1 className="text-2xl font-bold text-[oklch(0.18_0.012_265)]">新建采购项目</h1>
        <p className="text-sm text-[oklch(0.55_0.01_264)] mt-1">填写采购项目基本信息，创建后可提交审批并发起招标</p>
      </div>

      <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-[oklch(0.91_0.006_264)] p-6 space-y-5">
        {error && (
          <div className="bg-red-50 text-red-600 px-4 py-3 rounded-lg text-sm font-medium">{error}</div>
        )}

        <div>
          <label className="block text-sm font-semibold text-[oklch(0.18_0.012_265)] mb-1.5">项目名称 *</label>
          <input
            type="text" required
            value={form.title}
            onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
            placeholder="如：XX水库大坝安全监测设备采购"
            className="w-full px-4 py-2.5 rounded-lg border border-[oklch(0.91_0.006_264)] text-sm focus:outline-none focus:ring-2 focus:ring-[#064ea2]/20 focus:border-[#064ea2]"
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-semibold text-[oklch(0.18_0.012_265)] mb-1.5">采购类型 *</label>
            <select
              value={form.procurementType}
              onChange={e => setForm(f => ({ ...f, procurementType: e.target.value }))}
              className="w-full px-4 py-2.5 rounded-lg border border-[oklch(0.91_0.006_264)] text-sm focus:outline-none focus:ring-2 focus:ring-[#064ea2]/20 focus:border-[#064ea2] bg-white"
            >
              {PROCUREMENT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-semibold text-[oklch(0.18_0.012_265)] mb-1.5">采购方式 *</label>
            <select
              value={form.procurementMethod}
              onChange={e => setForm(f => ({ ...f, procurementMethod: e.target.value }))}
              className="w-full px-4 py-2.5 rounded-lg border border-[oklch(0.91_0.006_264)] text-sm focus:outline-none focus:ring-2 focus:ring-[#064ea2]/20 focus:border-[#064ea2] bg-white"
            >
              {PROCUREMENT_METHODS.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
        </div>

        <div>
          <label className="block text-sm font-semibold text-[oklch(0.18_0.012_265)] mb-1.5">预算金额（元）</label>
          <input
            type="number" min="0" step="0.01"
            value={form.budget}
            onChange={e => setForm(f => ({ ...f, budget: e.target.value }))}
            placeholder="选填"
            className="w-full px-4 py-2.5 rounded-lg border border-[oklch(0.91_0.006_264)] text-sm focus:outline-none focus:ring-2 focus:ring-[#064ea2]/20 focus:border-[#064ea2]"
          />
        </div>

        <div>
          <label className="block text-sm font-semibold text-[oklch(0.18_0.012_265)] mb-1.5">项目描述</label>
          <textarea
            value={form.description}
            onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
            rows={4}
            placeholder="选填，描述采购需求和技术要求"
            className="w-full px-4 py-2.5 rounded-lg border border-[oklch(0.91_0.006_264)] text-sm focus:outline-none focus:ring-2 focus:ring-[#064ea2]/20 focus:border-[#064ea2] resize-none"
          />
        </div>

        <div className="flex gap-3 pt-2">
          <button
            type="submit"
            disabled={submitting || !form.title.trim()}
            className="px-6 py-2.5 bg-[#064ea2] text-white rounded-lg text-sm font-semibold hover:bg-[#053f85] transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting ? '创建中...' : '创建项目'}
          </button>
          <button
            type="button"
            onClick={() => router.push('/procurement')}
            className="px-6 py-2.5 bg-white text-[oklch(0.55_0.01_264)] border border-[oklch(0.91_0.006_264)] rounded-lg text-sm font-semibold hover:border-[oklch(0.80_0.04_258)] transition"
          >
            取消
          </button>
        </div>
      </form>
    </div>
  );
}
