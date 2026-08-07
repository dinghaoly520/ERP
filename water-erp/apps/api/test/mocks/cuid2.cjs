/**
 * cuid2 ESM-only 包的 CJS 桩（jest 单测用）。
 * 仅满足模块加载——实际 createId 调用在被 mock 的 AiService 内，单测不会触达。
 */
module.exports = {
  createId: () => 'mock-cuid-id',
  init: () => ({ random: () => 'mock', createId: () => 'mock-cuid-id' }),
  getConstants: { mask: 1, maxHashSize: 32 },
  isCuid: () => true,
};
