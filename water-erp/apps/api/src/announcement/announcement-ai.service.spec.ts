import { AnnouncementAiService } from './announcement-ai.service';

/**
 * 提示词泄漏防御回归（2026-09-10 实录：LLM 把任务指令当摘要输出，三条公告入库提示词）。
 * 三段 fixture 即当天三条公告的真实 aiSummary 全文——命中 looksLikePromptLeak 即判无效。
 */
const LEAKED_PROMPTS = [
  '我们需要生成一个归纳型摘要，160-240汉字，完整句子结束。不得重复标题，不得照抄原文第一段，不得输出AI摘要前缀。根据采购公告突出采购内容、预算金额、实施地点、交付周期、报名和投标关键要求。只使用原文已有信息。 需要提取信息： - 采购人：四川水发勘测设计研究有限公司 - 项目：引大济岷工程千隧ZK10（700m）和千隧ZK12（600m）两个斜钻孔施工技术服务 - 目的：查明引大济岷隧洞工程地质条件，在千池山隧洞洞身中段布置。 - 最高限价：1539900元含税。 - 周期：合同签订之日起150日历天内完成钻探施工、现场测试及成果资料提交，通过验收。 - 里程碑：10日施工组织设计等；30日设备人员进场具备开钻。',
  '需要生成归纳型摘要，160-240汉字，不得重复标题，不得照抄第一段，不得AI前缀，完整句子结束。突出采购内容、预算、地点、周期、报名投标关键要求。 注意公告类型是采购公告（邀请招标）。要正式简洁。只使用原文信息。 关键信息： 采购人：四川水发勘测设计研究有限公司 项目：水电站机组状态监测系统升级改造 内容：水轮发电机组状态监测系统升级改造，扩展振动、摆度、气隙测点，接入集控平台，含软件授权、安装调试与培训。 最高限价298万元含税。 合同签订后120日内完成系统投运并通过72小时试运行；软件授权随系统一次性交付。 资格：具备电力系统自动化或状态监测领域实施业绩，提供三年质保及驻场培训。',
  '我们需要生成归纳型摘要，160-240汉字，不得重复标题，不得照抄原文第一段，不得“AI摘要”前缀。必须完整句子结束。类型采购公告，突出采购内容、预算金额、实施地点、交付周期、报名和投标关键要求。只使用原文信息。 需要仔细。原文：采购人四川水发勘测设计研究有限公司，内部竞标（竞价），从供应商库邀请三家及以上具备承担能力供应商。项目：办公区域中央空调系统维护保养服务采购。采购内容：2026-2027年度办公楼中央空调系统维护保养服务，含月度巡检、季度保养、滤网清洗及4小时应急响应维修。最高限价38万元含税。服务期12个月，自合同签订起算；每月5日前提交上月维保记录，季度保养按季度首月实施。',
];

const GOOD_SUMMARY =
  '四川水发勘测设计研究有限公司就引大济岷工程千池山隧洞中段两个斜钻孔施工技术服务开展内部竞标，最高限价153.99万元含税，合同签订后150日历天内完成钻探施工、现场测试及成果资料提交并通过验收。供应商须具备工程钻探劳务资质或红名单资格，近5年至少两项500米及以上类似钻探业绩，不接受联合体及分包，通过蜀水云采供应商门户在线报名。';

describe('AnnouncementAiService — 提示词泄漏防御', () => {
  const makeService = (chatImpl?: () => Promise<string>) => {
    const llm = {
      getModel: () => 'deepseek-v4-flash',
      chat: jest.fn(chatImpl ?? (async () => GOOD_SUMMARY)),
    };
    const config = { get: (_key: string, def?: string) => def };
    return new AnnouncementAiService(llm as any, config as any);
  };
  const input = { title: '竞价采购公告 — 某项目', type: '采购公告', content: '<p>正文若干，预算100万元，实施地点成都市。</p>' };

  it.each(LEAKED_PROMPTS.map((p, i) => [`实录${i + 1}`, p] as const))(
    'LLM 复述任务指令（%s）→ summarize 返回 undefined，不入库',
    async (_tag, leaked) => {
      const svc = makeService(async () => leaked);
      await expect(svc.summarize(input)).resolves.toBeUndefined();
    },
  );

  it('正常摘要 → 清洗后原样返回', async () => {
    const svc = makeService(async () => `AI摘要：${GOOD_SUMMARY}`);
    await expect(svc.summarize(input)).resolves.toBe(GOOD_SUMMARY);
  });

  it('LLM 抛错 / 未配置 → undefined（调用方走原文预览兜底）', async () => {
    const boom = makeService(async () => {
      throw new Error('upstream 429');
    });
    await expect(boom.summarize(input)).resolves.toBeUndefined();

    const llm = { getModel: () => undefined, chat: jest.fn() };
    const config = { get: (_key: string, def?: string) => def };
    const bare = new AnnouncementAiService(llm as any, config as any);
    await expect(bare.summarize(input)).resolves.toBeUndefined();
  });

  it('looksLikePromptLeak：三条实录全命中，正常摘要不命中（供 service 校验客户端直供值）', () => {
    const svc = makeService();
    for (const p of LEAKED_PROMPTS) expect(svc.looksLikePromptLeak(p)).toBe(true);
    expect(svc.looksLikePromptLeak(GOOD_SUMMARY)).toBe(false);
  });
});
