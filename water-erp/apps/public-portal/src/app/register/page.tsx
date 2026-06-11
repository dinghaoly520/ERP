'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { api } from '@/lib/api';

const enterpriseTypes = ['国有企业', '有限责任公司', '股份有限公司', '集体企业', '个体工商户'];

export default function RegisterPage() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({
    username: '', displayName: '', password: '', confirmPassword: '', email: '',
    name: '', creditCode: '', enterpriseType: '有限责任公司', legalPerson: '', registeredAddress: '', businessScope: '',
    contactName: '', contactPhone: '', contactEmail: '',
  });

  const handleRegister = async () => {
    if (form.password !== form.confirmPassword) { toast.error('两次密码不一致'); return; }
    if (form.password.length < 6) { toast.error('密码不少于6位'); return; }
    if (!form.name || !form.creditCode) { toast.error('请填写企业基本信息'); return; }
    setLoading(true);
    try {
      await api.post('/supplier/register', {
        name: form.name,
        creditCode: form.creditCode,
        enterpriseType: form.enterpriseType,
        legalPerson: form.legalPerson,
        registeredAddress: form.registeredAddress,
        businessScope: form.businessScope,
        username: form.username,
        displayName: form.displayName || form.contactName,
        password: form.password,
        email: form.email,
        contacts: [{ name: form.contactName, phone: form.contactPhone, email: form.contactEmail, isPrimary: true }],
        qualifications: [],
      });
      toast.success('注册成功！请登录后完善企业资料');
      setTimeout(() => router.push('/login'), 1000);
    } catch (e: any) { toast.error(e.message || '注册失败'); }
    setLoading(false);
  };

  const update = (field: string, value: string) => setForm(f => ({ ...f, [field]: value }));

  return (
    <div className="min-h-screen bg-[#f6f9fd] flex items-center justify-center">
      <div className="bg-white rounded-2xl p-10 w-full max-w-lg shadow-xl">
        <div className="text-center mb-6">
          <a href="/" className="text-sm text-[oklch(0.55_0.01_264)] hover:text-[#064ea2]">← 返回首页</a>
          <h1 className="text-2xl font-bold text-[oklch(0.18_0.012_265)] mt-2 mb-1">供应商注册</h1>
          <p className="text-sm text-[oklch(0.55_0.01_264)]">{step === 1 ? '填写账号信息' : '填写企业信息'}</p>
        </div>

        {/* 步骤指示器 */}
        <div className="flex items-center mb-8">
          {[1, 2].map(s => (
            <div key={s} className="flex items-center flex-1">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${step >= s ? 'bg-[#064ea2] text-white' : 'bg-[oklch(0.94_0.004_264)] text-[oklch(0.72_0.008_264)]'}`}>{s}</div>
              {s < 2 && <div className={`flex-1 h-1 mx-2 rounded ${step > s ? 'bg-[#064ea2]' : 'bg-[oklch(0.94_0.004_264)]'}`} />}
            </div>
          ))}
        </div>

        {step === 1 ? (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-semibold text-[oklch(0.18_0.012_265)] mb-1">登录用户名 *</label>
              <input value={form.username} onChange={e => update('username', e.target.value)}
                placeholder="用于登录系统" className="w-full px-3 py-2.5 border border-[oklch(0.91_0.006_264)] rounded-lg text-sm focus:border-[#064ea2] outline-none" />
            </div>
            <div>
              <label className="block text-sm font-semibold text-[oklch(0.18_0.012_265)] mb-1">联系人姓名 *</label>
              <input value={form.contactName} onChange={e => update('contactName', e.target.value)}
                placeholder="企业联系人或法人代表" className="w-full px-3 py-2.5 border border-[oklch(0.91_0.006_264)] rounded-lg text-sm focus:border-[#064ea2] outline-none" />
            </div>
            <div>
              <label className="block text-sm font-semibold text-[oklch(0.18_0.012_265)] mb-1">联系电话 *</label>
              <input value={form.contactPhone} onChange={e => update('contactPhone', e.target.value)}
                placeholder="手机号码" className="w-full px-3 py-2.5 border border-[oklch(0.91_0.006_264)] rounded-lg text-sm focus:border-[#064ea2] outline-none" />
            </div>
            <div>
              <label className="block text-sm font-semibold text-[oklch(0.18_0.012_265)] mb-1">电子邮箱</label>
              <input value={form.contactEmail} onChange={e => update('contactEmail', e.target.value)}
                placeholder="用于接收通知" className="w-full px-3 py-2.5 border border-[oklch(0.91_0.006_264)] rounded-lg text-sm focus:border-[#064ea2] outline-none" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-semibold text-[oklch(0.18_0.012_265)] mb-1">密码 *</label>
                <input type="password" value={form.password} onChange={e => update('password', e.target.value)}
                  placeholder="不少于6位" className="w-full px-3 py-2.5 border border-[oklch(0.91_0.006_264)] rounded-lg text-sm focus:border-[#064ea2] outline-none" />
              </div>
              <div>
                <label className="block text-sm font-semibold text-[oklch(0.18_0.012_265)] mb-1">确认密码 *</label>
                <input type="password" value={form.confirmPassword} onChange={e => update('confirmPassword', e.target.value)}
                  placeholder="再次输入密码" className="w-full px-3 py-2.5 border border-[oklch(0.91_0.006_264)] rounded-lg text-sm focus:border-[#064ea2] outline-none" />
              </div>
            </div>
            <button onClick={() => setStep(2)}
              disabled={!form.username || !form.contactName || !form.contactPhone || !form.password}
              className="w-full py-3 bg-[#064ea2] text-white rounded-xl font-bold text-sm hover:bg-[#0e62d0] transition disabled:opacity-50">
              下一步 →
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-semibold text-[oklch(0.18_0.012_265)] mb-1">企业全称 *</label>
              <input value={form.name} onChange={e => update('name', e.target.value)}
                placeholder="营业执照上的企业全称" className="w-full px-3 py-2.5 border border-[oklch(0.91_0.006_264)] rounded-lg text-sm focus:border-[#064ea2] outline-none" />
            </div>
            <div>
              <label className="block text-sm font-semibold text-[oklch(0.18_0.012_265)] mb-1">统一社会信用代码 *</label>
              <input value={form.creditCode} onChange={e => update('creditCode', e.target.value)}
                placeholder="18位统一社会信用代码" className="w-full px-3 py-2.5 border border-[oklch(0.91_0.006_264)] rounded-lg text-sm focus:border-[#064ea2] outline-none" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-semibold text-[oklch(0.18_0.012_265)] mb-1">企业类型</label>
                <select value={form.enterpriseType} onChange={e => update('enterpriseType', e.target.value)}
                  className="w-full px-3 py-2.5 border border-[oklch(0.91_0.006_264)] rounded-lg text-sm focus:border-[#064ea2] outline-none bg-white">
                  {enterpriseTypes.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-semibold text-[oklch(0.18_0.012_265)] mb-1">法定代表人</label>
                <input value={form.legalPerson} onChange={e => update('legalPerson', e.target.value)}
                  placeholder="法定代表人或负责人" className="w-full px-3 py-2.5 border border-[oklch(0.91_0.006_264)] rounded-lg text-sm focus:border-[#064ea2] outline-none" />
              </div>
            </div>
            <div>
              <label className="block text-sm font-semibold text-[oklch(0.18_0.012_265)] mb-1">注册地址</label>
              <input value={form.registeredAddress} onChange={e => update('registeredAddress', e.target.value)}
                placeholder="营业执照登记的注册地址" className="w-full px-3 py-2.5 border border-[oklch(0.91_0.006_264)] rounded-lg text-sm focus:border-[#064ea2] outline-none" />
            </div>
            <div>
              <label className="block text-sm font-semibold text-[oklch(0.18_0.012_265)] mb-1">经营范围</label>
              <textarea value={form.businessScope} onChange={e => update('businessScope', e.target.value)}
                placeholder="与营业执照一致的经营范围" className="w-full px-3 py-2.5 border border-[oklch(0.91_0.006_264)] rounded-lg text-sm h-20 resize-none focus:border-[#064ea2] outline-none" />
            </div>
            <div className="flex gap-3">
              <button onClick={() => setStep(1)} className="flex-1 py-3 border border-[oklch(0.91_0.006_264)] text-[oklch(0.55_0.01_264)] rounded-xl font-bold text-sm hover:bg-[oklch(0.992_0.003_264)] transition">← 上一步</button>
              <button onClick={handleRegister} disabled={loading || !form.name || !form.creditCode}
                className="flex-1 py-3 bg-[#064ea2] text-white rounded-xl font-bold text-sm hover:bg-[#0e62d0] transition disabled:opacity-50">
                {loading ? '提交中...' : '提交注册'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
