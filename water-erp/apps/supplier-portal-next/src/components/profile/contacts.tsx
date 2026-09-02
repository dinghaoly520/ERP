"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { ArrowRight, Phone, Plus, X } from "lucide-react";
import { supplierApi } from "@/lib/api/supplier";
import { cn } from "@/lib/utils";
import { SpButton } from "@/components/ui";
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
        <SpButton variant="primary" icon={Plus} onClick={onAdd}>添加联系人</SpButton>
      </div>
      {contacts.length > 0 ? (
        <div className="neu-table-card ct-table-wrap">
          <table className="neu-table">
            <thead>
              <tr>
                <th style={{ width: 160 }}>姓名</th>
                <th style={{ width: 80 }}>性别</th>
                <th style={{ width: 160 }}>手机号</th>
                <th>邮箱</th>
                <th style={{ width: 120 }}>职位</th>
                <th style={{ width: 120 }}>主要联系人</th>
                <th style={{ width: 160 }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {contacts.map((row) => (
                <tr key={row.id}>
                  <td>
                    <div className="contact-name-cell">
                      <span className="contact-avatar">{row.name?.charAt(0)}</span>
                      <span className="contact-name">{row.name}</span>
                    </div>
                  </td>
                  <td>{row.gender || "—"}</td>
                  <td>{row.phone}</td>
                  <td>{row.email || "—"}</td>
                  <td>{row.position || "—"}</td>
                  <td>
                    <span className={cn("ct-tag", row.isPrimary ? "ct-tag--primary" : "ct-tag--info")}>
                      {row.isPrimary ? "主要" : "普通"}
                    </span>
                  </td>
                  <td>
                    <button type="button" className="neu-btn-xs" onClick={() => onEdit(row)}>编辑</button>
                    <button type="button" className="neu-btn-xs is-danger" onClick={() => onDelete(row.id)}>删除</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
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
  const [form, setForm] = useState({
    name: editing?.name ?? "",
    phone: editing?.phone ?? "",
    email: editing?.email || "",
    position: editing?.position || "",
    isPrimary: editing?.isPrimary ?? false,
  });
  const [loading, setLoading] = useState(false);
  const [dirty, setDirty] = useState(false);

  const markDirty = () => setDirty(true);

  const closePanel = () => {
    if (dirty && !window.confirm("当前有未保存的修改，关闭后会丢失。确定关闭吗？")) return;
    onClose();
  };

  const handleSubmit = async () => {
    if (!form.name || !form.phone) { toast.warning("请填写姓名和手机号"); return; }
    if (!/^1[3-9]\d{9}$/.test(form.phone)) { toast.warning("请输入正确的11位手机号"); return; }
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
                  onChange={(e) => { setForm((f) => ({ ...f, phone: e.target.value })); markDirty(); }}
                  placeholder="请输入11位手机号"
                  maxLength={11}
                />
              </div>
            </div>
            <div className="ct-panel-row" style={{ marginTop: 14 }}>
              <div className="ct-panel-field">
                <label className="ct-panel-label ct-panel-label--opt">邮箱</label>
                <input
                  className="ct-panel-input"
                  value={form.email}
                  onChange={(e) => { setForm((f) => ({ ...f, email: e.target.value })); markDirty(); }}
                  placeholder="请输入邮箱（选填）"
                />
              </div>
              <div className="ct-panel-field">
                <label className="ct-panel-label ct-panel-label--opt">职位/职务</label>
                <input
                  className="ct-panel-input"
                  value={form.position}
                  onChange={(e) => { setForm((f) => ({ ...f, position: e.target.value })); markDirty(); }}
                  placeholder="请输入职位/职务"
                  maxLength={50}
                />
              </div>
            </div>
            <div className="ct-panel-row" style={{ marginTop: 14 }}>
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
          {!form.name && !form.phone
            ? <span className="ct-panel-hint">请填写联系人信息</span>
            : <span className="ct-panel-hint ready">信息已就绪</span>}
          <div className="ct-panel-foot-actions">
            <button type="button" className="ct-panel-btn-cancel" onClick={closePanel}>取消</button>
            <button
              type="button"
              className={cn("ct-panel-btn-submit", form.name && form.phone && !loading && "ready")}
              disabled={!form.name || !form.phone || loading}
              onClick={() => void handleSubmit()}
            >
              {loading ? <span>保存中…</span> : <><ArrowRight size={15} /><span>{isEdit ? "保存" : "确认添加"}</span></>}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
