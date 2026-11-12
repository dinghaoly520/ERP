// packages/shared/src/__tests__/procurement-method-label.test.ts
// bug#73 词表锁——判定逻辑与词汇域变化必须在此显式变更（生产 distinct 核对后并入）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tenderDocumentLabel, LEGAL_TENDER_METHODS, NON_TENDER_METHODS } from '../procurement-method-label';

test('法定招标方式 → 招标文件（裁定#3：邀请招标显法定名）', () => {
  for (const m of LEGAL_TENDER_METHODS) {
    assert.equal(tenderDocumentLabel(m), '招标文件', m);
  }
});

test('非招标方式（含历史变体拼写）→ 采购文件', () => {
  for (const m of NON_TENDER_METHODS) {
    assert.equal(tenderDocumentLabel(m), '采购文件', m);
  }
});

test('未知/缺失值 → 采购文件（canon 安全默认，勿改——平台采购口径）', () => {
  assert.equal(tenderDocumentLabel('邀请招标（二次）'), '采购文件'); // 未知变体：部署前核对词表的正是这类
  assert.equal(tenderDocumentLabel(''), '采购文件');
  assert.equal(tenderDocumentLabel(null), '采购文件');
  assert.equal(tenderDocumentLabel(undefined), '采购文件');
});

test('词表无交集（两集合互斥，防误并入）', () => {
  const overlap = (LEGAL_TENDER_METHODS as readonly string[]).filter(m =>
    (NON_TENDER_METHODS as readonly string[]).includes(m));
  assert.deepEqual(overlap, []);
});
