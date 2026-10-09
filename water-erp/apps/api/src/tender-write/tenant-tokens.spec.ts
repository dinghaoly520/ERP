import {
  applyTenantTokens,
  buildTenantPlaceholderReplacements,
  DEFAULT_SUPERVISION_ADDRESS,
  DEFAULT_SUPERVISION_CONTACT,
  DEFAULT_SUPERVISION_PHONE,
  replaceTextAcrossRuns,
  TENANT_OWNER_COMPANY_TOKEN,
} from './tenant-tokens';

const OWNER = TENANT_OWNER_COMPANY_TOKEN;

describe('replaceTextAcrossRuns', () => {
  it('替换单个 <w:t> 内的目标串', () => {
    const xml = '<w:p><w:r><w:t>采 购 人：四川水发勘测设计研究有限公司</w:t></w:r></w:p>';
    const out = replaceTextAcrossRuns(xml, OWNER, '甲公司');
    expect(out).toBe(
      '<w:p><w:r><w:t>采 购 人：甲公司</w:t></w:r></w:p>',
    );
  });

  it('替换被 Word 拆进多个 run 的目标串（保留各 run 标签与前后文）', () => {
    const xml =
      '<w:p>' +
      '<w:r><w:rPr/><w:t>采购人：四川水发勘测设计研究</w:t></w:r>' +
      '<w:r><w:rPr/><w:t xml:space="preserve">有限公司开户银行</w:t></w:r>' +
      '</w:p>';
    const out = replaceTextAcrossRuns(xml, OWNER, '乙公司');
    expect(out).toBe(
      '<w:p>' +
      '<w:r><w:rPr/><w:t>采购人：乙公司</w:t></w:r>' +
      '<w:r><w:rPr/><w:t xml:space="preserve">开户银行</w:t></w:r>' +
      '</w:p>',
    );
  });

  it('同一目标多处出现全部替换', () => {
    const xml = `<w:p><w:r><w:t>${OWNER}与${OWNER}</w:t></w:r></w:p>`;
    const out = replaceTextAcrossRuns(xml, OWNER, '丙公司');
    expect(out).toBe('<w:p><w:r><w:t>丙公司与丙公司</w:t></w:r></w:p>');
  });

  it('替换文本做 XML 转义', () => {
    const xml = `<w:p><w:r><w:t>${OWNER}</w:t></w:r></w:p>`;
    const out = replaceTextAcrossRuns(xml, OWNER, 'A&B<C>');
    expect(out).toBe(
      '<w:p><w:r><w:t>A&amp;B&lt;C&gt;</w:t></w:r></w:p>',
    );
  });

  it('目标不存在时原样返回', () => {
    const xml = '<w:p><w:r><w:t>无关内容</w:t></w:r></w:p>';
    expect(replaceTextAcrossRuns(xml, OWNER, '甲公司')).toBe(xml);
  });
});

describe('applyTenantTokens', () => {
  const baseXml = (block: string) =>
    `<w:body>${block}<w:p><w:r><w:t>采 购 人：${OWNER}</w:t></w:r></w:p></w:body>`;

  it('监督块四项全替换 + 公司名兜底替换其余出现', () => {
    const xml = baseXml(
      '<w:p><w:r><w:t>监督部门：四川水发勘测设计研究有限公司纪检监察部</w:t></w:r></w:p>' +
        '<w:p><w:r><w:t>地址：四川省成都市双流区红莲街三段383号四川水发集团B座9楼</w:t></w:r></w:p>' +
        '<w:p><w:r><w:t>联系人：王先生、徐先生</w:t></w:r></w:p>' +
        '<w:p><w:r><w:t>监督电话：028-81753276</w:t></w:r></w:p>',
    );
    const out = applyTenantTokens(xml, '甲公司', {
      department: '甲公司审计部',
      address: '某省某市某区1号',
      contact: '李女士',
      phone: '028-12345678',
    });
    expect(out).toContain('监督部门：甲公司审计部');
    expect(out).not.toContain('纪检监察部');
    expect(out).toContain('地址：某省某市某区1号');
    expect(out).toContain('联系人：李女士');
    expect(out).toContain('监督电话：028-12345678');
    // 兜底：其余裸公司名换成当前用户公司
    expect(out).toContain('采 购 人：甲公司');
    expect(out).not.toContain(OWNER);
  });

  it('天府新区地址写法同样替换（采购文件类模板）', () => {
    const xml =
      '<w:p><w:r><w:t>地        址：四川省成都市天府新区红莲街三段383号</w:t></w:r></w:p>';
    const out = applyTenantTokens(xml, '甲公司', { address: '新地址' });
    expect(out).toContain('新地址');
    expect(out).not.toContain('红莲街三段383号');
  });

  it('中标公告模板的第三种地址写法（无省前缀/B栋）同样替换', () => {
    const xml =
      '<w:p><w:r><w:t>地址：成都市天府新区红莲街383号B栋9楼</w:t></w:r></w:p>';
    const out = applyTenantTokens(xml, '甲公司', { address: '新地址' });
    expect(out).toContain('地址：新地址');
    expect(out).not.toContain('B栋9楼');
  });

  it('「王先生」单人也替换（直接采购公告模板只有一位监督人）', () => {
    const xml = '<w:p><w:r><w:t>联系人：王先生</w:t></w:r></w:p>';
    expect(applyTenantTokens(xml, '甲公司', { contact: '赵先生' })).toContain(
      '联系人：赵先生',
    );
  });

  it('监督部门缺省时由公司名兜底拼出「{公司}纪检监察部」', () => {
    const xml =
      `<w:p><w:r><w:t>监督部门：${OWNER}纪检监察部</w:t></w:r></w:p>` +
      `<w:p><w:r><w:t>采购人：${OWNER}</w:t></w:r></w:p>`;
    const out = applyTenantTokens(xml, '甲公司', {});
    expect(out).toContain('监督部门：甲公司纪检监察部');
    expect(out).toContain('采购人：甲公司');
  });

  it('监督字段为空白串视为未提供，保留模板原样', () => {
    const xml =
      `<w:p><w:r><w:t>联系人：王先生、徐先生</w:t></w:r></w:p>`;
    const out = applyTenantTokens(xml, '甲公司', { contact: '   ' });
    expect(out).toContain('王先生、徐先生');
  });

  it('当前用户无归属公司 → 不替换（等同旧行为）', () => {
    const xml = baseXml('<w:p><w:r><w:t>联系人：王先生、徐先生</w:t></w:r></w:p>');
    expect(applyTenantTokens(xml, null, {})).toBe(xml);
    expect(applyTenantTokens(xml, undefined)).toBe(xml);
  });

  it('当前用户公司恰为平台主公司 → 公司名不再无意义改写', () => {
    const xml = `<w:p><w:r><w:t>采购人：${OWNER}</w:t></w:r></w:p>`;
    expect(applyTenantTokens(xml, OWNER, {})).toBe(xml);
  });

  it('监督联系人拆 run（顿号处）也能替换', () => {
    const xml =
      '<w:p>' +
      '<w:r><w:t>联 系 人：王先生、</w:t></w:r>' +
      '<w:r><w:t>徐先生</w:t></w:r>' +
      '</w:p>';
    const out = applyTenantTokens(xml, '甲公司', { contact: '钱先生、孙先生' });
    expect(out).toContain('钱先生、孙先生');
    expect(out).not.toContain('徐先生');
  });
});

