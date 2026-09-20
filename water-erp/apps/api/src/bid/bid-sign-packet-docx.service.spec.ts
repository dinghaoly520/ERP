import { BidSignPacketDocxService, SignPacketSnapshot } from './bid-sign-packet-docx.service';

const baseSnapshot: SignPacketSnapshot = {
  packageType: 'BID_SIGN_PACKET',
  packageVersion: 1,
  generatedAt: '2026-08-13T00:00:00.000Z',
  project: { name: '智慧水务大数据平台建设', projectCode: 'BID-1785051154799', procurementMethod: '公开招标', openTime: '2026-08-10T09:00:00.000Z', deadline: '2026-08-11T09:00:00.000Z', scope: '大数据平台建设', qualification: '无', budget: 5000000 },
  committee: [
    { expertId: 'e1', name: '周祥志', major: '综合', role: '正选', isLead: true, isPurchaserRepresentative: false, signInIp: '10.0.0.1', signInMeta: { userAgent: 'Chrome' }, confidentialityAgreedAt: '2026-08-12T01:00:00.000Z', disciplineAgreedAt: '2026-08-12T01:01:00.000Z', reportConfirmedAt: '2026-08-12T03:00:00.000Z', signedIn: true, aiConsentConfirmed: true, aiConsentAt: '2026-08-12T01:02:00.000Z', avoidanceConfirmed: false },
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
    trace: { identityVerified: { ip: '10.0.0.1', meta: { userAgent: 'Chrome' }, at: '2026-08-12T00:00:00.000Z' }, confidentialityAgreedAt: '2026-08-12T01:00:00.000Z', disciplineAgreedAt: '2026-08-12T01:01:00.000Z', aiConsentAt: '2026-08-12T01:02:00.000Z', scoreSubmittedAt: '2026-08-12T02:00:00.000Z', scoreVerifiedAt: '2026-08-12T02:30:00.000Z', reportConfirmedAt: '2026-08-12T03:00:00.000Z', leaderCoSignedAt: '2026-08-12T04:00:00.000Z' },
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

/** 「十、评标过程其他说明」标题段的下一段全文（A-151 十节正文——修复轮1：逐字节全等断言的取段器） */
function sectionTenPara(children: any[]): string {
  const idx = children.findIndex(c => textOf([c]).startsWith('十、评标过程其他说明'));
  expect(idx).toBeGreaterThanOrEqual(0);
  return textOf([children[idx + 1]]);
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
      // 2026-09-18 完整性扩展：留痕表加「AI 辅助声明确认」行（aiConsentAt）
      'AI 辅助声明确认：2026-08-12T01:02:00.000Z',
      // 《不同意见书》模板页（办法第43条）：拒签专家当场手写的规范载体
      '不同意见书（模板）', '以书面方式阐述其不同意见并签名', '拒绝签字又不陈述书面不同意见的，视为同意评标结论', '由专家本人书写',
    ]) {
      expect(text).toContain(keyword);
    }
  });

  it('generateDocument 输出 docx（PK zip 头，长度合理）', async () => {
    const buf = await svc.generateDocument(baseSnapshot);
    expect(buf.length).toBeGreaterThan(1000);
    expect(buf.subarray(0, 2).toString('ascii')).toBe('PK');
  });

  /* ── 2026-09-18 身份核验 §4.5：留痕行增强 + 核验记录表 ── */
  it('身份核验留痕行：at 有值时披露 时间·留档照·遮挡检测（纸面证据自含）', () => {
    const snap: SignPacketSnapshot = {
      ...baseSnapshot,
      expertSheets: [{
        ...baseSnapshot.expertSheets[0],
        trace: {
          ...baseSnapshot.expertSheets[0].trace,
          identityVerified: {
            ip: '10.0.0.8',
            meta: { timestamp: '2026-09-18T09:12:00.000Z', method: 'self_password_photo', occlusion: 'passed', photoAssetId: 'fa-1' },
            at: '2026-09-18T09:12:00.000Z',
          },
        },
      }],
    };
    const text = textOf(svc.buildChildren(snap));
    expect(text).toContain('身份核验/签到：2026-09-18 09:12 · 留档照 ✓ · 遮挡检测通过（IP 10.0.0.8）');
  });

  it('核验记录表：标题与全专家行（方式/检测/留档照/时间/IP）', () => {
    const snap: SignPacketSnapshot = {
      ...baseSnapshot,
      committee: [{
        ...baseSnapshot.committee[0],
        signInMeta: { timestamp: '2026-09-18T09:12:00.000Z', method: 'self_password_photo', occlusion: 'passed', photoAssetId: 'fa-1' },
      }],
    };
    const text = textOf(svc.buildChildren(snap));
    expect(text).toContain('评标专家身份核验记录表');
    expect(text).toContain('身份证号登录 + 留档照');
    expect(text).toContain('有（存档）');
    expect(text).toContain('2026-09-18 09:12');
    expect(text).toContain('检测非识别，不进行人脸比对');
  });

  it('核验记录表：旧数据（无 meta 时间戳）渲染 未记录/—，不误标应急', () => {
    const text = textOf(svc.buildChildren(baseSnapshot));
    expect(text).toContain('评标专家身份核验记录表');
    expect(text).toContain('未记录');
  });

  it('R9 手动确认：核验记录表方式列含理由、留档照列「无（主持人确认）」；留痕行渲染主持人现场确认', () => {
    const snap: SignPacketSnapshot = {
      ...baseSnapshot,
      committee: [{
        ...baseSnapshot.committee[0],
        signInMeta: { timestamp: '2026-09-20T10:00:00.000Z', method: 'manual_confirm', reason: '摄像头故障', confirmedByName: '陈源远' },
      }],
      expertSheets: [{
        ...baseSnapshot.expertSheets[0],
        trace: {
          ...baseSnapshot.expertSheets[0].trace,
          identityVerified: {
            ip: null,
            meta: { timestamp: '2026-09-20T10:00:00.000Z', method: 'manual_confirm', reason: '摄像头故障' },
            at: '2026-09-20T10:00:00.000Z',
          },
        },
      }],
    };
    const text = textOf(svc.buildChildren(snap));
    expect(text).toContain('主持人现场确认（摄像头故障）');
    expect(text).toContain('无（主持人确认）');
    expect(text).toContain('无留档照（主持人现场确认）');
  });

  it('R5 核验事件：异常/替换留痕随核验记录表附注披露', () => {
    const snap: SignPacketSnapshot = {
      ...baseSnapshot,
      verifyEvents: [
        { time: '2026-09-20T10:05:00.000Z', action: '核验异常', target: '刘苡池', result: '人证不符（登记人：陈源远）' },
        { time: '2026-09-20T10:08:00.000Z', action: '身份核验降级', target: '刘苡池', result: '主持人手动确认签到（理由：摄像头故障；确认人：陈源远）' },
      ],
    };
    const text = textOf(svc.buildChildren(snap));
    expect(text).toContain('核验事件（异常/降级/替换留痕）');
    expect(text).toContain('2026-09-20 10:05 · 核验异常 · 刘苡池 · 人证不符（登记人：陈源远）');
    expect(text).toContain('2026-09-20 10:08 · 身份核验降级 · 刘苡池');
  });

  /* ── A-151（P1 波4）：报告章节附注渲染 ── */
  it('A-151：一~九节附注以「附注：」段插入节末；十节正文续写（首句保留+用户句+生效句接续）', () => {
    const snap: SignPacketSnapshot = {
      ...baseSnapshot,
      reportNotes: [
        { section: '一', content: '基本情况补充说明。' },
        { section: '九', content: '澄清纪要另有书面记录。' },
        { section: '十', content: '评标过程合规。' },
      ],
    };
    const children = svc.buildChildren(snap);
    const text = textOf(children);
    // 一~九节：附注段紧随节内容（此处仅验证存在与内容，位置由段落顺序保证）
    expect(text).toContain('附注：基本情况补充说明。');
    expect(text).toContain('附注：澄清纪要另有书面记录。');
    // 十节：三段拼接全串逐字节全等（含 组长末签 尾部）
    expect(sectionTenPara(children)).toBe(
      '本报告由系统根据评标过程数据自动生成；评标过程合规。全体评标委员会成员在本报告签字页签字后生效。组长末签：2026-08-12T04:00:00.000Z',
    );
    // 十节不走「附注：」段（正文续写语义）
    expect(text).not.toContain('附注：评标过程合规。');
    // 附注插在对应节末而非报告末尾：一节附注须出现在二节标题之前
    expect(text.indexOf('附注：基本情况补充说明。')).toBeLessThan(text.indexOf('评标委员会成员名单'));
  });

  it('A-151：无附注时十节与原硬编码全句逐字节相同（含 组长末签 尾部）', () => {
    const children = svc.buildChildren(baseSnapshot);
    expect(sectionTenPara(children)).toBe(
      '本报告由系统根据评标过程数据自动生成；全体评标委员会成员在本报告签字页签字后生效。组长末签：' + baseSnapshot.leaderCoSignedAt,
    );
    expect(textOf(children)).not.toContain('附注：');
  });
});
