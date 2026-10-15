/**
 * ca-opening-decrypt-card 重构后守卫（2026-10-14 用户裁定：按钮→弹窗输 PIN）
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { CaOpeningDecryptCard } from '../ca-opening-decrypt-card';

test('初始态：仅渲染按钮（无常驻 PIN 输入框——弹窗触发后才出现）', () => {
  const html = renderToStaticMarkup(createElement(CaOpeningDecryptCard, { projectId: 'p1' }));
  assert.ok(html.includes('取包并解密'), '触发按钮在位');
  assert.ok(!html.includes('type="password"'), 'PIN 输入不常驻（在 SpDialog 内按需渲染）');
});

test('done 态：已解密显示禁用按钮（状态可见性优于隐藏）', () => {
  const html = renderToStaticMarkup(createElement(CaOpeningDecryptCard, { projectId: 'p1', done: true }));
  assert.ok(html.includes('已解密'), '已解密标签在位');
  assert.ok(html.includes('disabled'), '不可点击');
  assert.ok(!html.includes('取包并解密'), '不显示触发按钮');
});

test('组件源码守卫：SpDialog 弹窗模式+证明链接线', () => {
  const src = readFileSync(new URL('../ca-opening-decrypt-card.tsx', import.meta.url), 'utf8');
  assert.ok(src.includes('SpDialog'), '弹窗体系（对齐大厅既有交互）');
  assert.ok(src.includes('buildDecryptProofCanonical'), 'P7 证明链');
  assert.ok(src.includes('unwrapSccaKey'), '盾解封');
  assert.ok(src.includes('caDecryptUpload'), '解密上传');
  assert.ok(!/bg-white|border-gray|shadow-lg/.test(src), 'cgzxui 反模式守卫');
});
