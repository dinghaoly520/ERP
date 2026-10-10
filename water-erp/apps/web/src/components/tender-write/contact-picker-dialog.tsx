"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, Check, Loader2, Pencil, Plus, Trash2, User, UserCheck, X } from "lucide-react";
import {
  createContact,
  deleteContact,
  fetchContacts,
  updateContact,
} from "@/lib/api/contacts";
import type { Contact } from "@/lib/api/contacts";

type PickedContact = { name: string; email: string; phone: string };

type ContactPickerDialogProps = {
  isOpen: boolean;
  /** 单选模式：点击即选中并关闭（联系人字段） */
  onSelect: (contact: PickedContact) => void;
  onClose: () => void;
  /**
   * 多选模式（监督人，2026-10-09）：点击勾选/取消，底部「确认」一次性回调。
   * 联系人列表已按当前账号公司隔离（contacts API companyId 过滤）。
   */
  multiple?: boolean;
  /** multiple 模式回显：已选名单（按联系人姓名对齐勾选态） */
  selectedNames?: string[];
  onConfirmMultiple?: (contacts: PickedContact[]) => void;
};

export function ContactPickerDialog({
  isOpen,
  onSelect,
  onClose,
  multiple = false,
  selectedNames = [],
  onConfirmMultiple,
}: ContactPickerDialogProps) {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ name: "", email: "", phone: "" });
  const [addingNew, setAddingNew] = useState(false);
  const [newForm, setNewForm] = useState({ name: "", email: "", phone: "" });
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // 多选模式：选中集（按联系人 id 键控）
  const [selected, setSelected] = useState<Record<string, Contact>>({});

  const loadContacts = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchContacts();
      setContacts(data);
      return data;
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载联系人失败");
      return null;
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      loadContacts();
      setEditingId(null);
      setAddingNew(false);
      setSelected({});
    }
  }, [isOpen]);

  // 多选回显：把外部已选名单（按姓名）对齐为勾选态
  useEffect(() => {
    if (!multiple || contacts.length === 0) return;
    const wanted = new Set(selectedNames.map((n) => n.trim()).filter(Boolean));
    if (wanted.size === 0) return;
    setSelected((prev) => {
      const next = { ...prev };
      for (const c of contacts) {
        if (wanted.has(c.name.trim())) next[c.id] = c;
      }
      return next;
    });
    // selectedNames 由父组件在打开时传入一次即可；contacts 加载后对齐
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [multiple, contacts]);

  const handleEdit = (contact: Contact) => {
    setEditingId(contact.id);
    setEditForm({
      name: contact.name,
      email: contact.email ?? "",
      phone: contact.phone ?? "",
    });
  };

  const handleSaveEdit = async () => {
    if (!editingId || !editForm.name.trim()) return;
    setError(null);
    try {
      const updated = await updateContact(editingId, {
        name: editForm.name.trim(),
        email: editForm.email.trim() || undefined,
        phone: editForm.phone.trim() || undefined,
      });
      setContacts((prev) =>
        prev.map((c) => (c.id === editingId ? updated : c)),
      );
      setEditingId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败");
    }
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setEditForm({ name: "", email: "", phone: "" });
  };

  const handleAddNew = () => {
    setAddingNew(true);
    setNewForm({ name: "", email: "", phone: "" });
  };

  const handleSaveNew = async () => {
    if (!newForm.name.trim()) return;
    setError(null);
    try {
      const created = await createContact({
        name: newForm.name.trim(),
        email: newForm.email.trim() || undefined,
        phone: newForm.phone.trim() || undefined,
      });
      setContacts((prev) => [created, ...prev]);
      if (multiple) {
        // 新建即选中（多选场景：加的就是要的）
        setSelected((prev) => ({ ...prev, [created.id]: created }));
      }
      setAddingNew(false);
      setNewForm({ name: "", email: "", phone: "" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "添加失败");
    }
  };

  const handleCancelNew = () => {
    setAddingNew(false);
    setNewForm({ name: "", email: "", phone: "" });
  };

  const handleDelete = async (id: string) => {
    setError(null);
    setDeletingId(id);
    try {
      await deleteContact(id);
      setContacts((prev) => prev.filter((c) => c.id !== id));
      setSelected((prev) => {
        if (!prev[id]) return prev;
        const next = { ...prev };
        delete next[id];
        return next;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "删除失败");
    } finally {
      setDeletingId(null);
    }
  };

  const handleSelect = (contact: Contact) => {
    onSelect({
      name: contact.name,
      email: contact.email ?? "",
      phone: contact.phone ?? "",
    });
    onClose();
  };

  const toggleSelected = (contact: Contact) => {
    setSelected((prev) => {
      const next = { ...prev };
      if (next[contact.id]) delete next[contact.id];
      else next[contact.id] = contact;
      return next;
    });
  };

  const handleConfirmMultiple = () => {
    const picked = Object.values(selected).map((c) => ({
      name: c.name,
      email: c.email ?? "",
      phone: c.phone ?? "",
    }));
    onConfirmMultiple?.(picked);
    onClose();
  };

  const inputClass = "min-h-[36px] rounded-[10px] border border-[oklch(0.6_0.04_258_/_0.25)] bg-[oklch(1_0_0_/_0.5)] px-3 py-2 text-sm outline-none focus:border-[rgba(107,149,240,0.34)]";
  const selectedList = Object.values(selected);

  if (!isOpen) return null;

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center px-4 py-6">
      <div
        className="absolute inset-0 bg-[var(--background)]/60 backdrop-blur-md"
        onClick={onClose}
      />
      <div className="relative z-10 flex w-full max-w-[480px] flex-col overflow-hidden rounded-[24px] bg-[var(--background)] shadow-[0_20px_60px_rgba(0,0,0,0.12)]">
        <div className="px-6 py-4" style={{ borderBottom: "1px solid oklch(0.6 0.04 258 / 0.16)" }}>
          <div className="flex items-center justify-between">
            <div className="text-sm font-semibold text-[color:var(--foreground)]">
              {multiple ? "监督人多选（本公司联系人）" : "联系人管理"}
            </div>
            <div className="flex items-center gap-2">
              {!addingNew && (
                <button type="button" onClick={handleAddNew} className="neu-btn-soft">
                  <Plus size={12} />
                  新增
                </button>
              )}
              <button type="button" onClick={onClose} className="neu-btn-xs" aria-label="关闭">
                <X size={14} />
              </button>
            </div>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-[color:var(--muted-foreground)]">
              <Loader2 size={16} className="animate-spin" />
              正在加载...
            </div>
          ) : error ? (
            <div className="rounded-[12px] border border-[color-mix(in_oklch,var(--danger)_20%,transparent)] bg-[color-mix(in_oklch,var(--danger)_8%,transparent)] px-4 py-3 text-sm text-[color:var(--danger)]">
              {error}
            </div>
          ) : (
            <div className="space-y-3">
              {addingNew && (
                <div className="rounded-[16px] border border-[rgba(96,139,239,0.3)] bg-[rgba(96,139,239,0.06)] px-4 py-3">
                  <div className="grid gap-2">
                    <input type="text" value={newForm.name} onChange={(e) => setNewForm({ ...newForm, name: e.target.value })} placeholder="姓名 *" className={inputClass} />
                    <input type="email" value={newForm.email} onChange={(e) => setNewForm({ ...newForm, email: e.target.value })} placeholder="邮箱" className={inputClass} />
                    <input type="tel" value={newForm.phone} onChange={(e) => setNewForm({ ...newForm, phone: e.target.value })} placeholder="电话" className={inputClass} />
                  </div>
                  <div className="mt-2 flex gap-2">
                    <button type="button" onClick={handleSaveNew} disabled={!newForm.name.trim()} className="neu-btn-soft is-success">保存</button>
                    <button type="button" onClick={handleCancelNew} className="neu-btn-soft"><ArrowLeft size={12} />返回</button>
                  </div>
                </div>
              )}

              {contacts.length === 0 && !addingNew ? (
                <div className="wb-panel flex items-center justify-center px-4 py-6 text-center text-sm text-[color:var(--muted-foreground)]">暂无联系人</div>
              ) : (
                contacts.map((contact) => {
                  const isSelected = Boolean(selected[contact.id]);
                  return (
                    <div
                      key={contact.id}
                      className={`neu-card-static !rounded-[14px] px-4 py-3 transition-colors ${
                        multiple && isSelected ? "!border-[rgba(76,111,189,0.55)] !bg-[rgba(96,139,239,0.1)]" : ""
                      }`}
                    >
                      {editingId === contact.id ? (
                        <div className="grid gap-2">
                          <input type="text" value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} placeholder="姓名 *" className={inputClass} />
                          <input type="email" value={editForm.email} onChange={(e) => setEditForm({ ...editForm, email: e.target.value })} placeholder="邮箱" className={inputClass} />
                          <input type="tel" value={editForm.phone} onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })} placeholder="电话" className={inputClass} />
                          <div className="flex gap-2">
                            <button type="button" onClick={handleSaveEdit} disabled={!editForm.name.trim()} className="neu-btn-soft is-success">保存</button>
                            <button type="button" onClick={handleCancelEdit} className="neu-btn-soft">取消</button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-center justify-between gap-3">
                          <button
                            type="button"
                            onClick={() => (multiple ? toggleSelected(contact) : handleSelect(contact))}
                            className="flex min-w-0 flex-1 items-center gap-3 text-left"
                            aria-pressed={multiple ? isSelected : undefined}
                          >
                            <div
                              className={`relative rounded-[8px] border p-2 transition-colors ${
                                multiple && isSelected
                                  ? "border-[rgba(76,111,189,0.55)] bg-[rgba(96,139,239,0.16)]"
                                  : "border-[rgba(96,139,239,0.18)] bg-[rgba(96,139,239,0.08)]"
                              }`}
                            >
                              {multiple && isSelected ? (
                                <UserCheck size={14} className="text-[color:var(--accent)]" />
                              ) : (
                                <User size={14} className="text-[color:var(--accent)]" />
                              )}
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="truncate text-sm font-semibold text-[color:var(--foreground)]">{contact.name}</div>
                              <div className="mt-0.5 truncate text-[11px] text-[color:var(--muted-foreground)]">
                                {contact.email && <span>{contact.email}</span>}
                                {contact.email && contact.phone && <span className="mx-1.5">·</span>}
                                {contact.phone && <span>{contact.phone}</span>}
                              </div>
                            </div>
                            {multiple && isSelected && (
                              <span className="flex items-center gap-1 text-[11px] font-semibold text-[color:var(--accent)]">
                                <Check size={13} />已选
                              </span>
                            )}
                          </button>
                          <div className="flex items-center gap-0.5">
                            <button type="button" onClick={() => handleEdit(contact)} className="neu-btn-xs" title="编辑"><Pencil size={13} /></button>
                            <button type="button" onClick={() => void handleDelete(contact.id)} disabled={deletingId === contact.id} className="neu-btn-xs is-danger" title="删除">
                              {deletingId === contact.id ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          )}
        </div>

        {multiple && (
          <div
            className="flex items-center justify-between gap-3 px-6 py-3"
            style={{ borderTop: "1px solid oklch(0.6 0.04 258 / 0.16)" }}
          >
            <div className="text-xs text-[color:var(--muted-foreground)]">
              已选 {selectedList.length} 人
              {selectedList.length > 0 && (
                <span className="ml-1 text-[color:var(--foreground)]">
                  （{selectedList.map((c) => c.name).join("、")}）
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button type="button" onClick={onClose} className="neu-btn-soft">取消</button>
              <button
                type="button"
                onClick={handleConfirmMultiple}
                disabled={selectedList.length === 0}
                className="neu-btn-soft is-success disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Check size={12} />
                确认选择
              </button>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
