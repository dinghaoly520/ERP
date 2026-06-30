import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { RuleResult } from './rule-executor.service';
import { GeneralReviewResult } from './general-reviewer.service';
import type { LlmFreeReviewIssue, LlmFreeReviewResult } from './llm-free-reviewer.service';

export interface LlmFreeIssue {
  severity: 'critical' | 'warning' | 'info';
  description: string;
  relatedClause: string;
  evidence: string;
  suggestion: any;
  documentExcerpt?: string;
  documentLocation?: {
    clauseNumber: string;
    sectionName: string;
    excerpt: string;
  };
  status?: 'pending' | 'accepted' | 'rejected';
  editedSuggestion?: string;
  resolvedAt?: string;
  source: 'llm-free';
  sectionName?: string;
}

export interface ReviewReport {
  summary: {
    totalChecks: number;
    passed: number;
    failed: number;
    warnings: number;
  };
  criticalIssues: RuleResult[];
  warnings: RuleResult[];
  passedChecks: RuleResult[];
  generalResults?: GeneralReviewResult[];
  llmFreeIssues?: LlmFreeIssue[];
}

const MIN_MATCH_LENGTH = 8;

@Injectable()
export class ReportGeneratorService {
  constructor(private prisma: PrismaService) {}

  generateFromRuleResults(results: RuleResult[]): ReviewReport {
    const critical = results.filter(
      (r) => !r.passed && r.severity === 'critical',
    );
    const warnings = results.filter(
      (r) => !r.passed && r.severity === 'warning',
    );
    const passed = results.filter((r) => r.passed);
    const failed = results.filter(
      (r) => !r.passed && r.severity === 'critical',
    );

    return {
      summary: {
        totalChecks: results.length,
        passed: passed.length,
        failed: failed.length,
        warnings: warnings.length,
      },
      criticalIssues: critical,
      warnings,
      passedChecks: passed,
    };
  }

  generateFromGeneralResults(
    results: GeneralReviewResult[],
    totalSections: number,
  ): ReviewReport {
    const allIssues = results.flatMap((r) => r.issues);
    const passedSections = results.filter((r) => r.issues.length === 0).length;
    const criticalCount = allIssues.filter(
      (i) => i.severity === 'critical',
    ).length;
    const warningCount = allIssues.filter(
      (i) => i.severity === 'warning',
    ).length;

    return {
      summary: {
        totalChecks: totalSections,
        passed: passedSections,
        failed: criticalCount,
        warnings: warningCount,
      },
      criticalIssues: [],
      warnings: [],
      passedChecks: [],
      generalResults: results,
    };
  }

  async saveReport(taskId: string, report: ReviewReport): Promise<void> {
    if (report.generalResults) {
      for (const section of report.generalResults) {
        for (const issue of section.issues) {
          if (!issue.status) issue.status = 'pending';
        }
      }
    } else {
      for (const issue of [
        ...report.criticalIssues,
        ...report.warnings,
        ...report.passedChecks,
      ]) {
        if (!issue.status) issue.status = 'pending';
      }
    }

    // Initialize status for LLM-free issues
    if (report.llmFreeIssues) {
      for (const issue of report.llmFreeIssues) {
        if (!issue.status) issue.status = 'pending';
      }
    }

    await this.prisma.reviewTask.update({
      where: { id: taskId },
      data: {
        status: 'completed',
        totalChecks: report.summary.totalChecks,
        passedCount: report.summary.passed,
        failedCount: report.summary.failed,
        warningCount: report.summary.warnings,
        results: report as any,
        completedAt: new Date(),
      },
    });
  }

  /**
   * Merge LLM-free review results into the knowledge-base report,
   * deduplicating issues that overlap with KB-based findings.
   */
  mergeWithLlmFreeResults(
    kbReport: ReviewReport,
    llmFreeResult: LlmFreeReviewResult,
  ): ReviewReport {
    // 1. Collect anchor texts from KB-based issues for deduplication
    const kbAnchors = this.collectKbAnchors(kbReport);

    // 2. Filter out duplicate LLM-free issues
    const allLlmFreeIssues = llmFreeResult.results.flatMap((section) =>
      section.issues.map((issue) => ({
        ...issue,
        sectionName: section.sectionName,
      })),
    );

    const uniqueIssues: LlmFreeIssue[] = allLlmFreeIssues.filter(
      (issue) => !this.isDuplicateWithKb(issue, kbAnchors),
    );

    // 3. Initialize status for unique issues
    for (const issue of uniqueIssues) {
      if (!issue.status) issue.status = 'pending';
    }

    // 4. Compute additional stats from unique LLM-free issues
    const additionalFailed = uniqueIssues.filter(
      (i) => i.severity === 'critical',
    ).length;
    const additionalWarnings = uniqueIssues.filter(
      (i) => i.severity === 'warning',
    ).length;

    // 5. Return merged report
    return {
      ...kbReport,
      summary: {
        totalChecks: kbReport.summary.totalChecks + uniqueIssues.length,
        passed: kbReport.summary.passed,
        failed: kbReport.summary.failed + additionalFailed,
        warnings: kbReport.summary.warnings + additionalWarnings,
      },
      llmFreeIssues: uniqueIssues.length > 0 ? uniqueIssues : undefined,
    };
  }

