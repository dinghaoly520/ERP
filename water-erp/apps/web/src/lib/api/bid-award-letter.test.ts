import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { awardLetterDeliveryUiState, validateAwardLetterFile } from './bid';

test('award letter accepts PDF and Office documents up to 20 MiB', () => {
  assert.equal(validateAwardLetterFile({ name: '通知书.pdf', type: 'application/pdf', size: 1024 }), null);
  assert.equal(validateAwardLetterFile({
    name: '通知书.docx',
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    size: 20 * 1024 * 1024,
  }), null);
});

test('award letter rejects missing, executable and oversized files', () => {
  assert.equal(validateAwardLetterFile(null), '请先选择中标通知书文件');
  assert.match(validateAwardLetterFile({ name: '通知书.exe', type: 'application/octet-stream', size: 12 }) ?? '', /PDF、DOC/);
  assert.match(validateAwardLetterFile({ name: '通知书.pdf', type: 'application/pdf', size: 20 * 1024 * 1024 + 1 }) ?? '', /20 MB/);
});

test('award letter delivery UI allows only unsigned deliveries to be reissued', () => {
  assert.equal(awardLetterDeliveryUiState(null), 'initial');
  assert.equal(awardLetterDeliveryUiState({ signedAt: null }), 'reissue');
  assert.equal(awardLetterDeliveryUiState({ signedAt: '2026-09-03T08:00:00.000Z' }), 'locked');
});

test('bid confirmation panel exposes reissue and signed-lock copy', () => {
  const panel = readFileSync(
    new URL('../../components/projects/bid-confirm-panel.tsx', import.meta.url),
    'utf8',
  );

  assert.match(panel, /awardLetterDeliveryUiState/);
  assert.match(panel, /更换文件并重发/);
  assert.match(panel, /已签收，通知书已锁定，不可更换或重发/);
  assert.match(panel, /送达/);
  assert.match(panel, /收阅/);
  assert.match(panel, /签收/);
  assert.match(panel, /receiptNo/);
  assert.match(panel, /letterAsset/);
  assert.match(panel, /\/api\/upload\/files\//);
});
