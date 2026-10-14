/**
 * ca-opening-decrypt-card 测试（Task12）
 * 渲染结构 + proof canonical 与服务端公式逐字一致（Task9 后端同式）
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { canonicalJson } from '@water-erp/ukey';
import { CaOpeningDecryptCard } from '../ca-opening-decrypt-card';
import { buildDecryptProofCanonical } from '../../utils/dual-v3-client';

test('初始态：PIN 字段掩码 + 禁用按钮 + cgzxui 类', () => {
  const html = renderToStaticMarkup(createElement(CaOpeningDecryptCard, { projectId: 'p1' }));
  assert.ok(html.includes('data-testid="ca-decrypt-card"'), '卡片容器');
  assert.ok(html.includes('data-testid="ca-decrypt-pin"'), 'PIN 字段');
  assert.ok(html.includes('type="password"'), 'PIN 掩码');
  assert.ok(html.includes('disabled'), 'PIN 空→按钮禁用');
  assert.ok(!/bg-white|border-gray|shadow-lg/.test(html), '无反模式类');
});

test('buildDecryptProofCanonical：与服务端 Task9 canonicalJson 同构（键序无关）', () => {
  const input = {
    openingSessionId: 'sess-1',
    revision: 1,
    plainSha256ByRole: { technical: 'a'.repeat(64), business: 'b'.repeat(64) },
    fieldsCommit: 'f'.repeat(64),
  };
  const expected = canonicalJson({
    version: 1, purpose: 'decrypt-upload',
    openingSessionId: input.openingSessionId, revision: input.revision,
    plainSha256ByRole: input.plainSha256ByRole, fieldsCommit: input.fieldsCommit,
  });
  assert.equal(buildDecryptProofCanonical(input), expected);
  // 键序无关：乱序构造同串
  assert.equal(
    buildDecryptProofCanonical({
      fieldsCommit: input.fieldsCommit,
      plainSha256ByRole: { business: 'b'.repeat(64), technical: 'a'.repeat(64) },
      revision: 1,
      openingSessionId: 'sess-1',
    }),
    expected,
  );
});
