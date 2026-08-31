/**
 * 管理方加密证书（双信封 v2 外层公钥载体）—— :3005 系统管理消费。
 * 2026-08-28 自 :3007（原 T17 侧栏小卡片）迁入：证书轮转属投递期管理动作，按分工 v3 归 :3005。
 */
import { api } from "../api";

export interface AdminCertInfo {
  id: string;
  certDn: string;
  publicKey: string;
  active: boolean;
  createdAt: string;
}

export function fetchAdminCert() {
  return api.get<AdminCertInfo | null>("/bid/admin-cert");
}

export function generateAdminCert() {
  return api.post<AdminCertInfo>("/bid/admin-cert/generate", {});
}
