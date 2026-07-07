import type { AuthRole } from '@/lib/api/auth';

export const ROLE_LABELS: Record<AuthRole, string> = {
  admin: '管理员',
  leader: '领导',
  staff: '员工',
  procurement_staff: '采购管理岗',
  bid_host: '开标主持',
  bid_expert: '评审专家',
  supplier: '供应商',
  mall: '商城用户',
};
