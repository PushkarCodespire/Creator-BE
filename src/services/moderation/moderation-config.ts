import { ModerationCategory } from '../../types/moderation.types';

/**
 * Moderation Thresholds
 * 
 * Adjust these based on your platform's tolerance:
 * - Lower threshold = More strict (more content flagged)
 * - Higher threshold = More lenient (less content flagged)
 */
export const MODERATION_THRESHOLDS = {
  /**
   * AUTO-BLOCK Thresholds (Immediate rejection)
   * Content scoring above these will be blocked instantly
   */
  BLOCK: {
    [ModerationCategory.SEXUAL_MINORS]: 0.3,        // Zero tolerance
    [ModerationCategory.HATE_THREATENING]: 0.7,     // Very strict
    [ModerationCategory.HARASSMENT_THREATENING]: 0.7,
    [ModerationCategory.SELF_HARM_INSTRUCTIONS]: 0.7,
    [ModerationCategory.VIOLENCE_GRAPHIC]: 0.8,
    [ModerationCategory.HATE]: 0.85,
    [ModerationCategory.HARASSMENT]: 0.85,
    [ModerationCategory.VIOLENCE]: 0.85,
    [ModerationCategory.SEXUAL]: 0.9,                // More lenient
    [ModerationCategory.SELF_HARM]: 0.85,
    [ModerationCategory.SELF_HARM_INTENT]: 0.75,
  },

  /**
   * AUTO-FLAG Thresholds (Create report for review)
   * Content scoring above these will be flagged for admin review
   */
  FLAG: {
    [ModerationCategory.SEXUAL_MINORS]: 0.1,        // Flag everything
    [ModerationCategory.HATE_THREATENING]: 0.5,
    [ModerationCategory.HARASSMENT_THREATENING]: 0.5,
    [ModerationCategory.SELF_HARM_INSTRUCTIONS]: 0.5,
    [ModerationCategory.VIOLENCE_GRAPHIC]: 0.6,
    [ModerationCategory.HATE]: 0.6,
    [ModerationCategory.HARASSMENT]: 0.6,
    [ModerationCategory.VIOLENCE]: 0.65,
    [ModerationCategory.SEXUAL]: 0.7,
    [ModerationCategory.SELF_HARM]: 0.6,
    [ModerationCategory.SELF_HARM_INTENT]: 0.55,
  },
};

/**
 * Priority Levels based on category
 */
export const CATEGORY_PRIORITY = {
  [ModerationCategory.SEXUAL_MINORS]: 'CRITICAL',
  [ModerationCategory.HATE_THREATENING]: 'HIGH',
  [ModerationCategory.HARASSMENT_THREATENING]: 'HIGH',
  [ModerationCategory.SELF_HARM_INSTRUCTIONS]: 'HIGH',
  [ModerationCategory.SELF_HARM_INTENT]: 'HIGH',
  [ModerationCategory.VIOLENCE_GRAPHIC]: 'HIGH',
  [ModerationCategory.HATE]: 'MEDIUM',
  [ModerationCategory.HARASSMENT]: 'MEDIUM',
  [ModerationCategory.VIOLENCE]: 'MEDIUM',
  [ModerationCategory.SEXUAL]: 'MEDIUM',
  [ModerationCategory.SELF_HARM]: 'MEDIUM',
};

/**
 * User-friendly reason messages
 */
export const VIOLATION_MESSAGES = {
  [ModerationCategory.HATE]: 'Content contains hate speech or discrimination',
  [ModerationCategory.HATE_THREATENING]: 'Content contains threatening hate speech',
  [ModerationCategory.HARASSMENT]: 'Content contains harassment or bullying',
  [ModerationCategory.HARASSMENT_THREATENING]: 'Content contains threatening harassment',
  [ModerationCategory.SELF_HARM]: 'Content promotes self-harm',
  [ModerationCategory.SELF_HARM_INTENT]: 'Content expresses self-harm intent',
  [ModerationCategory.SELF_HARM_INSTRUCTIONS]: 'Content provides self-harm instructions',
  [ModerationCategory.SEXUAL]: 'Content is sexually explicit',
  [ModerationCategory.SEXUAL_MINORS]: 'Content involves minors in sexual context',
  [ModerationCategory.VIOLENCE]: 'Content contains violent content',
  [ModerationCategory.VIOLENCE_GRAPHIC]: 'Content contains graphic violence',
};

/**
 * Rate limiting for AI moderation
 */
export const AI_MODERATION_LIMITS = {
  maxConcurrent: 5,          // Max parallel moderation requests
  retryAttempts: 2,          // Retry on failure
  timeoutMs: 5000,           // 5 second timeout
  cacheDurationMs: 3600000,  // Cache results for 1 hour
};
