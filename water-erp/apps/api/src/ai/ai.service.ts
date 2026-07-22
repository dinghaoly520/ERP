import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { LlmService } from '../local-ai/llm.service';
import { NotificationService } from '../notification/notification.service';
import { SupplierSelectionAiService } from './supplier-selection-ai.service';
import { ShareShortlistDto } from './dto/share-shortlist.dto';
import type {
  ComplianceItem,
  RiskItem,
  ScoreSuggestion,
  AiAnalysisResult,
  SupplierRecommendation,
  SupplierSelectionResult,
} from './ai.types';
import { computeRiskFactors, riskLevel, predictDefaultRisk } from './risk-score.compute';
import { buildCalibration } from '../ai-bid-analysis/utils/calibration';

/* =================================================================
   AI 辅助评标引擎
   — 基于规则 + 统计分析，模拟 AI 对投标文件的智能审查
   ================================================================= */

@Injectable()
export class AiService {
  constructor(
    private prisma: PrismaService,
    private selectionAi: SupplierSelectionAiService,
    private llm: LlmService,
    private notificationService: NotificationService,
  ) {}

  /** 便捷方法 —— 直接调用 LLM chatJson，兼容旧代码 */
  async chatJson<T = any>(systemPrompt: string, userPrompt: string, temperature = 0): Promise<T> {
    return this.llm.chatJson<T>(systemPrompt, userPrompt, temperature);
  }

  /** 便捷方法 —— 直接调用 LLM chat（纯文本输出） */
  async chat(systemPrompt: string, userPrompt: string, temperature = 0.3): Promise<string> {
    return this.llm.chat(systemPrompt, userPrompt, temperature);
  }

  /** 润色采购需求描述 —— AI 优化表达，使需求更精准 */
  async polishRequirement(
    text: string,
    projectCtx?: { projectName?: string; procurementMethod?: string; deadline?: string },
  ): Promise<{ polished: string }> {
    const ctxParts: string[] = [];
    if (projectCtx?.projectName) {
      ctxParts.push(`关联项目名称：${projectCtx.projectName}`);
      ctxParts.push(`（根据项目名称推断项目类型、行业归属和常规需求）`);
    }
    if (projectCtx?.procurementMethod) ctxParts.push(`采购方式：${projectCtx.procurementMethod}`);
    if (projectCtx?.deadline) ctxParts.push(`截止日期：${projectCtx.deadline}`);

    const projectContext = ctxParts.length > 0
      ? `\n\n【项目背景信息】\n${ctxParts.join('\n')}\n请根据项目名称推断该项目所属行业和常规采购内容，在润色时补充合理的项目概况（建设地点可写项目所在地区）、采购范围（根据行业推断常规采购项）、资质要求（根据行业查相关资质标准）和特殊要求（工期、质量、业绩门槛）。对于无法从项目名精确推断的具体数值（如工期天数、投资概算金额），请保留「（填写…）」占位符。`
      : '';

    const system = `你是一名政府采购招标文件撰写专家。请对用户的采购需求描述进行文字润色：
1. 修正语法错误、错别字和不规范的表达
2. 使专业术语使用更准确
3. 补充缺失但行业惯例应有的内容维度（如验收标准、质保要求等）
4. 保持原文的结构框架（【项目概况】【采购范围】【资质要求】【特殊要求】），不要改变格式
5. 如果原文内容已经很好，直接返回原文，不要强行修改
只输出润色后的文本，不要添加任何解释或标记。`;

    const input = text + projectContext;
    const polished = await this.llm.chat(system, input, 0.3);
    return { polished: polished.trim() || text };
  }

  /**
   * 优化立项事由 / 供方要求 —— 基于已上传的采购需求表与采购立项申请表原文
   * 对用户当前填写的内容进行润色、补全、规范化。
   */
  async polishInitiationField(params: {
    field: 'projectReason' | 'supplierRequirements';
    text: string;
    demandDocText?: string;
    initiationDocText?: string;
    projectContext?: { title?: string; category?: string; method?: string };
  }): Promise<{ polished: string }> {
    const { field, text, demandDocText, initiationDocText, projectContext } = params;
    const fieldLabel = field === 'projectReason' ? '立项事由' : '供方要求';

    const docParts: string[] = [];
    if (initiationDocText?.trim()) {
      docParts.push(`【采购立项申请表 原文】\n${initiationDocText.trim()}`);
    }
    if (demandDocText?.trim()) {
      docParts.push(`【采购需求表 原文】\n${demandDocText.trim()}`);
    }
    const docContext = docParts.length > 0
      ? `\n\n以下是已上传的原始文档内容，请作为优化依据（不要照抄，而是抽取关键信息融入优化结果）：\n${docParts.join('\n\n')}`
      : '';

    const ctxParts: string[] = [];
    if (projectContext?.title) ctxParts.push(`采购事项名称：${projectContext.title}`);
    if (projectContext?.category) ctxParts.push(`采购类别：${projectContext.category}`);
    if (projectContext?.method) ctxParts.push(`采购方式：${projectContext.method}`);
    const ctxLine = ctxParts.length > 0 ? `\n\n【项目背景】\n${ctxParts.join('\n')}` : '';

    const fieldGuide = field === 'projectReason'
      ? `「立项事由」应说明：项目背景与必要性、采购目标、预期成效，行文正式、逻辑清晰，一般 150-400 字。`
      : `「供方要求」应说明：对供应商的资质、业绩、技术能力、服务、交付等方面的核心要求，条理清晰、可量化处尽量量化。`;

    const system = `你是一名政府采购招标文件撰写专家。请优化用户填写的「${fieldLabel}」内容：

【原始文档利用指导】
你收到的原始文档可能包含采购需求申请表、采购立项申请表等含审批流程的表格文件。
在优化时请注意：
- 文档正文区（申请事项/事由/要求等）是优化内容的主要来源，请抽取其中的关键事实、数据、要求融入优化结果
- 文档审批流转区中的审批意见可能包含有价值的补充要求或修改建议（如"需补充业绩门槛""预算偏高请核实""建议增加质保条款"等），如果合理且与${fieldLabel}相关，应评估将其融入优化内容
- 审批意见中的纯表态用语（"同意""拟同意""批准"等）不纳入优化内容
- 若审批意见指出了原文的缺失或不足，应优先补齐这些内容

【润色与优化规则】
1. 修正语法错误、错别字和不规范表达
2. 结合上传的原始文档抽取关键信息，补全用户遗漏但应有的内容
3. ${fieldGuide}
4. 保持专业、正式的政府采购文风，避免口语化
5. 不要输出标题、编号或分节标记，直接输出正文内容
6. 如果用户原文已经完善，仅做轻微润色即可，不要过度改写

只输出优化后的文本，不要添加任何解释、前后缀或标记。`;

    const input = `当前「${fieldLabel}」内容：\n${text}${ctxLine}${docContext}`;
    const polished = await this.llm.chat(system, input, 0.3);
    return { polished: polished.trim() || text };
  }

  /** 生成通知供应商的文案（标题+正文），基于项目信息 */
  async generateNotificationContent(context: {
    projectName?: string; projectCode?: string; supplierNames: string[];
  }): Promise<{ title: string; body: string }> {
    const system = `你是一名政府采购中心的项目负责人。需要向候选供应商发送通知。

要求：标题简洁（含项目关键信息，不超过 30 字）；正文正式友好，包含：告知被纳入候选名单、项目信息、提醒关注后续正式邀请。不要列举供应商名单。输出纯 JSON（不要 markdown）：{ "title": "...", "body": "..." }`;

    const info = [
      context.projectName ? `项目名称：${context.projectName}` : '',
      context.projectCode ? `项目编号：${context.projectCode}` : '',
      `候选供应商（${context.supplierNames.length} 家）：${context.supplierNames.join('、')}`,
    ].filter(Boolean).join('\n');

    try {
      const result = await this.llm.chatJson<{ title: string; body: string }>(system, info, 0.3);
      return { title: result.title || '项目候选通知', body: result.body || '' };
    } catch {
      return {
        title: '项目候选通知',
        body: `您已被初步筛选为 ${context.projectName || '相关项目'} 的候选供应商。请留意后续正式采购邀请及招标文件。如有疑问请与采购中心联系。`,
      };
    }
  }

  /** 工作台问候语（兼容旧引用） */
  async generateWorkbenchGreeting(_context: any): Promise<{ greeting: string; subtitle?: string }> {
    return { greeting: '早上好', subtitle: '今日工作安排已就绪' };
  }

  /** 工作安排每日计划分析 */
  async analyzeWorkArrangementDailyPlan(context: {
    date: string;
    currentTime?: string;
    items?: any[];
    userContext?: { role?: string; displayName?: string; username?: string };
    chairmanMode?: boolean;
    projects?: any[];
  }): Promise<{
    date: string; headerGreeting: string; namePraise: string;
    dailyGreeting: string; riskSummary: string; aiSuggestion: string;
    overview: string; focusItems: any[]; timeBlocks: any[];
    riskAlerts: any[]; completionAdvice: string; projectBrief: string; dailyQuote: string;
  }> {
    const EN2ZH: Record<string,string> = {TODO:'待处理',IN_PROGRESS:'进行中',BLOCKED:'阻塞',COMPLETED:'已完成',CANCELLED:'已取消',CRITICAL:'紧急',HIGH:'高',MEDIUM:'中',LOW:'低'};
    const zh = (s:string)=>EN2ZH[s]||s;
    const items = (context.items||[]).map((i:any)=>({...i,status:zh(i.status),urgency:zh(i.urgency)}));
    const todoCount = items.filter((i:any)=>i.status==='待处理').length;
    const inProgressCount = items.filter((i:any)=>i.status==='进行中').length;
    const criticalCount = items.filter((i:any)=>i.urgency==='紧急').length;
    const totalItems = items.length;
    const projects = (context.projects||[]);
    const projectsInfo = projects.length>0?` 项目数据:${JSON.stringify(projects.slice(0,10))}`:'';
    const userName = context.userContext?.displayName||context.userContext?.username||'用户';
    const hour=parseInt((context.currentTime||'9:00').split(':')[0])||9;
    const period=hour<11?'上午':hour<14?'中午':hour<18?'下午':'晚上';

    try {
      const result = await this.llm.chatJson<any>(
        `你是${userName}的智能工作秘书，负责每日工作排程与风险预警。

═════════════════════════════════════════
【overview — 今日排程总览 · 严格100-200字】
═════════════════════════════════════════
用流畅的自然语言撰写一段充实的今日排程总览，严格控制在100-200字之间，太短会退回重写。必须覆盖以下5点：
1. 总量概况：任务总数、待办数、进行中数、紧急数，用数据说话
2. 最紧迫事项：挑出1-2件最紧迫的事，说明紧迫原因（截止时间、等待时长、影响范围）
3. 关键风险：如果有积压或到期风险，点明后果
4. 时间分配建议：上午适合做什么、下午适合做什么，结合时段特点给出理由
5. 核心策略：一句总结性的行动方针

═════════════════════════════════════════
【focusItems — 重点事项 · 3-5项】
═════════════════════════════════════════
从任务列表中挑出最需要关注的事项，每条：
- id: 任务ID
- title: 任务标题
- priorityRank: 数字越小越优先（1-5）
- reason: 为什么这是重点，15-30字

═════════════════════════════════════════
【timeBlocks — 时间块 · 3-4个】
═════════════════════════════════════════
按优先级将今日任务分配到时段，每个块：
- label: 3-6字短标签
- startTime/endTime: HH:MM格式
- focus: 20-40字，描述该时段要完成的具体任务和预期成果
- taskIds: 关联的任务ID数组

═════════════════════════════════════════
【riskAlerts — 风险提醒 · 按实际情况】
═════════════════════════════════════════
- level: "high"|"medium"|"low"
- title: 8-15字
- description: 20-40字
无明显风险返回空数组[]

═════════════════════════════════════════
其他字段：
- headerGreeting: 80-120字今日工作简报。像一个贴心的私人助理在简报今日安排。语气温暖自然，**直接从今日任务总量切入——不要任何问候语（"早/中/下午好"等问候已由页面标题栏单独显示，重复会冗余）**，挑出1-2项最紧迫的任务给出关怀提醒，最后以鼓励收尾。禁用姓名职位称呼。**严禁以任何标点符号开头，必须直接以汉字正文开始**。示例："今天有8项工作需要你关注，其中3项比较紧急——供应商审批已经等了快一天了，价格复核也有2项需要你的判断。不过别担心，我已经帮你排好了时间顺序。今天一定能顺利处理的。"
- dailyQuote: 20-35字。接在"{period}，{userName}。"之后的一句温暖问候续句，像一个有文化品位的私人助理在说话。要求：(1)与时段呼应——早晨可以是"晨光正好，先把要紧事理顺"、午后"沏杯热茶，案子一件件来"、晚间"今日辛苦，收尾工作交给我看着"；(2)融入当日天气或季节感知；(3)语气从容、关心分寸刚好——不过分亲密也不像机器；(4)一句话结尾，不拆两段；(5)禁止使用{name}、禁用职位称呼、禁用古诗词引用。示例："清晨的风还透着凉意，围好围巾再开始办公吧。"
- namePraise: ""
- dailyGreeting: ""
- riskSummary: 40字内风险总结
- aiSuggestion: ""
projectBrief — 项目简报 · 有项目数据时150-250字，无项目时返回空字符串""

当有项目数据时，必须写一段充实的项目简报，像一个项目经理在做周会汇报。严格覆盖以下4点：
1. 项目概况：一句话概述当前有多少活跃项目（用真实数据），各自处于什么阶段
2. 重点推进：挑1-2个最关键的当前阶段项目，说明所处的具体步骤（如"正处于评标阶段"），预期完成时间
3. 风险与阻塞：如果项目存在 blocked/超期/无进展状态，指明具体项目名和问题
4. 下一步行动：给出一条可执行的建议，如"建议优先推进XX项目的XX阶段，确保在下周前完成XX"

格式要求：流畅的自然语言、段落式叙述，禁止使用Markdown符号和键值对格式。
每段之间用中文句号自然衔接。示例写法：
"当前共有3个活跃项目。都江堰灌区改造项目正处于评标阶段，3位专家已提交评分，预计本周内完成评审。智慧水务信息化系统建设项目已进入合同阶段，合同金额580万元待签署。需注意的是，2026年度防汛物资储备项目处于受阻状态（供应商投标文件解密异常），建议今天联系该供应商确认情况后推进。"
- completionAdvice: ""`,

        `时段:${period} | 日期:${context.date}
用户:${userName}
任务总览: ${totalItems}项（待处理${todoCount} · 进行中${inProgressCount} · 紧急${criticalCount}）
${items.length > 0 ? '任务列表:\n' + JSON.stringify(items.slice(0,20), null, 2) : '今日暂无任务安排。'}
${projectsInfo ? '关联项目:\n' + projectsInfo : ''}`,
      );
      const safeTimeBlocks = (result.timeBlocks || []).map((b: any) => {
        const raw = Array.isArray(b.items) ? b.items : [];
        const titles = raw.map((i: any) => typeof i === 'string' ? i : (i.title || i.name || '')).filter(Boolean);
        return {
          label: b.label || '时间段',
          start: this.normalizeTimeSlot(b.startTime || b.start),
          end: this.normalizeTimeSlot(b.endTime || b.end),
          focus: b.focus || titles.join('、'),
          taskIds: Array.isArray(b.taskIds) ? b.taskIds : [],
        };
      });
      return {
        date: context.date,
        headerGreeting: this.trimLeadingPunctuation(result.headerGreeting) || `今天有${totalItems}项任务需要关注，${criticalCount}项比较紧急。别担心，按优先级一步步处理就好。`,
        namePraise: result.namePraise || '',
        dailyGreeting: '',
        riskSummary: result.riskSummary || (todoCount > 5 ? '待办事项较多' : '风险可控'),
        aiSuggestion: '',
        overview: result.overview || `共${totalItems}项任务 | ${todoCount}待办`,
        focusItems: result.focusItems || [],
        timeBlocks: safeTimeBlocks,
        riskAlerts: result.riskAlerts || [],
        completionAdvice: '',
        projectBrief: result.projectBrief || '',
        dailyQuote: result.dailyQuote || '',
      };
    } catch {
      return {
        date: context.date,
        headerGreeting: `今天有${totalItems}项任务需要关注，别担心，按优先级逐步处理就好。`,
        namePraise: '',
        dailyGreeting: '',
        riskSummary: '风险可控',
        aiSuggestion: '',
        overview: `${totalItems}项任务`,
        focusItems: [], timeBlocks: [], riskAlerts: [],
        completionAdvice: '',
        projectBrief: '',
        dailyQuote: '',
      };
    }
  }

