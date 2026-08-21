"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { AGREEMENT_TITLE, AGREEMENT_SECTIONS } from "@/constants/agreement";

/** 注册协议勾选 + 弹窗展示（移植自 Vue RegisterAgreement.vue，样式 .reg-agree-* 已入 globals.css） */
export function RegisterAgreement({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!visible) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setVisible(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [visible]);

  return (
    <div className="reg-agree">
      <label className="reg-agree-check inline-flex items-start gap-2 cursor-pointer">
        <input
          type="checkbox"
          className="mt-0.5 h-4 w-4 accent-[var(--brand)]"
          checked={value}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span className="reg-agree-text">
          我已阅读并同意
          <button
            type="button"
            className="reg-agree-link"
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); setVisible(true); }}
          >
            《{AGREEMENT_TITLE}》
          </button>
        </span>
      </label>

      {visible && (
        <div className="gdlg-ov" onMouseDown={(e) => { if (e.target === e.currentTarget) setVisible(false); }}>
          <div className="gdlg-pn" style={{ width: 680 }} role="dialog" aria-modal>
            <div className="gdlg-h">
              <div className="gdlg-hl">
                <div>
                  <h2 className="gdlg-t">{AGREEMENT_TITLE}</h2>
                </div>
              </div>
              <button type="button" className="gdlg-x" onClick={() => setVisible(false)} aria-label="关闭">
                <X size={18} strokeWidth={1.85} />
              </button>
            </div>
            <div className="gdlg-b">
              <div className="reg-agree-body">
                <p className="reg-agree-lead">
                  欢迎入驻蜀水云采采购平台。在提交注册申请前，请仔细阅读本协议。勾选「我已阅读并同意」即表示您已充分理解并同意本协议全部条款。
                </p>
                {AGREEMENT_SECTIONS.map((sec, i) => (
                  <section key={i} className="reg-agree-sec">
                    <h3 className="reg-agree-sec-title">{sec.title}</h3>
                    {sec.paragraphs.map((p, j) => (
                      <p key={j} className="reg-agree-p">{p}</p>
                    ))}
                  </section>
                ))}
              </div>
            </div>
            <div className="gdlg-ft">
              <button
                type="button"
                className="reg-agree-btn"
                onClick={() => { onChange(true); setVisible(false); }}
              >
                我已阅读并同意
              </button>
              <button type="button" className="reg-agree-btn reg-agree-btn--ghost" onClick={() => setVisible(false)}>
                关闭
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
