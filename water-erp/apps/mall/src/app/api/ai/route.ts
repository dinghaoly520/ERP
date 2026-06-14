import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

type AiRequest = {
  message?: string;
  context?: unknown;
};

const DEEPSEEK_URL = process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com';
const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash';

export async function POST(request: NextRequest) {
  const apiKey = process.env.DEEPSEEK_API_KEY;

  if (!apiKey) {
    return NextResponse.json(
      { error: 'AI 助手暂未启用，请联系管理员。' },
      { status: 500 },
    );
  }

  let body: AiRequest;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: '请求体格式错误。' }, { status: 400 });
  }

  const message = body.message?.trim();
  if (!message) {
    return NextResponse.json({ error: '请输入需要 AI 分析的问题。' }, { status: 400 });
  }

  const systemPrompt = [
    '你是四川水发集团电子商城中的"水叮当"，负责集中采购目录的价格参谋能力。',
    '',
    '你的职责：',
    '- 帮助采购人员研判目录价格是否适合用于预算参考。',
    '- 帮助识别需要复核、询价或比价的条目。',
    '- 帮助基于目录数据生成预算清单建议。',
    '- 帮助比较供应商价格区间、价格来源、有效期和价格变化。',
    '- 帮助形成可用于内部沟通或审计说明的简洁口径。',
    '',
    '回答要求：',
    '- 必须使用中文。',
    '- 风格专业、简洁、可执行。',
    '- 结论先行，再说明依据和建议动作。',
    '- 优先基于传入的当前筛选条件、可见目录条目、预算清单和商品详情回答。',
    '- 数据不足时说明缺少什么，不要编造市场行情、供应商报价或审批结果。',
    '- 不替代审批，不决定最终采购价，不指定成交供应商。',
    '- 与电子商城无关的问题应简短说明超出当前模块范围，并引导用户回到目录价格、预算、询价或供应商比价场景。',
    '',
    '建议输出结构：',
    '结论：',
    '依据：',
    '建议动作：',
    '注意事项：',
  ].join('\n');

  try {
    const response = await fetch(`${DEEPSEEK_URL.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: DEEPSEEK_MODEL,
        temperature: 0.2,
        max_tokens: 1200,
        messages: [
          { role: 'system', content: systemPrompt },
          {
            role: 'user',
            content: JSON.stringify({
              question: message,
              platformContext: body.context,
            }),
          },
        ],
      }),
    });

    if (!response.ok) {
      await response.text();
      return NextResponse.json(
        { error: `AI 服务暂时不可用（HTTP ${response.status}），请稍后重试。` },
        { status: 502 },
      );
    }

    const data = await response.json();
    const answer = data?.choices?.[0]?.message?.content;

    if (!answer) {
      return NextResponse.json({ error: 'AI 未返回有效内容，请重试。' }, { status: 502 });
    }

    return NextResponse.json({ answer });
  } catch (error) {
    return NextResponse.json(
      { error: 'AI 调用异常，请稍后重试。' },
      { status: 500 },
    );
  }
}
