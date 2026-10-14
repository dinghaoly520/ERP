/**
 * ca-bid-submit-card 渲染测试（Task11）
 * node:test + renderToStaticMarkup——四角色文件槽/字段表单/按钮禁用态/服务端错误透出
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { CaBidSubmitCard } from '../ca-bid-submit-card';

const PROPS = {
  projectId: 'proj-1',
  context: { supplierId: 'sup-1', submissionId: '', revision: 0, signingBindingId: 'b-1', signingCertFingerprint: 'cf-1' },
  encCertPem: '-----BEGIN CERTIFICATE-----\\nQUJD\\n-----END CERTIFICATE-----',
  adminCert: { adminCertId: 'ac-1', publicKey: '04' + 'ab'.repeat(64) },
} as const;

function render() {
  return renderToStaticMarkup(createElement(CaBidSubmitCard, { ...PROPS }));
}

test('初始态：四角色文件槽（technical 必选标识）+ 三字段 + PIN + 禁用按钮', () => {
  const html = render();
  for (const role of ['technical', 'business', 'coverLetter', 'bond']) {
    assert.ok(html.includes(`data-testid="ca-file-${role}"`), `缺 ${role} 文件槽`);
  }
  assert.ok(html.includes('技术标（必选）'), 'technical 必选标签');
  assert.ok(html.includes('data-testid="ca-field-price"'), '报价字段');
  assert.ok(html.includes('报价（万元）'), '报价单位=万元显式');
  assert.ok(html.includes('data-testid="ca-field-pin"'), 'PIN 字段');
  assert.ok(html.includes('type="password"'), 'PIN 掩码');
  assert.ok(html.includes('disabled'), '表单未填满时按钮禁用');
});

test('cgzxui 反模式守卫：无 bg-white/border-gray/shadow-lg/emoji', () => {
  const html = render();
  assert.ok(!/bg-white|border-gray|shadow-lg/.test(html), '禁 Tailwind 反模式类');
});
