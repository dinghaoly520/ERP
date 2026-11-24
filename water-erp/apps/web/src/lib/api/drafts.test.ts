import test from 'node:test';
import assert from 'node:assert/strict';

import { pickNewerDraft } from './drafts';

test('pickNewerDraft: 两边皆空/畸形返回 null', () => {
  assert.equal(pickNewerDraft(null, null), null);
  assert.equal(pickNewerDraft(undefined, undefined), null);
  assert.equal(pickNewerDraft('bad', 42), null);
});

test('pickNewerDraft: 单边存在直接采用该边', () => {
  assert.equal(pickNewerDraft({ v: 1, savedAt: 5 }, null), 'remote');
  assert.equal(pickNewerDraft(null, { v: 2, _ts: 5 }), 'local');
});

test('pickNewerDraft: 按 savedAt/_ts 取新者（两键同权）', () => {
  assert.equal(pickNewerDraft({ savedAt: 200 }, { savedAt: 100 }), 'remote');
  assert.equal(pickNewerDraft({ _ts: 200 }, { savedAt: 300 }), 'local');
  assert.equal(pickNewerDraft({ savedAt: 100 }, { _ts: 200 }), 'local');
});

test('pickNewerDraft: 时间戳相等本机胜出（幂等重开不扰动）', () => {
  assert.equal(pickNewerDraft({ savedAt: 100 }, { savedAt: 100 }), 'local');
});

test('pickNewerDraft: 本机旧数据无时间戳（savedAt=0）——服务端带时间戳即胜出（上云迁移语义）', () => {
  assert.equal(pickNewerDraft({ savedAt: 1 }, { foo: 'bar' }), 'remote');
  // 两边都无时间戳（同为本机旧数据形态）：本机胜出
  assert.equal(pickNewerDraft({ foo: 1 }, { foo: 2 }), 'local');
});

test('pickNewerDraft: 非对象载荷按空处理（字符串数字等畸形不参与比较）', () => {
  assert.equal(pickNewerDraft('raw', { savedAt: 1 }), 'local');
  assert.equal(pickNewerDraft({ savedAt: 1 }, 'raw'), 'remote');
});
