/**
 * ca-clarification-sign-dialog 渲染测试（2026-10-19）
 * 背景：24de18a8 澄清 P7 接线只落了 doReply 逻辑（pin state + toast 校验），
 * JSX 从未渲染 PIN 输入框——dual-v3 供应商被要求输 PIN 却无处可输。
 * 本弹窗补齐入口：node:test + renderToStaticMarkup（同 ca-bid-submit-card 模式）。
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { CaClarificationSignDialog } from '../ca-clarification-sign-dialog';

const PROPS = {
  open: true,
  onClose: () => {},
  projectId: 'proj-1',
  clarification: { id: 'clar-1', replyText: '答复内容……', attachmentIds: ['fa-1'] as string[] },
  onSubmitted: () => {},
};

function render(props = {}) {
  return renderToStaticMarkup(createElement(CaClarificationSignDialog, { ...PROPS, ...props }));
}

test('打开态：标题 + P7 说明 + PIN 掩码输入 + 底部按钮组', () => {
  const html = render();
  assert.ok(html.includes('澄清答复签署'), '弹窗标题');
  assert.ok(html.includes('P7'), '说明含 P7 签名语义');
  assert.ok(html.includes('data-testid="ca-clar-pin"'), 'PIN 输入框');
  assert.ok(html.includes('type="password"'), 'PIN 掩码');
  assert.ok(/autocomplete="off"/i.test(html), 'PIN 不回填');
  assert.ok(html.includes('取消'), '取消按钮');
  assert.ok(html.includes('盾签名并提交'), '确认按钮');
});

test('PIN 为空时确认按钮禁用（杜绝无处输 PIN 的死循环复发）', () => {
  const html = render();
  const confirm = html.match(/<button[^>]*>[^<]*盾签名并提交/) ?? html.match(/<button[^>]*disabled[^>]*>/);
  assert.ok(confirm, '按钮存在');
  assert.ok(html.includes('disabled'), '空 PIN 禁用提交');
});

test('关闭态：不渲染任何内容（含 PIN 框）', () => {
  const html = render({ open: false });
  assert.ok(!html.includes('ca-clar-pin'), '关闭态无 PIN 框');
  assert.ok(html === '' || html === '<!-- -->', `关闭态输出应为空，实际: ${html}`);
});

test('cgzxui 反模式守卫：无 bg-white/border-gray/shadow-lg', () => {
  const html = render();
  assert.ok(!/bg-white|border-gray|shadow-lg/.test(html), '禁 Tailwind 反模式类');
});
