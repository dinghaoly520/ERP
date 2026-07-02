'use client';

import { useState } from 'react';
import { UnifiedHeader } from '@/components/unified-header';
import { FlowBackdrop } from '@/components/flow-stage';
import { toast } from 'sonner';

/* ═══════════════════════════════════════
   来访接待登记 — 信访接待
   ═══════════════════════════════════════ */

interface FormData {
  name: string; phone: string; organization: string;
  visitorCount: string; visitDate: string; purpose: string; remark: string;
}

export default function VisitorPage() {
  const [form, setForm] = useState<FormData>({
    name: '', phone: '', organization: '', visitorCount: '',
    visitDate: '', purpose: '', remark: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const update = (k: keyof FormData, v: string) => setForm(p => ({ ...p, [k]: v }));

  const handleSubmit = async () => {
    if (!form.name || !form.phone || !form.visitDate || !form.purpose) { toast.error('请填写必填项'); return; }
    if (!/^1\d{10}$/.test(form.phone)) { toast.error('请输入正确的手机号码'); return; }
    setSubmitting(true);
    try { await new Promise(r => setTimeout(r, 800)); toast.success('登记成功！我们会尽快与您联系'); }
    catch { toast.error('提交失败，请稍后重试'); }
    setSubmitting(false);
  };

  const ic = "h-[44px] px-3.5 border border-[#d4dde8] rounded-lg text-[14px] text-[#18243a] bg-white outline-none focus:border-[#064ea2] focus:shadow-[0_0_0_3px_rgba(6,78,162,.08)] transition-all duration-200 placeholder:text-[#bcc6d4] w-full";

  return (
    <div className="flow-page flex flex-col" style={{ fontFamily: '"Microsoft YaHei","PingFang SC",Arial,sans-serif' }}>
      <FlowBackdrop />
      <UnifiedHeader announcements={[]} onLoginClick={() => {}} onRegisterClick={() => {}} />

      <main className="flex-1 relative z-10">
        <div className="px-[clamp(40px,5vw,80px)] pt-3 pb-[clamp(36px,3.5vw,48px)]">
          <a href="/" className="flow-back inline-flex items-center gap-1.5 w-fit">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
            返回首页
          </a>

          {/* 标题 */}
          <div className="mb-[clamp(28px,3vw,40px)] text-center">
            <h1 className="text-[clamp(28px,3vw,40px)] font-black text-[#18243a] mb-1.5" style={{ fontFamily: '"SimHei","黑体",sans-serif' }}>来访接待登记</h1>
            <p className="text-sm text-[#8a96aa]">填写以下信息，工作人员将尽快与您联系安排接待</p>
          </div>

          {/* 表单 */}
          <div className="max-w-2xl mx-auto">
            <div className="grid grid-cols-2 gap-x-5 gap-y-4">
              <label className="grid gap-1.5 text-[13px] font-bold text-[#1c314d]">
                <span className="flex items-center gap-1">来访人姓名<span className="text-[#d43030] text-xs">*</span></span>
                <input type="text" value={form.name} onChange={e => update('name', e.target.value)} placeholder="请输入姓名" className={ic} />
              </label>
              <label className="grid gap-1.5 text-[13px] font-bold text-[#1c314d]">
                <span className="flex items-center gap-1">联系电话<span className="text-[#d43030] text-xs">*</span></span>
                <input type="tel" value={form.phone} onChange={e => update('phone', e.target.value)} placeholder="请输入手机号码" className={ic} />
              </label>
              <label className="grid gap-1.5 text-[13px] font-bold text-[#1c314d]">
                <span>来访单位</span>
                <input type="text" value={form.organization} onChange={e => update('organization', e.target.value)} placeholder="请输入单位名称" className={ic} />
              </label>
              <label className="grid gap-1.5 text-[13px] font-bold text-[#1c314d]">
                <span>来访人数</span>
                <input type="number" min="1" value={form.visitorCount} onChange={e => update('visitorCount', e.target.value)} placeholder="请输入人数" className={ic} />
              </label>
              <label className="grid gap-1.5 text-[13px] font-bold text-[#1c314d]">
                <span className="flex items-center gap-1">来访日期<span className="text-[#d43030] text-xs">*</span></span>
                <input type="date" value={form.visitDate} onChange={e => update('visitDate', e.target.value)} className={ic} />
              </label>
              <label className="grid gap-1.5 text-[13px] font-bold text-[#1c314d]">
                <span className="flex items-center gap-1">来访事由<span className="text-[#d43030] text-xs">*</span></span>
                <input type="text" value={form.purpose} onChange={e => update('purpose', e.target.value)} placeholder="简要说明事由" className={ic} />
              </label>
            </div>

            <div className="flex items-end gap-4 mt-4">
              <label className="grid gap-1.5 text-[13px] font-bold text-[#1c314d] flex-1">
                备注说明
                <input type="text" value={form.remark} onChange={e => update('remark', e.target.value)} placeholder="其他需要说明的事项" className={ic} />
              </label>
              <button
                onClick={handleSubmit}
                disabled={submitting}
                className="h-[44px] px-8 bg-[#064ea2] text-white text-[14px] font-bold rounded-lg hover:bg-[#05428a] active:scale-[0.98] transition-all duration-200 disabled:opacity-60 disabled:cursor-not-allowed shrink-0"
              >
                {submitting ? '提交中...' : '提交登记'}
              </button>
            </div>

            <p className="text-[12px] text-[#94a3b8] text-center mt-4">提交后请保持手机畅通，我们会在1个工作日内与您联系</p>
          </div>
        </div>
      </main>

      {/* ── Footer ── */}
      <footer className="border-t border-[#eef1f6] bg-[#fafbfc]">
        <div className="px-[clamp(28px,4vw,72px)] py-5 flex items-center justify-between text-[12px] text-[#8a96aa] max-sm:flex-col max-sm:gap-1.5">
          <span>© 2026 四川水发集团</span>
          <div className="flex items-center gap-4">
            <a href="/about" className="hover:text-[#064ea2] transition-colors">集团简介</a>
            <a href="/" className="hover:text-[#064ea2] transition-colors">返回首页</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
