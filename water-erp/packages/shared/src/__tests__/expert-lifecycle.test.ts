// packages/shared/src/__tests__/expert-lifecycle.test.ts
// 库况呈现态跨端单源锁定：四态引擎 + 池外优先链（E5/E7 批次语义、2026-11-20 上移 shared）。
// api 侧消费经 expert-busy-state.util re-export 另有 jest 全量锁——本测试锁 shared 本体。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  IN_FLIGHT_STAGES,
  LIFECYCLE_LABELS,
  busyStateOf,
  lifecycleLabelOf,
  lifecycleStateOf,
} from '../expert-lifecycle';

test('busyStateOf 四态引擎：EVALUATING＞正选＞候补，终局阶段与 declined 之外的行按角色归类', () => {
  assert.equal(busyStateOf([{ expertRole: '正选', project: { stage: 'EVALUATING' } }]), LIFECYCLE_LABELS.evaluating);
  assert.equal(busyStateOf([{ expertRole: '候补', project: { stage: 'EVALUATING' } }]), LIFECYCLE_LABELS.evaluating);
  assert.equal(busyStateOf([{ expertRole: '正选', project: { stage: 'SUBMIT' } }]), LIFECYCLE_LABELS.assigned);
  assert.equal(busyStateOf([{ expertRole: '候补', project: { stage: 'SUBMIT' } }]), LIFECYCLE_LABELS.alternate);
  assert.equal(busyStateOf([]), LIFECYCLE_LABELS.idle);
  // 终局阶段行内部过滤（ARCHIVED/ABORTED 不占库况）
  assert.equal(busyStateOf([{ expertRole: '正选', project: { stage: 'ARCHIVED' } }]), LIFECYCLE_LABELS.idle);
  assert.equal(IN_FLIGHT_STAGES.includes('ARCHIVED' as never), false);
});

test('lifecycleLabelOf 池外优先链：已退库＞已停用＞透传四态（web 徽标消费形态）', () => {
  // 退库正门并存形态（RETIRED+停用 两列同写）——RETIRED 先判
  assert.equal(lifecycleLabelOf({ entryStatus: 'RETIRED', availability: '停用' }, LIFECYCLE_LABELS.evaluating), LIFECYCLE_LABELS.retired);
  assert.equal(lifecycleLabelOf({ entryStatus: 'ACTIVE', availability: '停用' }, LIFECYCLE_LABELS.assigned), LIFECYCLE_LABELS.disabled);
  assert.equal(lifecycleLabelOf({ entryStatus: 'ACTIVE', availability: '可用' }, LIFECYCLE_LABELS.assigned), LIFECYCLE_LABELS.assigned);
  // busyState 缺失且非池外 → 空串（调用方不渲染）
  assert.equal(lifecycleLabelOf({ entryStatus: 'ACTIVE', availability: '可用' }, ''), '');
});

test('lifecycleStateOf api 消费形态：池外压制在途冒充（停用档案不再显已被抽取/正在评标）', () => {
  const inflight = [{ expertRole: '正选' as const, project: { stage: 'SUBMIT' as const } }];
  assert.equal(lifecycleStateOf({ entryStatus: 'RETIRED', availability: '停用' }, inflight), LIFECYCLE_LABELS.retired);
  assert.equal(lifecycleStateOf({ entryStatus: 'ACTIVE', availability: '停用' }, inflight), LIFECYCLE_LABELS.disabled);
  assert.equal(lifecycleStateOf({ entryStatus: 'ACTIVE', availability: '可用' }, inflight), LIFECYCLE_LABELS.assigned);
  // 字段缺省（旧形态）落四态，不崩
  assert.equal(lifecycleStateOf({}, []), LIFECYCLE_LABELS.idle);
});
