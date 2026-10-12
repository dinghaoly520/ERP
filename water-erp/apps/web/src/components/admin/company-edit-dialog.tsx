'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Gavel, Landmark, Loader2, MapPin, Save, ShieldAlert, UserRound } from 'lucide-react';
import { Modal } from '@/components/workbench';
import { EntryListCard } from '@/components/company/company-entry-list-card';
import {
  createCompanyPlace,
  createCompanyPurchaser,
  createCompanySupervision,
  deleteCompanyPlace,
  deleteCompanyPurchaser,
  deleteCompanySupervision,
  fetchCompanyInfoById,
  updateCompanyById,
  updateCompanyPlace,
  updateCompanyPurchaser,
  updateCompanySupervision,
  type CompanyInfo,
} from '@/lib/api/company-info';

/* ═══════════════════════════════════════════════════════════════
   公司信息编辑窗口（2026-10-12）——账号管理「公司信息管理」弹窗内嵌套打开，
   替代原行内展开编辑。与 leader 侧 /company-info 页同数据面同口径：
   基本信息（名称/简称/采购人地址）+ 三类条目（采购人/开标地点/监督举报，
   多条目、单默认），维护即编写页实际取用的数据（条目优先）。
   ═══════════════════════════════════════════════════════════════ */

export function CompanyEditDialog({
  company,
  onClose,
  onChanged,
}: {
  company: { id: string; name: string; shortName: string | null; code: string | null };
  onClose: () => void;
  /** 任一保存可能影响台账（公司名/条目计数）——调用方刷新 /management 并向上冒泡 */
  onChanged?: () => void;
}) {
  const [info, setInfo] = useState<CompanyInfo | null>(null);
  const [form, setForm] = useState({ name: company.name, shortName: company.shortName ?? '', purchaserAddress: '' });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchCompanyInfoById(company.id);
      setInfo(data);
      // 名称/简称以打开时的公司行初值优先，地址以服务端值回填（编辑窗口内以表单为准）
      setForm((prev) => ({ ...prev, purchaserAddress: data.purchaserAddress ?? '' }));
    } catch (e) {
      toast.error((e as Error).message || '加载公司信息失败');
    } finally {
      setLoading(false);
    }
  }, [company.id]);

  useEffect(() => {
    setForm({ name: company.name, shortName: company.shortName ?? '', purchaserAddress: '' });
    void load();
  }, [company.id, company.name, company.shortName, load]);

  const set = (key: keyof typeof form, value: string) => setForm((prev) => ({ ...prev, [key]: value }));

  const saveBasic = async () => {
    if (!form.name.trim()) {
      toast.error('公司名称不能为空');
      return;
    }
    setSaving(true);
    try {
      await updateCompanyById(company.id, {
        name: form.name,
        shortName: form.shortName,
        purchaserAddress: form.purchaserAddress,
      });
      toast.success('基本信息已保存');
      onChanged?.();
      await load();
    } catch (e) {
      toast.error((e as Error).message || '保存失败');
    } finally {
      setSaving(false);
    }
  };

  /** 条目 CRUD 后刷新本窗口条目并通知外层（台账公司列「N 条目」计数联动） */
  const reloadEntries = useCallback(async () => {
    try {
      const data = await fetchCompanyInfoById(company.id);
      setInfo(data);
      onChanged?.();
    } catch {
      /* 刷新失败不打断窗口，下次操作自然重试 */
    }
  }, [company.id, onChanged]);

  const cid = company.id;

  return (
    <Modal
      open
      onClose={onClose}
      size="xl"
      title={
        <span className="flex items-center gap-2">
          <span className="neu-icon-well inline-flex h-7 w-7 items-center justify-center rounded-[9px]">
            <Landmark size={14} strokeWidth={1.9} className="text-[var(--accent)]" />
          </span>
          编辑公司信息
        </span>
      }
      description={
        <span>
          公司 <span className="font-mono font-semibold">{company.name}</span>
          {company.code ? ` · ${company.code}` : ''} · 与「公司信息管理」页（leader 本公司）同口径
        </span>
      }
      footer={
        <button type="button" onClick={onClose} className="neu-btn-soft !h-9 !text-xs">
          关闭
        </button>
      }
    >
      {loading ? (
        <div className="flex min-h-[280px] items-center justify-center">
          <div className="inline-flex items-center gap-3 text-sm text-[var(--muted-foreground)]">
            <Loader2 size={18} className="animate-spin" />
            正在加载公司信息...
          </div>
        </div>
      ) : !info ? (
        <div className="neu-card p-6 text-center">
          <ShieldAlert size={22} className="mx-auto mb-2 text-[var(--warning)]" />
          <div className="text-sm text-[var(--foreground)]">公司信息加载失败，请关闭后重试</div>
        </div>
      ) : (
        <>
          {/* ══════ 基本信息（名称全局唯一；采购人地址预填「联系人地址」） ══════ */}
          <div className="neu-card p-5">
            <div className="mb-3 flex items-center gap-2">
              <Gavel size={14} className="text-[var(--accent)]" />
              <span className="text-sm font-semibold text-[var(--foreground)]">基本信息</span>
            </div>
            <p className="mb-4 text-xs leading-5 text-[var(--muted-foreground)]">
              公司名称用于采购文件「采购人」落款与公告发布方展示；采购人地址预填「联系人地址」字段。改名即时生效于新项目归属快照。
            </p>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-[var(--muted-foreground)]">
                  公司名称 <span className="text-[var(--danger)]">*</span>
                </span>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => set('name', e.target.value)}
                  placeholder="规范全称（全局唯一）"
                  className="workbench-input w-full"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-[var(--muted-foreground)]">公司简称</span>
                <input
                  type="text"
                  value={form.shortName}
                  onChange={(e) => set('shortName', e.target.value)}
                  placeholder="例如：设计公司"
                  className="workbench-input w-full"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-[var(--muted-foreground)]">公司编码</span>
                <input
                  type="text"
                  value={info.code ?? ''}
                  disabled
                  placeholder="—"
                  className="workbench-input w-full font-mono disabled:opacity-60"
                  title="公司编码（项目编号前缀段）由主数据维护，此处只读"
                />
              </label>
            </div>
            <div className="mt-4 flex flex-col gap-3 md:flex-row md:items-end">
              <label className="block flex-1">
                <span className="mb-1 block text-xs font-medium text-[var(--muted-foreground)]">采购人地址</span>
                <input
                  type="text"
                  value={form.purchaserAddress}
                  onChange={(e) => set('purchaserAddress', e.target.value)}
                  placeholder="例如：四川省成都市双流区红莲街三段383号"
                  className="workbench-input w-full"
                />
              </label>
              <button
                type="button"
                onClick={() => void saveBasic()}
                disabled={saving || !form.name.trim()}
                className="neu-btn-primary !h-9 !text-xs shrink-0"
                title="保存基本信息（名称/简称/采购人地址）"
              >
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                保存基本信息
              </button>
            </div>
          </div>

          {/* ══════ 开标地点条目 ══════ */}
          <EntryListCard
            icon={MapPin}
            title="开标地点"
            hint="可维护多个开标地点、单默认——默认者进入编写时预填「开标地点」字段，编写时可点「地点」按钮改选；不设默认则不预填。"
            fields={[{ key: 'address', label: '地址（写入文档）', placeholder: '完整地址' }]}
            entries={info.places ?? []}
            onReload={reloadEntries}
            onCreate={async (v) => {
              await createCompanyPlace(cid, { address: v.address });
            }}
            onUpdate={async (id, v) => {
              await updateCompanyPlace(cid, id, { address: v.address });
            }}
            onSetDefault={async (row, isDefault) => {
              await updateCompanyPlace(cid, row.id, { isDefault });
            }}
            onRemove={async (row) => {
              await deleteCompanyPlace(cid, row.id);
            }}
          />

          {/* ══════ 监督举报条目 ══════ */}
          <EntryListCard
            icon={ShieldAlert}
            title="监督举报"
            hint="可维护多套监督举报信息（以监督人为标识）、单默认——默认者进入编写时预填「监督信息」四字段；不设默认则不预填。"
            fields={[
              { key: 'contact', label: '监督人（标识，必填）', placeholder: '多人顿号分隔，如：王先生、徐先生' },
              { key: 'department', label: '监督部门', placeholder: '留空 = 公司名称 + 纪检监察部' },
              { key: 'address', label: '监督地址', placeholder: '地址' },
              { key: 'phone', label: '监督电话', placeholder: '电话' },
            ]}
            entries={info.supervisionProfiles ?? []}
            onReload={reloadEntries}
            onCreate={async (v) => {
              await createCompanySupervision(cid, {
                contact: v.contact,
                department: v.department || null,
                address: v.address || null,
                phone: v.phone || null,
              });
            }}
            onUpdate={async (id, v) => {
              await updateCompanySupervision(cid, id, {
                contact: v.contact,
                department: v.department || null,
                address: v.address || null,
                phone: v.phone || null,
              });
            }}
            onSetDefault={async (row, isDefault) => {
              await updateCompanySupervision(cid, row.id, { isDefault });
            }}
            onRemove={async (row) => {
              await deleteCompanySupervision(cid, row.id);
            }}
          />

          {/* ══════ 采购人条目 ══════ */}
          <EntryListCard
            icon={UserRound}
            title="采购人"
            hint="可维护多位采购人、单默认——默认者进入编写时预填联系人三字段，编写时可点「联系人」按钮改选；不设默认则不预填。"
            fields={[
              { key: 'name', label: '姓名', placeholder: '姓名（必填）' },
              { key: 'phone', label: '联系电话', placeholder: '电话', type: 'tel' },
              { key: 'email', label: '电子邮箱', placeholder: '邮箱', type: 'email' },
            ]}
            entries={info.purchasers ?? []}
            onReload={reloadEntries}
            onCreate={async (v) => {
              await createCompanyPurchaser(cid, { name: v.name, phone: v.phone || null, email: v.email || null });
            }}
            onUpdate={async (id, v) => {
              await updateCompanyPurchaser(cid, id, { name: v.name, phone: v.phone || null, email: v.email || null });
            }}
            onSetDefault={async (row, isDefault) => {
              await updateCompanyPurchaser(cid, row.id, { isDefault });
            }}
            onRemove={async (row) => {
              await deleteCompanyPurchaser(cid, row.id);
            }}
          />
        </>
      )}
    </Modal>
  );
}
