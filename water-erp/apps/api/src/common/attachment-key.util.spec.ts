/**
 * attachment-key.util 单测——PMI 附件键形态校验与「引用采购文件」源键闸
 * （2026-11-24 审计第 1 处，封 P1-2 后半）。
 */
import { Logger } from '@nestjs/common';
import {
  assertPmiAttachmentSourceKey,
  isSafeAttachmentKey,
  PMI_ATTACHMENT_KEY_PREFIX,
} from './attachment-key.util';

/** 取抛出错误上的业务码；不抛返回 null */
const codeOf = (fn: () => void): string | null => {
  try { fn(); return null; } catch (e: any) { return e?.response?.code ?? null; }
};

// 拒绝路径会打真实警告：每个用例都接住它，既不让输出变脏，也让日志类断言有处可查
let warnSpy: jest.SpyInstance;
beforeEach(() => {
  warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
});
afterEach(() => { warnSpy.mockRestore(); });

describe('assertPmiAttachmentSourceKey / isSafeAttachmentKey（审计 P1-2 后半）', () => {
  const GOOD = 'project-management/1732452000000-tender-document-采购文件.pdf';

  it.each(['../../.env', '/proc/self/environ', 'knowledge/x', 'uploads/2026/x.pdf', 'project-management', ''])
  ('不在 PMI 前缀（%s）→ FORBIDDEN_SOURCE_KEY', (key) => {
    expect(codeOf(() => assertPmiAttachmentSourceKey(key))).toBe('FORBIDDEN_SOURCE_KEY');
  });

  it.each([
    'project-management/../../../etc/passwd',
    'project-management/a/../b',
    'project-management/a\\b',
    'project-management/x;y',
    'project-management/x y',
    PMI_ATTACHMENT_KEY_PREFIX + 'a'.repeat(600),
  ])('前缀合法但形态不安全（%s）→ INVALID_OBJECT_KEY', (key) => {
    expect(codeOf(() => assertPmiAttachmentSourceKey(key))).toBe('INVALID_OBJECT_KEY');
    expect(isSafeAttachmentKey(key)).toBe(false);
  });

  it('合法键放行且不打警告；非字符串一律不安全', () => {
    expect(codeOf(() => assertPmiAttachmentSourceKey(GOOD))).toBeNull();
    expect(warnSpy).not.toHaveBeenCalled();
    expect(isSafeAttachmentKey(GOOD)).toBe(true);
    expect(isSafeAttachmentKey(undefined)).toBe(false);
    expect(isSafeAttachmentKey(123)).toBe(false);
  });

  it('拒绝时打一条带业务码的警告（调用方会吞掉异常，日志是唯一的可见痕迹）', () => {
    codeOf(() => assertPmiAttachmentSourceKey('../../.env'));
    codeOf(() => assertPmiAttachmentSourceKey('project-management/a/../b'));
    const lines = warnSpy.mock.calls.map((c) => String(c[0]));
    expect(lines.some((l) => l.includes('FORBIDDEN_SOURCE_KEY'))).toBe(true);
    expect(lines.some((l) => l.includes('INVALID_OBJECT_KEY'))).toBe(true);
  });

  it('警告里的键经过转义：含换行的键不会伪造出第二条日志', () => {
    codeOf(() => assertPmiAttachmentSourceKey('../../x\nFORGED log line'));
    const lines = warnSpy.mock.calls.map((c) => String(c[0]));
    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toContain('\n');
  });
});
