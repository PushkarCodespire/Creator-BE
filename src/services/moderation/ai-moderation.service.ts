// ===========================================
// AI MODERATION SERVICE
// Primary:  Gemini 2.0 Flash (prompt-based, free tier)
// Fallback: OpenAI omni-moderation-latest
// ===========================================

import OpenAI from 'openai';
import { logError, logWarning } from '../../utils/logger';
import { isGeminiConfigured, moderateWithGemini } from '../../utils/gemini';
import {
  ModerationResult,
  SeverityLevel,
} from '../../types/moderation.types';
import {
  MODERATION_THRESHOLDS,
  CATEGORY_PRIORITY,
  VIOLATION_MESSAGES,
  AI_MODERATION_LIMITS,
} from './moderation-config';

// OpenAI client is created lazily so startup doesn't crash when key is absent.
let _openai: OpenAI | null = null;
function getOpenAIClient(): OpenAI {
  if (!_openai) {
    _openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      timeout: AI_MODERATION_LIMITS.timeoutMs,
    });
  }
  return _openai;
}

class AIModerationService {
  /**
   * Moderate content using Gemini first, OpenAI as fallback.
   */
  async moderateContent(
    content: string,
    contentType: string = 'MESSAGE'
  ): Promise<ModerationResult> {
    try {
      if (!content || content.trim().length === 0) {
        return this.createSafeResult();
      }

      // ── Gemini path ─────────────────────────────────────────────────────
      if (isGeminiConfigured()) {
        try {
          const geminiResult = await moderateWithGemini(content);

          // Map GeminiModerationResult → ModerationResult
          const severity = this.determineSeverity(geminiResult.highestScore);
          const violatedCategories = Object.entries(geminiResult.categories)
            .filter(([, flagged]) => flagged)
            .map(([cat]) => cat);

          return {
            isFlagged:          geminiResult.flagged,
            severity,
            violatedCategories,
            scores:             geminiResult.scores,
            shouldBlock:        geminiResult.shouldBlock,
            shouldFlag:         geminiResult.shouldFlag,
            reason:             this.generateReason(violatedCategories, geminiResult.highestCategory),
            recommendation:     this.generateRecommendation(geminiResult.shouldBlock, geminiResult.shouldFlag, severity),
            highestScore:       geminiResult.highestScore,
            highestCategory:    geminiResult.highestCategory,
          };
        } catch (geminiErr) {
          const msg = geminiErr instanceof Error ? geminiErr.message : String(geminiErr);
          logWarning(`[Moderation] Gemini failed, falling back to OpenAI: ${msg}`);
          // fall through to OpenAI
        }
      }

      // ── OpenAI fallback ──────────────────────────────────────────────────
      if (!process.env.OPENAI_API_KEY) {
        // Neither provider available — fail open (configurable)
        logWarning('[Moderation] No provider configured, failing open');
        return this.createSafeResult();
      }

      const truncated = content.substring(0, 30000);
      const response = await getOpenAIClient().moderations.create({
        input: truncated,
        model: 'omni-moderation-latest',
      });

      return this.analyzeOpenAIModeration(response.results[0], contentType);
    } catch (error) {
      logError(
        error instanceof Error ? error : new Error(String(error)),
        { context: 'AI Moderation Error' }
      );

      return {
        isFlagged:           true,
        severity:            SeverityLevel.MEDIUM,
        violatedCategories:  ['MODERATION_ERROR'],
        scores:              {},
        shouldBlock:         false,
        shouldFlag:          true,
        reason:              'AI moderation service error — flagged for manual review',
        recommendation:      'MANUAL_REVIEW_REQUIRED',
        highestScore:        0.5,
        highestCategory:     'ERROR',
      };
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private analyzeOpenAIModeration(result: any, _contentType: string): ModerationResult {
    const categories = result.categories;
    const scores     = result.category_scores;

    const { highestCategory, highestScore } = this.findHighestScore(scores);
    const shouldBlock         = this.shouldBlockContent(categories, scores);
    const shouldFlag          = this.shouldFlagContent(categories, scores);
    const violatedCategories  = this.getViolatedCategories(categories, scores);
    const severity            = this.determineSeverity(highestScore);
    const reason              = this.generateReason(violatedCategories, highestCategory);
    const recommendation      = this.generateRecommendation(shouldBlock, shouldFlag, severity);

    return {
      isFlagged: result.flagged || shouldBlock || shouldFlag,
      severity,
      violatedCategories,
      scores,
      shouldBlock,
      shouldFlag,
      reason,
      recommendation,
      highestScore,
      highestCategory,
    };
  }

  private findHighestScore(scores: Record<string, number>): {
    highestCategory: string;
    highestScore: number;
  } {
    let highestCategory = '';
    let highestScore    = 0;
    for (const [category, score] of Object.entries(scores)) {
      if (score > highestScore) {
        highestScore    = score;
        highestCategory = category;
      }
    }
    return { highestCategory, highestScore };
  }

  private shouldBlockContent(
    _categories: Record<string, boolean>,
    scores: Record<string, number>
  ): boolean {
    for (const [category, threshold] of Object.entries(MODERATION_THRESHOLDS.BLOCK)) {
      if ((scores[category] || 0) >= threshold) return true;
    }
    return false;
  }

  private shouldFlagContent(
    _categories: Record<string, boolean>,
    scores: Record<string, number>
  ): boolean {
    for (const [category, threshold] of Object.entries(MODERATION_THRESHOLDS.FLAG)) {
      if ((scores[category] || 0) >= threshold) return true;
    }
    return false;
  }

  private getViolatedCategories(
    _categories: Record<string, boolean>,
    scores: Record<string, number>
  ): string[] {
    const violated: string[] = [];
    for (const [category, threshold] of Object.entries(MODERATION_THRESHOLDS.FLAG)) {
      if ((scores[category] || 0) >= threshold) violated.push(category);
    }
    return violated;
  }

  private determineSeverity(highestScore: number): SeverityLevel {
    if (highestScore >= 0.95) return SeverityLevel.CRITICAL;
    if (highestScore >= 0.85) return SeverityLevel.HIGH;
    if (highestScore >= 0.7)  return SeverityLevel.MEDIUM;
    if (highestScore >= 0.5)  return SeverityLevel.LOW;
    return SeverityLevel.SAFE;
  }

  private generateReason(violatedCategories: string[], primaryCategory: string): string {
    if (violatedCategories.length === 0) return 'Content appears safe';
    const primaryMessage =
      VIOLATION_MESSAGES[primaryCategory as keyof typeof VIOLATION_MESSAGES]
      || 'Content flagged by AI moderation';
    if (violatedCategories.length === 1) return primaryMessage;
    return `${primaryMessage} (${violatedCategories.length} violations detected)`;
  }

  private generateRecommendation(
    shouldBlock: boolean,
    shouldFlag:  boolean,
    severity:    SeverityLevel
  ): string {
    if (shouldBlock) return 'BLOCK_IMMEDIATELY - Content blocked automatically';
    if (shouldFlag && severity === SeverityLevel.HIGH) return 'REVIEW_URGENTLY - High severity, manual review needed';
    if (shouldFlag) return 'REVIEW_WHEN_POSSIBLE - Flagged for review';
    return 'NO_ACTION_NEEDED - Content appears safe';
  }

  private createSafeResult(): ModerationResult {
    return {
      isFlagged:          false,
      severity:           SeverityLevel.SAFE,
      violatedCategories: [],
      scores:             {},
      shouldBlock:        false,
      shouldFlag:         false,
      reason:             'Content appears safe',
      recommendation:     'NO_ACTION_NEEDED',
      highestScore:       0,
      highestCategory:    'none',
    };
  }

  getPriorityForCategory(category: string): string {
    return CATEGORY_PRIORITY[category as keyof typeof CATEGORY_PRIORITY] || 'MEDIUM';
  }

  async moderateBatch(contents: string[]): Promise<ModerationResult[]> {
    return Promise.all(contents.map(c => this.moderateContent(c)));
  }
}

export default new AIModerationService();