  /* ━━━ 核心：对某供应商在某项目中的投标进行全方位 AI 分析 ━━━ */

  async analyzeBid(
    projectId: string,
    supplierId: string,
    expertId?: string,
  ): Promise<AiAnalysisResult> {
    const [project, supplier] = await Promise.all([
      this.prisma.bidProject.findUnique({
        where: { id: projectId },
        include: { scoreItems: { orderBy: [{ category: 'asc' }, { createdAt: 'asc' }] }, suppliers: true },
      }),
      this.prisma.bidSupplier.findUnique({ where: { id: supplierId } }),
    ]);
    if (!project || !supplier) throw new Error('项目或供应商不存在');

    const scoreItems = project.scoreItems;

    // 1. 符合性检查 — 根据供应商实际状态动态生成
    const complianceCheck = this.runComplianceCheck(supplier, project);

    // 2. 风险分析 — 多维度评估
    const riskAnalysis = this.runRiskAnalysis(supplier, project);

    // 3. 评分建议 — 对每个评分项给出 AI 建议
    const scoreSuggestion = this.generateScoreSuggestions(supplier, scoreItems, project);

    // 4. 关键评审要点
    const keyPoints = this.generateKeyPoints(supplier, project, complianceCheck, riskAnalysis);

    // 汇总
    const overallScore = this.calcOverallScore(complianceCheck, riskAnalysis, scoreSuggestion);

    return {
      supplierName: supplier.supplierName,
      generatedAt: new Date().toISOString(),
      // 诚实标注：本接口为「规则预检」，非大模型结论——此前以 "WaterERP-AI" 名义呈现 hash 模拟数据会误导评标专家。
      model: '规则预检引擎 v2.0（Rules + Statistics，非 LLM）',
      isAi: false,
      methodology:
        '本结果为确定性规则与统计预检（符合性核对 + 风险因子 + 评分区间提示），未调用大模型，部分明细为占位示例，仅供评标参考，不得作为 AI 评审结论。',
      overall: overallScore,
      complianceCheck,
      riskAnalysis,
      scoreSuggestion,
      keyPoints,
    };
  }

  /* ━━━ 符合性检查引擎 ━━━ */

  private runComplianceCheck(supplier: any, project: any): { overall: string; score: number; items: ComplianceItem[] } {
    const items: ComplianceItem[] = [];

    // 投标函签字盖章 — 基于解密状态判断
    if (supplier.decryptStatus === 'SUCCESS') {
      items.push({ name: '投标函签字盖章', status: 'pass', detail: '投标函已按要求签字盖章，签章合法有效' });
    } else if (supplier.decryptStatus === 'DANGER') {
      items.push({ name: '投标函签字盖章', status: 'fail', detail: '投标函签章校验异常，可能存在代签或伪造签章风险' });
    } else {
      items.push({ name: '投标函签字盖章', status: 'warn', detail: '投标函已完成解密，签章信息待人工核验' });
    }

    // 营业执照 — 模拟检查
    const licenseOk = supplier.confirmStatus !== 'EXCEPTION';
    items.push({
      name: '营业执照',
      status: licenseOk ? 'pass' : 'fail',
      detail: licenseOk ? '营业执照在有效期内，经营范围覆盖本项目需求' : '营业执照信息异常，请人工核实',
    });

    // 资质证书 — 基于供应商名称生成差异
    const qualOk = !supplier.supplierName.includes('异常');
    if (qualOk) {
      const qualDetails = [
        '水利水电工程施工总承包一级资质，符合项目要求',
        '资质等级满足要求，有效期至 2028年',
        '资质证书齐全，安全生产许可证有效',
      ];
      items.push({ name: '资质证书', status: 'pass', detail: qualDetails[this.hashString(supplier.supplierName) % qualDetails.length] });
    } else {
      items.push({ name: '资质证书', status: 'fail', detail: '资质证书已过期或与项目要求不符' });
    }

    // 投标保证金
    if (supplier.confirmStatus === 'CONFIRMED') {
      items.push({ name: '投标保证金', status: 'pass', detail: '投标保证金已按时足额缴纳，到账确认' });
    } else if (supplier.confirmStatus === 'PENDING') {
      items.push({ name: '投标保证金', status: 'warn', detail: '保证金缴纳状态待确认，请核实收款凭证' });
    } else {
      items.push({ name: '投标保证金', status: 'fail', detail: '保证金缴纳异常，请立即核查' });
    }

    // 法定代表人授权书
    items.push({ name: '法定代表人授权书', status: 'pass', detail: '授权书内容完整，授权范围明确，签字盖章齐全' });

    // 投标文件完整性 — 模拟检查
    const fileStatuses = ['投标文件份数符合要求，电子文件格式正确', '投标文件完整，正本1份，副本4份', '电子投标文件已完整上传，附件无遗漏'];
    items.push({ name: '投标文件完整性', status: 'pass', detail: fileStatuses[this.hashString(supplier.id) % fileStatuses.length] });

    // 工期/交货期响应
    if (supplier.submitStatus === '已提交') {
      items.push({ name: '工期/交货期响应', status: 'pass', detail: '投标文件明确响应了招标文件要求的工期/交货期' });
    } else {
      items.push({ name: '工期/交货期响应', status: 'warn', detail: '工期承诺待确认' });
    }

    // 技术方案完整性
    items.push({ name: '技术方案完整性', status: 'pass', detail: '技术方案涵盖施工组织设计、质量保证措施、安全管理方案' });

    let overall: string;
    const failCount = items.filter(i => i.status === 'fail').length;
    const warnCount = items.filter(i => i.status === 'warn').length;
    const passCount = items.filter(i => i.status === 'pass').length;
    const score = Math.round((passCount * 100 + warnCount * 50) / items.length);

    if (failCount === 0 && warnCount === 0) overall = '全部符合';
    else if (failCount === 0 && warnCount <= 2) overall = '基本符合（有观察项）';
    else if (failCount <= 1) overall = '部分不符合，建议人工复核';
    else overall = '存在严重不符合项';

    return { overall, score, items };
  }

  /* ━━━ 风险分析引擎 ━━━ */

  private runRiskAnalysis(supplier: any, project: any): RiskItem[] {
    const risks: RiskItem[] = [];
    const seed = this.hashString(supplier.supplierName);

    // 资质风险
    risks.push({
      level: supplier.decryptStatus === 'DANGER' ? 'danger' : 'success',
      category: '资质',
      content: supplier.decryptStatus === 'DANGER'
        ? '供应商资质材料异常，存在资质造假风险，建议重点核查'
        : '供应商资质齐全，无异常记录，历史项目履约良好',
      confidence: 92,
    });

    // 报价风险 — 基于项目阶段
    if (project.stage === 'EVALUATING' || project.stage === 'OPENING') {
      const priceRisk = seed % 3;
      if (priceRisk === 0) {
        risks.push({ level: 'info', category: '报价', content: '报价处于竞争对手中位水平，竞争策略稳健', confidence: 78 });
      } else if (priceRisk === 1) {
        risks.push({ level: 'warning', category: '报价', content: '报价低于市场平均水平15%，需关注是否存在低于成本投标风险', confidence: 85 });
      } else {
        risks.push({ level: 'info', category: '报价', content: '报价偏高但处于合理区间，需评估性价比', confidence: 81 });
      }
    }

    // 技术风险
    const techRiskLevels = [0, 1, 2, 0, 0]; // 大部分正常
    const techIdx = seed % techRiskLevels.length;
    if (techRiskLevels[techIdx] === 0) {
      risks.push({ level: 'success', category: '技术', content: '技术方案中施工组织设计详细，关键路径分析清晰', confidence: 88 });
    } else if (techRiskLevels[techIdx] === 1) {
      risks.push({ level: 'warning', category: '技术', content: '技术方案部分细节不够清晰，缺少关键设备清单', confidence: 82 });
    } else {
      risks.push({ level: 'danger', category: '技术', content: '技术方案存在重大缺陷，未明确质量保证措施', confidence: 91 });
    }

    // 进度风险
    if (supplier.confirmStatus === 'CONFIRMED') {
      risks.push({ level: 'success', category: '进度', content: '施工进度计划合理，关键节点安排符合项目工期要求', confidence: 86 });
    } else {
      risks.push({ level: 'info', category: '进度', content: '进度计划基本合理，建议关注资源配置与工期匹配度', confidence: 79 });
    }

    // 业绩风险 — 固定分析点
    const perfScores = [
      { level: 'success' as const, content: '近3年同类项目业绩>5个，最大单项合同金额>5000万元', confidence: 90 },
      { level: 'info' as const, content: '同类项目经验中等，建议重点评审项目团队配置', confidence: 83 },
    ];
    risks.push({ ...perfScores[seed % 2], category: '业绩' });

    // 法律/合规风险
    risks.push({
      level: 'info',
      category: '合规',
      content: '供应商无重大诉讼记录，无行政处罚，信用评级良好',
      confidence: 87,
    });

    return risks;
  }

  /* ━━━ 智能评分建议引擎 ━━━ */

  private generateScoreSuggestions(
    supplier: any,
    scoreItems: any[],
    project: any,
  ): ScoreSuggestion[] {
    const seed = this.hashString(supplier.supplierName + supplier.id);
    const isHighPerformer = supplier.confirmStatus === 'CONFIRMED' && supplier.decryptStatus === 'SUCCESS';

    return scoreItems.map(item => {
      const max = Number(item.maxScore);
      if (max === 0) {
        return { category: item.category, name: item.name, suggestedScore: 0, minScore: 0, maxScore: 0, reason: '此项为符合性审查（通过/不通过），不计分', confidence: 100 };
      }

      // 基于供应商特征 + 评分类别生成差异化的建议分数
      let basePercent: number;
      switch (item.category) {
        case 'QUALIFICATION': basePercent = isHighPerformer ? 0.88 : 0.72; break;
        case 'BUSINESS': basePercent = 0.75 + (seed % 20) / 100; break;
        case 'TECHNICAL': basePercent = 0.70 + (seed % 25) / 100; break;
        case 'PRICE': basePercent = 0.78 + (seed % 18) / 100; break;
        case 'RESPONSIVE': basePercent = isHighPerformer ? 0.92 : 0.82; break;
        default: basePercent = 0.80;
      }

      const suggestedScore = Math.round(max * basePercent * 2) / 2;
      const confidence = 75 + (seed % 20);

      const reasonTemplates: Record<string, string[]> = {
        QUALIFICATION: ['资质齐全，等级符合要求', '基本满足资质要求，可进一步提供补充材料', '资质等级超出项目要求'],
        BUSINESS: ['商务方案完整，报价结构合理', '商务条款响应较好，部分可优化', '商务方案较为完善'],
        TECHNICAL: ['技术方案完善，创新点突出', '技术方案合理，部分细节可优化', '技术方案总体良好，建议关注施工难点'],
        PRICE: ['报价具有竞争力，处于合理区间', '价格评分基于基准价偏差计算', '报价策略合理'],
        RESPONSIVE: ['完全响应招标文件要求', '基本响应，部分条款需确认', '响应性良好'],
      };

      const reasons = reasonTemplates[item.category] || ['综合评估'];
      const reason = reasons[seed % reasons.length];

      return {
        category: item.category,
        name: item.name,
        suggestedScore,
        minScore: Math.max(0, suggestedScore - Math.round(max * 0.12)),
        maxScore: Math.min(max, suggestedScore + Math.round(max * 0.08)),
        reason,
        confidence,
      };
    });
  }

  /* ━━━ 关键评审要点生成 ━━━ */

  private generateKeyPoints(
    supplier: any,
    project: any,
    compliance: { items: ComplianceItem[] },
    risks: RiskItem[],
  ): string[] {
    const points: string[] = [];

    // 从符合性检查中提取关注点
    const problemItems = compliance.items.filter(i => i.status !== 'pass');
    if (problemItems.length > 0) {
      points.push(`⚠️ 注意：存在 ${problemItems.length} 项检查项需人工复核（${problemItems.map(i => i.name).join('、')}）`);
    } else {
      points.push('所有符合性检查项均已通过，文件齐全');
    }

    // 从风险分析中提取关键风险
    const highRisks = risks.filter(r => r.level === 'danger' || r.level === 'warning');
    if (highRisks.length > 0) {
      points.push(`🔍 重点关注风险点：${highRisks.map(r => r.category).join('、')}，建议详细评审`);
    }

    // 基于供应商的特征建议
    if (supplier.decryptStatus === 'SUCCESS') {
      points.push('该供应商已成功完成标书解密，投标文件完整可读');
    }

    if (supplier.confirmStatus === 'CONFIRMED') {
      points.push('供应商已确认开标记录，无异议');
    }

    // 项目特定建议
    if (project.procurementMethod === '公开招标') {
      points.push('本项目为公开招标，建议严格按招标文件规定的评分标准进行评审');
    } else if (project.procurementMethod === '综合评分法') {
      points.push('本项目采用综合评分法，请全面评估技术、商务、价格各维度');
    }

    // 通用评审要点
    const universalPoints = [
      '建议横向对比所有投标人的技术方案，关注差异化的创新点',
      '价格评分应注意是否低于成本，如低于成本的应有合理解释',
      '评审时应独立判断，不受其他专家评分影响',
      '如发现投标文件中存在不一致或矛盾之处，应记录并要求澄清',
    ];

    // 随机补充 1-2 条通用要点
    const extraCount = 1 + (this.hashString(supplier.id) % 2);
    const shuffled = [...universalPoints].sort(() => this.hashString(supplier.id + 'extra') % 3 - 1);
    points.push(...shuffled.slice(0, extraCount));

    return points;
  }

  /* ━━━ 综合评分计算 ━━━ */

  private calcOverallScore(
    compliance: { score: number },
    risks: RiskItem[],
    suggestions: ScoreSuggestion[],
  ) {
    const riskScore = risks.reduce((s, r) => s + (r.level === 'danger' ? 0 : r.level === 'warning' ? 50 : 100), 0) / risks.length;

    const nonZeroSuggestions = suggestions.filter(s => s.maxScore > 0);
    const avgSuggestedPercent = nonZeroSuggestions.length > 0
      ? nonZeroSuggestions.reduce((s, sug) => s + (sug.suggestedScore / sug.maxScore), 0) / nonZeroSuggestions.length
      : 0.8;

    const overallScore = Math.round((compliance.score * 0.3 + riskScore * 0.3 + avgSuggestedPercent * 100 * 0.4));

    return {
      score: overallScore,
      level: overallScore >= 85 ? '优秀' : overallScore >= 70 ? '良好' : overallScore >= 60 ? '合格' : '需关注',
      breakdown: {
        compliance: { weight: 30, score: compliance.score },
        risk: { weight: 30, score: Math.round(riskScore) },
        scoring: { weight: 40, score: Math.round(avgSuggestedPercent * 100) },
      },
    };
  }

  /* ━━━ 评分异常检测（管理端用） ━━━ */

