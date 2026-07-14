"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, Loader2, Pencil, Plus, Trash2, User, X } from "lucide-react";
import {
  createContact,
  deleteContact,
  fetchContacts,
  updateContact,
} from "@/lib/api/contacts";
import type { Contact } from "@/lib/api/contacts";

type ContactPickerDialogProps = {
  isOpen: boolean;
  onSelect: (contact: { name: string; email: string; phone: string }) => void;
  onClose: () => void;
};

export function ContactPickerDialog({
  isOpen,
  onSelect,
  onClose,
}: ContactPickerDialogProps) {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ name: "", email: "", phone: "" });
  const [addingNew, setAddingNew] = useState(false);
  const [newForm, setNewForm] = useState({ name: "", email: "", phone: "" });
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadContacts = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchContacts();
      setContacts(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载联系人失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      loadContacts();
      setEditingId(null);
      setAddingNew(false);
    }
  }, [isOpen]);

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

  const inputClass = "min-h-[36px] rounded-[10px] border border-[oklch(0.6_0.04_258_/_0.25)] bg-[oklch(1_0_0_/_0.5)] px-3 py-2 text-sm outline-none focus:border-[rgba(107,149,240,0.34)]";

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
              联系人管理
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
                contacts.map((contact) => (
                  <div key={contact.id} className="neu-card-static !rounded-[14px] px-4 py-3">
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
                        <button type="button" onClick={() => handleSelect(contact)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                          <div className="rounded-[8px] border border-[rgba(96,139,239,0.18)] bg-[rgba(96,139,239,0.08)] p-2">
                            <User size={14} className="text-[color:var(--accent)]" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-semibold text-[color:var(--foreground)]">{contact.name}</div>
                            <div className="mt-0.5 truncate text-[11px] text-[color:var(--muted-foreground)]">
                              {contact.email && <span>{contact.email}</span>}
                              {contact.email && contact.phone && <span className="mx-1.5">·</span>}
                              {contact.phone && <span>{contact.phone}</span>}
                            </div>
                          </div>
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
                ))
              )}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
