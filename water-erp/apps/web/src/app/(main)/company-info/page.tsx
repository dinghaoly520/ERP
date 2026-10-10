'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  Building2,
  Gavel,
  Loader2,
  MapPin,
  RefreshCw,
  Save,
  ShieldAlert,
  UserRound,
} from 'lucide-react';
import { fetchMyCompanyInfo, updateMyCompanyInfo, type CompanyInfo } from '@/lib/api/company-info';

/* ═══════════════════════════════════════════════════════════════
   公司信息管理（2026-10-10）
   leader 维护本公司基础信息：名称 / 开标地点 / 监督块 / 采购人联系块。
   维护值供采购文件编写与公告编写按登录人公司自动带入
   （监督块+采购人联系人预填草稿；开标地点替换模板默认地址）。
   ═══════════════════════════════════════════════════════════════ */

/** 表单字段布局：[{字段, 标签, 占位, 类型?}]——渲染与提交共用同一份清单 */
const SECTIONS: Array<{
  key: string;
  icon: typeof MapPin;
  title: string;
  hint: string;
  fields: Array<{ key: keyof CompanyInfo; label: string; placeholder: string; type?: string; wide?: boolean }>;
}> = [
  {
    key: 'opening',
    icon: MapPin,
    title: '开标地点',
    hint: '采购文件「递交/开标地点」与公告「开标地点」自动带入此地址；留空沿用模板默认地址。',
    fields: [
      { key: 'bidOpeningAddress', label: '开标地点', placeholder: '例如：四川省成都市双流区红莲街三段383号四川水发集团B座3楼采购中心', wide: true },
    ],
  },
  {
    key: 'supervision',
    icon: ShieldAlert,
    title: '监督信息',
    hint: '公告与采购文件「监督举报」块自动带入；监督部门留空时按「公司名 + 纪检监察部」生成，其余留空沿用平台默认值。',
    fields: [
      { key: 'supervisionDept', label: '监督部门', placeholder: '留空 = 公司名称 + 纪检监察部' },
      { key: 'supervisionPhone', label: '监督电话', placeholder: '例如：028-XXXXXXXX', type: 'tel' },
      { key: 'supervisionAddress', label: '监督地址', placeholder: '例如：四川省成都市双流区红莲街三段383号', wide: true },
      { key: 'supervisionContact', label: '监督人', placeholder: '多人以顿号分隔，例如：王先生、徐先生', wide: true },
    ],
  },
  {
    key: 'purchaser',
    icon: UserRound,
    title: '采购人信息',
    hint: '公告「联系方式」块与采购文件联系人字段自动带入（联系人亦可在编写时从本公司联系人库重选）。',
    fields: [
      { key: 'purchaserContact', label: '联系人', placeholder: '例如：张三' },
      { key: 'purchaserPhone', label: '联系电话', placeholder: '例如：028-XXXXXXXX', type: 'tel' },
      { key: 'purchaserEmail', label: '电子邮箱', placeholder: '例如：cgzx@example.com', type: 'email' },
      { key: 'purchaserAddress', label: '地址', placeholder: '例如：四川省成都市双流区红莲街三段383号', wide: true },
    ],
  },
];

const ALL_FIELDS = SECTIONS.flatMap((s) => s.fields.map((f) => f.key));