describe('buildTenantPlaceholderReplacements（显式占位符填充，2026-10-09 二期）', () => {
  it('公司名优先当前用户公司；未归属回退平台主公司', () => {
    expect(buildTenantPlaceholderReplacements('甲公司')).toContainEqual({
      targetText: '采购人名称',
      replacementText: '甲公司',
      highlight: false,
    });
    expect(buildTenantPlaceholderReplacements(null)).toContainEqual({
      targetText: '采购人名称',
      replacementText: TENANT_OWNER_COMPANY_TOKEN,
      highlight: false,
    });
  });

  it('监督块留空回退统一默认值（部门 = {公司}纪检监察部）', () => {
    const plan = buildTenantPlaceholderReplacements('甲公司');
    expect(plan).toContainEqual({ targetText: '监督部门', replacementText: '甲公司纪检监察部', highlight: false });
    expect(plan).toContainEqual({ targetText: '监督地址', replacementText: DEFAULT_SUPERVISION_ADDRESS, highlight: false });
    expect(plan).toContainEqual({ targetText: '监督人', replacementText: DEFAULT_SUPERVISION_CONTACT, highlight: false });
    expect(plan).toContainEqual({ targetText: '监督电话', replacementText: DEFAULT_SUPERVISION_PHONE, highlight: false });
  });

  it('表单监督值优先于默认值', () => {
    const plan = buildTenantPlaceholderReplacements('甲公司', { department: '甲公司审计部', contact: '李女士' });
    expect(plan).toContainEqual({ targetText: '监督部门', replacementText: '甲公司审计部', highlight: false });
    expect(plan).toContainEqual({ targetText: '监督人', replacementText: '李女士', highlight: false });
  });

  it('includeCompany=false 跳过公司项（备案表模板自有 {{采购人名称}}，防先到先得覆盖）', () => {
    const plan = buildTenantPlaceholderReplacements('甲公司', undefined, false);
    expect(plan.find((r) => r.targetText === '采购人名称')).toBeUndefined();
    expect(plan).toHaveLength(4);
  });
});

describe('replaceTextAcrossRuns — 自含替换防膨胀（稳健性加固）', () => {
  it('替换串包含目标串时不逐轮增长（监督人=王先生、徐先生 含子串 王先生）', () => {
    const xml =
      '<w:p><w:r><w:t>联系人：王先生、徐先生 监督人另有王先生在岗</w:t></w:r></w:p>';
    const out = replaceTextAcrossRuns(xml, '王先生', '王先生、徐先生');
    // 两处「王先生」各替换一次，产物不得再被二次替换
    expect(out).toBe(
      '<w:p><w:r><w:t>联系人：王先生、徐先生、徐先生 监督人另有王先生、徐先生在岗</w:t></w:r></w:p>',
    );
    expect(out.match(/、徐先生/g)?.length).toBe(3); // 恰好两处替换各带一个，无第三次膨胀
  });

  it('替换串与目标串相同时原样收敛（不空转产出）', () => {
    const xml = '<w:p><w:r><w:t>王先生</w:t></w:r></w:p>';
    const out = replaceTextAcrossRuns(xml, '王先生', '王先生');
    expect(out).toBe(xml);
  });

  it('跨 run 命中 + 自含替换串组合也安全', () => {
    const xml =
      '<w:p><w:r><w:t>监督：王先生、</w:t></w:r><w:r><w:t>徐先生</w:t></w:r></w:p>';
    const out = replaceTextAcrossRuns(xml, '王先生、徐先生', '王先生、徐先生、李女士');
    expect(out).toContain('王先生、徐先生、李女士');
    expect(out).not.toContain('李女士、李女士');
  });
});
