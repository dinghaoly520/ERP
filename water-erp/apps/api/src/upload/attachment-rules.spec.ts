import { BadRequestException } from '@nestjs/common';
import {
  ATTACHMENT_MAX_BYTES,
  DEFAULT_MAX_BYTES,
  ATTACHMENT_WHITELIST_CATEGORIES,
  isAttachmentExtensionAllowed,
  assertAttachmentRules,
} from './attachment-rules';

/** Nest 异常的 code 在 getResponse().code（message 恒为 "Bad Request Exception"） */
function expectCode(fn: () => void, code: string) {
  try {
    fn();
  } catch (e) {
    expect((e as BadRequestException).getResponse()).toMatchObject({ code });
    return;
  }
  throw new Error(`期望抛出 ${code}，实际未抛出`);
}

describe('attachment-rules（100MB+白名单，2026-10-19）', () => {
  it('白名单类目=announcement，扩展名 9 项大小写不敏感', () => {
    expect([...ATTACHMENT_WHITELIST_CATEGORIES]).toEqual(['announcement']);
    for (const ext of ['png', 'jpg', 'jpeg', 'doc', 'docx', 'xls', 'xlsx', 'pdf', 'zip', 'rar']) {
      expect(isAttachmentExtensionAllowed(`a.${ext}`)).toBe(true);
      expect(isAttachmentExtensionAllowed(`A.${ext.toUpperCase()}`)).toBe(true);
    }
    expect(isAttachmentExtensionAllowed('a.gif')).toBe(false);
    expect(isAttachmentExtensionAllowed('a.txt')).toBe(false);
    expect(isAttachmentExtensionAllowed('无扩展名')).toBe(false);
  });

  it('大小上限：announcement 100MB、其余 50MB', () => {
    expect(ATTACHMENT_MAX_BYTES).toBe(100 * 1024 * 1024);
    expect(DEFAULT_MAX_BYTES).toBe(50 * 1024 * 1024);
  });

  it('assertAttachmentRules：announcement 类目拒格式/拒超大、放行合法文件', () => {
    const file = (name: string, size: number) => ({ originalname: name, size, buffer: Buffer.alloc(0) });
    expectCode(() => assertAttachmentRules(file('a.exe', 1024), 'announcement'), 'ATTACHMENT_FILE_TYPE_INVALID');
    expectCode(() => assertAttachmentRules(file('a.pdf', ATTACHMENT_MAX_BYTES + 1), 'announcement'), 'ATTACHMENT_FILE_TOO_LARGE');
    expect(() => assertAttachmentRules(file('a.pdf', ATTACHMENT_MAX_BYTES), 'announcement')).not.toThrow();
    expectCode(() => assertAttachmentRules(file('a.pdf', DEFAULT_MAX_BYTES + 1), 'general'), 'ATTACHMENT_FILE_TOO_LARGE');
    expect(() => assertAttachmentRules(file('a.pdf', DEFAULT_MAX_BYTES), 'general')).not.toThrow();
    // contract_document 不套扩展白名单（PDF_WORD_IMAGE 内容闸另管格式），仅 100MB
    expectCode(() => assertAttachmentRules(file('a.zip', ATTACHMENT_MAX_BYTES + 1), 'contract_document'), 'ATTACHMENT_FILE_TOO_LARGE');
    expect(() => assertAttachmentRules(file('a.zip', DEFAULT_MAX_BYTES + 1), 'contract_document')).not.toThrow();
  });
});
