'use client';

import { useState } from 'react';
import { UnifiedHeader } from '@/components/unified-header';
import { FlowBackdrop } from '@/components/flow-stage';
import { UnitSearchSelect } from '@/components/unit-search-select';
import { toast } from 'sonner';
import { api } from '@/lib/api';

/* ═══════════════════════════════════════
   供应商来访接待登记 — 采购办
   布局：统一顶栏 → 返回首页 → 内容区垂直居中（标题 + neu-card 表单）
   ═══════════════════════════════════════ */

interface FormData {
  name: string; phone: string; organization: string; visitUnit: string;
  visitorCount: string; visitDate: string; purpose: string; remark: string;
}

/* 来访事由快捷选项 — 与原 placeholder 示例一致，点击即填、可自由输入 */
const PURPOSE_PRESETS = ['投标咨询', '合同洽谈', '异议沟通'];

export default function VisitorPage() {
  const [form, setForm] = useState<FormData>({
    name: '', phone: '', organization: '', visitUnit: '',
    visitorCount: '', visitDate: '', purpose: '', remark: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const update = (k: keyof FormData, v: string) => setForm(p => ({ ...p, [k]: v }));

  const handleSubmit = async () => {
    if (!form.name || !form.phone || !form.visitUnit || !form.visitDate || !form.purpose) { toast.error('请填写必填项'); return; }
    if (!/^1\d{10}$/.test(form.phone)) { toast.error('请输入正确的手机号码'); return; }
    setSubmitting(true);
    try {
      // 后端将登记信息通知访问单位归属公司的 staff 账号（:3005 通知中心）
      await api.post('/visitor/registrations', {
        name: form.name.trim(),
        phone: form.phone.trim(),
        organization: form.organization.trim() || undefined,
        visitUnit: form.visitUnit,
        visitorCount: form.visitorCount ? Number(form.visitorCount) : undefined,
        visitDate: form.visitDate,
        purpose: form.purpose.trim(),
        remark: form.remark.trim() || undefined,
      });
      toast.success('登记成功！我们会尽快与您联系');
      setForm({ name: '', phone: '', organization: '', visitUnit: '', visitorCount: '', visitDate: '', purpose: '', remark: '' });
    } catch (e) {
      toast.error(e instanceof Error && e.message ? `提交失败：${e.message}` : '提交失败，请稍后重试');
    }
    setSubmitting(false);
  };

  const labelCls = 'grid gap-2';
  const labelText = 'flex items-baseline gap-1 text-[12px] font-semibold tracking-[0.02em] text-[var(--fg-2)]';
  const req = <span className="text-[#d43030]">*</span>;
  /* 分区头 — 与集团简介页 h2 同语汇（品牌色竖条 + 粗体） */
  const sectionTitle = (t: string) => (
    <div className="mb-4 flex items-center gap-2.5">
      <span className="block w-[3px] h-[15px] rounded-full bg-[var(--brand)]" />
      <span className="text-[13px] font-bold tracking-[0.06em] text-[var(--ink)]">{t}</span>
    </div>
  );

  return (
    <div className="flow-page flex flex-col">
      <FlowBackdrop />
      <UnifiedHeader />

      <main className="flex-1 relative z-10 flex flex-col">
        <div className="px-[clamp(28px,4vw,72px)] pt-3">
          <a href="/" className="flow-back">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
            返回首页
          </a>
        </div>

        {/* 内容区 — 垂直居中 */}
        <div className="flex-1 flex items-center justify-center px-[clamp(28px,4vw,72px)] pt-4 pb-[clamp(32px,4vw,56px)]">
          <div className="w-full max-w-2xl">
            {/* 标题 */}
            <div className="mb-[clamp(24px,3vw,36px)] text-center">
              <h1 className="mb-3 text-[clamp(28px,3vw,40px)] font-black tracking-[0.02em] text-[var(--ink)]">供应商来访接待登记</h1>
              <span className="mx-auto mb-2.5 block h-[3px] w-10 rounded-full bg-[linear-gradient(90deg,var(--brand),var(--water))]" />
              <p className="text-sm text-[var(--fg-3)]">供应商现场来访请提前登记，工作人员将尽快与您联系安排接待</p>
            </div>

            {/* 表单卡 — 2026-11-04 重设计：两分区（来访人信息/来访安排）+
                内凹井输入 + 快选芯片 + 整宽提交 */}
            <div className="neu-card neu-card--static p-[clamp(22px,3vw,34px)]">
              {/* ── 分区一：来访人信息 ── */}
              {sectionTitle('来访人信息')}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-5 gap-y-4">
                <label className={labelCls}>
                  <span className={labelText}>来访人姓名{req}</span>
                  <input type="text" value={form.name} onChange={e => update('name', e.target.value)} placeholder="请输入姓名" className="neu-input" />
                </label>
                <label className={labelCls}>
                  <span className={labelText}>联系电话{req}</span>
                  <input type="tel" value={form.phone} onChange={e => update('phone', e.target.value)} placeholder="请输入手机号码" className="neu-input" />
                </label>
                <label className={labelCls}>
                  <span className={labelText}>供应商单位</span>
                  <input type="text" value={form.organization} onChange={e => update('organization', e.target.value)} placeholder="请输入供应商名称" className="neu-input" />
                </label>
                <label className={labelCls}>
                  <span className={labelText}>来访人数</span>
                  <input type="number" min="1" value={form.visitorCount} onChange={e => update('visitorCount', e.target.value)} placeholder="请输入人数" className="neu-input" />
                </label>
              </div>

              {/* hairline 分割 — cgzxui 统一参数 */}
              <div className="my-5" style={{ borderTop: '1px solid oklch(0.6 0.04 258 / 0.16)' }} />

              {/* ── 分区二：来访安排 ── */}
              {sectionTitle('来访安排')}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-5 gap-y-4">
                <div className={labelCls}>
                  <span className={labelText}>访问单位{req}</span>
                  <UnitSearchSelect
                    value={form.visitUnit}
                    onChange={v => update('visitUnit', v)}
                    placeholder="请选择来访的集团单位"
                    allowCustom={false}
                  />
                </div>
                <label className={labelCls}>
                  <span className={labelText}>来访日期{req}</span>
                  <input type="date" value={form.visitDate} onChange={e => update('visitDate', e.target.value)} className="neu-input" />
                </label>
                <div className={`${labelCls} sm:col-span-2`}>
                  <label htmlFor="visit-purpose" className={labelText}>来访事由{req}</label>
                  <input id="visit-purpose" type="text" value={form.purpose} onChange={e => update('purpose', e.target.value)} placeholder="可输入，或点击下方快捷选择" className="neu-input" />
                  <div className="flex flex-wrap gap-2">
                    {PURPOSE_PRESETS.map(p => (
                      <button key={p} type="button" onClick={() => update('purpose', p)} className={`neu-chip${form.purpose === p ? ' is-active' : ''}`}>{p}</button>
                    ))}
                  </div>
                </div>
                <label className={`${labelCls} sm:col-span-2`}>
                  <span className={labelText}>备注说明</span>
                  <textarea value={form.remark} onChange={e => update('remark', e.target.value)} placeholder="其他需要说明的事项" className="neu-input" />
                </label>
              </div>

              {/* 提交 — 整宽主按钮 */}
              <button onClick={handleSubmit} disabled={submitting} className="neu-btn-primary mt-6 w-full">
                {submitting ? '提交中...' : '提交登记'}
              </button>
              <p className="text-[12px] text-[var(--fg-3)] text-center mt-3.5">提交后请保持手机畅通，我们会在1个工作日内与您联系</p>
            </div>
          </div>
        </div>
      </main>

      {/* ── Footer — 玻璃雾化，与联系我们页同语汇 ── */}
      <footer className="footer-glass">
        <div className="flex items-center justify-between gap-3 px-[clamp(28px,4vw,72px)] py-4 max-sm:flex-col max-sm:gap-3">
          <span className="text-[11px] text-[#8a96aa] flex items-center gap-2 flex-wrap justify-center">
            Copyright ® 2026 四川省水利发展集团有限公司 版权所有
            <span className="footer-legal-divider" aria-hidden="true" />
            <a href="https://beian.miit.gov.cn/" target="_blank" rel="noopener noreferrer" className="footer-legal-icp">蜀ICP备2020033056号-1</a>
          </span>
          <div className="flex items-center gap-2">
            <a href="/about" className="footer-link">集团简介</a>
            <a href="/" className="footer-link">返回首页</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
