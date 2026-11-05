/**
 * crypto-overlay 纯逻辑单测（Task 7）——formatProgress 四口径：
 * ①有总量：百分比整数 + 双 MB 值（一位小数）；②totalBytes 缺省/0：只显
 * 已处理量（动词形态：加密中→已加密）；③doneBytes=0 有总量：0%；
 * ④phase 文案原样透传（不硬编码「加密中」）。
 * 另附 SSR 安全冒烟：node:test 进程无 document，withCryptoOverlay 应直跑
 * task、report 为安全 noop。DOM 渲染部分不造假浏览器——由 code-walk +
 * Task 9 手工 QA 覆盖。
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatProgress, withCryptoOverlay } from '../crypto-overlay';

const MB = 1048576;

test('formatProgress：有总量——百分比整数 + 双 MB 一位小数', () => {
  assert.equal(
    formatProgress({ phase: '加密中', doneBytes: 185 * MB, totalBytes: 500 * MB }),
    '加密中 37%（185.0MB/500.0MB）',
  );
  assert.equal(
    formatProgress({ phase: '加密中', doneBytes: 190 * MB, totalBytes: 500 * MB }),
    '加密中 38%（190.0MB/500.0MB）',
  );
});

test('formatProgress：百分比向下取整（37.98%→37，MB 值四舍五入一位小数）', () => {
  assert.equal(
    formatProgress({ phase: '加密中', doneBytes: 189.9 * MB, totalBytes: 500 * MB }),
    '加密中 37%（189.9MB/500.0MB）',
  );
});

test('formatProgress：totalBytes 缺省/0——只显已处理量（加密中→已加密）', () => {
  assert.equal(formatProgress({ phase: '加密中', doneBytes: 185 * MB }), '已加密 185.0MB');
  assert.equal(
    formatProgress({ phase: '解密中', doneBytes: 185 * MB, totalBytes: 0 }),
    '已解密 185.0MB',
  );
  assert.equal(formatProgress({ phase: '解密中', doneBytes: 512 * 1024 }), '已解密 0.5MB');
  assert.equal(formatProgress({ phase: '解密中', doneBytes: 0 }), '已解密 0.0MB');
});

test('formatProgress：doneBytes=0/缺省 有总量 → 0%', () => {
  assert.equal(
    formatProgress({ phase: '加密中', doneBytes: 0, totalBytes: 500 * MB }),
    '加密中 0%（0.0MB/500.0MB）',
  );
  assert.equal(
    formatProgress({ phase: '解密中', totalBytes: 100 * MB }),
    '解密中 0%（0.0MB/100.0MB）',
  );
});

test('formatProgress：phase 原样透传（不硬编码加密中）', () => {
  assert.equal(
    formatProgress({ phase: '上传密封信封', doneBytes: 100 * MB, totalBytes: 400 * MB }),
    '上传密封信封 25%（100.0MB/400.0MB）',
  );
  // 非「中」尾缀 phase 无总量时原样透传（不硬拼「已」——任意短语如「上传密封信封」不被改写）
  assert.equal(formatProgress({ phase: '上传', doneBytes: 12 * MB }), '上传 12.0MB');
});

test('formatProgress：防御——进度封顶 100%（doneBytes 超总量照实显示字节）', () => {
  assert.equal(
    formatProgress({ phase: '加密中', doneBytes: 505 * MB, totalBytes: 500 * MB }),
    '加密中 100%（505.0MB/500.0MB）',
  );
});

test('withCryptoOverlay：SSR（无 document）直跑 task，report 为安全 noop', async () => {
  assert.equal(typeof document, 'undefined', 'node:test 进程不应有 document');
  let ran = false;
  const out = await withCryptoOverlay((report) => {
    report({ phase: '加密中', doneBytes: 1, totalBytes: 2 }); // 无 DOM 也不抛
    ran = true;
    return Promise.resolve(42);
  });
  assert.equal(out, 42);
  assert.equal(ran, true);
});
