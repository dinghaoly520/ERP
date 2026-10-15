/**
 * ca-bid-reupload-card 渲染测试（阶段2.5 T3）
 * loading→null（锚点未就绪不渲染）+ cgzxui 反模式守卫
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { readFileSync } from 'node:fs';
import { CaBidReuploadCard } from '../ca-bid-reupload-card';

test('初始 loading 态渲染 null（服务端锚点闸内建——非 OPENING/非 v3 不出卡）', () => {
  const html = renderToStaticMarkup(createElement(CaBidReuploadCard, { projectId: 'p1' }));
  assert.equal(html, '');
});

test('组件源码守卫：reuseNonce/nextRevisionContext/unwrapSealedFields 三契约接线', () => {
  const src = readFileSync(new URL('../ca-bid-reupload-card.tsx', import.meta.url), 'utf8');
  assert.ok(src.includes('unwrapSealedFields'), '盾复原 fields+nonce');
  assert.ok(src.includes('nextRevisionContext'), '信封 revision=base+1 契约');
  assert.ok(src.includes('nonce,'), 'reuseNonce 传参（改价闸通过的前提）');
  assert.ok(!/bg-white|border-gray|shadow-lg/.test(src), 'cgzxui 反模式守卫');
});
