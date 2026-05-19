// ===========================================
// AI MODERATION SERVICE — UNIT TESTS
// ===========================================

const mockModerationsCreate = jest.fn();

jest.mock('openai', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    moderations: { create: mockModerationsCreate },
  })),
}));

jest.mock('../../../types/moderation.types', () => ({
  SeverityLevel: {
    SAFE: 'SAFE',
    LOW: 'LOW',
    MEDIUM: 'MEDIUM',
    HIGH: 'HIGH',
    CRITICAL: 'CRITICAL',
  },
  AutoActionType: {
    BLOCK: 'BLOCK',
    FLAG: 'FLAG',
    WARN: 'WARN',
    ALLOW: 'ALLOW',
  },
  ModerationCategory: {
    HATE: 'hate',
    HATE_THREATENING: 'hate/threatening',
    HARASSMENT: 'harassment',
    HARASSMENT_THREATENING: 'harassment/threatening',
    SELF_HARM: 'self-harm',
    SELF_HARM_INTENT: 'self-harm/intent',
    SELF_HARM_INSTRUCTIONS: 'self-harm/instructions',
    SEXUAL: 'sexual',
    SEXUAL_MINORS: 'sexual/minors',
    VIOLENCE: 'violence',
    VIOLENCE_GRAPHIC: 'violence/graphic',
  },
}));

jest.mock('../../../services/moderation/moderation-config', () => ({
  MODERATION_THRESHOLDS: {
    BLOCK: { 'sexual/minors': 0.3, 'hate': 0.85 },
    FLAG: { 'sexual/minors': 0.1, 'hate': 0.6, 'harassment': 0.6 },
  },
  CATEGORY_PRIORITY: {
    'sexual/minors': 'CRITICAL',
    'hate': 'MEDIUM',
    'harassment': 'MEDIUM',
  },
  VIOLATION_MESSAGES: {
    'hate': 'Content contains hate speech or discrimination',
    'harassment': 'Content contains harassment or bullying',
    'sexual/minors': 'Content involves minors in sexual context',
  },
  AI_MODERATION_LIMITS: {
    maxConcurrent: 5,
    retryAttempts: 2,
    timeoutMs: 5000,
    cacheDurationMs: 3600000,
  },
}));

import aiModerationService from '../../../services/moderation/ai-moderation.service';

describe('AIModerationService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('moderateContent', () => {
    it('should return safe result for empty content', async () => {
      const result = await aiModerationService.moderateContent('');

      expect(result.isFlagged).toBe(false);
      expect(result.severity).toBe('SAFE');
      expect(result.shouldBlock).toBe(false);
      expect(result.shouldFlag).toBe(false);
    });

    it('should return safe result for whitespace-only content', async () => {
      const result = await aiModerationService.moderateContent('   ');

      expect(result.isFlagged).toBe(false);
      expect(result.severity).toBe('SAFE');
    });

    it('should classify safe content correctly', async () => {
      mockModerationsCreate.mockResolvedValue({
        results: [
          {
            flagged: false,
            categories: { hate: false, harassment: false },
            category_scores: { hate: 0.01, harassment: 0.02 },
          },
        ],
      });

      const result = await aiModerationService.moderateContent('Hello, how are you?');

      expect(result.isFlagged).toBe(false);
      expect(result.shouldBlock).toBe(false);
      expect(result.shouldFlag).toBe(false);
    });

    it('should flag content above threshold', async () => {
      mockModerationsCreate.mockResolvedValue({
        results: [
          {
            flagged: true,
            categories: { hate: true, harassment: false },
            category_scores: { hate: 0.75, harassment: 0.1 },
          },
        ],
      });

      const result = await aiModerationService.moderateContent('Flaggable content');

      expect(result.isFlagged).toBe(true);
      expect(result.shouldFlag).toBe(true);
      expect(result.violatedCategories).toContain('hate');
    });

    it('should block content above block threshold', async () => {
      mockModerationsCreate.mockResolvedValue({
        results: [
          {
            flagged: true,
            categories: { hate: true },
            category_scores: { hate: 0.95 },
          },
        ],
      });

      const result = await aiModerationService.moderateContent('Severe hate speech');

      expect(result.shouldBlock).toBe(true);
      expect(result.recommendation).toContain('BLOCK_IMMEDIATELY');
    });

    it('should return error result on API failure', async () => {
      mockModerationsCreate.mockRejectedValue(new Error('API timeout'));

      const result = await aiModerationService.moderateContent('Test content');

      expect(result.isFlagged).toBe(true);
      expect(result.severity).toBe('MEDIUM');
      expect(result.reason).toContain('error');
      expect(result.shouldBlock).toBe(false);
      expect(result.shouldFlag).toBe(true);
    });

    it('should truncate very long content', async () => {
      const longContent = 'a'.repeat(35000);
      mockModerationsCreate.mockResolvedValue({
        results: [
          {
            flagged: false,
            categories: {},
            category_scores: {},
          },
        ],
      });

      await aiModerationService.moderateContent(longContent);

      expect(mockModerationsCreate).toHaveBeenCalledWith({
        input: 'a'.repeat(30000),
        model: 'omni-moderation-latest',
      });
    });
  });

  describe('getPriorityForCategory', () => {
    it('should return correct priority for known category', () => {
      const priority = aiModerationService.getPriorityForCategory('sexual/minors');
      expect(priority).toBe('CRITICAL');
    });

    it('should return MEDIUM for unknown category', () => {
      const priority = aiModerationService.getPriorityForCategory('unknown');
      expect(priority).toBe('MEDIUM');
    });
  });

  describe('moderateBatch', () => {
    it('should moderate multiple content items', async () => {
      mockModerationsCreate.mockResolvedValue({
        results: [
          {
            flagged: false,
            categories: {},
            category_scores: {},
          },
        ],
      });

      const results = await aiModerationService.moderateBatch([
        'Content 1',
        'Content 2',
        'Content 3',
      ]);

      expect(results).toHaveLength(3);
      expect(mockModerationsCreate).toHaveBeenCalledTimes(3);
    });
  });
});