export default function CompanyInfoPage() {
  const [info, setInfo] = useState<CompanyInfo | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchMyCompanyInfo();
      if (!data) throw new Error('所属公司数据异常，请联系管理员处理');
      setInfo(data);
      // name/shortName 不在 ALL_FIELDS（基本信息节无 fields 配置），此处一并初始化
      setForm({
        name: data.name ?? '',
        shortName: data.shortName ?? '',
        ...Object.fromEntries(
          ALL_FIELDS.map((k) => [k, ((data as Record<string, unknown>)[k] as string | null) ?? '']),
        ),
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const save = async () => {
    if (!info) return;
    if (!form.name.trim()) {
      toast.error('公司名称不能为空');
      return;
    }
    setSaving(true);
    try {
      const payload = Object.fromEntries(
        ALL_FIELDS.concat('name', 'shortName').map((k) => [k, form[k] ?? '']),
      );
      const saved = await updateMyCompanyInfo(payload);
      setInfo(saved);
      toast.success('公司信息已保存，后续采购文件与公告编写将按此带入');
    } catch (e) {
      toast.error((e as Error).message || '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const set = (key: string, value: string) => setForm((prev) => ({ ...prev, [key]: value }));

  if (loading) {
    return (
      <div className="flex min-h-[360px] items-center justify-center">
        <div className="inline-flex items-center gap-3 text-sm text-[var(--muted-foreground)]">
          <Loader2 size={18} className="animate-spin" />
          正在加载公司信息...
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="neu-card p-6 text-center">
        <ShieldAlert size={22} className="mx-auto mb-2 text-[var(--warning)]" />
        <div className="text-sm font-medium text-[var(--foreground)]">{error}</div>
        <div className="mt-1 text-xs text-[var(--muted-foreground)]">
          请联系管理员（账号管理 → 公司信息管理）为账号归属公司后再维护
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {/* ══════ page-hero ══════ */}
      <div className="page-hero">
        <div className="page-hero__row">
          <div className="page-hero__left">
            <div className="page-hero__icon">
              <Building2 size={17} />
            </div>
            <div>
              <div className="page-hero__title">公司信息管理</div>
              <div className="page-hero__sub">
                维护本公司的开标地点、监督信息与采购人联系方式——采购文件编写与公告编写将自动带入
              </div>
            </div>
          </div>
          <div className="page-hero__right">
            <button onClick={() => void load()} className="neu-btn-xs" title="刷新">
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            </button>
            <button onClick={() => void save()} disabled={saving} className="neu-btn-primary">
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
              {saving ? '保存中...' : '保存'}
            </button>
          </div>
        </div>
        <div className="page-hero__divider" />
      </div>

      {/* ══════ 基本信息（名称可改，全局唯一） ══════ */}
      <div className="neu-card p-5">
        <div className="mb-3 flex items-center gap-2">
          <Gavel size={14} className="text-[var(--accent)]" />
          <span className="text-sm font-semibold text-[var(--foreground)]">基本信息</span>
        </div>
        <p className="mb-4 text-xs leading-5 text-[var(--muted-foreground)]">
          公司名称用于采购文件「采购人」落款与公告发布方展示（留空沿用模板默认）；改名即时生效于新项目归属快照。
        </p>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-[var(--muted-foreground)]">
              公司名称 <span className="text-[var(--danger)]">*</span>
            </span>
            <input
              type="text"
              value={form.name ?? ''}
              onChange={(e) => set('name', e.target.value)}
              placeholder="规范全称（全局唯一）"
              className="workbench-input w-full"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-[var(--muted-foreground)]">公司简称</span>
            <input
              type="text"
              value={form.shortName ?? ''}
              onChange={(e) => set('shortName', e.target.value)}
              placeholder="例如：设计公司"
              className="workbench-input w-full"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-[var(--muted-foreground)]">公司编码</span>
            <input
              type="text"
              value={info?.code ?? ''}
              disabled
              placeholder="—"
              className="workbench-input w-full font-mono disabled:opacity-60"
              title="公司编码（项目编号前缀段）由主数据维护，此处只读"
            />
          </label>
        </div>
      </div>

      {/* ══════ 开标地点 / 监督信息 / 采购人信息 ══════ */}
      {SECTIONS.map((section) => (
        <div key={section.key} className="neu-card p-5">
          <div className="mb-3 flex items-center gap-2">
            <section.icon size={14} className="text-[var(--accent)]" />
            <span className="text-sm font-semibold text-[var(--foreground)]">{section.title}</span>
          </div>
          <p className="mb-4 text-xs leading-5 text-[var(--muted-foreground)]">{section.hint}</p>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {section.fields.map((f) => (
              <label key={String(f.key)} className={f.wide ? 'md:col-span-2 block' : 'block'}>
                <span className="mb-1 block text-xs font-medium text-[var(--muted-foreground)]">{f.label}</span>
                <input
                  type={f.type ?? 'text'}
                  value={form[String(f.key)] ?? ''}
                  onChange={(e) => set(String(f.key), e.target.value)}
                  placeholder={f.placeholder}
                  className="workbench-input w-full"
                />
              </label>
            ))}
          </div>
        </div>
      ))}

      {/* 底部保存（滚动到表单底部时无需回滚页头） */}
      <div className="flex justify-end gap-3">
        <button onClick={() => void save()} disabled={saving} className="neu-btn-primary">
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
          {saving ? '保存中...' : '保存'}
        </button>
      </div>
    </div>
  );
}
