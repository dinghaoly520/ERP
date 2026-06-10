import { api } from '../api';
import type { Supplier, SupplierListResponse, SupplierClassification, SupplierEvaluation, SupplierChangeRecord, SupplierQualification, Notification } from '../types';

// 供应商注册
export function registerSupplier(data: {
  name: string;
  creditCode: string;
  enterpriseType: string;
  legalPerson: string;
  registeredAddress: string;
  businessScope: string;
  username: string;
  displayName: string;
  password: string;
  email?: string;
  contacts: { name: string; phone: string; email?: string; isPrimary: boolean }[];
  qualifications: { type: string; name: string; fileUrl: string; validFrom?: string; validTo?: string }[];
}) {
  return api.post<{ user: any; supplier: Supplier }>('/supplier/register', data);
}

// 查询注册状态
export function getRegisterStatus() {
  return api.get<{ id: string; name: string; status: string; returnReason?: string; rejectReason?: string }>('/supplier/register/status');
}

// 供应商列表
export function getSupplierList(params?: { status?: string; classificationId?: string; search?: string; page?: number; pageSize?: number }) {
  const query = new URLSearchParams();
  if (params?.status) query.set('status', params.status);
  if (params?.classificationId) query.set('classificationId', params.classificationId);
  if (params?.search) query.set('search', params.search);
  if (params?.page) query.set('page', String(params.page));
  if (params?.pageSize) query.set('pageSize', String(params.pageSize));
  return api.get<SupplierListResponse>(`/supplier/list?${query.toString()}`);
}

// 供应商详情
export function getSupplier(id: string) {
  return api.get<Supplier>(`/supplier/${id}`);
}

// 审核通过
export function approveSupplier(id: string) {
  return api.post<{ success: boolean }>(`/supplier/${id}/approve`, {});
}

// 审核不通过
export function rejectSupplier(id: string, reason: string) {
  return api.post<Supplier>(`/supplier/${id}/reject`, { reason });
}

// 退回补正
export function returnSupplier(id: string, reason: string) {
  return api.post<Supplier>(`/supplier/${id}/return`, { reason });
}

// 更新状态
export function updateSupplierStatus(id: string, status: 'DISABLED' | 'BLACKLIST', reason: string) {
  return api.patch<Supplier>(`/supplier/${id}/status?status=${status}`, { reason });
}

// 变更记录列表
export function getSupplierChanges(id: string) {
  return api.get<SupplierChangeRecord[]>(`/supplier/${id}/changes`);
}

// 提交变更申请
export function createChangeRequest(id: string, data: { fieldName: string; fieldLabel: string; newValue: string; reason?: string }) {
  return api.post<SupplierChangeRecord>(`/supplier/${id}/changes`, data);
}

// 审核变更
export function approveChange(changeId: string) {
  return api.post<{ success: boolean }>(`/supplier/changes/${changeId}/approve`, {});
}

// 拒绝变更
export function rejectChange(changeId: string, rejectReason: string) {
  return api.post<SupplierChangeRecord>(`/supplier/changes/${changeId}/reject`, { rejectReason });
}

// 资质材料列表
export function getQualifications(id: string) {
  return api.get<SupplierQualification[]>(`/supplier/${id}/qualifications`);
}

// 上传资质材料
export function addQualification(id: string, data: { type: string; name: string; fileUrl: string; validFrom?: string; validTo?: string }) {
  return api.post<SupplierQualification>(`/supplier/${id}/qualifications`, data);
}

// 删除资质材料
export function deleteQualification(id: string, qid: string) {
  return api.delete<SupplierQualification>(`/supplier/${id}/qualifications/${qid}`);
}

// 评价记录列表
export function getSupplierEvaluations(id: string) {
  return api.get<SupplierEvaluation[]>(`/supplier/${id}/evaluations`);
}

// 发起评价
export function createEvaluation(id: string, data: {
  projectId?: string;
  completenessScore: number;
  responsivenessScore: number;
  cooperationScore: number;
  complianceScore: number;
  overallScore: number;
  comment?: string;
}) {
  return api.post<SupplierEvaluation>(`/supplier/${id}/evaluations`, data);
}

// 评价统计
export function getEvaluationStats() {
  return api.get<{ levelCounts: { A: number; B: number; C: number; D: number }; avgScore: number; total: number }>('/supplier/evaluations/stats');
}

// 分类列表
export function getClassifications() {
  return api.get<SupplierClassification[]>('/supplier/classifications');
}

// 创建分类
export function createClassification(data: { name: string; code: string; description?: string }) {
  return api.post<SupplierClassification>('/supplier/classifications', data);
}

// 更新分类
export function updateClassification(id: string, data: { name?: string; code?: string; description?: string }) {
  return api.patch<SupplierClassification>(`/supplier/classifications/${id}`, data);
}

// 删除分类
export function deleteClassification(id: string) {
  return api.delete<SupplierClassification>(`/supplier/classifications/${id}`);
}

// 通知列表
export function getNotifications(page?: number, pageSize?: number) {
  const query = new URLSearchParams();
  if (page) query.set('page', String(page));
  if (pageSize) query.set('pageSize', String(pageSize));
  return api.get<{ total: number; page: number; pageSize: number; items: Notification[] }>(`/notifications?${query.toString()}`);
}

// 未读通知数量
export function getUnreadNotificationCount() {
  return api.get<{ count: number }>('/notifications/unread-count');
}

// 标记已读
export function markNotificationRead(id: string) {
  return api.post<Notification>(`/notifications/${id}/read`, {});
}

// 全部标记已读
export function markAllNotificationsRead() {
  return api.post<{ count: number }>('/notifications/mark-all-read', {});
}