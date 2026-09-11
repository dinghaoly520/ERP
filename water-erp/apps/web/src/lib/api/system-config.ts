import { api } from '../api';

/** 供应商门户「澄清答疑」区块展示的说明文案（公开读取） */
export function getClarificationNotice() {
  return api.get<{ value: string }>('/system-config/clarification-notice');
}

/** 编辑发布澄清说明文案（采购管理方）——保存即发布，供应商端实时展示 */
export function updateClarificationNotice(value: string) {
  return api.put<{ key: string; value: string; updatedAt: string }>(
    '/system-config/clarification-notice',
    { value },
  );
}

/** 异议联系方式（公开读取）——公告发布向导带入、公告详情页单独展示 */
export function getObjectionContact() {
  return api.get<{ value: string }>('/system-config/objection-contact');
}

/** 编辑异议联系方式（采购管理方）——随公告发布快照展示 */
export function updateObjectionContact(value: string) {
  return api.put<{ key: string; value: string; updatedAt: string }>(
    '/system-config/objection-contact',
    { value },
  );
}
