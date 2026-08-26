import { checkBidNoticeElements } from './bid-notice-checklist';

const COMPLETE_META = {
  projectCode: 'CG-2026-001',
  method: '询比采购',
  qualification: '具备水利工程施工资质',
  downloadDeadline: '2026-09-01 至 2026-09-10',
  deadline: '2026-09-12 10:00',
  objection: '公示期内向采购人在线提出',
  contact: '张三 028-12345678',
};

describe('checkBidNoticeElements（GB/T 43711 7.2.2.5）', () => {
  it('要素齐全时无警告', () => {
    expect(checkBidNoticeElements({
      title: '某设备采购公告',
      content: '正文含"下载采购文件"与"异议"字样，落款盖章',
      metadata: COMPLETE_META,
    })).toEqual([]);
  });

  it('缺少编号/方式/截止等要素时逐项告警', () => {
    const warnings = checkBidNoticeElements({ title: '标题', content: '', metadata: {} });
    const items = warnings.map(w => w.item);
    expect(items).toContain('项目名称和编码');
    expect(items).toContain('采购交易方式');
    expect(items).toContain('供应商资格条件');
    expect(items).toContain('采购文件获取方法');
    expect(items).toContain('递交截止时间');
    expect(items).toContain('异议渠道');
    expect(items).toContain('采购人签名签章');
  });

  it('正文中出现关键词可豁免对应要素', () => {
    const warnings = checkBidNoticeElements({
      title: '公告',
      content: '异议请联系采购人；请于截止时间前下载获取文件，落款：公司（盖章）',
      metadata: { projectCode: 'X1', method: '询比采购', qualification: '有', deadline: '2026-09-12' },
    });
    expect(warnings.map(w => w.item)).not.toContain('异议渠道');
    expect(warnings.map(w => w.item)).not.toContain('采购文件获取方法');
    expect(warnings.map(w => w.item)).not.toContain('采购人签名签章');
  });

  it('直接采购：无资格条件不算缺项，但缺理由必告警；给了理由则通过', () => {
    const base = { ...COMPLETE_META, method: '直接采购' };
    delete (base as Record<string, unknown>).qualification;

    const withoutReason = checkBidNoticeElements({ title: '直接采购公告', content: '', metadata: base });
    expect(withoutReason.map(w => w.item)).not.toContain('供应商资格条件');
    expect(withoutReason.map(w => w.item)).toContain('直接采购理由');

    const withReason = checkBidNoticeElements({
      title: '直接采购公告',
      content: '',
      metadata: { ...base, directSourcingReason: '专利专有性，只能从该供应商处采购' },
    });
    expect(withReason.map(w => w.item)).not.toContain('直接采购理由');
  });
});
