import { ARCHIVE_PICKUP_CATEGORIES } from './archive-export.service';
import { HANDOVER_KEY_PATTERNS } from './archive-scope.service';

describe('归档取件类目覆盖（2026-09-18 补漏锁定）', () => {
  it('key 含项目 ID 的开评标留痕件全部在类目取件清单', () => {
    // bid_evaluation_handover 走 OR 第一支精确 key（bid-evaluation-handover/${bp.id}.json），不在类目清单属预期
    for (const c of [
      'bid_opening_handover', 'bid_evaluation_sign_handover', 'bid_sign_packet',
      'sign_packet_signature_page', 'expert_sign_scan', 'bid_decrypted',
      'opening_sign_page', 'opening_sign_scan',
    ] as const) {
      expect(ARCHIVE_PICKUP_CATEGORIES).toContain(c);
    }
  });

  it('key 不含项目 ID 的引用件类目不得混入类目取件（它们走引用 id 取件）', () => {
    for (const c of ['expert_memo_ink', 'expert_signin_photo', 'clarification_reply', 'ai_bid_report'] as const) {
      expect(ARCHIVE_PICKUP_CATEGORIES).not.toContain(c);
    }
  });

  it('2026-09-22 P2-1：key 含项目 ID 的取件类目都有勾稽定位规则（取件/勾稽不漂移）', () => {
    for (const c of ARCHIVE_PICKUP_CATEGORIES) {
      expect(Object.keys(HANDOVER_KEY_PATTERNS)).toContain(c);
    }
  });
});
