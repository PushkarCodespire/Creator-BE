/**
 * OpenAI Moderation Categories
 */
export enum ModerationCategory {
  HATE = 'hate',
  HATE_THREATENING = 'hate/threatening',
  HARASSMENT = 'harassment',
  HARASSMENT_THREATENING = 'harassment/threatening',
  SELF_HARM = 'self-harm',
  SELF_HARM_INTENT = 'self-harm/intent',
  SELF_HARM_INSTRUCTIONS = 'self-harm/instructions',
  SEXUAL = 'sexual',
  SEXUAL_MINORS = 'sexual/minors',
  VIOLENCE = 'violence',
  VIOLENCE_GRAPHIC = 'violence/graphic',
}

/**
 * Severity Levels
 */
export enum SeverityLevel {
  SAFE = 'SAFE',           // Score < 0.5
  LOW = 'LOW',             // Score 0.5 - 0.7
  MEDIUM = 'MEDIUM',       // Score 0.7 - 0.85
  HIGH = 'HIGH',           // Score 0.85 - 0.95
  CRITICAL = 'CRITICAL',   // Score > 0.95
}

/**
 * AI Moderation Result
 */
export interface ModerationResult {
  isFlagged: boolean;
  severity: SeverityLevel;
  violatedCategories: string[];
  scores: Record<string, number>;
  shouldBlock: boolean;
  shouldFlag: boolean;
  reason: string;
  recommendation: string;
  highestScore: number;
  highestCategory: string;
}

/**
 * Content Types that can be moderated
 */
export enum ModerableContentType {
  MESSAGE = 'MESSAGE',
  POST = 'POST',
  COMMENT = 'COMMENT',
  CREATOR_BIO = 'CREATOR_BIO',
  CREATOR_CONTENT = 'CREATOR_CONTENT',
  USER_PROFILE = 'USER_PROFILE',
}

/**
 * Auto-Action Types
 */
export enum AutoActionType {
  BLOCK = 'BLOCK',           // Reject content immediately
  FLAG = 'FLAG',             // Create report for admin review
  WARN = 'WARN',             // Log but allow
  ALLOW = 'ALLOW',           // No action needed
}
