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
      { error: 'DeepSeek API Key 未配置，请在 apps/mall/.env.local 中设置 DEEPSEEK_API_KEY。' },
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
    '你是四川水发集团集中采购价格目录平台的 AI 价格助手。',
    '你的职责是辅助采购人员做价格参考、预算编制、询价建议、风险识别和审计说明。',
    '回答必须使用中文，风格专业、简洁、可执行。',
    '不要声称你能决定最终采购价格、替代审批或指定中标供应商。',
    '如涉及价格风险，请说明依据、风险等级和建议动作。',
    '如用户要求生成预算清单，请基于给定目录数据推荐条目、数量建议和注意事项。',
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
      const text = await response.text();
      return NextResponse.json(
        { error: `DeepSeek 调用失败：${response.status} ${text.slice(0, 300)}` },
        { status: 502 },
      );
    }

    const data = await response.json();
    const answer = data?.choices?.[0]?.message?.content;

    if (!answer) {
      return NextResponse.json({ error: 'DeepSeek 未返回有效分析内容。' }, { status: 502 });
    }

    return NextResponse.json({ answer });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'DeepSeek 调用异常。' },
      { status: 500 },
    );
  }
}
