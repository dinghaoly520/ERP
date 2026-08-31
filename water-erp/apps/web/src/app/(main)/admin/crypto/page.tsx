"use client";

/**
 * 加密管理（admin）—— 管理方加密证书：投标文件第一道锁的公钥载体，轮转入口。
 * 2026-08-28 自 :3007 迁入（分工 v3：证书轮转属投递期管理动作，归 :3005 系统管理）。
 */

import { AdminCertCard } from "@/components/admin/admin-cert-card";

export default function CryptoAdminPage() {
  return (
    <div className="mx-auto w-full max-w-3xl space-y-5">
      <div>
        <h1 className="text-lg font-bold text-[color:var(--foreground)]">加密管理</h1>
        <p className="mt-0.5 text-[13px] text-[color:var(--muted-foreground)]">
          投标文件加密所用的管理方证书——当前状态与更换
        </p>
      </div>
      <AdminCertCard />
      <p className="text-[11px] leading-relaxed text-[color:var(--muted-foreground)]">
        投标人递交投标文件时，系统用这份证书给文件上第一道锁，投标人的 U 盾再上第二道锁；
        开标前任何人（包括平台管理员）都无法看到投标内容，开标现场按流程依次解密。
      </p>
    </div>
  );
}
