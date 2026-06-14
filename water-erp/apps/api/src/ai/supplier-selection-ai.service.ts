import { Injectable, Logger } from '@nestjs/common';

/* =================================================================
   供应商智能选取 — DeepSeek LLM 排序引擎
   与 AnnouncementAiService 同构：fetch chat/completions，无 key 或失败时
   返回 undefined，由调用方降级到规则评分引擎。
   ================================================================= */

const DEEPSEEK_API_URL = process.env.DEEPSEEK_API_URL ?? 'https://api.deepseek.com';
const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL ?? 'deepseek-v4-flash';

/** 送入 LLM 的候选供应商（已由规则检索阶段筛选） */
export interface SelectionCandidate {
  id: string; // 真实 supplier.id（用于回填结果）
  name: string;
  classification?: string;
  businessScope: string;
  qualificationText?: string;
  enterpriseType?: string;
  legalPerson?: string;
}

export interface LlmRecommendation {
  id: string; // 映射回真实 supplier.id
  score: number; // 0-100
  reason: string;
}

export interface SupplierSelectionLlmResult {
  summary: string;
  recommendations: LlmRecommendation[];
}

@Injectable()
export class SupplierSelectionAiService {
  private readonly logger = new Logger(SupplierSelectionAiService.name);

  async rankCandidates(
    requirement: string,
    candidates: SelectionCandidate[],
    maxCount: number,
  ): Promise<SupplierSelectionLlmResult | undefined> {
    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!apiKey || candidates.length === 0) return undefined;

    // 紧凑候选清单：用短编号 c0/c1... 节省 token，回填时映射回真实 id
    const indexToId = new Map<string, string>();
    const lines = candidates.map((c, i) => {
      const key = `c${i}`;
      indexToId.set(key, c.id);
      return [
        key,
        c.name,
        c.classification ? `[${c.classification}]` : '',
        c.enterpriseType || '',
        (c.businessScope || '').slice(0, 90),
        c.qualificationText ? `资质:${c.qualificationText.slice(0, 60)}` : '',
      ]
        .filter(Boolean)
        .join(' | ');
    });

    const system = [
      '你是四川水发集团招采系统的供应商智能推荐引擎。',
      '根据采购需求，从候选供应商清单中挑选最匹配的供应商，按匹配度从高到低排序，最多推荐 ' + maxCount + ' 家。',
      '对每家给出：匹配度评分(0-100的整数)和一条20-50字的中文推荐理由，须结合其经营范围/资质/分类与需求的相关性。',
      '严格基于候选清单中的已有信息判断，不得编造清单外不存在的供应商或能力。',
      '必须只输出一个 JSON 对象，不要输出任何其它文字或代码块标记，格式：',
      '{"summary":"对整体匹配情况的一句话分析(40-80字)","recommendations":[{"id":"c0","score":92,"reason":"..."}]}',
    ].join('\n');

    try {
      const response = await fetch(`${DEEPSEEK_API_URL.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: DEEPSEEK_MODEL,
          messages: [
            { role: 'system', content: system },
            {
              role: 'user',
              content:
                `采购需求：${requirement}\n\n` +
                `候选供应商清单（编号 | 名称 | 分类 | 类型 | 经营范围 | 资质）：\n${lines.join('\n')}`,
            },
          ],
          temperature: 0.2,
          max_tokens: 4000, // deepseek-v4-flash 是推理模型，先输出 reasoning_content 再输出 content，需预留充足额度
        }),
      });

      if (!response.ok) {
        this.logger.warn(`DeepSeek supplier-selection failed: ${response.status} ${await response.text()}`);
        return undefined;
      }

      const data = await response.json();
      const content: string | undefined = data?.choices?.[0]?.message?.content;
      if (typeof content !== 'string') return undefined;

      const parsed = this.parseJson(content);
      if (!parsed || !Array.isArray(parsed.recommendations)) return undefined;

      const recommendations: LlmRecommendation[] = parsed.recommendations
        .map((r: any) => ({
          id: indexToId.get(String(r.id)) ?? '',
          score: Math.max(0, Math.min(100, Math.round(Number(r.score) || 0))),
          reason: String(r.reason || '').slice(0, 200),
        }))
        .filter((r: LlmRecommendation) => r.id)
        .slice(0, maxCount);

      if (recommendations.length === 0) return undefined;

      return {
        summary: String(parsed.summary || '').slice(0, 300),
        recommendations,
      };
    } catch (error) {
      this.logger.warn(
        `DeepSeek supplier-selection error: ${error instanceof Error ? error.message : String(error)}`,
      );
      return undefined;
    }
  }

  /** 防御性解析：先尝试整体 JSON，再从文本中抽取首个 JSON 对象 */
  private parseJson(content: string): any | undefined {
    try {
      return JSON.parse(content);
    } catch {
      // not pure JSON — fall through
    }
    const cleaned = content.replace(/```json/gi, '').replace(/```/g, '').trim();
    try {
      return JSON.parse(cleaned);
    } catch {
      // fall through
    }
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch {
        // ignore
      }
    }
    return undefined;
  }
}
