"use client";

/**
 * 加密管理（admin）—— 管理方加密证书：投标文件第一道锁的公钥载体，轮转入口。
 * 2026-08-28 自 :3007 迁入（分工 v3：证书轮转属投递期管理动作，归 :3005 系统管理）。
 * 2026-08-31 视觉对齐 cgzxui 数据页标准（page-hero + 流程条 + 状态卡）。
 */

import { AdminCertPage } from "@/components/admin/admin-cert-card";

export default function CryptoAdminPage() {
  return <AdminCertPage />;
}
