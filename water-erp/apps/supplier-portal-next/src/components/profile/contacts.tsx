"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { ArrowRight, Phone, Plus, X } from "lucide-react";
import { supplierApi } from "@/lib/api/supplier";
import { sanitizePhoneInput } from "@/lib/phone-input";
import { cn } from "@/lib/utils";
import { SpButton } from "@/components/ui";
import { useConfirm } from "@/components/use-confirm";
import "@/styles/pages/profile.css";

/* ═══ 联系人 Tab（CompanyInfo 内联版 — 操作栏 + 表格 + 空态）═══ */
export function ContactsTab({ contacts, onAdd, onEdit, onDelete }: {
  contacts: any[];
  onAdd: () => void;
  onEdit: (c: any) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <>
      <div className="quals-actions">
        {/* 白瓷片变体 + 38px（2026-10-22 用户口径）：不用深色实心主按钮，与「提出异议」等
            门户操作钮同款（neu-btn-primary.is-water：纯白底 + 顶缘内高光 + 品牌蓝粗体） */}
        <SpButton variant="primary" water icon={Plus} className="!h-[38px] !px-5" onClick={onAdd}>添加联系人</SpButton>
      </div>
      {contacts.length > 0 ? (
        <div className="neu-table-card ct-table-wrap">
          <div className="overflow-x-auto">
          <table className="neu-table">
            <thead>
              <tr>
                {/* 全列居中：globals .neu-table th 默认已改居中（2026-10-22 第二次错位后基类翻转）。
                    列宽（2026-10-28 用户实录「邮箱列过宽」）：全列显式定宽——此前邮箱是唯一
                    auto 列，table-layout:auto 下独占全部剩余宽度；定宽后剩余空间按各列比例
                    摊开，宽屏不再单列拉肥。 */}
                <th style={{ width: 150 }}>姓名</th>
                <th style={{ width: 70 }}>性别</th>
                <th style={{ width: 150 }}>手机号</th>
                <th style={{ width: 230 }}>邮箱</th>
                <th style={{ width: 130 }}>职位</th>
                <th style={{ width: 110 }}>主要联系人</th>
                <th style={{ width: 150 }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {contacts.map((row) => (
                <tr key={row.id}>
                  <td>
                    <div className="contact-name-cell justify-center">
                      <span className="contact-avatar">{row.name?.charAt(0)}</span>
                      <span className="contact-name">{row.name}</span>
                    </div>
                  </td>
                  <td>{row.gender || "—"}</td>
                  <td>{row.phone}</td>
                  <td><span className="ct-cell-ellipsis" title={row.email || undefined}>{row.email || "—"}</span></td>
                  <td><span className="ct-cell-ellipsis" title={row.position || undefined}>{row.position || "—"}</span></td>
                  <td>
                    <span className={cn("ct-tag", row.isPrimary ? "ct-tag--primary" : "ct-tag--info")}>
                      {row.isPrimary ? "主要" : "普通"}
                    </span>
                  </td>
                  <td>
                    <div className="flex items-center justify-center gap-1.5">
                      <button type="button" className="neu-btn-xs" onClick={() => onEdit(row)}>编辑</button>
                      <button type="button" className="neu-btn-xs is-danger" onClick={() => onDelete(row.id)}>删除</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
      ) : (
        <div className="prof-card ct-empty">
          <div className="sp-empty-icon"><Phone size={22} strokeWidth={1.75} /></div>
          <p className="ct-empty-title">暂无联系人</p>
          <p className="ct-empty-desc">请添加企业联系人信息</p>
        </div>
      )}
    </>
  );
}

/* ═══ 联系人弹窗（ct-panel — Teleport 等价）═══
   editing=null 新增 / editing=联系人 编辑；挂载即按入参重置表单（对应 ctOpenAdd / ctOpenEdit）。 */
export function ContactPanel({ editing, onSaved, onClose }: {
  editing: any | null;
  onSaved: () => void;
  onClose: () => void;
}) {
  const isEdit = !!editing;
  const { confirm, dialog } = useConfirm();
  const [form, setForm] = useState({
    name: editing?.name ?? "",
    phone: editing?.phone ?? "",
    email: editing?.email || "",
    position: editing?.position || "",
    isPrimary: editing?.isPrimary ?? false,
    // B4-2（2026-09-30）：注册口径字段补录入口——完整度按「全员有性别/身份证号」各计 2 分，
    // 此前仅注册可写，维护端新增的联系人永久拉低完整度且表格列恒空
    gender: editing?.gender || "",
    idCard: editing?.idCard || "",
  });
  const [loading, setLoading] = useState(false);
  const [dirty, setDirty] = useState(false);

  const markDirty = () => setDirty(true);

  // 全必填完整度（按钮闸门 + 底部提示共用）：六字段齐 = 可提交（格式校验在 handleSubmit 逐项精确报错）
  const allFilled = !!form.name.trim() && !!form.phone.trim() && !!form.email.trim() && !!form.position.trim() && !!form.gender && !!form.idCard.trim();

  const closePanel = async () => {
    if (dirty && !(await confirm({ message: "当前有未保存的修改，关闭后会丢失。确定关闭吗？" }))) return;
    onClose();
  };

  // 全字段必填（2026-10-22 用户口径）：逐字段精确报错——第一处失败即指名道姓，不再笼统提示
  const handleSubmit = async () => {
    if (!form.name.trim()) { toast.warning("请填写姓名"); return; }
    if (!form.phone.trim()) { toast.warning("请填写手机号"); return; }
    if (!/^1[3-9]\d{9}$/.test(form.phone)) { toast.warning("手机号格式不正确：须为 1 开头的 11 位数字"); return; }
    if (!form.email.trim()) { toast.warning("请填写邮箱"); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) { toast.warning("邮箱格式不正确，例如 name@example.com"); return; }
    if (!form.position.trim()) { toast.warning("请填写职位/职务"); return; }
    if (!form.gender) { toast.warning("请选择性别"); return; }
    if (!form.idCard.trim()) { toast.warning("请填写身份证号"); return; }
    if (!/^\d{17}[\dXx]$/.test(form.idCard)) { toast.warning("身份证号格式不正确：须为 18 位（末位可为 X）"); return; }
    setLoading(true);
    try {
      if (isEdit) {
        await supplierApi.updateContact(editing.id, form);
        toast.success("联系人更新成功");
      } else {
        await supplierApi.addContact(form);
        toast.success("联系人添加成功");
      }
      onSaved();
    } catch {
      /* 错误提示已由 API 层统一弹出 */
    } finally {
      setLoading(false);
    }
  };

  return createPortal(
    <div className="ct-overlay" onClick={(e) => { if (e.target === e.currentTarget) closePanel(); }}>
      <div className="ct-panel">
        <div className="ct-panel-head">
          <div className="ct-panel-head-left">
            <div className="ct-panel-head-icon"><Phone size={20} /></div>
            <div>
              <h2 className="ct-panel-title">{isEdit ? "编辑联系人" : "添加联系人"}</h2>
              <p className="ct-panel-sub">{isEdit ? "修改联系人信息后保存" : "填写企业联系人姓名与联系方式"}</p>
            </div>
          </div>
          <button type="button" className="ct-panel-close" onClick={closePanel}><X size={18} /></button>
        </div>
        <div className="ct-panel-body">
          <div className="ct-panel-sec">
            <div className="ct-panel-sec-label"><span className="ct-panel-sec-dot" />基本信息</div>
            <div className="ct-panel-row">
              <div className="ct-panel-field">
                <label className="ct-panel-label">姓名 <i>*</i></label>
                <input
                  className="ct-panel-input"
                  value={form.name}
                  onChange={(e) => { setForm((f) => ({ ...f, name: e.target.value })); markDirty(); }}
                  placeholder="请输入姓名"
                  maxLength={20}
                />
              </div>
              <div className="ct-panel-field">
                <label className="ct-panel-label">手机号 <i>*</i></label>
                <input
                  className="ct-panel-input"
                  value={form.phone}
                  onChange={(e) => { setForm((f) => ({ ...f, phone: sanitizePhoneInput(e.target.value) })); markDirty(); }}
                  onBlur={(e) => {
                    // DOM 兜底回同步（2026-10-19，同注册页口径）：旁路 onChange 的填充
                    // （自动填充/输入法）会让状态落后于显示值，失焦时以 DOM 为准对齐
                    const healed = sanitizePhoneInput(e.target.value);
                    setForm((f) => (f.phone === healed ? f : { ...f, phone: healed }));
                  }}
                  placeholder="请输入11位手机号"
                  inputMode="numeric"
                />
              </div>
            </div>
            <div className="ct-panel-row mt-3.5">
              <div className="ct-panel-field">
                <label className="ct-panel-label">邮箱 <i>*</i></label>
                <input
                  className="ct-panel-input"
                  value={form.email}
                  onChange={(e) => { setForm((f) => ({ ...f, email: e.target.value })); markDirty(); }}
                  placeholder="请输入邮箱，例如 name@example.com"
                />
              </div>
              <div className="ct-panel-field">
                <label className="ct-panel-label">职位/职务 <i>*</i></label>
                <input
                  className="ct-panel-input"
                  value={form.position}
                  onChange={(e) => { setForm((f) => ({ ...f, position: e.target.value })); markDirty(); }}
                  placeholder="请输入职位/职务"
                  maxLength={50}
                />
              </div>
            </div>
            <div className="ct-panel-row mt-3.5">
              <div className="ct-panel-field">
                <label className="ct-panel-label">性别 <i>*</i></label>
                <select
                  className="ct-panel-input"
                  value={form.gender}
                  onChange={(e) => { setForm((f) => ({ ...f, gender: e.target.value })); markDirty(); }}
                >
                  <option value="">请选择</option>
                  <option value="男">男</option>
                  <option value="女">女</option>
                </select>
              </div>
              <div className="ct-panel-field">
                <label className="ct-panel-label">身份证号 <i>*</i></label>
                <input
                  className="ct-panel-input"
                  value={form.idCard}
                  onChange={(e) => { setForm((f) => ({ ...f, idCard: e.target.value.toUpperCase() })); markDirty(); }}
                  placeholder="请输入 18 位身份证号"
                  maxLength={18}
                />
              </div>
            </div>
            <div className="ct-panel-row mt-3.5">
              <div className="ct-panel-field ct-panel-field--toggle">
                <label className="ct-panel-label ct-panel-label--opt">主要联系人</label>
                <button
                  type="button"
                  className={cn("ct-toggle", form.isPrimary && "active")}
                  onClick={() => { setForm((f) => ({ ...f, isPrimary: !f.isPrimary })); markDirty(); }}
                >
                  <span className="ct-toggle-knob" />
                </button>
              </div>
            </div>
          </div>
        </div>
        <div className="ct-panel-foot">
          {!allFilled
            ? <span className="ct-panel-hint">所有字段均为必填，请完整填写</span>
            : <span className="ct-panel-hint ready">信息已就绪</span>}
          <div className="ct-panel-foot-actions">
            <button type="button" className="ct-panel-btn-cancel" onClick={closePanel}>取消</button>
            <button
              type="button"
              className={cn("ct-panel-btn-submit", allFilled && !loading && "ready")}
              disabled={!allFilled || loading}
              onClick={() => void handleSubmit()}
            >
              {loading ? <span>保存中…</span> : <><ArrowRight size={15} /><span>{isEdit ? "保存" : "确认添加"}</span></>}
            </button>
          </div>
        </div>
      </div>
      {dialog}
    </div>,
    document.body,
  );
}
