import { Injectable, Logger } from '@nestjs/common';
import { LlmService } from '../../local-ai/llm.service';
import { COMPETITIVE_ANALYSIS_PROMPT } from '../prompts/competitive-analysis.prompt';
import { deterministicSeed } from '../utils';

const DIMENSION_WHITELIST = [
  'qualification',
  'technical',
  'commercial',
  'price',
  'risk',
] as const;

interface StrengthOrWeakness {
  dimension: string;
  title: string;
  detail: string;
  evidence?: string;
  impact?: string;
}

export interface CompetitiveAnalysisResult {
  strengths: StrengthOrWeakness[];
  weaknesses: StrengthOrWeakness[];
  overallComment: string;
  keyObservations: string[];
}

@Injectable()
export class CompetitiveAnalysisService {
  private readonly logger = new Logger(CompetitiveAnalysisService.name);

  constructor(private llmService: LlmService) {}

  async analyze(
    bidderName: string,
    totalScore: number,
    scores: any,
    keyInfo: any,
    taskId?: string,
    bidderId?: string,
  ): Promise<CompetitiveAnalysisResult> {
    this.logger.log(`Analyzing competitive profile for ${bidderName}`);

    const prompt = COMPETITIVE_ANALYSIS_PROMPT
      .replace('{{BIDDER_NAME}}', bidderName)
      .replace('{{TOTAL_SCORE}}', String(totalScore.toFixed(1)))
      .replace('{{TECHNICAL_SCORE}}', this.safeStringify(scores?.technical))
      .replace('{{COMMERCIAL_SCORE}}', this.safeStringify(scores?.commercial))
      .replace('{{PRICE_SCORE}}', this.safeStringify(scores?.price))
      .replace('{{KEY_INFO}}', this.safeStringify(keyInfo));

    const result = await this.llmService.chatJson<CompetitiveAnalysisResult>(
      '你是一名资深招投标评审专家，擅长基于材料和评分结果进行中性、可核验的正向依据与需关注事项分析。',
      prompt,
      0,
      undefined,
      taskId && bidderId ? deterministicSeed(taskId + ':' + bidderId + ':competitive') : undefined,
    );

    return this.sanitizeResult(result);
  }

  private sanitizeResult(raw: any): CompetitiveAnalysisResult {
    const strengths: StrengthOrWeakness[] = [];
    const weaknesses: StrengthOrWeakness[] = [];

    if (Array.isArray(raw?.strengths)) {
      for (const s of raw.strengths) {
        if (!s.title || !s.detail) continue;
        strengths.push({
          dimension: DIMENSION_WHITELIST.includes(s.dimension) ? s.dimension : 'technical',
          title: String(s.title).slice(0, 100),
          detail: String(s.detail).slice(0, 500),
          evidence: s.evidence ? String(s.evidence).slice(0, 300) : undefined,
          impact: s.impact ? String(s.impact).slice(0, 200) : undefined,
        });
      }
    }

    if (Array.isArray(raw?.weaknesses)) {
      for (const w of raw.weaknesses) {
        if (!w.title || !w.detail) continue;
        weaknesses.push({
          dimension: DIMENSION_WHITELIST.includes(w.dimension) ? w.dimension : 'technical',
          title: String(w.title).slice(0, 100),
          detail: String(w.detail).slice(0, 500),
          evidence: w.evidence ? String(w.evidence).slice(0, 300) : undefined,
          impact: w.impact ? String(w.impact).slice(0, 200) : undefined,
        });
      }
    }

    return {
      strengths,
      weaknesses,
      overallComment: raw?.overallComment
        ? String(raw.overallComment).slice(0, 1000)
        : '',
      keyObservations: Array.isArray(raw?.keyObservations)
        ? raw.keyObservations.map((o: any) => String(o).slice(0, 200))
        : [],
    };
  }

  private safeStringify(obj: any): string {
    if (!obj) return '无数据';
    try {
      return JSON.stringify(obj, null, 2);
    } catch {
      return String(obj);
    }
  }
}