  async detectAnomalies(projectId: string) {
    const scores = await this.prisma.bidScoreRecord.findMany({
      where: { expert: { projectId } },
      include: { expert: true, scoreItem: true },
    });

    const expertScores: Record<string, { expertName: string; scores: { itemName: string; category: string; score: number; maxScore: number }[] }> = {};

    for (const s of scores) {
      const key = s.expert.expertName;
      if (!expertScores[key]) expertScores[key] = { expertName: key, scores: [] };
      expertScores[key].scores.push({
        itemName: s.scoreItem.name,
        category: s.scoreItem.category,
        score: Number(s.score),
        maxScore: Number(s.scoreItem.maxScore),
      });
    }

    const anomalies: { expertName: string; severity: 'high' | 'medium' | 'low'; detail: string }[] = [];

    const allExperts = Object.values(expertScores);
    if (allExperts.length < 2) return { anomalies, message: '需要至少2位专家才能进行偏差分析' };

    // 按评分项计算各专家的偏差
    const itemNames = [...new Set(scores.map(s => s.scoreItem.name))];
    for (const itemName of itemNames) {
      const itemScores = allExperts
        .map(e => ({
          expertName: e.expertName,
          score: e.scores.find(s => s.itemName === itemName)?.score ?? 0,
          max: e.scores.find(s => s.itemName === itemName)?.maxScore ?? 0,
        }))
        .filter(s => s.max > 0);

      if (itemScores.length < 2) continue;

      const avg = itemScores.reduce((sum, s) => sum + s.score, 0) / itemScores.length;
      const maxDeviation = Math.max(...itemScores.map(s => Math.abs(s.score - avg)));
      const threshold = Math.max(...itemScores.map(s => s.max)) * 0.2;

      if (maxDeviation > threshold) {
        const outlier = itemScores.find(s => Math.abs(s.score - avg) === maxDeviation);
        if (outlier) {
          anomalies.push({
            expertName: outlier.expertName,
            severity: maxDeviation > threshold * 2 ? 'high' : 'medium',
            detail: `在"${itemName}"评分项上，${outlier.expertName}(${outlier.score}) 与其他专家均值(${Math.round(avg)}) 偏差较大`,
          });
        }
      }
    }

    return {
      anomalies,
      total: anomalies.length,
      highCount: anomalies.filter(a => a.severity === 'high').length,
      analyzedAt: new Date().toISOString(),
    };
  }

  /* ━━━ 供应商风险评分（管理端用） ━━━ */

  async getSupplierRiskScores(projectId: string) {
    // 预取：投标方、提交、绩效均分、资质聚合（全部/过期）、项目预算
    const [suppliers, submissions, perfAgg, qualAgg, expiredAgg, budgetRow] = await Promise.all([
      this.prisma.bidSupplier.findMany({ where: { projectId } }),
      this.prisma.supplierBidSubmission.findMany({ where: { projectId } }),
      this.prisma.supplierEvaluation.groupBy({
        by: ['supplierId'],
        _avg: { overallScore: true },
        _count: { _all: true },
      }),
      this.prisma.supplierQualification.groupBy({ by: ['supplierId'], _count: { _all: true } }),
      this.prisma.supplierQualification.groupBy({
        by: ['supplierId'],
        where: { validTo: { lt: new Date() } },
        _count: { _all: true },
      }),
      this.prisma.procurementProject.findFirst({ where: { bidProjectId: projectId }, select: { budget: true } }),
    ]);

    // 仅对"已关联 supplierId"的投标方做资质/绩效查表
    const linkedSupplierIds = suppliers.map(s => s.supplierId).filter((x): x is string => !!x);
    const perfMap = new Map(perfAgg.filter(a => linkedSupplierIds.includes(a.supplierId)).map(a => [a.supplierId, { avg: a._avg.overallScore ? Number(a._avg.overallScore) : null, count: a._count._all }]));
    const qualMap = new Map(qualAgg.filter(a => linkedSupplierIds.includes(a.supplierId)).map(a => [a.supplierId, a._count._all]));
    const expiredMap = new Map(expiredAgg.filter(a => linkedSupplierIds.includes(a.supplierId)).map(a => [a.supplierId, a._count._all]));
    const budget = budgetRow?.budget ? Number(budgetRow.budget) : null;

    return suppliers.map(s => {
      const sub = submissions.find(x => x.supplierId === s.supplierId);
      const fileRefs = sub ? [sub.technicalFileAssetId, sub.businessFileAssetId, sub.coverLetterAssetId] : [];
      const fileCount = fileRefs.filter(Boolean).length;

      const totalQual = s.supplierId ? (qualMap.get(s.supplierId) ?? 0) : 0;
      const expiredQual = s.supplierId ? (expiredMap.get(s.supplierId) ?? 0) : 0;
      const perf = s.supplierId ? perfMap.get(s.supplierId) : undefined;

      const factors = computeRiskFactors({
        decryptStatus: s.decryptStatus,
        fileCount,
        fileTotal: 3,
        validQualifications: Math.max(0, totalQual - expiredQual),
        expiredQualifications: expiredQual,
        bidPrice: sub?.bidPrice ? Number(sub.bidPrice) : null,
        budget,
        perfAvg: perf?.avg ?? null,
        perfCount: perf?.count ?? 0,
      });
      const overall = Math.round(factors.reduce((sum, f) => sum + f.score, 0) / factors.length);
      const dataBacked = factors.filter(f => f.backedByData).length;
      return {
        id: s.id,
        supplierName: s.supplierName,
        overallRiskScore: overall,
        level: riskLevel(overall),
        factors: factors.map(f => ({ name: f.name, score: f.score, detail: f.detail })),
        confidence: Math.round((dataBacked / factors.length) * 100),
      };
    });
  }

  /* ━━━ 工具方法 ━━━ */

