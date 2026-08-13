import { BidSignPacketDocxService, SignPacketSnapshot } from './bid-sign-packet-docx.service';

const baseSnapshot: SignPacketSnapshot = {
  packageType: 'BID_SIGN_PACKET',
  packageVersion: 1,
  generatedAt: '2026-08-13T00:00:00.000Z',
  project: { name: '智慧水务大数据平台建设', projectCode: 'BID-1785051154799', procurementMethod: '公开招标', openTime: '2026-08-10T09:00:00.000Z', deadline: '2026-08-11T09:00:00.000Z', scope: '大数据平台建设', qualification: '无', budget: 5000000 },
  committee: [
    { expertId: 'e1', name: '周祥志', major: '综合', role: '正选', isLead: true, isPurchaserRepresentative: false, signInIp: '10.0.0.1', signInMeta: { userAgent: 'Chrome' }, confidentialityAgreedAt: '2026-08-12T01:00:00.000Z', disciplineAgreedAt: '2026-08-12T01:01:00.000Z', reportConfirmedAt: '2026-08-12T03:00:00.000Z' },
  ],
  leaderCoSignedAt: '2026-08-12T04:00:00.000Z',
  openingRecords: [{ supplierName: '重庆蜀通岩土工程有限公司', amount: '4800000', period: '90日历天', qualityTarget: '合格', bondStatus: '已缴纳', confirmStatus: 'CONFIRMED' }],
  bids: [{ supplierName: '重庆蜀通岩土工程有限公司', amount: '4800000', period: '90日历天', submittedAt: '2026-08-11T08:50:00.000Z' }],
  invalidBids: [],
  scoreStandard: [{ category: 'BUSINESS', name: '商务评分', maxScore: 20, points: ['商务要点1'] }],
  results: [{ supplierName: '重庆蜀通岩土工程有限公司', totalScore: 88.5, averageScore: 88.5, rank: 1, recommended: true, disqualified: false, bidPrice: 4800000 }],
  expertSheets: [{
    expertId: 'e1', name: '周祥志', major: '综合', role: '正选',
    rows: [{ supplierName: '重庆蜀通岩土工程有限公司', scoreItemName: '商务评分', category: 'BUSINESS', score: 18, passed: true, reason: null }],
    pointDecisions: [{ pointName: '商务要点1', supplierName: '重庆蜀通岩土工程有限公司', checked: true, awardedScore: 18 }],
    trace: { identityVerified: { ip: '10.0.0.1', meta: { userAgent: 'Chrome' }, at: '2026-08-12T00:00:00.000Z' }, confidentialityAgreedAt: '2026-08-12T01:00:00.000Z', disciplineAgreedAt: '2026-08-12T01:01:00.000Z', scoreSubmittedAt: '2026-08-12T02:00:00.000Z', scoreVerifiedAt: '2026-08-12T02:30:00.000Z', reportConfirmedAt: '2026-08-12T03:00:00.000Z', leaderCoSignedAt: '2026-08-12T04:00:00.000Z' },
  }],
  disputes: [],
  clarifications: [],
  motions: [],
};

/** docx 对象树（实测 docx@9.7.1）：所有节点继承 XmlComponent，内容只挂在公开的 root 数组；
 *  文本是 root 树中的裸 string 叶子。没有 children/rows/cells/text 等 getter。
 *  下面只遍历 .root：数组/对象 → 看其 .root；string 叶子 → 收集。 */
function textOf(children: any[]): string {
  const out: string[] = [];
  const walk = (node: unknown): void => {
    if (node == null) return;
    if (typeof node === 'string') { out.push(node); return; }
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (typeof node === 'object' && Array.isArray((node as any).root)) walk((node as any).root);
  };
  children.forEach(walk);
  return out.join('');
}

describe('BidSignPacketDocxService', () => {
  let svc: BidSignPacketDocxService;
  beforeEach(() => { svc = new BidSignPacketDocxService(); });

  it('内容含 §42 十项、专家声明六条与在线操作留痕数据', () => {
    const children = svc.buildChildren(baseSnapshot);
    const text = textOf(children);
    for (const keyword of [
      '评标报告', '基本情况和数据表', '评标委员会成员名单', '开标记录', '投标一览表', '废标情况说明',
      '评标标准', '评分比较一览表', '推荐中标候选人', '澄清', '评标过程其他说明',
      '评标专家声明', '本人对投标人的独立评分', '周祥志', '商务评分', '在线操作留痕', '签字',
    ]) {
      expect(text).toContain(keyword);
    }
  });

  it('generateDocument 输出 docx（PK zip 头，长度合理）', async () => {
    const buf = await svc.generateDocument(baseSnapshot);
    expect(buf.length).toBeGreaterThan(1000);
    expect(buf.subarray(0, 2).toString('ascii')).toBe('PK');
  });
});
