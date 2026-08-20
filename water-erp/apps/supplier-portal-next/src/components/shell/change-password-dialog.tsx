"use client";

import { useEffect, useState } from "react";
import { Lock, View, X } from "lucide-react";
import { toast } from "sonner";
import { supplierApi } from "@/lib/api/supplier";
import { SpButton } from "@/components/ui";

const Eye = View;
const EyeOff = ({ size, className, strokeWidth }: { size?: number; className?: string; strokeWidth?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth || 2} strokeLinecap="round" strokeLinejoin="round" className={className}>
    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
    <line x1="1" y1="1" x2="23" y2="23" />
  </svg>
);

/** 修改密码弹窗 — cgzxui neumorphic（与 Vue 版 .pwd-* 规格一致） */
export function ChangePasswordDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [form, setForm] = useState({ old: "", newPwd: "", confirm: "" });
  const [show, setShow] = useState({ old: false, newPwd: false, confirm: false });
  const [loading, setLoading] = useState(false);

  // 关闭即重置（对齐原 el-dialog destroy-on-close 行为）
  useEffect(() => {
    if (!open) {
      setForm({ old: "", newPwd: "", confirm: "" });
      setShow({ old: false, newPwd: false, confirm: false });
    }
  }, [open]);

  const ready =
    form.old.trim().length > 0 &&
    form.newPwd.length >= 6 &&
    form.confirm === form.newPwd;

  const hint = (() => {
    const { old, newPwd, confirm } = form;
    if (!old.trim()) return { text: "请先输入原密码", ok: false };
    if (newPwd.length === 0) return { text: "请设置新密码", ok: false };
    if (newPwd.length < 6) return { text: `新密码还差 ${6 - newPwd.length} 位`, ok: false };
    if (confirm !== newPwd) return { text: "两次输入的密码不一致", ok: false };
    return { text: "已准备好提交", ok: true };
  })();

  async function submit() {
    if (form.newPwd !== form.confirm) { toast.warning("两次密码不一致"); return; }
    if (form.newPwd.length < 6) { toast.warning("密码不少于6位"); return; }
    setLoading(true);
    try {
      await supplierApi.changePassword(form.old, form.newPwd);
      toast.success("密码修改成功");
      onClose();
    } catch {
      toast.error("密码修改失败");
    } finally {
      setLoading(false);
    }
  }

  if (!open) return null;
  return (
    <div className="pwd-ov" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="pwd-pn">
        <div className="pwd-h">
          <div className="pwd-hl">
            <div className="pwd-hi"><Lock size={20} strokeWidth={1.75} /></div>
            <div>
              <h2 className="pwd-t">修改密码</h2>
              <p className="pwd-sub">修改后下次登录使用新密码</p>
            </div>
          </div>
          <button type="button" className="pwd-x" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="pwd-b">
          <div className="pwd-f">
            <label>原密码 <i>*</i></label>
            <div className="pwd-iw">
              <input
                className="pwd-inp"
                value={form.old}
                onChange={(e) => setForm((f) => ({ ...f, old: e.target.value }))}
                type={show.old ? "text" : "password"}
                placeholder="请输入当前密码"
                autoComplete="current-password"
              />
              <button
                type="button"
                className={`pwd-eye${show.old ? " on" : ""}`}
                tabIndex={-1}
                onClick={() => setShow((s) => ({ ...s, old: !s.old }))}
              >
                {show.old ? <Eye size={15} /> : <EyeOff size={15} />}
              </button>
            </div>
          </div>
          <div className="pwd-f">
            <label>新密码 <i>*</i></label>
            <div className="pwd-iw">
              <input
                className="pwd-inp"
                value={form.newPwd}
                onChange={(e) => setForm((f) => ({ ...f, newPwd: e.target.value }))}
                type={show.newPwd ? "text" : "password"}
                placeholder="不少于6位，建议字母+数字组合"
                autoComplete="new-password"
              />
              <button
                type="button"
                className={`pwd-eye${show.newPwd ? " on" : ""}`}
                tabIndex={-1}
                onClick={() => setShow((s) => ({ ...s, newPwd: !s.newPwd }))}
              >
                {show.newPwd ? <Eye size={15} /> : <EyeOff size={15} />}
              </button>
            </div>
          </div>
          <div className="pwd-f">
            <label>确认新密码 <i>*</i></label>
            <div className="pwd-iw">
              <input
                className="pwd-inp"
                value={form.confirm}
                onChange={(e) => setForm((f) => ({ ...f, confirm: e.target.value }))}
                type={show.confirm ? "text" : "password"}
                placeholder="请再次输入新密码"
                autoComplete="new-password"
                onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
              />
              <button
                type="button"
                className={`pwd-eye${show.confirm ? " on" : ""}`}
                tabIndex={-1}
                onClick={() => setShow((s) => ({ ...s, confirm: !s.confirm }))}
              >
                {show.confirm ? <Eye size={15} /> : <EyeOff size={15} />}
              </button>
            </div>
          </div>
        </div>
        <div className="pwd-ft">
          <span className={`pwd-hint${hint.ok ? " ok" : ""}`}>{hint.text}</span>
          <div className="pwd-acts">
            <SpButton onClick={onClose}>取消</SpButton>
            <SpButton variant="primary" disabled={!ready || loading} onClick={submit}>
              {loading ? "提交中…" : (<><Lock size={15} />确认修改</>)}
            </SpButton>
          </div>
        </div>
      </div>
    </div>
  );
}
