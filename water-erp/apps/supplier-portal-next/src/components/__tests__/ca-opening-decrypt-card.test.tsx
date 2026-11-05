/**
 * ca-opening-decrypt-card 重构后守卫（2026-10-14 用户裁定：按钮→弹窗输 PIN；
 * 2026-11-05 流式化：worker 下载解密 + 回传进度 + 可取消）
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { CaOpeningDecryptCard, decryptProgressNote } from '../ca-opening-decrypt-card';

test('初始态：仅渲染按钮（无常驻 PIN 输入框——弹窗触发后才出现）', () => {
  const html = renderToStaticMarkup(createElement(CaOpeningDecryptCard, { projectId: 'p1' }));
  assert.ok(html.includes('取包并解密'), '触发按钮在位');
  assert.ok(!html.includes('type="password"'), 'PIN 输入不常驻（在 SpDialog 内按需渲染）');
  assert.ok(!html.includes('取消解密'), '取消按钮仅 busy 态渲染');
});

test('done 态：已解密显示禁用按钮（状态可见性优于隐藏）', () => {
  const html = renderToStaticMarkup(createElement(CaOpeningDecryptCard, { projectId: 'p1', done: true }));
  assert.ok(html.includes('已解密'), '已解密标签在位');
  assert.ok(html.includes('disabled'), '不可点击');
  assert.ok(!html.includes('取包并解密'), '不显示触发按钮');
});

test('组件源码守卫：SpDialog 弹窗模式+证明链+流式化接线', () => {
  const src = readFileSync(new URL('../ca-opening-decrypt-card.tsx', import.meta.url), 'utf8');
  assert.ok(src.includes('SpDialog'), '弹窗体系（对齐大厅既有交互）');
  assert.ok(src.includes('buildDecryptProofCanonical'), 'P7 证明链');
  assert.ok(src.includes('unwrapSccaKey'), '盾解封');
  assert.ok(src.includes('caDecryptUpload'), '解密上传');
  // 2026-11-05 流式化：引擎接线在位、整读整算路径已删
  assert.ok(src.includes('engine.decryptUrl'), '流式下载解密（worker 数据面）');
  assert.ok(src.includes('上传明文 ${pct}%`'), '回传进度（caDecryptUpload 第 3 参）');
  assert.ok(src.includes('getDefaultCryptoEngine().terminate()'), '取消接线（terminate 引擎，幂等）');
  assert.ok(src.includes('sm4Decrypt(dekF.k'), 'sealedFields 整块解密保留（KB 级，无流式必要）');
  assert.ok(!src.includes('fetchCInner'), '整读下载已删（worker 流式替代）');
  assert.ok(!/\bsha256Hex\b/.test(src), '主线程整算哈希已删（worker 增量哈希直接作证明）');
  assert.ok(!/bg-white|border-gray|shadow-lg/.test(src), 'cgzxui 反模式守卫');
});

test('decryptProgressNote：已知总量走百分比（向下取整+封顶 100）', () => {
  const MB = 1024 * 1024;
  assert.equal(decryptProgressNote('technical', 0, 200 * MB), '正在解密 technical（下载解密 0%）…');
  assert.equal(decryptProgressNote('technical', 100 * MB, 200 * MB), '正在解密 technical（下载解密 50%）…');
  assert.equal(decryptProgressNote('business', 199 * MB, 200 * MB), '正在解密 business（下载解密 99%）…');
  // doneBytes 异常超总量——百分比封顶 100（对齐 crypto-overlay formatProgress 口径）
  assert.equal(decryptProgressNote('business', 999 * MB, 200 * MB), '正在解密 business（下载解密 100%）…');
});

test('decryptProgressNote：无 Content-Length（total=0）只报已下载量', () => {
  const MB = 1024 * 1024;
  assert.equal(decryptProgressNote('coverLetter', 0, 0), '正在解密 coverLetter（已下载 0.0MB）…');
  assert.equal(decryptProgressNote('coverLetter', 3.5 * MB, 0), '正在解密 coverLetter（已下载 3.5MB）…');
});
