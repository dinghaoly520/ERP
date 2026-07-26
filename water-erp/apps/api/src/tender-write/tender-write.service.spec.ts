import {
  buildCompetitiveNegotiationReplacementPlan,
  buildInternalBiddingReplacementPlan,
  highlightUnresolvedPlaceholders,
  normalizeCompetitiveNegotiationTemplateXml,
  buildSingleSourceReplacementPlan,
  renderTemplateXml,
  renderCompetitiveNegotiationXml,
} from './tender-write.template';

describe('tender-write template helpers', () => {
  it('normalizes malformed placeholder closers before rendering', () => {
    const xml = '<w:t>{{封面日期)}}</w:t><w:t>{{付款进程)}}</w:t>';

    expect(normalizeCompetitiveNegotiationTemplateXml(xml)).toContain(
      '{{封面日期}}',
    );
    expect(normalizeCompetitiveNegotiationTemplateXml(xml)).toContain(
      '{{付款进程}}',
    );
  });

  it('colors unresolved placeholders red without removing the placeholder text', () => {
    const xml =
      '<w:r><w:t>{{联系邮箱}}</w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>{{评审标准和方法}}</w:t></w:r>';

    const result = highlightUnresolvedPlaceholders(xml);

    expect(result).toContain('{{联系邮箱}}');
    expect(result).toContain('{{评审标准和方法}}');
    expect(result).toContain('w:color w:val="FF0000"');
  });
});

