/**
 * 版本分派统一 + capabilities v3 开关单测（Task13）
 */
import { BadRequestException } from '@nestjs/common';
import { resolveEnvelopeVersion } from '../supplier-portal/envelope-version.util';

describe('resolveEnvelopeVersion（Task13）', () => {
  test('legacy：无 envelope / 空 version → legacy', () => {
    expect(resolveEnvelopeVersion({ envelope: null, envelopeVersion: null } as any)).toBe('legacy');
    expect(resolveEnvelopeVersion({ envelopeVersion: '' } as any)).toBe('legacy');
  });

  test('dual-v2 / dual-v3 行正确分派', () => {
    expect(resolveEnvelopeVersion({ envelopeVersion: 'dual-v2' } as any)).toBe('dual-v2');
    expect(resolveEnvelopeVersion({ envelopeVersion: 'dual-v3' } as any)).toBe('dual-v3');
  });

  test('未知版本字符串 → 400 ENVELOPE_VERSION_UNKNOWN', () => {
    try {
      resolveEnvelopeVersion({ envelopeVersion: 'dual-v9' } as any);
      throw new Error('should have thrown');
    } catch (e: any) {
      expect(e).toBeInstanceOf(BadRequestException);
      expect((e.getResponse() as any).code).toBe('ENVELOPE_VERSION_UNKNOWN');
    }
  });
});

describe('capabilities allowedEnvelopeVersions 开关（Task13）', () => {
  test('CA_SUPPLIER_V3_ENABLED 未设 → 仅 dual-v2；设 true → 含 dual-v3', () => {
    // 纯函数直测（controller 内联逻辑抽为 v3Enabled()）
    const { v3Enabled } = require('../supplier-portal/envelope-version.util');
    const prev = process.env.CA_SUPPLIER_V3_ENABLED;
    delete process.env.CA_SUPPLIER_V3_ENABLED;
    expect(v3Enabled()).toBe(false);
    process.env.CA_SUPPLIER_V3_ENABLED = 'true';
    expect(v3Enabled()).toBe(true);
    if (prev === undefined) delete process.env.CA_SUPPLIER_V3_ENABLED; else process.env.CA_SUPPLIER_V3_ENABLED = prev;
  });
});
