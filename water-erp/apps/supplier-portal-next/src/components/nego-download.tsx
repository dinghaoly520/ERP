"use client";
/**
 * 谈判采购文件门控下载（2026-11-05 下载方式治理）：
 * - 解密下载：必须输入密码（弹窗收集），下载 URL 带 ?password= 由后端校验；
 *   错误密码 → 后端 403 WRONG_PASSWORD，首个文件失败即中止、toast 后端文案。
 * - 免费下载：直接逐文件下载。付费下载已暂不支持（:3005 不再可配；旧 paid 配置
 *   后端归一为免费）。
 * 此前实现把后端下发的密码直接 toast 展示给供应商——闸门形同虚设，后端已同步
 * 停止下发密码（getNegotiationFiles 无 password 字段）。
 */
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { SpButton, SpDialog, SpInput } from "@/components/ui";
import { fetchAuthedFile, saveBlob } from "@/lib/authed-file";

export interface NegoFileEntry { url?: string; name?: string }
export interface NegoFilesMeta { downloadMode?: string; files?: NegoFileEntry[] }

/** 逐文件鉴权下载（带 token；解密模式附密码）。首个失败即中止，不静默丢下载。 */
export async function downloadNegotiationFilesGated(meta: NegoFilesMeta, password?: string): Promise<void> {
  const files = meta.files ?? [];
  if (files.length === 0) {
    toast.warning("该项目暂无可下载的采购文件");
    return;
  }
  const suffix = password ? `?password=${encodeURIComponent(password)}` : "";
  let done = 0;
  try {
    for (const f of files) {
      if (!f.url) continue;
      const blob = await fetchAuthedFile(`${f.url}${suffix}`);
      await saveBlob(blob, f.name || undefined);
      done += 1;
    }
    if (done > 0) toast.success(`已下载 ${done} 个采购文件`);
    else toast.warning("该项目暂无可下载的采购文件");
  } catch (e: unknown) {
    // 首个失败即中止：后续文件不再重试（密码错误/越权等场景整批停止）
    if (done > 0) toast.warning(`已下载 ${done} 个文件，余下因错误中止`);
    toast.error(e instanceof Error ? e.message : "文件获取失败");
  }
}

/** 解密下载密码弹窗（与公告采购文件的下载密码弹窗同款交互） */
export function NegoPasswordDialog({ open, onClose, onConfirm, busy }: {
  open: boolean;
  onClose: () => void;
  onConfirm: (password: string) => void;
  busy?: boolean;
}) {
  const [pwd, setPwd] = useState("");
  // 关闭即清空：重开弹窗不残留上次的密码输入（错密码重试场景）
  useEffect(() => { if (!open) setPwd(""); }, [open]);
  const submit = () => {
    const v = pwd.trim();
    if (!v) { toast.warning("请输入下载密码"); return; }
    onConfirm(v);
  };
  return (
    <SpDialog open={open} onClose={onClose} title="输入下载密码" width={380}
      footer={
        <>
          <SpButton variant="soft" onClick={onClose}>取消</SpButton>
          <SpButton variant="primary" disabled={busy} onClick={submit}>确认下载</SpButton>
        </>
      }
    >
      <div className="b-dialog-field">
        <span>下载密码</span>
        <SpInput value={pwd} maxLength={16} autoFocus onChange={(e) => setPwd(e.target.value)}
          placeholder="请输入采购管理方告知的下载密码"
          onKeyDown={(e) => { if (e.key === "Enter") submit(); }} />
      </div>
    </SpDialog>
  );
}