  /**
   * Collect anchor texts from KB-based report issues.
   * Anchors come from evidence, suggestion.originalText, and documentExcerpt.
   */
  private collectKbAnchors(report: ReviewReport): string[] {
    const anchors: string[] = [];

    // Strict mode: criticalIssues / warnings / passedChecks
    for (const issue of [
      ...(report.criticalIssues || []),
      ...(report.warnings || []),
      ...(report.passedChecks || []),
    ]) {
      if (issue.evidence) anchors.push(this.normalizeText(issue.evidence));
      if (issue.documentExcerpt)
        anchors.push(this.normalizeText(issue.documentExcerpt));
      const suggestion = issue.suggestion as any;
      if (suggestion && typeof suggestion === 'object' && suggestion.originalText) {
        anchors.push(this.normalizeText(suggestion.originalText));
      }
    }

    // General mode: generalResults
    if (report.generalResults) {
      for (const section of report.generalResults) {
        for (const issue of section.issues) {
          if (issue.evidence) anchors.push(this.normalizeText(issue.evidence));
          if (issue.documentExcerpt)
            anchors.push(this.normalizeText(issue.documentExcerpt));
          const suggestion = issue.suggestion as any;
          if (suggestion && typeof suggestion === 'object' && suggestion.originalText) {
            anchors.push(this.normalizeText(suggestion.originalText));
          }
        }
      }
    }

    return anchors;
  }

  /**
   * Check if an LLM-free issue duplicates a KB-based issue.
   * Uses containment check: if the LLM-free issue's anchor text is
   * largely contained in any KB anchor (or vice versa), it's a duplicate.
   */
  private isDuplicateWithKb(
    issue: LlmFreeReviewIssue & { sectionName?: string },
    kbAnchors: string[],
  ): boolean {
    const issueAnchors: string[] = [];

    if (issue.evidence) issueAnchors.push(this.normalizeText(issue.evidence));
    if (issue.documentExcerpt)
      issueAnchors.push(this.normalizeText(issue.documentExcerpt));
    const suggestion = issue.suggestion as any;
    if (suggestion && typeof suggestion === 'object' && suggestion.originalText) {
      issueAnchors.push(this.normalizeText(suggestion.originalText));
    }

    if (issueAnchors.length === 0 || kbAnchors.length === 0) return false;

    for (const anchor of issueAnchors) {
      if (anchor.length < 6) continue; // too short to match reliably

      for (const kbAnchor of kbAnchors) {
        // Check if either contains a significant portion of the other
        if (
          this.hasSignificantOverlap(anchor, kbAnchor)
        ) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Check if two text fragments have significant overlap.
   * Uses a sliding window approach to find longest common substring.
   * Requires a minimum match length to avoid false positives from
   * common clause-number prefixes (e.g. "第十条").
   */
  private hasSignificantOverlap(a: string, b: string): boolean {
    const minLen = Math.min(a.length, b.length);
    if (minLen < MIN_MATCH_LENGTH) return false;

    // Containment check: if one string fully contains the other,
    // they must overlap significantly
    if (a.length >= b.length && a.includes(b)) return true;
    if (b.length > a.length && b.includes(a)) return true;

    // Sliding window: look for a shared substring of at least 50%
    // of the shorter text (minimum 8 chars after normalization)
    const windowSize = Math.max(MIN_MATCH_LENGTH, Math.floor(minLen * 0.5));
    if (windowSize > minLen) return false;

    for (let i = 0; i <= a.length - windowSize; i++) {
      const chunk = a.slice(i, i + windowSize);
      if (b.includes(chunk)) return true;
    }

    return false;
  }

  private normalizeText(text: string): string {
    return text
      .replace(/\s+/g, '')
      .replace(/[，。；：、""''（）【】《》]/g, '')
      .toLowerCase();
  }
}
