import OpenAI from 'openai';
import { logError } from '../../utils/logger';
import {
  ModerationResult,
  SeverityLevel
} from '../../types/moderation.types';
import { 
  MODERATION_THRESHOLDS, 
  CATEGORY_PRIORITY,
  VIOLATION_MESSAGES,
  AI_MODERATION_LIMITS
} from './moderation-config';

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  timeout: AI_MODERATION_LIMITS.timeoutMs,
});

class AIModerationService {
  /**
   * Main function: Moderate content using OpenAI
   */
  async moderateContent(
    content: string,
    contentType: string = 'MESSAGE'
  ): Promise<ModerationResult> {
    try {
      // Validate input
      if (!content || content.trim().length === 0) {
        return this.createSafeResult();
      }

      // Truncate very long content (OpenAI limit is 32k chars)
      const truncatedContent = content.substring(0, 30000);

      // Call OpenAI Moderation API
      const response = await openai.moderations.create({
        input: truncatedContent,
        model: 'omni-moderation-latest',
      });

      // Extract results
      const result = response.results[0];

      // Analyze results
      return this.analyzeModeration(result, contentType);
    } catch (error) {
      logError(error instanceof Error ? error : new Error(String(error)), { context: 'AI Moderation Error' });
      
      // On error, flag for manual review (fail-safe)
      return {
        isFlagged: true,
        severity: SeverityLevel.MEDIUM,
        violatedCategories: ['MODERATION_ERROR'],
        scores: {},
        shouldBlock: false,
        shouldFlag: true,
        reason: 'AI moderation service error - flagged for manual review',
        recommendation: 'MANUAL_REVIEW_REQUIRED',
        highestScore: 0.5,
        highestCategory: 'ERROR',
      };
    }
  }

  /**
   * Analyze OpenAI moderation results
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private analyzeModeration(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    result: any,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    contentType: string
  ): ModerationResult {
    const categories = result.categories;
    const scores = result.category_scores;

    // Find highest scoring category
    const { highestCategory, highestScore } = this.findHighestScore(scores);

    // Determine if content should be blocked
    const shouldBlock = this.shouldBlockContent(categories, scores);

    // Determine if content should be flagged
    const shouldFlag = this.shouldFlagContent(categories, scores);

    // Get violated categories
    const violatedCategories = this.getViolatedCategories(categories, scores);

    // Determine severity
    const severity = this.determineSeverity(highestScore);

    // Generate reason message
    const reason = this.generateReason(violatedCategories, highestCategory);

    // Generate recommendation
    const recommendation = this.generateRecommendation(
      shouldBlock,
      shouldFlag,
      severity
    );

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

  /**
   * Find category with highest score
   */
  private findHighestScore(scores: Record<string, number>): {
    highestCategory: string;
    highestScore: number;
  } {
    let highestCategory = '';
    let highestScore = 0;

    for (const [category, score] of Object.entries(scores)) {
      if (score > highestScore) {
        highestScore = score;
        highestCategory = category;
      }
    }

    return { highestCategory, highestScore };
  }

  /**
   * Determine if content should be blocked
   */
  private shouldBlockContent(
    categories: Record<string, boolean>,
    scores: Record<string, number>
  ): boolean {
    for (const [category, threshold] of Object.entries(MODERATION_THRESHOLDS.BLOCK)) {
      const score = scores[category] || 0;
      if (score >= threshold) {
        return true;
      }
    }
    return false;
  }

  /**
   * Determine if content should be flagged
   */
  private shouldFlagContent(
    categories: Record<string, boolean>,
    scores: Record<string, number>
  ): boolean {
    for (const [category, threshold] of Object.entries(MODERATION_THRESHOLDS.FLAG)) {
      const score = scores[category] || 0;
      if (score >= threshold) {
        return true;
      }
    }
    return false;
  }

  /**
   * Get list of violated categories
   */
  private getViolatedCategories(
    categories: Record<string, boolean>,
    scores: Record<string, number>
  ): string[] {
    const violated: string[] = [];

    for (const [category, threshold] of Object.entries(MODERATION_THRESHOLDS.FLAG)) {
      const score = scores[category] || 0;
      if (score >= threshold) {
        violated.push(category);
      }
    }

    return violated;
  }

  /**
   * Determine severity level
   */
  private determineSeverity(highestScore: number): SeverityLevel {
    if (highestScore >= 0.95) return SeverityLevel.CRITICAL;
    if (highestScore >= 0.85) return SeverityLevel.HIGH;
    if (highestScore >= 0.7) return SeverityLevel.MEDIUM;
    if (highestScore >= 0.5) return SeverityLevel.LOW;
    return SeverityLevel.SAFE;
  }

  /**
   * Generate user-friendly reason message
   */
  private generateReason(
    violatedCategories: string[],
    primaryCategory: string
  ): string {
    if (violatedCategories.length === 0) {
      return 'Content appears safe';
    }

    const primaryMessage = VIOLATION_MESSAGES[primaryCategory as keyof typeof VIOLATION_MESSAGES] 
      || 'Content flagged by AI moderation';

    if (violatedCategories.length === 1) {
      return primaryMessage;
    }

    return `${primaryMessage} (${violatedCategories.length} violations detected)`;
  }

  /**
   * Generate recommendation for admin
   */
  private generateRecommendation(
    shouldBlock: boolean,
    shouldFlag: boolean,
    severity: SeverityLevel
  ): string {
    if (shouldBlock) {
      return 'BLOCK_IMMEDIATELY - Content blocked automatically';
    }
    if (shouldFlag && severity === SeverityLevel.HIGH) {
      return 'REVIEW_URGENTLY - High severity, manual review needed';
    }
    if (shouldFlag) {
      return 'REVIEW_WHEN_POSSIBLE - Flagged for review';
    }
    return 'NO_ACTION_NEEDED - Content appears safe';
  }

  /**
   * Create safe result (when content is empty or error occurs in fail-open mode)
   */
  private createSafeResult(): ModerationResult {
    return {
      isFlagged: false,
      severity: SeverityLevel.SAFE,
      violatedCategories: [],
      scores: {},
      shouldBlock: false,
      shouldFlag: false,
      reason: 'Content appears safe',
      recommendation: 'NO_ACTION_NEEDED',
      highestScore: 0,
      highestCategory: 'none',
    };
  }

  /**
   * Get priority level for a category
   */
  getPriorityForCategory(category: string): string {
    return CATEGORY_PRIORITY[category as keyof typeof CATEGORY_PRIORITY] || 'MEDIUM';
  }

  /**
   * Batch moderate multiple contents
   */
  async moderateBatch(contents: string[]): Promise<ModerationResult[]> {
    const promises = contents.map(content => this.moderateContent(content));
    return Promise.all(promises);
  }
}

export default new AIModerationService();