describe('single-source tender template helpers', () => {
  it('maps single-source answers to fixed template replacement texts', () => {
    expect(
      buildSingleSourceReplacementPlan({
        projectName: '取水口闸门维修服务',
        coverDate: '2026-05-18',
        supplierName: '四川某设备有限公司',
        projectBudget: '',
        projectDuration: '30 日历天',
        documentAcquireTime: '2026-05-20 09:00',
        documentPrice: '0 元',
        submissionAndNegotiationTime: '2026-05-25 10:00',
        contactName: '李工',
        contactEmail: '',
        contactPhone: '13800000000',
        serviceContent: '负责现场检修、调试与技术交底。',
        procurementContent: '闸门启闭机维修',
        procurementRequirements: '按既有设备标准完成安装调试',
        quotationLetter: '我方愿按采购文件要求提交报价。',
        quotationLetterType: 'text',
      }),
    ).toEqual([
      {
        targetText: '项目名称',
        replacementText: '取水口闸门维修服务',
        highlight: false,
      },
      {
        targetText: '封面时间',
        replacementText: '二〇二六年五月十八日',
        highlight: false,
      },
      {
        targetText: '供应商名称',
        replacementText: '四川某设备有限公司',
        highlight: false,
      },
      {
        targetText: '项目预算价格',
        replacementText: '请填写项目预算价格',
        highlight: true,
      },
      {
        targetText: '项目完成期限',
        replacementText: '30 日历天',
        highlight: false,
      },
      {
        targetText: '采购文件获取时间',
        replacementText: '2026-05-20 09:00',
        highlight: false,
      },
      { targetText: '采购文件售价', replacementText: '0 元', highlight: false },
      {
        targetText: '递交和谈判时间',
        replacementText: '2026-05-25 10:00',
        highlight: false,
      },
      { targetText: '联系人', replacementText: '李工', highlight: false },
      {
        targetText: '联系邮箱',
        replacementText: '请填写联系邮箱',
        highlight: true,
      },
      {
        targetText: '联系电话',
        replacementText: '13800000000',
        highlight: false,
      },
      {
        targetText: '服务内容',
        replacementText: '负责现场检修、调试与技术交底。',
        highlight: false,
        shouldDeleteLine: false,
      },
      {
        targetText: '采购内容',
        replacementText: '闸门启闭机维修',
        highlight: false,
        isHierarchicalText: true,
      },
      {
        targetText: '采购要求',
        replacementText: '按既有设备标准完成安装调试',
        highlight: false,
        isHierarchicalText: true,
      },
      {
        targetText: '报价表',
        replacementText: '',
        highlight: false,
        isFormattedText: true,
        formattedTextXml:
          '<w:p><w:pPr><w:spacing w:line="360" w:lineRule="auto"/><w:ind w:firstLineChars="200" w:firstLine="480"/><w:jc w:val="both"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="仿宋" w:eastAsia="仿宋" w:hAnsi="仿宋" w:cs="仿宋"/><w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr><w:t xml:space="preserve">我方愿按采购文件要求提交报价。</w:t></w:r></w:p>',
      },
    ]);
  });

  it('renders red fallback runs for missing single-source values', () => {
    const xml =
      '<w:p><w:r><w:t>{{项目预算价格}}</w:t></w:r></w:p><w:p><w:r><w:t>{{联系邮箱}}</w:t></w:r></w:p>';

    const result = renderTemplateXml(
      xml,
      buildSingleSourceReplacementPlan({
        projectName: '',
        coverDate: '',
        supplierName: '',
        projectBudget: '',
        projectDuration: '',
        documentAcquireTime: '',
        documentPrice: '',
        submissionAndNegotiationTime: '',
        contactName: '',
        contactEmail: '',
        contactPhone: '',
        serviceContent: '',
        procurementContent: '',
        procurementRequirements: '',
        quotationLetter: '',
        quotationLetterType: 'text',
      }),
    );

    expect(result).toContain('请填写项目预算价格');
    expect(result).toContain('请填写联系邮箱');
    expect(result).toContain('w:color w:val="FF0000"');
  });

  it('handles placeholders split across multiple XML runs', () => {
    // Simulate Word splitting {{项目名称}} across three runs
    const splitXml = `<w:p><w:r><w:t>{{</w:t></w:r><w:r><w:t>项目名称</w:t></w:r><w:r><w:t>}}</w:t></w:r></w:p>`;

    const result = renderTemplateXml(splitXml, [
      { targetText: '项目名称', replacementText: '测试项目', highlight: false },
    ]);

    expect(result).toContain('测试项目');
    expect(result).not.toContain('{{项目名称}}');
    expect(result).not.toContain('{{');
    expect(result).not.toContain('}}');
  });

  it('handles placeholders whose closing braces are split across XML runs', () => {
    const splitXml = `<w:p><w:r><w:t>16.1.1本项目评标委员会人数应为{{</w:t></w:r><w:r><w:t>评标委员会人数}</w:t></w:r><w:r><w:t>}人（含）以上单数。</w:t></w:r></w:p>`;

    const result = renderTemplateXml(splitXml, [
      { targetText: '评标委员会人数', replacementText: '5', highlight: false },
    ]);

    expect(result).toContain('16.1.1本项目评标委员会人数应为5人（含）以上单数。');
    expect(result).not.toContain('{{评标委员会人数}}');
    expect(result).not.toContain('评标委员会人数}');
  });

  it('maps internal/invited bidding evaluation committee count to template replacement', () => {
    const plan = buildInternalBiddingReplacementPlan({
      projectName: '测试项目',
      coverDate: '2026-06-02',
      projectOverview: '项目概况内容',
      procurementContent: '采购内容',
      maxPrice: '1000元',
      qualificationRequirements: '特定资质要求',
      consortiumForm: '',
      consortiumFormType: 'reject',
      documentAcquireTime: '2026-06-03',
      documentPrice: '0元',
      responseSubmissionTime: '2026-06-04',
      contactName: '张三',
      contactPhone: '13800000000',
      contactEmail: 'test@example.com',
      responseDepositType: 'none',
      responseDepositAmount: '',
      responseDepositForm: 'cash',
      responseDepositBankInfo: '',
      responseDepositOtherForm: '',
      responseDepositOtherRequirement: '',
      responseDepositOtherRequirementType: 'none',
      responseDepositNonRefundType: 'none',
      responseDepositNonRefundContent: '',
      performanceDepositType: 'none',
      performanceDepositAmount: '',
      performanceDepositForm: 'cash',
      performanceDepositOtherForm: '',
      evaluationMethod: '综合评分法',
      contractSubcontracting: '',
      contractSubcontractingType: 'none',
      siteSurvey: '',
      siteSurveyType: 'none',
      copyCount: '1',
      evaluationCommitteeCount: '5',
      businessRequirements: '商务要求',
      technicalRequirements: '技术要求',
      quotationLetterType: 'text',
      quotationLetter: '',
    });

    expect(plan).toContainEqual({
      targetText: '评标委员会人数',
      replacementText: '5',
      highlight: false,
    });
  });

  it('does not merge placeholders split within a single run', () => {
    const splitXml = `<w:p><w:r><w:t>{{</w:t><w:t>项目名称</w:t><w:t>}}</w:t></w:r></w:p>`;

    const result = renderTemplateXml(splitXml, [
      { targetText: '项目名称', replacementText: '合并测试', highlight: false },
    ]);

    expect(result).toBe(splitXml);
  });

  it('renders competitive negotiation with split placeholders', () => {
    const splitXml = `<w:p><w:r><w:t>{{</w:t></w:r><w:r><w:t>项目名称</w:t></w:r><w:r><w:t>}}</w:t></w:r></w:p>`;

    const result = renderCompetitiveNegotiationXml(splitXml, {
      项目名称: '谈判采购项目',
    });

    expect(result).toContain('谈判采购项目');
    expect(result).not.toContain('{{项目名称}}');
  });

  it('replaces embedded placeholders preserving surrounding text', () => {
    // Test case: "最高限价{{356864}}元" should become "最高限价356864元"
    const embeddedXml = `<w:p><w:r><w:t>最高限价{{356864}}元</w:t></w:r></w:p>`;

    const result = renderCompetitiveNegotiationXml(embeddedXml, {
      356864: '500000',
    });

    expect(result).toContain('最高限价500000元');
    expect(result).not.toContain('{{356864}}');
    expect(result).toContain('<w:r>');
    expect(result).toContain('</w:r>');
  });

  it('replaces standalone placeholder with braces', () => {
    // Test case: "{{项目名称}}" should be fully replaced
    const standaloneXml = `<w:p><w:r><w:t>{{项目名称}}</w:t></w:r></w:p>`;

    const result = renderCompetitiveNegotiationXml(standaloneXml, {
      项目名称: '测试项目名称',
    });

    expect(result).toContain('测试项目名称');
    expect(result).not.toContain('{{');
    expect(result).not.toContain('}}');
  });

  it('adds the fixed submission requirements heading when the field is enabled', () => {
    const plan = buildCompetitiveNegotiationReplacementPlan({
      projectName: '',
      coverDate: '',
      projectOverview: '',
      procurementContent: '',
      maxPrice: '',
      submissionRequirements: '提交纸质成果 3 套。',
      submissionRequirementsType: 'have',
      qualificationRequirements: '',
      documentAcquireTime: '',
      responseDeadline: '',
      responseDeadlineType: '',
      contactName: '',
      contactPhone: '',
      contactEmail: '',
      contractSubcontracting: '',
      contractSubcontractingType: '',
      siteSurvey: '',
      siteSurveyType: '',
      businessRequirements: '',
      technicalRequirements: '',
      quotationLetter: '',
      quotationLetterType: 'text',
    });

    expect(plan.find((item) => item.targetText === '提交成果要求')).toMatchObject({
      replacementText: '5.提交成果要求：提交纸质成果 3 套。',
      highlight: false,
      shouldDeleteLine: false,
    });
  });

  it('does not duplicate the fixed submission requirements heading', () => {
    const plan = buildCompetitiveNegotiationReplacementPlan({
      projectName: '',
      coverDate: '',
      projectOverview: '',
      procurementContent: '',
      maxPrice: '',
      submissionRequirements: '5.提交成果要求：提交纸质成果 3 套。',
      submissionRequirementsType: 'have',
      qualificationRequirements: '',
      documentAcquireTime: '',
      responseDeadline: '',
      responseDeadlineType: '',
      contactName: '',
      contactPhone: '',
      contactEmail: '',
      contractSubcontracting: '',
      contractSubcontractingType: '',
      siteSurvey: '',
      siteSurveyType: '',
      businessRequirements: '',
      technicalRequirements: '',
      quotationLetter: '',
      quotationLetterType: 'text',
    });

    expect(plan.find((item) => item.targetText === '提交成果要求')?.replacementText).toBe(
      '5.提交成果要求：提交纸质成果 3 套。',
    );
  });

  it('formats project overview with the same paragraph rendering as requirement fields', () => {
    const result = renderTemplateXml(
      '<w:p><w:r><w:t>{{项目概况和采购内容}}</w:t></w:r></w:p>',
      buildCompetitiveNegotiationReplacementPlan({
        projectName: '',
        coverDate: '',
        projectOverview: '第一段\n第二段',
        procurementContent: '',
        maxPrice: '',
        submissionRequirements: '',
        submissionRequirementsType: '',
        qualificationRequirements: '',
        documentAcquireTime: '',
        responseDeadline: '',
        responseDeadlineType: '',
        contactName: '',
        contactPhone: '',
        contactEmail: '',
        contractSubcontracting: '',
        contractSubcontractingType: '',
        siteSurvey: '',
        siteSurveyType: '',
        businessRequirements: '',
        technicalRequirements: '',
        quotationLetter: '',
        quotationLetterType: 'text',
      }),
    );

    expect(result).toContain('第一段');
    expect(result).toContain('第二段');
    // Hierarchical text joins multiple lines with <w:br/> inside the
    // original placeholder paragraph (preserving the template's own pPr).
    expect(result).toContain('<w:br/>');
  });

  it('leaves stray closing braces untouched when no {{...}} placeholder matches', () => {
    // `项目名称}}` has no opening `{{`, so it is not a valid placeholder
    // and the renderer must leave it as plain text (no substitution).
    const malformedXml = `<w:p><w:r><w:t>项目名称：项目名称}}</w:t></w:r></w:p>`;

    const result = renderTemplateXml(malformedXml, [
      { targetText: '项目名称', replacementText: '测试项目', highlight: false },
    ]);

    expect(result).toBe(malformedXml);
  });

  it('replaces placeholders split before numeric suffix without removing following text', () => {
    const splitXml = `<w:p><w:r><w:t>{{响应保证金</w:t></w:r><w:r><w:t>1</w:t></w:r><w:r><w:t>}}不收取</w:t></w:r></w:p>`;

    const result = renderTemplateXml(splitXml, [
      { targetText: '响应保证金1', replacementText: '☑', highlight: false },
    ]);

    expect(result).toContain('☑');
    expect(result).toContain('不收取');
    expect(result).not.toContain('{{响应保证金');
  });

  it('keeps internal bidding long text fields as text replacements', () => {
    const plan = buildInternalBiddingReplacementPlan({
      projectName: '测试项目',
      coverDate: '2026-06-02',
      projectOverview: '项目概况内容',
      procurementContent: '采购内容',
      maxPrice: '1000元',
      qualificationRequirements: '特定资质要求',
      consortiumForm: '',
      consortiumFormType: 'reject',
      documentAcquireTime: '2026-06-03',
      documentPrice: '0元',
      responseSubmissionTime: '2026-06-04',
      contactName: '张三',
      contactPhone: '13800000000',
      contactEmail: 'test@example.com',
      responseDepositType: 'none',
      responseDepositAmount: '',
      responseDepositForm: 'cash',
      responseDepositBankInfo: '',
      responseDepositOtherForm: '',
      responseDepositOtherRequirement: '',
      responseDepositOtherRequirementType: 'none',
      responseDepositNonRefundType: 'none',
      responseDepositNonRefundContent: '',
      performanceDepositType: 'none',
      performanceDepositAmount: '',
      performanceDepositForm: 'cash',
      performanceDepositOtherForm: '',
      evaluationMethod: '综合评分法',
      contractSubcontracting: '',
      contractSubcontractingType: 'none',
      siteSurvey: '',
      siteSurveyType: 'none',
      copyCount: '1',
      businessRequirements: '商务要求',
      technicalRequirements: '技术要求',
      quotationLetterType: 'text',
      quotationLetter: '',
    });

    for (const targetText of [
      '项目概况和采购内容',
      '特定资质要求',
      '商务要求',
      '技术要求',
    ]) {
      const replacement = plan.find((item) => item.targetText === targetText);
      expect(replacement?.replacementText).toBe(targetText === '项目概况和采购内容' ? '项目概况内容' : targetText);
      expect(replacement?.isFormattedText).toBeUndefined();
      expect(replacement?.formattedTextXml).toBeUndefined();
    }
  });

  it('removes internal bidding comprehensive scoring table for lowest price evaluation', () => {
    const xml = `<w:body><w:p><w:r><w:t>六、 综合评分法评标标准</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>评分标准</w:t></w:r></w:p></w:tc></w:tr></w:tbl><w:p><w:r><w:t>第四章 采购需求</w:t></w:r></w:p></w:body>`;

    const result = renderTemplateXml(
      xml,
      buildInternalBiddingReplacementPlan({
        projectName: '测试项目',
        coverDate: '2026-06-02',
        projectOverview: '项目概况内容',
        procurementContent: '采购内容',
        maxPrice: '1000元',
        qualificationRequirements: '特定资质要求',
        consortiumForm: '',
        consortiumFormType: 'reject',
        documentAcquireTime: '2026-06-03',
        documentPrice: '0元',
        responseSubmissionTime: '2026-06-04',
        contactName: '张三',
        contactPhone: '13800000000',
        contactEmail: 'test@example.com',
        responseDepositType: 'none',
        responseDepositAmount: '',
        responseDepositForm: 'cash',
        responseDepositBankInfo: '',
        responseDepositOtherForm: '',
        responseDepositOtherRequirement: '',
        responseDepositOtherRequirementType: 'none',
        responseDepositNonRefundType: 'none',
        responseDepositNonRefundContent: '',
        performanceDepositType: 'none',
        performanceDepositAmount: '',
        performanceDepositForm: 'cash',
        performanceDepositOtherForm: '',
        evaluationMethod: '最低评标价法',
        contractSubcontracting: '',
        contractSubcontractingType: 'none',
        siteSurvey: '',
        siteSurveyType: 'none',
        copyCount: '1',
        businessRequirements: '商务要求',
        technicalRequirements: '技术要求',
        quotationLetterType: 'text',
        quotationLetter: '',
      }),
    );

    expect(result).not.toContain('六、 综合评分法评标标准');
    expect(result).not.toContain('评分标准');
    expect(result).toContain('第四章 采购需求');
  });

  it('keeps content before the comprehensive scoring table when deleting it', () => {
    const xml = `<w:body><w:p><w:r><w:t>第五章 评审办法前置内容</w:t></w:r></w:p><w:p><w:r><w:t>六、 综合评分法评标标准</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>评分标准</w:t></w:r></w:p></w:tc></w:tr></w:tbl><w:p><w:r><w:t>第四章 采购需求</w:t></w:r></w:p></w:body>`;

    const result = renderTemplateXml(
      xml,
      buildInternalBiddingReplacementPlan({
        projectName: '测试项目',
        coverDate: '2026-06-02',
        projectOverview: '项目概况内容',
        procurementContent: '采购内容',
        maxPrice: '1000元',
        qualificationRequirements: '特定资质要求',
        consortiumForm: '',
        consortiumFormType: 'reject',
        documentAcquireTime: '2026-06-03',
        documentPrice: '0元',
        responseSubmissionTime: '2026-06-04',
        contactName: '张三',
        contactPhone: '13800000000',
        contactEmail: 'test@example.com',
        responseDepositType: 'none',
        responseDepositAmount: '',
        responseDepositForm: 'cash',
        responseDepositBankInfo: '',
        responseDepositOtherForm: '',
        responseDepositOtherRequirement: '',
        responseDepositOtherRequirementType: 'none',
        responseDepositNonRefundType: 'none',
        responseDepositNonRefundContent: '',
        performanceDepositType: 'none',
        performanceDepositAmount: '',
        performanceDepositForm: 'cash',
        performanceDepositOtherForm: '',
        evaluationMethod: '最低评标价法',
        contractSubcontracting: '',
        contractSubcontractingType: 'none',
        siteSurvey: '',
        siteSurveyType: 'none',
        copyCount: '1',
        businessRequirements: '商务要求',
        technicalRequirements: '技术要求',
        quotationLetterType: 'text',
        quotationLetter: '',
      }),
    );

    expect(result).toContain('第五章 评审办法前置内容');
    expect(result).not.toContain('六、 综合评分法评标标准');
    expect(result).not.toContain('评分标准');
    expect(result).toContain('第四章 采购需求');
  });

  it('keeps the scoring heading paragraph structurally valid when it has paragraph properties', () => {
    const xml = `<w:body><w:p><w:r><w:t>第五章 评审办法前置内容</w:t></w:r></w:p><w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:t>六、 综合评分法评标标准</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>评分标准</w:t></w:r></w:p></w:tc></w:tr></w:tbl><w:p><w:r><w:t>第四章 采购需求</w:t></w:r></w:p><w:p><w:r><w:t>第四章后续内容</w:t></w:r></w:p></w:body>`;

    const result = renderTemplateXml(
      xml,
      buildInternalBiddingReplacementPlan({
        projectName: '测试项目',
        coverDate: '2026-06-02',
        projectOverview: '项目概况内容',
        procurementContent: '采购内容',
        maxPrice: '1000元',
        qualificationRequirements: '特定资质要求',
        consortiumForm: '',
        consortiumFormType: 'reject',
        documentAcquireTime: '2026-06-03',
        documentPrice: '0元',
        responseSubmissionTime: '2026-06-04',
        contactName: '张三',
        contactPhone: '13800000000',
        contactEmail: 'test@example.com',
        responseDepositType: 'none',
        responseDepositAmount: '',
        responseDepositForm: 'cash',
        responseDepositBankInfo: '',
        responseDepositOtherForm: '',
        responseDepositOtherRequirement: '',
        responseDepositOtherRequirementType: 'none',
        responseDepositNonRefundType: 'none',
        responseDepositNonRefundContent: '',
        performanceDepositType: 'none',
        performanceDepositAmount: '',
        performanceDepositForm: 'cash',
        performanceDepositOtherForm: '',
        evaluationMethod: '最低评标价法',
        contractSubcontracting: '',
        contractSubcontractingType: 'none',
        siteSurvey: '',
        siteSurveyType: 'none',
        copyCount: '1',
        businessRequirements: '商务要求',
        technicalRequirements: '技术要求',
        quotationLetterType: 'text',
        quotationLetter: '',
      }),
    );

    expect(result).toContain('第五章 评审办法前置内容');
    expect(result).toContain('第四章 采购需求');
    expect(result).toContain('第四章后续内容');
    expect(result).not.toContain('<w:p><w:p>');
    expect(result).not.toContain('<w:p><w:pPr');
  });

  it('keeps internal bidding comprehensive scoring table for comprehensive evaluation', () => {
    const xml = `<w:body><w:p><w:r><w:t>六、 综合评分法评标标准</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>评分标准</w:t></w:r></w:p></w:tc></w:tr></w:tbl><w:p><w:r><w:t>第四章 采购需求</w:t></w:r></w:p></w:body>`;

    const result = renderTemplateXml(
      xml,
      buildInternalBiddingReplacementPlan({
        projectName: '测试项目',
        coverDate: '2026-06-02',
        projectOverview: '项目概况内容',
        procurementContent: '采购内容',
        maxPrice: '1000元',
        qualificationRequirements: '特定资质要求',
        consortiumForm: '',
        consortiumFormType: 'reject',
        documentAcquireTime: '2026-06-03',
        documentPrice: '0元',
        responseSubmissionTime: '2026-06-04',
        contactName: '张三',
        contactPhone: '13800000000',
        contactEmail: 'test@example.com',
        responseDepositType: 'none',
        responseDepositAmount: '',
        responseDepositForm: 'cash',
        responseDepositBankInfo: '',
        responseDepositOtherForm: '',
        responseDepositOtherRequirement: '',
        responseDepositOtherRequirementType: 'none',
        responseDepositNonRefundType: 'none',
        responseDepositNonRefundContent: '',
        performanceDepositType: 'none',
        performanceDepositAmount: '',
        performanceDepositForm: 'cash',
        performanceDepositOtherForm: '',
        evaluationMethod: '综合评分法',
        contractSubcontracting: '',
        contractSubcontractingType: 'none',
        siteSurvey: '',
        siteSurveyType: 'none',
        copyCount: '1',
        businessRequirements: '商务要求',
        technicalRequirements: '技术要求',
        quotationLetterType: 'text',
        quotationLetter: '',
      }),
    );

    expect(result).toContain('六、 综合评分法评标标准');
    expect(result).toContain('评分标准');
    expect(result).toContain('第四章 采购需求');
  });

  it('generates Word table from table data', () => {
    const result = buildSingleSourceReplacementPlan({
      projectName: '测试项目',
      coverDate: '2026-05-22',
      supplierName: '供应商A',
      projectBudget: '100000',
      projectDuration: '30天',
      documentAcquireTime: '2026-05-22 09:00',
      documentPrice: '0元',
      submissionAndNegotiationTime: '2026-05-25 10:00',
      contactName: '张三',
      contactEmail: 'test@example.com',
      contactPhone: '13800000000',
      serviceContent: '服务内容',
      procurementContent: '采购内容',
      procurementRequirements: '采购要求',
      quotationLetterType: 'table',
      quotationLetter: '',
      quotationLetterTable: {
        rows: 2,
        cols: 2,
        cells: [
          [
            { content: '设备名称', rowSpan: 1, colSpan: 1, align: 'center' },
            {
              content: 'VWP型振弦式渗压计',
              rowSpan: 1,
              colSpan: 1,
              align: 'center',
            },
          ],
          [
            { content: '规格型号', rowSpan: 1, colSpan: 1, align: 'left' },
            { content: 'VWP-3型', rowSpan: 1, colSpan: 1, align: 'left' },
          ],
        ],
      },
    });

    const quotationReplacement = result.find((r) => r.targetText === '报价表');
    expect(quotationReplacement?.isTable).toBe(true);
    expect(quotationReplacement?.tableXml).toContain('<w:tbl>');
    expect(quotationReplacement?.tableXml).toContain('设备名称');
    expect(quotationReplacement?.tableXml).toContain('VWP型振弦式渗压计');
  });
});
