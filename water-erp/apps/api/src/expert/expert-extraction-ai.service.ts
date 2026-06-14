import { Injectable, Logger } from '@nestjs/common';

/* =================================================================
   专家智能抽取 — DeepSeek LLM 分析引擎
   AI 只负责"理解项目 + 评估专家匹配度 + 推荐专家组构成"，
   "谁中选"由调用方的确定性随机层决定（合规公平）。
   无 key / 失败时返回 undefined，调用方降级到规则评分。
   ================================================================= */

const DEEPSEEK_API_URL = process.env.DEEPSEEK_API_URL ?? 'https://api.deepseek.com';
const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL ?? 'deepseek-v4-flash';

/** 送入 LLM 的合规候选专家 */
export interface ExtractionCandidate {
  id: string; // 真实 userId
  displayName: string;
  specialty: string;
  title?: string;
  employer?: string;
  pastProjects: number;
  pastAvgScore: number;
}

export interface LlmSpecialtyQuota {
  specialty: string;
  count: number;
  reason: string;
}

export interface LlmExpertScore {
  id: string; // 映射回真实 userId
  matchScore: number; // 0-100
  fitSpecialty: string;
  reason: string;
}

export interface ExpertExtractionLlmResult {
  analysis: string;
  requiredSpecialties: LlmSpecialtyQuota[];
  scoredExperts: LlmExpertScore[];
}

@Injectable()
export class ExpertExtractionAiService {
  private readonly logger = new Logger(ExpertExtractionAiService.name);

  async analyzeAndScore(
    project: { name: string; procurementMethod: string; procurementType?: string; scope: string; budget?: number | string },
    candidates: ExtractionCandidate[],
    totalNeeded: number,
  ): Promise<ExpertExtractionLlmResult | undefined> {
    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!apiKey || candidates.length === 0) return undefined;

    const indexToId = new Map<string, string>();
    const lines = candidates.map((c, i) => {
      const key = `e${i}`;
      indexToId.set(key, c.id);
      return [
        key,
        c.displayName,
        `专业:${c.specialty}`,
        c.title ? `职称:${c.title}` : '',
        c.employer ? `单位:${c.employer}` : '',
        `历史项目${c.pastProjects}个`,
        c.pastAvgScore > 0 ? `历评${c.pastAvgScore}` : '',
      ].filter(Boolean).join(' | ');
    });

    const system = [
      '你是四川水发集团招采系统的评标专家组智能组建助手。',
      '根据招标项目内容，从合规候选专家中分析评审所需的专业构成，并为每位专家给出与该项目的语义匹配度评分。',
      `本次共需抽取 ${totalNeeded} 名专家。`,
      '一、requiredSpecialties：推荐专家组的专业构成（各专业需几人，合计应接近 ' + totalNeeded + '），每项含 specialty、count、reason。',
      '二、scoredExperts：对候选清单中每位专家给出 matchScore(0-100整数)、fitSpecialty(最契合的专业)、reason(20-50字，结合项目与专家专业/职称/经验)。',
      '严格基于候选清单已有信息，不得编造清单外的专家。',
      '必须只输出一个 JSON 对象，不要输出任何其它文字或代码块标记，格式：',
      '{"analysis":"项目评审难点与专家组构成总体分析(60-120字)","requiredSpecialties":[{"specialty":"水利工程","count":2,"reason":"..."}],"scoredExperts":[{"id":"e0","matchScore":88,"fitSpecialty":"水利工程","reason":"..."}]}',
    ].join('\n');

    try {
      const response = await fetch(`${DEEPSEEK_API_URL.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: DEEPSEEK_MODEL,
          messages: [
            { role: 'system', content: system },
            {
              role: 'user',
              content:
                `招标项目：${project.name}\n` +
                `采购方式：${project.procurementMethod}${project.procurementType ? '（' + project.procurementType + '）' : ''}\n` +
                `项目概况/范围：${project.scope}\n` +
                (project.budget ? `预算：${project.budget}\n` : '') +
                `\n合规候选专家清单（编号 | 姓名 | 专业 | 职称 | 单位 | 历史项目 | 历史评分）：\n${lines.join('\n')}`,
            },
          ],
          temperature: 0.2,
          max_tokens: 4000,
        }),
      });

      if (!response.ok) {
        this.logger.warn(`DeepSeek expert-extraction failed: ${response.status} ${await response.text()}`);
        return undefined;
      }

      const data = await response.json();
      const content: string | undefined = data?.choices?.[0]?.message?.content;
      if (typeof content !== 'string') return undefined;

      const parsed = this.parseJson(content);
      if (!parsed) return undefined;

      const scoredExperts: LlmExpertScore[] = Array.isArray(parsed.scoredExperts)
        ? parsed.scoredExperts
            .map((s: any) => ({
              id: indexToId.get(String(s.id)) ?? '',
              matchScore: Math.max(0, Math.min(100, Math.round(Number(s.matchScore) || 0))),
              fitSpecialty: String(s.fitSpecialty || '').slice(0, 50),
              reason: String(s.reason || '').slice(0, 200),
            }))
            .filter((s: LlmExpertScore) => s.id)
        : [];

      const requiredSpecialties: LlmSpecialtyQuota[] = Array.isArray(parsed.requiredSpecialties)
        ? parsed.requiredSpecialties
            .map((q: any) => ({
              specialty: String(q.specialty || '').slice(0, 50),
              count: Math.max(0, Math.round(Number(q.count) || 0)),
              reason: String(q.reason || '').slice(0, 200),
            }))
            .filter((q: LlmSpecialtyQuota) => q.specialty && q.count > 0)
        : [];

      if (scoredExperts.length === 0 && requiredSpecialties.length === 0) return undefined;

      return {
        analysis: String(parsed.analysis || '').slice(0, 500),
        requiredSpecialties,
        scoredExperts,
      };
    } catch (error) {
      this.logger.warn(`DeepSeek expert-extraction error: ${error instanceof Error ? error.message : String(error)}`);
      return undefined;
    }
  }

  private parseJson(content: string): any | undefined {
    try { return JSON.parse(content); } catch { /* not pure json */ }
    const cleaned = content.replace(/```json/gi, '').replace(/```/g, '').trim();
    try { return JSON.parse(cleaned); } catch { /* fall through */ }
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) { try { return JSON.parse(match[0]); } catch { /* ignore */ } }
    return undefined;
  }
}
