import test from 'node:test';
import assert from 'node:assert/strict';

import { isCompletedEarlyStageWithoutFiles } from './project-management';

/** 2026-11-24 用户裁定：需求/立项完成但未上传任何文件 → 卡片该步骤显白不显绿。
 *  兼容两种数据形状：项目管理列表（attachments 数组）/ /progress/stats（attachmentCount）。 */
test('isCompletedEarlyStageWithoutFiles: 完成 + 需求/立项 + 0 附件 → true（显白）', () => {
  assert.equal(isCompletedEarlyStageWithoutFiles({ stageKey: 'PROCUREMENT_DEMAND', status: 'COMPLETED', attachments: [] }), true);
  assert.equal(isCompletedEarlyStageWithoutFiles({ stageKey: 'INITIATION', status: 'COMPLETED', attachmentCount: 0 }), true);
});

test('isCompletedEarlyStageWithoutFiles: 有附件的完成态 → false（照常显绿）', () => {
  assert.equal(isCompletedEarlyStageWithoutFiles({ stageKey: 'PROCUREMENT_DEMAND', status: 'COMPLETED', attachments: [{}, {}] }), false);
  assert.equal(isCompletedEarlyStageWithoutFiles({ stageKey: 'INITIATION', status: 'COMPLETED', attachmentCount: 1 }), false);
});

test('isCompletedEarlyStageWithoutFiles: 非完成态或其他步骤 → false（不走白分支）', () => {
  // 未开始/进行中的需求立项：本就非绿，不归本判定管
  assert.equal(isCompletedEarlyStageWithoutFiles({ stageKey: 'PROCUREMENT_DEMAND', status: 'NOT_STARTED', attachments: [] }), false);
  assert.equal(isCompletedEarlyStageWithoutFiles({ stageKey: 'PROCUREMENT_DEMAND', status: 'IN_PROGRESS', attachments: [] }), false);
  // 其他步骤即使完成且 0 附件也不受此裁定约束（如豁免完成的后续步骤）
  assert.equal(isCompletedEarlyStageWithoutFiles({ stageKey: 'TENDER_DOCUMENT', status: 'COMPLETED', attachments: [] }), false);
});

test('isCompletedEarlyStageWithoutFiles: 两种形状字段缺省时互为兜底', () => {
  // attachmentCount 缺省 → 回落 attachments 数组
  assert.equal(isCompletedEarlyStageWithoutFiles({ stageKey: 'INITIATION', status: 'COMPLETED', attachments: [{ fileName: 'x' }] }), false);
  // 两者都缺（畸形/旧响应）→ 视作 0 附件
  assert.equal(isCompletedEarlyStageWithoutFiles({ stageKey: 'INITIATION', status: 'COMPLETED' }), true);
});