  private hashString(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
    }
    return Math.abs(hash);
  }

  /* ━━━ AI 供应商智能选取（检索 → LLM 排序 → 规则兜底） ━━━ */

  async recommendSuppliers(
    requirement: string,
    opts: { classificationId?: string; maxCount?: number },
  ): Promise<SupplierSelectionResult> {
    const maxCount = Math.min(Math.max(opts.maxCount ?? 10, 1), 30);
    const reqGrams = this.tokenize(requirement);

    // 1. 检索：已入库供应商，可选分类过滤
    const where: any = { status: 'APPROVED' };
    if (opts.classificationId) where.classificationId = opts.classificationId;
    const suppliers = await this.prisma.supplier.findMany({
      where,
      include: {
        classification: true,
        contacts: { where: { isPrimary: true }, take: 2 },
        qualifications: { select: { name: true }, take: 3 },
        evaluations: { select: { level: true, score: true } },
        bidSuppliers: { where: { project: { stage: { notIn: ['ARCHIVED'] } } }, select: { id: true } },
      },
    });

    // 2. 关键词 n-gram 重叠度评分 → 取 top 候选池
    const scored = suppliers.map((s) => {
      const textSet = new Set(this.tokenize(this.supplierText(s)));
      let hits = 0;
      for (const g of reqGrams) if (textSet.has(g)) hits++;
      const overlap = reqGrams.length > 0 ? hits / reqGrams.length : 0;
      return { supplier: s, overlap, hits };
    });
    scored.sort((a, b) => b.overlap - a.overlap || b.hits - a.hits);

    const POOL = 40;
    const pool = scored.slice(0, POOL);
    const supplierMap = new Map(pool.map(({ supplier: s }) => [s.id, s]));
    // 评价 + 忙闲状态汇总
    const evalMap = new Map<string, { level: string; avgScore: number; count: number }>();
    const activeMap = new Map<string, number>();
    for (const { supplier: s } of pool) {
      const evals: { level: string; score: number }[] = (s as any).evaluations || [];
      if (evals.length > 0) {
        const avgScore = evals.reduce((sum, e) => sum + Number(e.score), 0) / evals.length;
        const levels = { A: 5, B: 4, C: 3, D: 1 } as Record<string, number>;
        const best = evals.reduce((a, b) => (levels[a.level] || 0) >= (levels[b.level] || 0) ? a : b);
        evalMap.set(s.id, { level: best.level, avgScore: Math.round(avgScore * 10) / 10, count: evals.length });
      }
      activeMap.set(s.id, ((s as any).bidSuppliers || []).length);
    }
    const enrichment = { evalMap, activeMap };
    const candidates = pool.map(({ supplier: s }) => ({
      id: s.id,
      name: s.name,
      classification: s.classification?.name,
      businessScope: s.businessScope || '',
      qualificationText: (s.qualifications || []).map((q) => q.name).join('；'),
      enterpriseType: s.enterpriseType,
      legalPerson: s.legalPerson,
      // C3：把规则阶段已算出的履约/评价数据喂给 LLM，使排序真正体现「择优」而非仅语义匹配。
      evalLevel: evalMap.get(s.id)?.level,
      evalAvgScore: evalMap.get(s.id)?.avgScore,
      evalCount: evalMap.get(s.id)?.count,
      activeProjects: activeMap.get(s.id) ?? 0,
    }));

    // 3. LLM 排序（无 key / 失败 → 规则兜底）
    const llm = await this.selectionAi.rankCandidates(requirement, candidates, maxCount);

    let recommendations: SupplierRecommendation[];
    let summary: string;
    let engine: 'deepseek' | 'rules';

    if (llm && llm.recommendations.length > 0) {
      engine = 'deepseek';
      summary = llm.summary;
      recommendations = llm.recommendations
        .map((r) => this.toRecommendation(r.id, r.score, r.reason, supplierMap, enrichment))
        .filter((r): r is SupplierRecommendation => r !== null);
    } else {
      engine = 'rules';
      summary = this.fallbackSummary(pool.length, !!opts.classificationId, maxCount);
      recommendations = pool
        .slice(0, maxCount)
        .map(({ supplier: s, overlap }) =>
          this.toRecommendation(s.id, Math.round(55 + overlap * 40), this.fallbackReason(s, overlap), supplierMap, enrichment)!,
        )
        .filter(Boolean);
    }

    const result = {
      requirement,
      engine,
      model: engine === 'deepseek'
        ? process.env.DEEPSEEK_MODEL ?? 'deepseek-v4-flash'
        : 'WaterERP Rules Engine',
      candidatePool: candidates.length,
      summary,
      recommendations,
      generatedAt: new Date().toISOString(),
    };

    // 自动落取选取历史（A2），供「选取历史/恢复候选名单」使用；失败不影响主流程。
    void this.saveSelectionHistoryRecord({
      requirement,
      resultSummary: summary,
      recommendations,
      candidatePool: candidates.length,
    }).catch(() => {});

    return result;
  }

  private supplierText(s: any): string {
    return [
      s.name,
      s.classification?.name,
      s.enterpriseType,
      s.businessScope,
      (s.qualifications || []).map((q: any) => q.name).join(' '),
    ]
      .filter(Boolean)
      .join(' ');
  }

  /** 中文 n-gram(2/3-gram) + 英文整词 分词，用于无分词器下的重叠度匹配 */
  private tokenize(text: string): string[] {
    if (!text) return [];
    const cleaned = text.replace(/[^一-龥A-Za-z0-9]/g, ' ');
    const grams = new Set<string>();
    for (const word of cleaned.split(/\s+/)) {
      if (!word) continue;
      if (/[一-龥]/.test(word)) {
        for (let n = 2; n <= 3; n++) {
          for (let i = 0; i + n <= word.length; i++) grams.add(word.slice(i, i + n));
        }
        if (word.length <= 3) grams.add(word);
      } else {
        grams.add(word.toLowerCase());
      }
    }
    return [...grams];
  }

  private toRecommendation(
    id: string,
    score: number,
    reason: string,
    supplierMap: Map<string, any>,
    enrichment?: { evalMap: Map<string, any>; activeMap: Map<string, number> },
  ): SupplierRecommendation | null {
    const s = supplierMap.get(id);
    if (!s) return null;
    return {
      supplierId: s.id,
      name: s.name,
      classification: s.classification?.name,
      matchScore: score,
      reason,
      legalPerson: s.legalPerson,
      enterpriseType: s.enterpriseType,
      contacts: (s.contacts || []).map((c: any) => ({ name: c.name, phone: c.phone, isPrimary: c.isPrimary })),
      evaluation: enrichment?.evalMap.get(id),
      activeProjects: enrichment?.activeMap.get(id) ?? 0,
    };
  }

  private fallbackSummary(poolSize: number, classified: boolean, maxCount: number): string {
    if (poolSize === 0) return '未在供应商库中找到与采购需求匹配的候选供应商，请调整需求描述或分类后重试。';
    const scope = classified ? '指定分类内' : '全库';
    return `基于关键词与经营范围匹配，从${scope}候选中筛选出最多 ${maxCount} 家相关供应商（规则引擎；如需更精准的语义推荐，请确保已配置 DeepSeek AI 服务）。`;
  }

  private fallbackReason(s: any, overlap: number): string {
    const parts: string[] = [];
    if (s.classification?.name) parts.push(`属「${s.classification.name}」分类`);
    if (overlap > 0.3) parts.push('经营范围与需求高度相关');
    else if (overlap > 0.1) parts.push('经营范围部分匹配采购需求');
    else parts.push('可纳入候选比较');
    return parts.join('，') + '。';
  }

  private readonly logger = new Logger(AiService.name);

  /** P1-E：全局 AI 评分校准（跨项目采纳率 + category 偏差 + top 偏差项） */
  async getAiCalibration() {
    const deltas = await this.prisma.bidScoreDelta.findMany({
      where: { expertReportConfirmed: true },
    });
    if (!deltas.length) return null;
    const itemIds = [...new Set(deltas.map((d) => d.scoreItemId))];
    const items = await this.prisma.bidScoreItem.findMany({
      where: { id: { in: itemIds } },
      select: { id: true, category: true, name: true },
    });
    return buildCalibration(
      deltas.map((d) => ({
        scoreItemId: d.scoreItemId,
        expertScore: Number(d.expertScore),
        aiScore: Number(d.aiScore),
        delta: Number(d.delta),
        accepted: d.accepted,
      })),
      items,
    );
  }

  async dashboardSummary(context: {
    supplier?: { total: number; approved: number; pending: number; risk: number };
    announcement?: { total: number; published: number; draftLike: number };
    expert?: { total: number; active: number; unfinished: number };
    catalog?: { total: number; active: number; alerts: number };
    applications?: { pending: number };
  }) {
    const s = context.supplier || { total: 0, approved: 0, pending: 0, risk: 0 };
    const a = context.announcement || { total: 0, published: 0, draftLike: 0 };
    const e = context.expert || { total: 0, active: 0, unfinished: 0 };
    const c = context.catalog || { total: 0, active: 0, alerts: 0 };
    const apps = context.applications || { pending: 0 };

    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!apiKey) {
      return this.fallbackInsight(s, a, e, c, apps);
    }

    const supplierApprovalPct = s.total > 0 ? Math.round((s.approved / s.total) * 100) : 0;
    const announcementPubPct = a.total > 0 ? Math.round((a.published / a.total) * 100) : 0;
    const catalogActivePct = c.total > 0 ? Math.round((c.active / c.total) * 100) : 0;
    const expertCompletionRate = (e.active + Math.max(e.unfinished || 0, 0)) > 0
      ? Math.round(((e.active || 0) / ((e.active || 0) + (e.unfinished || 0))) * 100) : 0;

    const systemPrompt = [
      '你是"水叮当"——四川水发集团招采ERP的AI采购运营分析师。你服务于采购管理部门的日常运营决策。',
      '',
      '# 角色设定',
      '你是一位在水利行业有10年经验的采购运营总监，现在转型为AI助手。你的分析风格：',
      '- 从数据中读出业务含义，而不是复述数字。',
      '- 关注审批积压、资源利用率、流程瓶颈、数据质量。',
      '- 对每个模块给出独立的健康度判断和依据。',
      '- 在模块之间建立关联分析（例如：供应商入库慢→可投标的供应商少→招标竞争不充分）。',
      '- 语言干练专业，不堆砌术语，每句话都有信息量。',
      '',
      '# 业务理解',
      '四川水发集团是省属水利投资建设集团，采购业务覆盖工程建设、设备采购、信息化和服务四大类。',
      '招采ERP管理以下业务中心：',
      '',
      '1. 信息发布中心（/notice）：管理招标公告、中标公示、政策法规、平台通知。',
      '   - 已发布比例低意味着对外信息公开不足，影响供应商获取招标机会。',
      '   - 待完善数量多意味着采购需求描述不完整，可能导致后续答疑和澄清增多。',
      '',
      '2. 供应商管理中心（/supplier）：管理供应商注册、审核、入库、评价、变更、停用和黑名单。',
      '   - 入库率 = 已入库/总量，反映供应商资源池的健康程度。',
      '   - 待审积压意味着新供应商无法及时参与投标，直接影响招标竞争充分性。',
      '   - 停用/黑名单数量需要关注是否在合理范围内（通常不超过总量的10%）。',
      '',
      '3. 专家管理中心（/expert）：管理评标专家库、抽取分配、回避管理、履职评价。',
      '   - 专家总量决定了评标工作的可调度弹性。',
      '   - 未完成事项数反映专家履职的及时性。',
      '   - 专家参与项目数反映专家资源的利用效率。',
      '',
      '4. 电子商城管理（/mall-management）：管理集中采购目录、价格审批、价格录入。',
      '   - 有效目录占比直接影响价格参考体系的可用性。',
      '   - 待处理预警数反映价格数据的时效性风险。',
      '   - 供货审批积压意味着供应商无法及时获得供货资格。',
      '',
      '# 跨模块关联分析原则',
      '- 供应商待审积压 + 投标项目少 → 招标市场竞争不充分。',
      '- 公告发布率低 + 供应商已入库多 → 信息触达不足，供应商有资源但无机会。',
      '- 专家总量充足但履职完成率低 → 可能存在分配不合理或回避关系过多。',
      '- 商城目录有效率高 + 供货审批少 → 商城供给侧稳定，可扩大目录覆盖。',
      '',
      '# 输出格式（必须严格返回JSON，无任何其他文字）',
      '{',
      '  "overview": "一段80-120字的运营总评，包含对各模块的独立判断和之间的关联分析，语气专业",',
      '  "moduleInsights": [',
      '    {',
      '      "module": "模块名称",',
      '      "status": "健康|关注|待处理",',
      '      "analysis": "40-60字的详细分析，包含数据解读和业务影响",',
      '      "path": "/supplier/approval",',
      '      "tone": "blue|green|orange|purple|cyan",',
      '      "metrics": ["关键数字1", "关键数字2"]',
      '    }',
      '  ],',
      '  "crossInsight": "50-80字的跨模块关联洞察，指出最值得关注的系统性问题",',
      '  "suggestions": [',
      '    {"priority": 1, "text": "具体可执行的行动建议", "path": "/supplier/approval", "impact": "高|中|低"},',
      '    {"priority": 2, "text": "具体可执行的行动建议", "path": "/notice", "impact": "中"}',
      '  ]',
      '}',
      '',
      '# 关键路径映射',
      '信息发布中心→/notice  供应商审批→/supplier/approval  供应商库→/supplier/repository',
      '专家库→/expert/repository  专家评价→/expert/evaluation  商城目录→/mall-management/catalog',
      '价格审批→/mall-management/approval  价格录入→/mall-management/price-entry',
      '',
      '# tone 规则：积压/异常→orange，健康→green，信息→blue，专家→purple，商城→cyan',
      'moduleInsights 必须覆盖4个模块，不要遗漏。metrics 字段放2个最有意义的数字。',
    ].join('\n');

    const userPrompt = [
      '# 当前运营数据快照',
      '',
      '## 信息发布中心',
      `总量 ${a.total} 条 | 已发布 ${a.published} 条（占比 ${announcementPubPct}%）| 待完善/草稿 ${a.draftLike} 条`,
      a.draftLike > 0 ? `→ 有 ${a.draftLike} 条信息尚未完成发布流程，可能处于草稿或待审核状态。` : '→ 信息发布通道畅通，无积压。',
      '',
      '## 供应商管理中心',
      `总量 ${s.total} 家 | 已入库 ${s.approved} 家（入库率 ${supplierApprovalPct}%）| 待审批 ${s.pending} 家 | 停用/黑名单 ${s.risk} 家`,
      s.pending > 0 ? `→ ${s.pending} 家供应商等待入库审核，是当前供应商管理的核心待办事项。` : '',
      s.risk > 0 ? `→ 有 ${s.risk} 家供应商处于停用或黑名单状态，需要确认是否需要清理或恢复。` : '',
      '',
      '## 专家管理中心',
      `总量 ${e.total} 名 | 进行中项目 ${e.active} 项 | 未完成事项 ${e.unfinished} 项 | 履职完成率 ${expertCompletionRate}%`,
      e.unfinished > 0 ? `→ ${e.unfinished} 项专家事项待完成，可能影响评审进度。` : '→ 专家履职情况良好。',
      '',
      '## 电子商城管理',
      `目录总量 ${c.total} 条 | 有效 ${c.active} 条（占比 ${catalogActivePct}%）| 待处理/预警 ${c.alerts} 条 | 供货审批待办 ${apps.pending} 条`,
      c.alerts > 0 ? `→ ${c.alerts} 条目录存在价格波动、临期或待复核状态，影响价格参考准确性。` : '',
      apps.pending > 0 ? `→ ${apps.pending} 条供应商供货申请等待审批。` : '→ 无待审批供货申请。',
      '',
      '# 分析要求',
      '请以采购运营总监的视角，对上述四个模块进行逐一分析和跨模块关联洞察。',
      '每个模块的分析需要引用具体数字，说明业务含义和潜在影响。',
      '跨模块洞察需要找到两个以上模块之间的关联性问题。',
      '建议需要按优先级排列，每条附上预期影响（高/中/低）。',
    ].join('\n');

    try {
      const DEEPSEEK_URL = process.env.DEEPSEEK_API_URL || 'https://api.deepseek.com';
      const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash';
      const res = await fetch(`${DEEPSEEK_URL.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: DEEPSEEK_MODEL, temperature: 0.3, max_tokens: 1600,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
        }),
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) {
        this.logger.warn(`DeepSeek dashboard-summary failed: ${res.status}`);
        return this.fallbackInsight(s, a, e, c, apps);
      }
      const data = await res.json();
      const text = (data?.choices?.[0]?.message?.content || '').trim();
      const parsed = JSON.parse(text);
      return {
        overview: parsed.overview || '运营态势正常',
        moduleInsights: Array.isArray(parsed.moduleInsights) ? parsed.moduleInsights.filter((m: any) => m.module && m.analysis) : [],
        crossInsight: parsed.crossInsight || '',
        highlights: Array.isArray(parsed.highlights) ? parsed.highlights.filter((h: any) => h.module && h.path) : [],
        suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions.filter((s: any) => s.text && s.path) : [],
      };
    } catch (err: any) {
      this.logger.warn(`DeepSeek dashboard-summary error: ${err.message}`);
      return this.fallbackInsight(s, a, e, c, apps);
    }
  }

  private fallbackInsight(s: any, a: any, e: any, c: any, apps: any) {
    const approvalPct = s.total > 0 ? Math.round((s.approved / s.total) * 100) : 0;
    const pubPct = a.total > 0 ? Math.round((a.published / a.total) * 100) : 0;
    const catalogPct = c.total > 0 ? Math.round((c.active / c.total) * 100) : 0;
    const totalIssues = s.pending + a.draftLike + e.unfinished + c.alerts + apps.pending;
    const hasSupplierRisk = s.risk > 0;

    const moduleInsights: any[] = [
      {
        module: '信息发布中心',
        status: a.draftLike > 3 ? '待处理' : a.draftLike > 0 ? '关注' : '健康',
        analysis: a.total === 0
          ? '信息发布中心暂无数据，建议尽快发布集团首条招标公告或政策文件，启动信息发布流程。'
          : a.draftLike > 3
            ? `信息发布总量${a.total}条，但仍有${a.draftLike}条处于草稿或待发布状态（发布率仅${pubPct}%），信息发布效率偏低。公告未发布意味着供应商无法获取招标机会，直接影响项目推进节奏。`
            : a.draftLike > 0
              ? `信息发布总量${a.total}条，已发布${a.published}条，发布率${pubPct}%。有${a.draftLike}条待完善，建议尽快完成剩余信息的发布流程以保持信息透明度。`
              : `信息发布总量${a.total}条，全部已发布，发布率100%。信息发布通道畅通，供应商可及时获取招标信息。`,
        path: '/notice',
        tone: a.draftLike > 3 ? 'orange' : a.draftLike > 0 ? 'blue' : 'green',
        metrics: [`总量${a.total}条`, pubPct > 0 ? `发布率${pubPct}%` : '暂无数据'],
      },
      {
        module: '供应商管理中心',
        status: s.pending > 2 ? '待处理' : s.pending > 0 ? '关注' : hasSupplierRisk ? '关注' : '健康',
        analysis: s.total === 0
          ? '供应商库暂无数据。供应商是招标采购的基础资源，建议尽快通过注册审核或批量导入方式建立首批供应商档案。'
          : s.pending > 2
            ? `供应商总量${s.total}家，入库率${approvalPct}%，当前有${s.pending}家供应商等待入库审核，审批积压较为明显。审核延迟将导致这些供应商无法参与当前招标项目，建议优先处理。`
            : s.pending > 0
              ? `供应商总量${s.total}家，已入库${s.approved}家，入库率${approvalPct}%。有${s.pending}家待审批，供应商资源池总体健康。`
              : hasSupplierRisk
                ? `供应商总量${s.total}家，入库率${approvalPct}%。但存在${s.risk}家停用或黑名单供应商，需要定期复核状态。`
                : `供应商总量${s.total}家，已入库${s.approved}家，入库率${approvalPct}%。资源池健康，审批通道畅通。`,
        path: s.pending > 0 ? '/supplier/approval' : '/supplier/repository',
        tone: s.pending > 2 ? 'orange' : 'green',
        metrics: [`总量${s.total}家`, `入库率${approvalPct}%`],
      },
      {
        module: '专家管理中心',
        status: e.unfinished > 2 ? '待处理' : e.unfinished > 0 ? '关注' : '健康',
        analysis: e.total === 0
          ? '专家库暂无数据。评标专家是招标评审的核心资源，建议尽快录入首批专家信息，并建立专业分类体系。'
          : e.unfinished > 2
            ? `专家${e.total}名，当前${e.active}项评审进行中，但有${e.unfinished}项履职事项未完成。履职延迟可能影响评审质量评价和后续专家抽取。`
            : e.unfinished > 0
              ? `专家${e.total}名，${e.active}项评审进行中，${e.unfinished}项未完成。资源充足，需关注个别专家的履职及时性。`
              : `专家${e.total}名，${e.active}项评审进行中。专家评审工作有序推进，履职情况良好。`,
        path: e.unfinished > 0 ? '/expert/evaluation' : '/expert/repository',
        tone: e.unfinished > 2 ? 'orange' : e.unfinished > 0 ? 'purple' : 'green',
        metrics: [`${e.total}名专家`, `${e.active}项进行中`],
      },
      {
        module: '电子商城管理',
        status: c.alerts > 3 || apps.pending > 2 ? '待处理' : c.alerts > 0 || apps.pending > 0 ? '关注' : '健康',
        analysis: c.total === 0
          ? '电子商城目录暂无数据。集中采购目录是价格参考体系的核心，建议尽快通过价格录入或批量导入方式建立目录数据库。'
          : c.alerts > 3
            ? `目录总量${c.total}条，有效${c.active}条（有效率${catalogPct}%），但有${c.alerts}条存在价格波动、临期或待复核预警。价格数据时效性不足将影响预算编制的准确性。`
            : c.alerts > 0 || apps.pending > 0
              ? `目录总量${c.total}条，有效${c.active}条。${c.alerts > 0 ? `${c.alerts}条待复核，` : ''}${apps.pending > 0 ? `${apps.pending}条供货审批待处理，` : ''}建议及时维护价格数据。`
              : `目录总量${c.total}条，有效${c.active}条（有效率${catalogPct}%）。价格数据时效性良好，可支撑预算编制和价格参考。`,
        path: c.alerts > 0 ? '/mall-management/catalog' : apps.pending > 0 ? '/mall-management/approval' : '/mall-management/catalog',
        tone: c.alerts > 3 || apps.pending > 2 ? 'orange' : c.alerts > 0 || apps.pending > 0 ? 'cyan' : 'green',
        metrics: [`有效${c.active}条`, catalogPct > 0 ? `有效率${catalogPct}%` : '暂无数据'],
      },
    ];

    const crossParts: string[] = [];
    if (s.pending > 0 && a.total > 0) {
      crossParts.push('供应商审批积压可能导致可投标供应商不足，影响招标项目的竞争充分性');
    }
    if (a.draftLike > 0 && a.published > 0) {
      crossParts.push(`信息发布率达${pubPct}%，但仍有${a.draftLike}条待完善，建议优先完成涉及当前招标项目的信息发布`);
    }
    if (e.active > 0 && e.unfinished > 0) {
      crossParts.push(`专家${e.active}项评审进行中但${e.unfinished}项未完成，建议排查是否存在分配不均或回避流程过长的问题`);
    }
    if (c.active > 0 && apps.pending > 0) {
      crossParts.push(`商城目录${c.active}条有效，${apps.pending}条供货申请待审，应尽快完成审批以扩大有效供应商覆盖面`);
    }
    const crossInsight = crossParts.length > 0
      ? crossParts.join('。')
      : '各模块间暂无明显的关联性问题，建议按常规流程推进各项业务';

    const suggestions: any[] = [];
    if (s.pending > 0) suggestions.push({ priority: 1, text: `处理${s.pending}家待审批供应商的入库审核，确保新供应商能及时参与招标`, path: '/supplier/approval', impact: '高' });
    if (a.draftLike > 0) suggestions.push({ priority: suggestions.length + 1, text: `完成${a.draftLike}条待完善公告的编辑和发布，提高信息透明度`, path: '/notice', impact: '高' });
    if (apps.pending > 0) suggestions.push({ priority: suggestions.length + 1, text: `审核${apps.pending}条商城供货申请，扩大目录供应商覆盖范围`, path: '/mall-management/approval', impact: '中' });
    if (c.alerts > 0) suggestions.push({ priority: suggestions.length + 1, text: `复核${c.alerts}条目录的价格波动或临期状态，确保价格参考体系可靠`, path: '/mall-management/catalog', impact: '中' });
    if (e.unfinished > 0) suggestions.push({ priority: suggestions.length + 1, text: `跟进${e.unfinished}项专家未完成事项，保障评审工作的完整性和及时性`, path: '/expert/evaluation', impact: '中' });
    if (c.total > 0 && c.active / Math.max(c.total, 1) > 0.8 && suggestions.length < 3) {
      suggestions.push({ priority: suggestions.length + 1, text: '考虑扩大商城目录品类覆盖范围，丰富价格参考数据维度', path: '/mall-management/price-entry', impact: '低' });
    }
    if (s.approved > 0 && s.pending === 0 && suggestions.length < 3) {
      suggestions.push({ priority: suggestions.length + 1, text: '对已入库供应商进行分类梳理和绩效评价，优化资源池结构', path: '/supplier/evaluation', impact: '低' });
    }

    const overviewParts: string[] = [];
    if (s.total > 0) overviewParts.push(`供应商库${s.total}家（入库率${approvalPct}%）`);
    if (a.total > 0) overviewParts.push(`信息发布${a.total}条（发布率${pubPct}%）`);
    if (e.total > 0) overviewParts.push(`专家${e.total}名（${e.active}项进行中）`);
    if (c.total > 0) overviewParts.push(`商城目录${c.total}条（有效率${catalogPct}%）`);
    const overview = overviewParts.length > 0
      ? `各中心运行概况：${overviewParts.join('，')}。` + (totalIssues > 0 ? `当前共有${totalIssues}项待处理事项需要关注。` : '各模块运行平稳，无积压事项。')
      : '各业务中心暂无活跃数据。建议按实际业务需求逐步初始化：信息发布中心录入首条公告、供应商管理中心注册首批供应商、专家管理中心建立专家库、电子商城导入目录数据。';

    return { overview, moduleInsights, crossInsight, highlights: [], suggestions: suggestions.slice(0, 4) };
  }

  /* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
     大屏 AI 分析面板 — 6 格 + 跑马灯
     ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

  async getBigscreenInsight() {
    const logger = new Logger(AiService.name + '(bigscreen)');

    const [budgetData, signedData, activeBids, supplierGroups, expiringQuals,
      expertGroups, archiveGroups, decryptAnomalies, disputedConfirms,
      topExpiringQuals, openingSessions, stalledProjects, recentProcurement,
    ] = await Promise.all([
      this.prisma.procurementProject.aggregate({ _sum: { budget: true }, _count: true }),
      this.prisma.procurementProject.aggregate({ _sum: { budget: true }, where: { status: 'CONTRACTED' } }),
      this.prisma.bidProject.findMany({
        where: { stage: { in: ['OPENING', 'EVALUATING'] } },
        select: { id: true, name: true, stage: true, budget: true,
          _count: { select: { suppliers: true } } },
        orderBy: { openTime: 'desc' }, take: 8,
      }),
      this.prisma.supplier.groupBy({ by: ['status'], _count: true }),
      this.prisma.supplierQualification.count({
        where: { validTo: { lt: new Date(Date.now() + 90 * 86400000), gte: new Date() } },
      }),
      this.prisma.expertProfile.groupBy({ by: ['availability'], _count: true }),
      this.prisma.bidArchiveItem.groupBy({ by: ['status'], _count: true }),
      // NEW: 解密异常供应商数
      this.prisma.bidSupplier.count({ where: { decryptStatus: 'DANGER' } }),
      // NEW: 确认争议数
      this.prisma.bidSupplier.count({ where: { confirmStatus: 'DISPUTED' } }),
      // NEW: 最紧急过期资质 top 5（含供应商名）
      this.prisma.supplierQualification.findMany({
        where: { validTo: { lt: new Date(Date.now() + 90 * 86400000), gte: new Date() } },
        select: { name: true, validTo: true, supplier: { select: { name: true } } },
        orderBy: { validTo: 'asc' }, take: 5,
      }),
      // NEW: 当前开标会话（含倒计时）
      this.prisma.bidOpeningSession.findMany({
        where: { status: 'OPENING' },
        select: { projectId: true, remainingSeconds: true, project: { select: { name: true } } },
        take: 5,
      }),
      // NEW: 项目阶段停滞（超过7天未更新）
      this.prisma.bidProject.findMany({
        where: { stage: { in: ['SUBMIT', 'OPENING', 'EVALUATING'] },
          updatedAt: { lt: new Date(Date.now() - 7 * 86400000) } },
        select: { name: true, stage: true, updatedAt: true },
        take: 5,
      }),
      // NEW: 最近15条采购项目（用于趋势分析）
      this.prisma.procurementProject.findMany({
        select: { createdAt: true, budget: true, status: true },
        orderBy: { createdAt: 'desc' }, take: 20,
      }),
    ]);

    const fm = (n: number) => n >= 1e8 ? '¥' + (n / 1e8).toFixed(2) + '亿' : n >= 1e4 ? '¥' + Math.round(n / 1e4) + '万' : '¥' + n;
    const gc = (arr: any[], s: string) => arr.find(x => x.status === s)?._count ?? 0;
    const ga = (arr: any[], s: string) => arr.find(x => x.availability === s)?._count ?? 0;
    const gz = (arr: any[], s: string) => arr.find(x => x.status === s)?._count ?? 0;

    const totalBudget = Number(budgetData._sum.budget || 0);
    const signedAmt = Number(signedData._sum.budget || 0);
    const savings = totalBudget - signedAmt;
    const pct = totalBudget > 0 ? Math.round(savings / totalBudget * 1000) / 10 : 0;
    const supTotal = supplierGroups.reduce((a: number, x: any) => a + x._count, 0);
    const supOk = gc(supplierGroups, 'APPROVED');
    const supWait = gc(supplierGroups, 'PENDING');
    const supOff = gc(supplierGroups, 'DISABLED');
    const supBlock = gc(supplierGroups, 'BLACKLIST');
    const expAvail = ga(expertGroups, '可用');
    const expBusy = ga(expertGroups, '占用');
    const expOff = ga(expertGroups, '停用');
    const arcOk = gz(archiveGroups, 'COMPLETED');
    const arcIng = gz(archiveGroups, 'IN_PROGRESS');
    const arcNo = gz(archiveGroups, 'NOT_STARTED');
    const arcAll = arcOk + arcIng + arcNo;
    const stageCN: Record<string, string> = { OPENING: '开标', EVALUATING: '评标', SUBMIT: '提交' };
    const now = new Date();
    const timeStr = now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });

    // ── 趋势数据：按月分组最近6个月采购项目 ──
    const monthlyBuckets: Record<string, number> = {};
    const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1);
    for (const p of recentProcurement) {
      const d = new Date(p.createdAt);
      if (d >= sixMonthsAgo) {
        const key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
        monthlyBuckets[key] = (monthlyBuckets[key] || 0) + 1;
      }
    }
    const monthlyTrend = Object.entries(monthlyBuckets).sort().map(([m, c]) => m + ':' + c).join(',');
    const maxMonthly = Math.max(1, ...Object.values(monthlyBuckets));

    // ── 建设数据快照 ──
    const snap = [
      '【蜀水云采运营快照 ' + now.toLocaleDateString('zh-CN') + ' ' + timeStr + '】',
      '',
      '## 采购总览',
      '项目总数:' + budgetData._count + ' | 预算总额:' + fm(totalBudget) + ' | 已签约:' + fm(signedAmt) + ' | 节资率:' + pct + '%',
      '',
      '## 月度采购趋势（近6月）',
      monthlyTrend + ' (格式: YYYY-MM:项目数)',
      '',
      '## 活跃招标项目',
      activeBids.map((b: any) => '- ' + b.name + ' ' + (stageCN[b.stage] || b.stage) + ' 预算' + fm(Number(b.budget)) + ' ' + b._count.suppliers + '家供方').join('\n') || '无',
      '',
      '## 供应商库',
      '总数' + supTotal + ' | 已批准' + supOk + ' | 待审核' + supWait + ' | 停用' + supOff + ' | 黑名单' + supBlock,
      '资质临期(90天内): ' + expiringQuals + ' 项',
      '解密异常: ' + decryptAnomalies + ' 家 | 确认争议: ' + disputedConfirms + ' 家',
      '',
      '## 临期资质详情（最紧急）',
      topExpiringQuals.map((q: any) => '- ' + q.supplier.name + ' - ' + q.name + ' 有效期至' + new Date(q.validTo).toLocaleDateString('zh-CN')).join('\n') || '无',
      '',
      '## 专家库',
      '总数' + (expAvail + expBusy + expOff) + ' | 可用' + expAvail + ' | 占用' + expBusy + ' | 停用' + expOff,
      '',
      '## 开标实时状态',
      openingSessions.map((s: any) => '- ' + (s.project?.name || '--') + ' 剩余' + Math.ceil((s.remainingSeconds || 0) / 60) + '分钟').join('\n') || '无进行中开标',
      '',
      '## 阶段停滞项目（>7天未推进）',
      stalledProjects.map((p: any) => '- ' + p.name + ' [' + (stageCN[p.stage] || p.stage) + '] 停滞' + Math.floor((now.getTime() - new Date(p.updatedAt).getTime()) / 86400000) + '天').join('\n') || '无',
      '',
      '## 归档状态',
      '总计' + arcAll + ' | 已完成' + arcOk + ' | 进行中' + arcIng + ' | 未开始' + arcNo,
    ].join('\n');

    const sys = [
      '你是"水叮当"——四川水发集团招采ERP的AI运营分析师，直接向集团采购管理部汇报。',
      '',
      '# 你的核心能力',
      '你不是数据的搬运工，你是数据的解读者。不要简单复述数字，要给出判断、归因和建议。',
      '- 比较：当前数据 vs 历史趋势，指出偏离和异常',
      '- 归因：解释数字背后的原因（哪个项目贡献大？哪个供应商出了问题？）',
      '- 研判：指出风险和机会，给出置信度',
      '- 可操作：每条建议必须指向具体操作对象（项目名/供应商名/专家名）',
      '',
      '# 6个分析模块要求',
      '1. 洞察: 3个KPI(总预算/签约/节资)，barPct基于签约率/节资率，标签必须包含环比判断',
      '2. 预警: 列出具体风险事件，level区分紧急程度，每个事件必须有具体名称（如"X公司资质临期"而非笼统描述）。最多4条',
      '3. 趋势: 15个bar对应月度走势(heightPct基于实际月度数据), 2个预测是基于数据的趋势判断',
      '4. 建议: 2-3条，按紧急程度排序，每条带status(active/pending/done)，指向具体操作对象',
      '5. 关注: 最多2项，聚焦当前开标项目（具体项目名+状态+倒计时），使用环形图pct表示进度',
      '6. 归档: 3条进度条，value用"已完成/总计"格式',
      '',
      '# 输出JSON格式',
      '{"insight":{"kpis":[{"label":"总预算","value":"¥X.XX亿","barPct":100},{"label":"已签约","value":"¥X.XX亿","barPct":78},{"label":"节资","value":"¥X.XX亿","barPct":22}]},"alerts":{"events":[{"level":"high","count":3,"label":"X公司资质临期"}],"summary":{"label":"关键指标","value":"X%"}},"trend":{"bars":[{"heightPct":50,"direction":"up"},...15个],"predictions":[{"label":"节资率走势","value":"XX%","direction":"up"},{"label":"招标量走势","value":"X个","direction":"up"}]},"actions":{"steps":[{"label":"催办X公司资质年审(30天到期)","status":"active"}],"completedCount":0},"watch":{"items":[{"name":"X项目","subLabel":"X/Y签到","pct":71,"color":"#f87171"}],"countdownMins":14},"archive":{"items":[{"label":"项目归档","value":"X/Y","barPct":80},{"label":"哈希验证","value":"✓","barPct":100},{"label":"审计追溯","value":"✓","barPct":100}]},"ticker":{"items":[{"dot":"live","time":"12:03","text":"系统正常·X个项目"},...最少10条]}}',
      '',
      '# 关键规则',
      '- level: high(红色紧急)/mid(橙色关注)/info(蓝色信息)',
      '- direction: "up"(绿色利好)/"down"(红色警示)/""(平稳)',
      '- dot: live(绿)/alert(红)/info(蓝)/success(绿)/warn(橙)',
      '- status: active(当前进行)/pending(待处理)/done(已完成)',
      '- barPct: 0-100整数, 趋势bar的heightPct基于每月项目数/maxMonthly*100',
      '- color: #f87171(高)/#fbbf24(中)/#38bdf8(信息)',
      '- 金额: ¥X.XX亿或¥XXX万, 百分比: XX.X%',
      '- ticker最少12条, 含供应商总数/专家数/项目数/活跃开标数/最新归档数',
      '- summary.insights必须是5条字符串数组，每条30-50字，首3字为标签(实时/异常/趋势/建议/数据)，每条引用具体数据',
      '- 必须引用数据快照中的具体名称（供应商名/项目名/专家名），禁止编造',
      '- 如果某模块数据不足（如无开标项目），返回友好占位内容而非空数组',
    ].join('\n');

    const userName = '用户';
    const period = '上午';
    const context = { date: new Date().toISOString().split('T')[0] };
    const items: any[] = [];
    const projectsInfo: any[] = [];
    const totalItems = 1;
    const todoCount = 0;
    const inProgressCount = 0;
    const criticalCount = 0;
    try {
      const result = await this.llm.chatJson<any>(
        `你是${userName}的智能工作秘书，负责每日工作排程与风险预警。

═════════════════════════════════════════
【overview — 今日排程总览 · 严格100-200字】
═════════════════════════════════════════
用流畅的自然语言撰写一段充实的今日排程总览，严格控制在100-200字之间，太短会退回重写。必须覆盖以下5点：
1. 总量概况：任务总数、待办数、进行中数、紧急数，用数据说话
2. 最紧迫事项：挑出1-2件最紧迫的事，说明紧迫原因（截止时间、等待时长、影响范围）
3. 关键风险：如果有积压或到期风险，点明后果
4. 时间分配建议：上午适合做什么、下午适合做什么，结合时段特点给出理由
5. 核心策略：一句总结性的行动方针
格式示例（150字参考）："今日共12项工作任务，其中4项待处理、3项进行中、2项紧急。最紧迫的是2家新供应商已等待超过24小时需尽快审批以免影响后续采购排期，同时有1项价格复核已超时6小时。当前风险集中在供应商积压——如今天内未处理完，明日将累积至6项待审。建议上午9:00-11:00集中处理供应商审批和价格复核，下午14:00起推进项目跟进和资质到期确认，中间预留30分钟处理突发事务。今天的核心策略是：先清审批再推项目，确保零积压。"

═════════════════════════════════════════
【focusItems — 重点事项 · 3-5项】
═════════════════════════════════════════
从任务列表中挑出最需要关注的事项（综合紧迫性和影响面），每条：
- id: 任务ID
- title: 任务标题
- priorityRank: 数字越小越优先（1-5）
- reason: 为什么这是重点，15-30字，说明具体影响或紧迫性
示例：{id:"task_1",title:"核验供应商资质",priorityRank:1,reason:"2家供应商的CCC证书30天内到期，如未续期将从名录移除"}

═════════════════════════════════════════
【timeBlocks — 时间块 · 3-4个】
═════════════════════════════════════════
按优先级将今日任务分配到时段，每个块：
- label: 3-6字短标签，如"上午重点""午后处理"
- startTime/endTime: HH:MM格式
- focus: 20-40字，描述该时段要完成的具体任务和预期成果
- taskIds: 关联的任务ID数组
必须覆盖所有紧急任务。

═════════════════════════════════════════
【riskAlerts — 风险提醒 · 按实际情况】
═════════════════════════════════════════
识别今日风险点，每条：
- level: "high" | "medium" | "low"
- title: 8-15字简短标题
- description: 20-40字具体影响
常见风险：截止时间超期/任务阻塞/依赖未完成/资质到期/供应商积压。无明显风险则返回空数组[]。

═════════════════════════════════════════
其他字段：
- headerGreeting: 80-120字今日工作简报。像一个贴心的私人助理在简报今日安排。语气温暖自然，**直接从今日任务总量切入——不要任何问候语（"早/中/下午好"等问候已由页面标题栏单独显示，重复会冗余）**，挑出1-2项最紧迫或最重要的任务给出关怀提醒，最后以一句鼓励或轻松的话收尾。必须覆盖：数据简述+关怀提醒+鼓励收尾。禁用姓名职位称呼。**严禁以任何标点符号开头，必须直接以汉字正文开始**。
- dailyQuote: 20-35字。接在"{period}，{userName}。"之后的一句温暖问候续句，像一个有文化品位的私人助理在说话。要求：(1)与时段呼应——早晨可以是"晨光正好，先把要紧事理顺"、午后"沏杯热茶，案子一件件来"、晚间"今日辛苦，收尾工作交给我看着"；(2)融入当日天气或季节感知；(3)语气从容、关心分寸刚好——不过分亲密也不像机器；(4)一句话结尾，不拆两段；(5)禁止使用{name}、禁用职位称呼、禁用古诗词引用。示例："清晨的风还透着凉意，围好围巾再开始办公吧。"
- namePraise: ""
- dailyGreeting: ""
- riskSummary: 40字内风险总结
- aiSuggestion: ""
projectBrief — 项目简报 · 有项目数据时150-250字，无项目时返回空字符串""

当有项目数据时，必须写一段充实的项目简报，像一个项目经理在做周会汇报。严格覆盖以下4点：
1. 项目概况：一句话概述当前有多少活跃项目（用真实数据），各自处于什么阶段
2. 重点推进：挑1-2个最关键的当前阶段项目，说明所处的具体步骤（如"正处于评标阶段"），预期完成时间
3. 风险与阻塞：如果项目存在 blocked/超期/无进展状态，指明具体项目名和问题
4. 下一步行动：给出一条可执行的建议，如"建议优先推进XX项目的XX阶段，确保在下周前完成XX"

格式要求：流畅的自然语言、段落式叙述，禁止使用Markdown符号和键值对格式。
每段之间用中文句号自然衔接。示例写法：
"当前共有3个活跃项目。都江堰灌区改造项目正处于评标阶段，3位专家已提交评分，预计本周内完成评审。智慧水务信息化系统建设项目已进入合同阶段，合同金额580万元待签署。需注意的是，2026年度防汛物资储备项目处于受阻状态（供应商投标文件解密异常），建议今天联系该供应商确认情况后推进。"
- completionAdvice: ""`,

        `时段:${period} | 日期:${context.date}
用户:${userName}
任务总览: ${totalItems}项（待处理${todoCount} · 进行中${inProgressCount} · 紧急${criticalCount}）
${items.length > 0 ? '任务列表:\n' + JSON.stringify(items.slice(0,20), null, 2) : '今日暂无任务安排。'}
${projectsInfo ? '关联项目:\n' + projectsInfo : ''}`,
      );
      const safeTimeBlocks = (result.timeBlocks || []).map((b: any) => {
        const raw = Array.isArray(b.items) ? b.items : [];
        const titles = raw.map((i: any) => typeof i === 'string' ? i : (i.title || i.name || '')).filter(Boolean);
        return {
          label: b.label || '时间段',
          start: this.normalizeTimeSlot(b.startTime || b.start),
          end: this.normalizeTimeSlot(b.endTime || b.end),
          focus: b.focus || titles.join('、'),
          taskIds: Array.isArray(b.taskIds) ? b.taskIds : [],
        };
      });
      return {
        date: context.date,
        headerGreeting: this.trimLeadingPunctuation(result.headerGreeting) || `新的一天，愿你从容应对每一件事。`,
        namePraise: result.namePraise || '',
        dailyGreeting: result.dailyGreeting || `今日共${totalItems}项任务，${todoCount}项待处理，${criticalCount}项紧急。`,
        riskSummary: result.riskSummary || (todoCount > 5 ? '待办事项较多' : '风险可控'),
        aiSuggestion: result.aiSuggestion || '建议按优先级依次处理',
        overview: result.overview || `共${totalItems}项任务 | ${todoCount}待办`,
        focusItems: result.focusItems || [],
        timeBlocks: safeTimeBlocks,
        riskAlerts: result.riskAlerts || [],
        completionAdvice: result.completionAdvice || '完成所有待办后记得复盘',
        projectBrief: result.projectBrief || '',
        dailyQuote: result.dailyQuote || '',
      };
    } catch {
      return {
        date: context.date, headerGreeting: `今日共${totalItems}项任务需要关注。`, namePraise: '',
        dailyGreeting: `今日共${totalItems}项任务`, riskSummary: '风险可控',
        aiSuggestion: '按优先级处理', overview: `${totalItems}项任务`,
        focusItems: [], timeBlocks: [], riskAlerts: [],
        completionAdvice: '完成后复盘', projectBrief: '', dailyQuote: '',
      };
    }
  }

  /** 工作画像 — AI 生成个性化的用户工作风格分析与叙事 */
  async analyzeWorkPortrait(context: {
    userContext?: { role?: string; displayName?: string; username?: string };
    auditActivities?: { action: string; resourceType?: string; createdAt: string }[];
    taskSummary?: { total: number; completed: number; byType: Record<string, number> };
  }): Promise<{
    narrative: string;
    metrics: {
      totalApprovals: number;
      avgResponseHours: number;
      completionStreak: number;
      peakDay: string; peakPeriod: string;
    };
    domainFocus: { label: string; pct: number }[];
  }> {
    const userName = context.userContext?.displayName || context.userContext?.username || '用户';
    const activities = context.auditActivities || [];
    const tasks = context.taskSummary || { total: 0, completed: 0, byType: {} };

    const approvalActs = activities.filter(a =>
      ['SUPPLIER_APPROVE','SUPPLIER_REJECT','SUPPLIER_RETURN','PRICE_APPROVE','PRICE_REJECT','CATALOG_APPROVE','PASSWORD_REQUEST_APPROVE'].includes(a.action)
    );

    // Compute simple stats for AI context (not for display — AI generates the narrative)
    const sorted = [...approvalActs].sort((a,b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    let totalGap = 0; let gapCount = 0;
    for (let i = 1; i < sorted.length; i++) {
      const gap = (new Date(sorted[i].createdAt).getTime() - new Date(sorted[i-1].createdAt).getTime()) / 3600000;
      if (gap > 0 && gap < 72) { totalGap += gap; gapCount++; }
    }
    const avgHours = gapCount > 0 ? Math.round((totalGap / gapCount) * 10) / 10 : 0;
    const avgHoursStr = avgHours > 0 ? `${avgHours}小时` : '暂无数据';

    const hourCounts = new Array(24).fill(0);
    const dayCounts = new Array(7).fill(0);
    for (const a of approvalActs) {
      const d = new Date(a.createdAt);
      hourCounts[d.getHours()]++;
      dayCounts[d.getDay()]++;
    }
    const peakHour = hourCounts.indexOf(Math.max(...hourCounts));
    const peakDayIdx = dayCounts.indexOf(Math.max(...dayCounts));
    const periodLabels = { 0:'深夜',6:'清晨',10:'上午',12:'午后',14:'下午',18:'晚间' };
    let period = '上午';
    for (const [h, label] of Object.entries(periodLabels)) {
      if (peakHour >= Number(h)) period = label;
    }
    const dayLabels = ['周日','周一','周二','周三','周四','周五','周六'];

    // Completion streak
    let streak = 0;
    for (let i = 0; i < 30; i++) {
      const d = new Date(); d.setDate(d.getDate() - i);
      const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate());
      const dayEnd = new Date(dayStart.getTime() + 86400000);
      const dayActs = activities.filter(a => {
        const t = new Date(a.createdAt).getTime();
        return t >= dayStart.getTime() && t < dayEnd.getTime() && !['LOGIN','LOGOUT'].includes(a.action);
      });
      if (dayActs.length > 0) streak++; else break;
    }

    // Task type distribution
    const typeLabels: Record<string,string> = { APPROVAL:'审批处理', FOLLOW_UP:'项目跟进', WRITING:'文档撰写', COMMUNICATION:'沟通协调', REVIEW:'审核审查', MEETING:'会议研讨', ARCHIVE:'资料归档', RESEARCH:'调研分析' };
    const totalTyped = Object.values(tasks.byType).reduce((s:number,v:number)=>s+v,0);
    const domainFocus = Object.entries(tasks.byType)
      .sort(([,a],[,b]) => b - a)
      .slice(0, 3)
      .map(([type,count]) => ({ label: typeLabels[type] || type, pct: totalTyped > 0 ? Math.round((count/totalTyped)*100) : 0 }));

    // Let AI generate the narrative
    const systemPrompt = `你是${userName}的私人工作分析师。根据提供的审计日志和任务数据，用温暖、有洞察力的语言写一篇约500字的"工作画像"叙事，分为2-3个自然段。

把以下主题自然地融入这 2-3 个段落（不要逐条罗列，也不要加标题或序号）：
- 工作节奏：高峰日/时段、连续活跃、响应间隔等数据刻画的工作习惯
- 核心领域：从任务类型分布看出的深耕方向与背后能力
- 协作与风格：执行/思考/关系导向等协作偏好
- 一个闪光点：基于数据的具体肯定
- 一条建设性建议：有温度、可操作

写作要求：
- 像一个了解你多年的导师在娓娓道来，有温度、有洞察，不是冰冷的数据汇报
- 第二人称"你"叙述，亲切但有分寸
- 自然融入关键数据点（审批次数、高峰时段、主要领域、完成率等），每处数字紧跟"这意味着什么"
- 严格 2-3 个自然段，**段落之间只用一个换行分隔、禁止空行**（换行符 \\n，不是 \\n\\n）
- 纯中文、不使用Markdown、不加标题或序号
- 如果某些数据为空或为0，巧妙规避或以中性表达处理，不要生硬地说"暂无数据"

返回 JSON:
{
  "narrative": "约500字、2-3段的工作画像叙事（段落之间用单个 \\n 分隔，禁止空行）"
}`;

    const userPrompt = `用户: ${userName}
审批记录: ${approvalActs.length}条，平均响应间隔${avgHoursStr}，峰值时段${dayLabels[peakDayIdx]}${period}（${peakHour}:00左右），最近连续活跃${streak}天
任务总览: 共${tasks.total}项，已完成${tasks.completed}项，完成率${tasks.total > 0 ? Math.round((tasks.completed / tasks.total) * 100) : 0}%
任务类型分布: ${JSON.stringify(tasks.byType)}
任务类型含义: APPROVAL=审批处理, FOLLOW_UP=项目跟进, WRITING=文档撰写, COMMUNICATION=沟通协调, REVIEW=审核审查, MEETING=会议研讨, ARCHIVE=资料归档, RESEARCH=调研分析`;

    // AI 调用失败时直接抛错 —— 不再返回降级文案，让前端显示"未成功生成"。
    // DeepSeek 偶发失败（限流 / 网络抖动 / JSON 解析），重试 1 次再放弃。
    let result: { narrative: string } | null = null;
    for (let attempt = 0; attempt < 2 && !result?.narrative; attempt++) {
      try {
        result = await this.llm.chatJson<{ narrative: string }>(systemPrompt, userPrompt, 0.7);
      } catch (err) {
        if (attempt === 1) throw err;
      }
    }

    if (!result?.narrative) {
      throw new ServiceUnavailableException('工作画像生成返回空内容，请稍后重试');
    }

    return {
      narrative: result.narrative.replace(/\n{2,}/g, '\n').trim(),
      metrics: {
        totalApprovals: approvalActs.length,
        avgResponseHours: avgHours,
        completionStreak: streak,
        peakDay: dayLabels[peakDayIdx], peakPeriod: period,
      },
      domainFocus,
    };
  }

  /** 去掉字符串开头的空白和中英文标点符号。
   *  LLM 偶尔会把问候语漏掉、直接以句号开头（如"。今天有..."），这里做兜底清洗。 */
  private trimLeadingPunctuation(s: string | null | undefined): string {
    if (!s) return '';
    return s.replace(/^[\s。，、；：！？.,;:!?'""''（）()【】《》<>\[\]\-—~·…]+/, '');
  }

  /** Normalize a time-slot string into HH:MM format, handling ISO 8601 and HH:MM inputs. */
  private normalizeTimeSlot(raw: string | undefined | null): string {
    if (!raw) return '';
    const trimmed = raw.trim();
    if (/^\d{2}:\d{2}(:\d{2})?$/.test(trimmed)) return trimmed.slice(0, 5);
    const isoMatch = trimmed.match(/T(\d{2}):(\d{2})/);
    if (isoMatch) return `${isoMatch[1]}:${isoMatch[2]}`;
    return trimmed;
  }

  /** 项目详情分析 — 基于文件 OCR 提取文本 + 项目上下文的双维度匹配分析 */
  async analyzeProjectDetail(context: {
    title?: string; method?: string; budget?: string;
    stages?: { name: string; status: string }[];
    files?: { objectKey?: string; fileName?: string; name?: string; mimeType?: string; fileSize?: number; createdAt?: string; extractedText?: string }[];
    project?: any; currentStage?: any;
  }): Promise<{ analysis: string; fileAnalyses: { objectKey: string; fileName: string; stageMatch: string; contentSummary: string }[] }> {
    const files = (context.files || []).map(f => ({ objectKey: f.objectKey || '', fileName: f.fileName || f.name || '', mimeType: f.mimeType }));
    const project = context.project || {};
    const currentStage = context.currentStage || {};
    const stageKey = currentStage.stageKey || '';

    const systemPrompt = `
你是项目采购文件分析助手，负责阅读项目文件内容并输出简洁、专业的总结性分析。

请输出一个 JSON 对象，结构固定为：
{
  "summary": {
    "stageMatch": "项目简报",
    "contentSummary": "..."
  },
  "fileAnalyses": [
    {
      "objectKey": "...",
      "fileName": "...",
      "stageMatch": "...",
      "contentSummary": "..."
    }
  ]
}

【项目简报规则】
1. summary.stageMatch 固定输出"项目简报"，不要写成文件匹配判断。
2. summary.contentSummary 必须扩展为一段更完整的项目简报（150-200字），至少覆盖：项目采购目标、当前推进到哪一步、已上传材料覆盖情况、项目整体推进状态。

【简报写作格式要求 - 非常重要】
1. 使用流畅的自然语言叙述，不要使用 Markdown 格式（禁止使用 ** 加粗符号）
2. 不要使用"项目名称：xxx"、"申请人：xxx"等键值对格式
3. 采用连贯的段落式表达，例如："本项目采购华测i93pro RTK测量仪器，由兰小平申请，当前处于开标评标阶段..."
4. 信息之间用逗号或句号连接，形成完整的叙述句
5. 保持专业、简洁的公文风格

【文件分析规则】
1. fileAnalyses 只分析当前阶段下的文件，不分析其他阶段文件。
2. 对每个文件进行内容分析，contentSummary 输出一段总结性文字（100-150字），要求：
   - 阅读文件的 extractedText 内容，理解文件的核心信息
   - 用流畅的自然语言总结文件的主要内容，不要使用列表或结构化格式
   - 同样禁止使用 ** 加粗符号和键值对格式
   - 禁止使用"归档"、"已归档"、"归档完成"等表述，因为用户正在进行归档工作
   - 只描述文件本身的内容，不要对整个项目流程做总结性判断
3. 根据文件类型把握分析重点：
   - 审批表/申请表/评审表类：★★★ 重点分析——必须按**表单正文+审批流转**双层结构进行深度分析，具体见下方【审批类文件专项分析规则】
   - 招标文件类：概括采购范围、资格要求、技术规格要点、评标办法
   - 投标/评标类：概括供应商信息、报价、评分结果、评标意见
   - 合同类：概括合同双方、金额、履约期限、主要条款
   - 其他文档：概括文档核心内容

【审批类文件专项分析规则 — 非常重要】
审批表（如采购需求申请表、采购立项申请表、采购文件审批表、定标审批表、合同审批表等）、
申请表、评审表等含审批流转流程的表格文件，必须按以下双层结构深度分析：

**第一层：表单正文区（申请事项核心内容）**
1. 申请事项名称、申请部门/申请人
2. 采购预算金额、采购方式、采购类别
3. 申请事由/情况说明（正文内容，不含审批意见）
4. 供方要求/技术规格摘要
5. 附件清单

**第二层：审批流转区（审批过程全景）**
1. **审批链条**：逐环节列出审批流转路径，识别审批层级（如：经办人→部门负责人→相关职能部门会签→分管领导→公司领导→采购中心），描述每一环节的审批人姓名与职务
2. **审批意见**：逐环节记录审批意见内容，区分类型：
   - 肯定性意见："同意""拟同意""批准""已阅"等
   - 否定性意见："不同意""暂缓""退回修改"等
   - 附条件同意："同意，但需补充XX材料""拟同意，建议完善XX后实施"等——需标注所附条件
3. **审批时间线**：提取各环节的审批日期，分析审批周期（从首次提交到最终批准耗时）
4. **签章状态**：检查审批链中各环节是否已完成签字/盖章

**审批流转分析要点：**
在 contentSummary 中，对审批类文件需按以下结构输出分析：
- 先用 1-2 句概括表单正文（申请事项、预算、申请人）
- 再用 2-3 句详述审批流转情况：审批链有几级、参与审批的部门/人员、最终审批结论（批准/不批准/附条件批准）
- 若存在审批异常（如审批链缺失某环节、有否定意见但项目继续推进、附条件同意的条件未落实、签章不全等），必须明确指出
- 若审批意见中包含对采购内容的修改要求或补充建议，应予以描述

**审批文件内容与字段提取的特殊处理：**
- 审批表中的"申请采购事项名称""立项事由"等字段位于表单正文区，不要将审批意见栏的内容混入
- 审批流转区的审批人签名、日期不应被误提为申请人或需求部门
- 若审批意见中提出了对采购事项的补充/修改要求（如"需补充业绩门槛""预算偏高，请核实"），应记录为审批意见而非采购事项本身的修改

【文件与步骤匹配规则 - 非常重要】
用户输入中包含 currentStage.stageKey，表示当前项目所处的步骤。你需要从两个维度判断文件是否适合该步骤。

**维度一：文件类型匹配（判断文件是否放错了步骤）**
通过文件名关键词快速判断文件是否属于其他步骤：
- 如果文件名关键词直接表明它属于其他步骤，则文件类型不匹配
- 例如：当前步骤是采购需求，但文件名含"立项申请"、"公告"、"合同"等关键词

步骤标识对照表：
- PROCUREMENT_DEMAND = 采购需求步骤
- INITIATION = 采购立项步骤
- TENDER_DOCUMENT = 采购文件步骤
- SUPPLIER_INVITATION = 供应商邀请步骤
- PUBLIC_ANNOUNCEMENT = 采购公告公示步骤
- EXPERT_SELECTION = 专家抽取步骤
- BID_EVALUATION = 开标评标步骤
- AWARD_DECISION = 定标步骤
- CONTRACT = 合同步骤

各步骤对应的典型文件关键词：
- PROCUREMENT_DEMAND（采购需求）：采购需求申请表、需求申请表、采购申请表、需求计划表、采购需求
- INITIATION（项目立项）：采购立项申请表、立项申请表、项目立项审批单、立项申请、立项审批
- TENDER_DOCUMENT（采购文件）：招标文件、采购文件、投标邀请书、技术规格书、评标办法、招标、采购文件（不含"公告"、"公示"）
- PUBLIC_ANNOUNCEMENT（采购公示）：招标公告、采购公告、采购公示、邀请招标公告、谈判采购公告、成交公示、中标公示、公告、公示
- EXPERT_SELECTION（专家抽取）：专家抽取申请、专家名单、评标专家抽取结果、专家抽取、抽取结果
- BID_EVALUATION（评标过程）：投标文件、开标记录、评标报告、评分表、投标、评标、开标
- AWARD_DECISION（定标）：定标报告、中标通知书、定标审批表、定标、中标通知
- CONTRACT（合同）：合同、合同草案、合同审批表、履约保证金

**维度二：内容匹配（判断文件内容与项目信息是否一致 - 非常重要）**
**这是判断文件是否属于当前项目的核心依据，必须严格检查！**

需要阅读文件内容后判断：
1. **提取文件中的项目名称/采购项目名称**：文件内容中通常会明确写出该项目名称
2. **与当前项目标题（project.title）进行比对**：
   - 项目标题中的关键实体（如"土溪口水库"、"人事档案数字化"）必须与文件中的项目名称一致
   - 不同项目的文件内容绝对不能判定为"匹配"
3. **检查文件内容是否与项目需求（project.projectReason）一致**
4. **检查文件内容是否与立项内容相符**

**内容不匹配的典型情况：**
- 文件中的项目名称与当前项目标题完全不同（如文件是"土溪口水库"项目，但当前项目是"人事档案数字化"）
- 文件内容涉及的项目与当前项目无关
- 文件明显属于其他采购项目

**内容匹配的标准：**
- 文件中出现的项目名称/采购项目名称与 project.title 核心关键词一致
- 文件内容描述的采购事项与当前项目相符

**强制要求：如果文件内容中的项目名称与 project.title 明显不同，必须判定为"内容：不匹配"，无论文件类型是否正确！**

**输出格式**
stageMatch 字段需要输出两部分判断结果：

格式："文件类型：XX | 内容：XX"

文件类型判断（必填）：
- "匹配" — 文件名关键词表明文件属于当前步骤
- "不匹配，属于XX步骤" — 文件名关键词表明文件属于其他步骤（XX为中文步骤名）

内容判断（必填）：
- "匹配" — 文件内容与项目标题、需求、立项内容一致
- "不匹配" — 文件内容与项目标题、需求、立项内容不一致，或明显属于其他项目
- "无法判断" — 文件内容无法解析或信息不足

输出示例：
- 当前步骤是采购需求，文件名含"需求申请表"，内容与项目需求一致 → 输出"文件类型：匹配 | 内容：匹配"
- 当前步骤是采购需求，文件名含"立项申请表"，但内容与项目一致 → 输出"文件类型：不匹配，属于采购立项步骤 | 内容：匹配"
- 当前步骤是采购立项，文件名含"立项申请表"，但内容涉及其他项目 → 输出"文件类型：匹配 | 内容：不匹配"
- 当前步骤是采购文件，文件名含"招标公告" → 输出"文件类型：不匹配，属于采购公示步骤 | 内容：匹配"
- 当前步骤是开标评标，文件名含"评标报告"，但内容与项目标题无关 → 输出"文件类型：匹配 | 内容：不匹配"
- 当前步骤是合同，文件名含"合同"，内容与项目一致 → 输出"文件类型：匹配 | 内容：匹配"
- 文件内容无法解析 → 输出"文件类型：匹配 | 内容：无法判断"

【重要提示】
- 必须分别判断文件类型和内容两个维度
- 文件类型判断依据文件名关键词，内容判断依据文件实际内容
- 两个维度的判断相互独立，不要混淆
- **内容匹配判断必须严格核对项目名称，不同项目的文件必须判定为"内容：不匹配"**

【内容匹配判断示例 - 重点参考】
假设当前项目标题是"人资-人事档案数字化服务（谈判采购）"：

错误判断示例：
- 文件内容提到"土溪口水库工程拱坝应力分析"，但判定为"内容：匹配" (错误)
- 这是因为没有核对项目名称，只看了文件类型

正确判断示例：
- 文件名是"抽取结果单"，属于专家抽取步骤 → 文件类型：匹配
- 但文件内容是"土溪口水库工程"，与当前项目"人事档案数字化"完全不同 → 内容：不匹配
- 最终输出："文件类型：匹配 | 内容：不匹配"

再假设当前项目标题是"土溪口水库工程拱坝应力分析及整体安全性综合评价"：
- 文件名是"抽取结果单"，内容提到"土溪口水库工程" → 文件类型：匹配 | 内容：匹配

【强约束】
1. 必须基于文件的 extractedText 内容进行分析，不得编造文件中不存在的信息
2. 如果文件内容为空或无法解析，明确说明"文件内容无法解析"
3. 用语专业、简洁，全部使用中文输出
4. 不输出风险提示或下一步建议
5. 项目简报的结束语必须严格按照 currentStage 的 stageKey 判断：
   - 如果 stageKey 为"CONTRACT"且 status 为"COMPLETED"：简报末尾自然过渡到归档完成的表述，如"至此，本项目采购流程已完整归档"、"各项材料齐备，归档工作已顺利完成"等，文字要有变化，与前文内容连贯衔接
   - 其他情况：只能描述当前所处阶段，如"当前处于XX阶段"，绝对不能出现"归档完成"、"归档资料齐备"等表述
`.trim();

    const userPrompt = JSON.stringify({ project, currentStage, files: context.files }, null, 2);

    try {
      const result = await this.llm.chatJson<{
        summary: { stageMatch: string; contentSummary: string };
        fileAnalyses: Array<{ objectKey: string; fileName: string; stageMatch: string; contentSummary: string }>;
      }>(systemPrompt, userPrompt, 0.2);

      return {
        analysis: result.summary?.contentSummary || `项目"${project.title || ''}"本轮共分析${files.length}个文件。`,
        fileAnalyses: Array.isArray(result.fileAnalyses)
          ? result.fileAnalyses.map(f => ({ objectKey: f.objectKey || '', fileName: f.fileName || '', stageMatch: f.stageMatch || '', contentSummary: f.contentSummary || '' }))
          : files.map(f => ({ objectKey: f.objectKey || '', fileName: f.fileName || '', stageMatch: '未分析', contentSummary: 'AI 未返回分析结果' })),
      };
    } catch {
      return {
        analysis: `项目"${project.title || ''}"共${files.length}个文件。`,
        fileAnalyses: files.map(f => ({ objectKey: f.objectKey || '', fileName: f.fileName || '', stageMatch: '分析失败', contentSummary: 'AI 服务暂不可用，已记录文件信息。' })),
      };
    }
  }

  /** 仪表盘 AI 分析（从 procurement 迁入） */
  async analyzeDashboard(payload: any) {
    const systemPrompt = [
      '你是"水叮当"——四川水发集团招采ERP的 AI 采购运营分析师，服务于采购中心管理驾驶舱。',
      '',
      '# 角色设定',
      '你是一位在水利行业有10年经验的采购运营总监，现转型为 AI 助手。你的分析风格：',
      '- 从数据中读出业务含义，绝不复述数字。',
      '- 关注流程健康度、竞争充分性、资金使用效率、风险信号。',
      '- 语言干练专业、有洞察力，每句话都有信息量。',
      '- 只使用输入数据中明确存在的数值，禁止编造、推算或假设不存在的数据。',
      '',
      '# 领域知识',
      '四川水发集团是省属水利投资建设集团，采购业务覆盖工程建设、设备采购、信息化和服务。',
      '采购方式包括：公开招标、邀请招标、谈判采购、竞争性磋商、询价、单一来源、直接委托、续约、竞价采购。',
      '竞价采购和续约占比过高可能存在竞争不充分的风险；直接委托需要关注合规性。',
      '未成交的原因通常包括：资格审查未通过、报价超预算、投标单位不足、材料不齐全、中止采购等。',
      '风险项目按严重程度分为"高/中/低"，高严重度项目需要管理层立即关注。',
      '',
      '# 分析框架',
      '你需要对采购仪表盘数据进行多维度的关联分析，而不是逐模块孤立解读：',
      '',
      '## 1. 综合研判 (overview)',
      '- 80-120 字的运营总评，先总结整体（完成率、节资率），再指出最值得关注的 1-2 个系统性问题。',
      '- 必须引用具体数字，但不要罗列所有数字。',
      '- 如果完成率高且节资率合适，正面评价；如果有非成交或风险项目，点出核心原因。',
      '',
      '## 2. 核心亮点 (highlights)',
      '- 2-4 条正面发现，每条 15-25 字。',
      '- 扫描这些信号：',
      '  · 某采购方式节资率明显高于平均 → "XX 采购方式节资率达 X%，成本控制效果显著"',
      '  · 某部门项目全部完成 → "XX 部门 X 个项目全部完成，流程执行高效"',
      '  · 供应商竞争充分 → "XX 项目吸引 X 家供应商竞标，竞争充分"',
      '  · 总体节资率 > 10% → "总体节资率 X%，成本管控成效突出"',
      '  · 切忌"整体运行良好"等空洞评价，每条必须引用具体数字或事实。',
      '- 如果确实找不到亮点，返回空数组 []，不要编造。',
      '',
      '## 3. 待关注项 (concerns)',
      '- 2-4 条风险/问题信号，每条 15-25 字。',
      '- 必须逐项扫描以下信号：',
      '  · nonAwardReasons 中某项原因频繁出现 → "X 个项目因资格审查未通过流标，需检查招标资质要求是否合理"',
      '  · riskProjects 中有"高"严重度 → "X 个高风险项目待处理，建议立即介入"',
      '  · 某采购方式全部未成交 → "XX 采购方式流标率 100%，需评估是否调整采购策略"',
      '  · 某部门预算大但完成率低 → "XX 部门预算高但完成率仅 X%，项目推进可能存在瓶颈"',
      '  · 趋势中空日期（未填）占比高 → "X 个项目缺少开标日期，数据完整性待改善"',
      '  · 供应商过度集中 → "XX 供应商中标占比过高，需拓展资源池避免依赖风险"',
      '- 如果确实没有值得关注的问题，描述为"当前各维度运行平稳，无异常信号可关注"。',
      '',
      '## 4. 建议方向 (suggestions)',
      '- 3-5 条可落地的管理建议，每条 18-30 字。',
      '- 建议必须紧扣发现的实际问题（concerns + nonAwardReasons + riskProjects）。',
      '- 示例：',
      '  · "对资格审查未通过率高的采购方式，组织供应商投标培训，降低门槛理解偏差"',
      '  · "将高风险项目列入管理层周例会督办清单，明确责任人和完成时限"',
      '  · "对直接委托/续约占比高的部门，要求说明原因并提报竞争性采购替代方案"',
      '  · "针对缺少开标日期的历史项目，限期补录以确保数据完整性"',
      '  · "拓展某类供应商资源池，增加投标竞争度以提升节资率"',
      '- 即使没有明显问题，也要给出 1-2 条常规改进建议（如定期数据质量巡检、流程审计），不要返回空数组。',
      '',
      '# 输出格式',
      '严格返回 JSON（不要任何其他文本）：',
      '{',
      '  "overview": "100字左右的运营总评，引用关键数字，点出核心问题和亮点",',
      '  "highlights": ["具体亮点1", "具体亮点2"],',
      '  "concerns": ["具体风险1", "具体风险2"],',
      '  "suggestions": ["可执行建议1", "可执行建议2", "可执行建议3"]',
      '}',
    ].join('\n');

    const userPrompt = JSON.stringify({
      range: { label: payload.rangeLabel, startDate: payload.startDate, endDate: payload.endDate },
      summary: payload.summary, trendSeries: payload.trendSeries,
      departmentStats: payload.departmentStats, methodStats: payload.methodStats,
      supplierStats: payload.supplierStats, resultStats: payload.resultStats,
      nonAwardReasons: payload.nonAwardReasons, riskProjects: payload.riskProjects,
      quickActions: payload.quickActions ?? [],
    }, null, 2);

    try {
      const raw = await this.llm.chatJson<any>(systemPrompt, userPrompt, 0.35);
      return {
        overview: raw?.overview || '分析完成',
        highlights: Array.isArray(raw?.highlights) ? raw.highlights : [],
        concerns: Array.isArray(raw?.concerns) ? raw.concerns : [],
        suggestions: Array.isArray(raw?.suggestions) ? raw.suggestions : [],
      };
    } catch {
      return { overview: 'AI 分析暂不可用', highlights: [], concerns: [], suggestions: [] };
    }
  }

  /** 采购台账 AI 分析 */
  async analyzeProcurementLedger(payload: any) {
    const systemPrompt = '你是采购数据分析师。基于采购台账数据进行分析，返回 JSON: {overview, highlights:[], concerns:[], suggestions:[]}';
    try {
      const raw = await this.llm.chatJson<any>(systemPrompt, JSON.stringify(payload, null, 2), 0.3);
      return {
        overview: raw?.overview || raw?.analysis || '分析完成',
        highlights: Array.isArray(raw?.highlights) ? raw.highlights : Array.isArray(raw?.insights) ? raw.insights : [],
        concerns: Array.isArray(raw?.concerns) ? raw.concerns : [],
        suggestions: Array.isArray(raw?.suggestions) ? raw.suggestions : Array.isArray(raw?.recommendations) ? raw.recommendations : [],
      };
    } catch {
      return { overview: '台账分析暂不可用', highlights: [], concerns: [], suggestions: [] };
    }
  }

  /** 招标字段 AI 生成 */
  async generateTenderFieldContent(payload: {
    fieldKey: string; fieldLabel: string; currentValue: string;
    aiPrompt?: string; context?: any;
  }) {
    const systemPrompt =
      `你是招标/采购文件编写专家。默认以采购方（招标方）立场行文，向供应商提出要求、规范其投标与报价行为；` +
      `若字段要求中明确指定以供应商口吻填写（如供应商填报的报价清单），则按该字段指定口吻生成。` +
      `不得编造具体的报价金额（需要报价处以 ____ 留空供填写）。` +
      `只输出正文：不写标题、抬头（如 致：××）或落款签字栏（如 投标人盖章、法定代表人签字、日期）。` +
      `现为"${payload.fieldLabel}"字段生成内容。只返回 JSON: {"content": "正文"}。`;
    const userPrompt =
      `字段: ${payload.fieldKey}\n当前值: ${payload.currentValue}\n` +
      `要求: ${payload.aiPrompt || '生成专业内容'}\n上下文: ${JSON.stringify(payload.context || {})}`;

    // LLM 调用可能因限流/网络/解析偶发失败，重试 3 次以提升稳定性
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const result = await this.llm.chatJson<{ content: string }>(systemPrompt, userPrompt);
        const content = (result.content || '').trim();
        if (content) return { content };
      } catch (err) {
        lastError = err;
      }
      if (attempt < 2) {
        await new Promise((resolve) => setTimeout(resolve, 600 * (attempt + 1)));
      }
    }
    // 全部重试失败 —— 抛错由调用方处理，避免把"生成失败"文本写回字段或存为样本
    throw lastError instanceof Error
      ? lastError
      : new Error('AI 生成失败，请稍后重试');
  }

  /** 参考预算生成 */
  async generateReferenceBudget(payload: {
    projectTitle: string; procurementMethod?: string;
    procurementCategory?: string; requesterDepartment?: string;
    projectReason?: string; historicalProjects?: any[];
  }) {
    const systemPrompt = '你是造价分析师。基于历史项目数据为当前项目生成参考预算。返回 JSON: {referenceBudget, reasoning}';
    try {
      return await this.llm.chatJson<any>(systemPrompt, JSON.stringify(payload, null, 2));
    } catch {
      return { referenceBudget: 0, reasoning: '预算分析暂不可用' };
    }
  }

  /** 生成项目摘要 — 基于项目全量信息 + 各阶段文件分析结果的深度综述，支持归档模式 */
  async generateProjectSummary(context: {
    title?: string; method?: string; category?: string;
    budget?: string; stageCount?: number; completedStages?: number;
    project?: any; fileAnalysisResults?: any; isCompleted?: boolean;
    [key: string]: any;
  }): Promise<string> {
    const p = context.project || {};
    const title = context.title || p.title || '未命名项目';
    const method = context.method || p.procurementMethod || '未知';
    const category = context.category || p.procurementCategory || '未知';
    const budget = context.budget || p.budgetAmount || '未知';
    const requesterName = p.requesterName || '未知';
    const requesterDepartment = p.requesterDepartment || '未知';
    const currentStage = p.currentStage || '未知';
    const projectReason = (p.projectReason || '无').slice(0, 300);
    const supplierRequirements = (p.supplierRequirements || '无').slice(0, 300);
    const stageCount = context.stageCount ?? (p.stages?.length || 0);
    const completedStages = context.completedStages ?? (p.stages?.filter((s: any) => s.status === 'COMPLETED').length || 0);

    const stageNames: Record<string, string> = {
      PROCUREMENT_DEMAND: '采购需求',
      INITIATION: '项目立项',
      TENDER_DOCUMENT: '采购文件',
      PUBLIC_ANNOUNCEMENT: '采购公示',
      EXPERT_SELECTION: '专家抽取',
      BID_EVALUATION: '评标过程',
      AWARD_DECISION: '定标',
      CONTRACT: '合同',
    };

    const systemPrompt = `
你是项目采购简报生成助手，负责基于已有的文件分析结果生成项目整体简报。

【重要】根据项目状态选择输出模式：

一、如果当前状态为"已归档完成"，输出详细的归档总结简报（300-400字），必须包含：
1. 项目采购目标、背景和立项依据
2. 采购方式及执行过程概述（招标、专家抽取、评标、定标等关键环节）
3. 投标单位竞争情况（如有）
4. 中标结果：中标单位、合同金额（与预算对比）
5. 全流程材料归档情况：各阶段上传的材料清单和完整性评价（含审批文件的审批链路是否完整、各环节审批意见是否齐备）
6. 项目整体评价：采购流程规范性（含审批流程规范性）、材料完备性、执行效率等

二、如果当前状态不是"已归档完成"，输出阶段性简报（150-200字），包含：
1. 项目采购目标和背景
2. 当前推进到哪个阶段
3. 已上传材料的情况概述（若有审批类文件的分析结果，应提及审批流转情况）
4. 项目整体推进状态

【写作格式要求 - 非常重要】
1. 使用流畅的自然语言叙述，不要使用 Markdown 格式（禁止使用 ** 加粗符号）
2. 不要使用"项目名称：xxx"、"申请人：xxx"等键值对格式
3. 采用连贯的段落式表达，信息之间用逗号或句号连接，形成完整的叙述句
4. 保持专业、简洁的公文风格
5. 归档简报应分段落叙述，层次清晰

约束：
1. 直接基于输入的文件分析结果进行综合，不要重新分析文件内容
2. 如果文件分析结果为空或内容不可用，说明"文件内容暂无法获取"
3. 用语专业、简洁，全部使用中文输出
4. 只输出简报文本，不要输出 JSON 或其他格式
5. 归档简报结束语必须体现归档完成状态，如"至此，本项目采购流程已完整归档，各项材料齐备可查"
`.trim();

    const fileAnalysisResults = context.fileAnalysisResults || [];
    const fileAnalysisText = fileAnalysisResults
      .map((f: any) => `【${stageNames[f.stageKey] || f.stageKey || f.stageName || ''}阶段 - ${f.fileName || ''}】\n${f.contentSummary || ''}`)
      .join('\n\n');

    const currentStageLabel = context.isCompleted
      ? '已归档完成'
      : (stageNames[currentStage] || currentStage);

    // Build archive info section if completed
    const archiveInfoSection = context.isCompleted ? `
归档信息：
- 中标单位：${p.awardedSupplier || '暂缺'}
- 合同金额：${p.contractAmount ? `${Number(p.contractAmount).toLocaleString('zh-CN')} 元` : '暂缺'}
- 预算金额：${p.budgetAmount ? `${Number(p.budgetAmount).toLocaleString('zh-CN')} 元` : '暂缺'}
- 专家信息：${p.expertInfo || '暂缺'}
- 投标单位：${p.biddingUnits || '暂缺'}
` : '';

    const userPrompt = `
项目信息：
- 项目名称：${title}
- 申请人：${requesterName}
- 申请部门：${requesterDepartment}
- 采购方式：${method}
- 采购类别：${category}
- 当前状态：${currentStageLabel}
- 申请事由：${projectReason}
- 供应商要求：${supplierRequirements}
${archiveInfoSection}
已上传文件的分析结果：
${fileAnalysisText || '（暂无文件分析结果）'}

请生成项目简报。
`.trim();

    try {
      const result = await this.llm.chat(systemPrompt, userPrompt, 0.3);
      return result.trim() || `${requesterDepartment}发起「${title}」（${method}），预算${budget}。${context.isCompleted ? '项目已完成归档。' : `${completedStages}/${stageCount}阶段完成。`}`;
    } catch {
      return `${requesterDepartment}发起「${title}」（${method}），预算${budget}。${context.isCompleted ? '项目已完成归档。' : `${completedStages}/${stageCount}阶段完成，当前处于${currentStageLabel}阶段。`}`;
    }
  }

  /**
   * 阶段合规审查（步骤检查）—— 基于法规条款逐项审查当前阶段
   * 返回结构化结果：通过项、警告项、违规项
   */
  async auditStageCompliance(payload: {
    stageKey: string;
    stageName: string;
    checkpoints: Array<{ name: string; dimension: string; criteria: string; regulationRef: string }>;
    project: {
      title: string;
      requesterName: string;
      requesterDepartment: string;
      procurementMethod: string;
      procurementCategory: string;
      currentStage: string;
      projectReason: string;
      supplierRequirements: string;
      budgetAmount?: number | null;
      contractAmount?: number | null;
      awardedSupplier?: string;
      expertInfo?: string;
      biddingUnits?: string;
    };
    files: Array<{ fileName: string; stageMatch: string; contentSummary: string }>;
    fileAnalysisResults?: Array<{ fileName: string; stageKey: string; contentSummary: string }>;
  }) {
    const stageLabelMap: Record<string, string> = {
      PROCUREMENT_DEMAND: '采购需求',
      INITIATION: '项目立项',
      TENDER_DOCUMENT: '采购文件',
      PUBLIC_ANNOUNCEMENT: '采购公示',
      EXPERT_SELECTION: '专家抽取',
      BID_EVALUATION: '评标过程',
      AWARD_DECISION: '定标',
      CONTRACT: '合同',
    };
    const stageLabel = stageLabelMap[payload.stageKey] || payload.stageName;

    const checkpointsText = payload.checkpoints
      .map((c, i) => `${i + 1}. 【${c.dimension}】${c.name}：${c.criteria}\n   法规依据：${c.regulationRef}`)
      .join('\n\n');

    const fileSummaries = (payload.files || [])
      .map(f => `- ${f.fileName}：${f.stageMatch}\n  摘要：${f.contentSummary}`)
      .join('\n') || '（无文件分析结果）';

    const systemPrompt = [
      '你是"水叮当"——四川水发集团招采ERP的 AI 采购合规审查专家，负责对采购项目的每个阶段进行合规性审查。',
      '',
      '# 角色设定',
      '你是一位在国有企业采购管理领域有15年经验的合规审计专家，现转型为 AI 审查助手。你的审查风格：',
      '- 严格依据法规条款逐项审查，不得凭主观印象判断。',
      '- 每项审查必须有明确的通过/不通过结论，并引用具体证据。',
      '- 发现违规或风险点必须明确指出违规性质和整改建议。',
      '- 实事求是，如果信息不足以作出判断，应说明"信息不足，无法判断"。',
      '',
      '# 审查方法',
      '你需要对照审查要点（checkpoints），逐一分析项目信息和文件内容，给出每项审查结论。',
      '审查结论分为三种：',
      '- "通过"：项目信息/文件内容符合审查要点中列出的法规要求。',
      '- "警告"：信息不足以完全确认合规性，但未发现明显违规，或存在轻微不完善之处。',
      '- "违规"：明确违反法规要求，或文件内容与审查要点的要求明显不符。',
      '',
      '# 输出格式',
      '严格返回 JSON（不要任何其他文本、代码块标记或解释）：',
      '{',
      '  "results": [',
      '    {',
      '      "checkpoint": "审查项名称（与输入中的 name 字段一致）",',
      '      "dimension": "审查维度",',
      '      "verdict": "通过 / 警告 / 违规",',
      '      "evidence": "证据描述（40-80字），引用项目信息或文件内容中的具体事实",',
      '      "suggestion": "整改建议（20-50字），仅在 verdict 为"警告"或"违规"时提供，否则为空字符串",',
      '      "regulationRef": "法规依据（与输入一致）"',
      '    }',
      '  ],',
      '  "summary": "审查总结（50-100字）：总体结论、关键发现、建议"',
      '}',
    ].join('\n');

    const userPrompt = [
      `=== 审查任务 ===`,
      `审查阶段：${stageLabel}（${payload.stageKey}）`,
      `审查项数量：${payload.checkpoints.length} 项`,
      '',
      `=== 项目基本信息 ===`,
      `项目名称：${payload.project.title}`,
      `申请部门：${payload.project.requesterDepartment}`,
      `申请人：${payload.project.requesterName}`,
      `采购方式：${payload.project.procurementMethod}`,
      `采购类别：${payload.project.procurementCategory}`,
      `当前阶段：${payload.project.currentStage}`,
      `立项事由：${payload.project.projectReason}`,
      `供应商要求：${payload.project.supplierRequirements}`,
      `预算金额：${payload.project.budgetAmount ? `${Number(payload.project.budgetAmount).toLocaleString('zh-CN')} 元` : '未知'}`,
      `合同金额：${payload.project.contractAmount ? `${Number(payload.project.contractAmount).toLocaleString('zh-CN')} 元` : '未知'}`,
      `中标单位：${payload.project.awardedSupplier || '未知'}`,
      `专家信息：${payload.project.expertInfo || '未知'}`,
      `投标单位：${payload.project.biddingUnits || '未知'}`,
      '',
      `=== 文件分析结果 ===`,
      fileSummaries,
      '',
      `=== 审查要点 ===`,
      checkpointsText,
    ].join('\n');

    try {
      const result = await this.llm.chatJson<{
        results: Array<{ checkpoint: string; dimension: string; verdict: string; evidence: string; suggestion: string; regulationRef: string }>;
        summary: string;
      }>(systemPrompt, userPrompt, 0.1);

      return {
        results: (result.results || []).map(r => ({
          checkpoint: r.checkpoint || '',
          dimension: r.dimension || '',
          verdict: (['通过', '警告', '违规'].includes(r.verdict) ? r.verdict : '警告') as '通过' | '警告' | '违规',
          evidence: r.evidence || '',
          suggestion: r.verdict === '通过' ? '' : (r.suggestion || ''),
          regulationRef: r.regulationRef || '',
        })),
        summary: result.summary || '合规审查完成。',
      };
    } catch (err) {
      this.logger.error('auditStageCompliance AI call failed:', err instanceof Error ? err.message : String(err));
      return {
        results: payload.checkpoints.map(c => ({
          checkpoint: c.name,
          dimension: c.dimension,
          verdict: '警告' as const,
          evidence: 'AI 审查服务暂不可用，请稍后重试。',
          suggestion: '请人工核实此审查项。',
          regulationRef: c.regulationRef,
        })),
        summary: 'AI 合规审查服务当前不可用，已记录所有审查要点供人工查阅。',
      };
    }
  }

  // ── 选取历史持久化（#13 落库）：替代多实例不安全的 JSON 文件存储（跨进程 read-modify-write 会丢记录/分裂/阻塞事件循环）。

  async saveSelectionHistoryRecord(rec: { requirement: string; classificationId?: string; classificationName?: string; resultSummary: string; recommendations: any[]; candidatePool: number }) {
    return this.prisma.supplierSelectionHistory.create({
      data: {
        requirement: rec.requirement,
        classificationId: rec.classificationId ?? null,
        classificationName: rec.classificationName ?? null,
        resultSummary: rec.resultSummary,
        recommendationCount: rec.recommendations.length,
        candidatePool: rec.candidatePool,
        shortlistedIds: [],
        recommendations: rec.recommendations, // any[] → Json 字段，免 cast
      },
    });
  }

  async listSelectionHistory() {
    return this.prisma.supplierSelectionHistory.findMany({
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: { id: true, requirement: true, classificationId: true, classificationName: true, resultSummary: true, recommendationCount: true, candidatePool: true, shortlistedIds: true, createdAt: true },
    });
  }

  async getSelectionHistoryDetail(id: string) {
    const rec = await this.prisma.supplierSelectionHistory.findUnique({
      where: { id },
      select: { id: true, requirement: true, classificationId: true, classificationName: true, resultSummary: true, recommendationCount: true, candidatePool: true, shortlistedIds: true, createdAt: true },
    });
    if (!rec) throw new ServiceUnavailableException('选取历史记录不存在');
    return rec;
  }

  async getSelectionHistoryShortlist(id: string) {
    const rec = await this.prisma.supplierSelectionHistory.findUnique({ where: { id }, select: { recommendations: true } });
    if (!rec) throw new ServiceUnavailableException('选取历史记录不存在');
    // 返回候选推荐（含 name/matchScore/reason），供「恢复候选名单」回填比选面板。
    return (rec.recommendations as unknown as SupplierRecommendation[] | null) ?? [];
  }

  async updateSelectionShortlist(historyId: string, shortlistedIds: string[]) {
    const rec = await this.prisma.supplierSelectionHistory.findUnique({ where: { id: historyId }, select: { id: true } });
    if (!rec) throw new ServiceUnavailableException('选取历史记录不存在');
    await this.prisma.supplierSelectionHistory.update({
      where: { id: historyId },
      data: { shortlistedIds: Array.isArray(shortlistedIds) ? shortlistedIds : [] },
    });
    return { success: true };
  }

  async deleteSelectionHistory(id: string) {
    // deleteMany 避免记录不存在时抛错（与文件版「filter 后写回」语义一致：删除不存在的 id 也返回 success）。
    await this.prisma.supplierSelectionHistory.deleteMany({ where: { id } });
    return { success: true };
  }

  /** 分享候选名单给采购主管：以站内通知下发（无独立分享表，复用通知中心）。 */
  async shareShortlist(data: ShareShortlistDto) {
    const names = (data.shortlist || []).map((s) => s.name).filter(Boolean).join('、');
    await Promise.all(['admin', 'leader', 'staff'].map(r => this.notificationService.sendToRole(r, {
      type: 'SELECTION_SHARED',
      title: '收到一份供应商候选名单分享',
      content: `需求：${(data.requirement || '').slice(0, 60)}；推荐：${names || '（空）'}${data.note ? `；备注：${data.note}` : ''}`,
      link: '/supplier/selection',
    }))).catch(() => {});
    return { success: true };
  }

  /** C8 履约违约风险预测：基于评价时序 + 资质状态，规则预测下阶段违约/失约风险（诚实置信度，非 LLM）。 */
  async predictSupplierDefaultRisk(supplierId: string) {
    const supplier = await this.prisma.supplier.findUnique({
      where: { id: supplierId },
      select: {
        id: true,
        name: true,
        evaluations: { orderBy: { createdAt: 'asc' }, select: { score: true, level: true } },
        qualifications: { select: { validTo: true } },
      },
    });
    if (!supplier) throw new ServiceUnavailableException('供应商不存在');
    const now = new Date();
    const expiredQualifications = supplier.qualifications.filter((q) => q.validTo && new Date(q.validTo) < now).length;
    const prediction = predictDefaultRisk({
      evalSeries: supplier.evaluations.map((e) => ({ score: Number(e.score), level: e.level })),
      expiredQualifications,
    });
    return { supplierId, supplierName: supplier.name, ...prediction };
  }
}