// ===========================================
// PROFANITY FILTER UNIT TESTS
// ===========================================

import {
  containsProfanity,
  getFlaggedWords,
  getToxicityScore,
  shouldAutoFlag,
  getModerationRecommendation,
  cleanProfanity
} from '../../utils/profanityFilter';

describe('Profanity Filter', () => {
  describe('containsProfanity', () => {
    it('should detect English profanity', () => {
      expect(containsProfanity('fuck you')).toBe(true);
      expect(containsProfanity('This is shit')).toBe(true);
      expect(containsProfanity('You are a bitch')).toBe(true);
    });

    it('should detect Hindi/Hinglish profanity', () => {
      expect(containsProfanity('bhenchod')).toBe(true);
      expect(containsProfanity('madarchod')).toBe(true);
      expect(containsProfanity('chutiya')).toBe(true);
      expect(containsProfanity('BC yaar')).toBe(true);
      expect(containsProfanity('MC sale')).toBe(true);
    });

    it('should be case-insensitive', () => {
      expect(containsProfanity('FUCK')).toBe(true);
      expect(containsProfanity('Bhenchod')).toBe(true);
      expect(containsProfanity('ShIt')).toBe(true);
    });

    it('should not flag clean text', () => {
      expect(containsProfanity('Hello, how are you?')).toBe(false);
      expect(containsProfanity('This is a nice day')).toBe(false);
      expect(containsProfanity('Thank you for your help')).toBe(false);
    });

    it('should detect profanity in sentences', () => {
      expect(containsProfanity('This is a fuck great day')).toBe(true);
      expect(containsProfanity('Tu chutiya hai kya')).toBe(true);
    });
  });

  describe('getFlaggedWords', () => {
    it('should return all flagged words', () => {
      const words = getFlaggedWords('You are a fuck bitch');
      expect(words).toContain('fuck');
      expect(words).toContain('bitch');
      expect(words.length).toBeGreaterThanOrEqual(2);
    });

    it('should return empty array for clean text', () => {
      expect(getFlaggedWords('Hello world')).toEqual([]);
    });

    it('should detect mixed language profanity', () => {
      const words = getFlaggedWords('fuck you chutiya');
      expect(words).toContain('fuck');
      expect(words).toContain('chutiya');
    });
  });

  describe('getToxicityScore', () => {
    it('should return 0 for clean text', () => {
      expect(getToxicityScore('Hello, how are you?')).toBe(0);
      expect(getToxicityScore('Nice to meet you')).toBe(0);
    });

    it('should return higher score for profane text', () => {
      const cleanScore = getToxicityScore('Hello');
      const profaneScore = getToxicityScore('fuck you');
      expect(profaneScore).toBeGreaterThan(cleanScore);
      expect(profaneScore).toBeGreaterThan(0);
    });

    it('should penalize multiple profane words', () => {
      const singleProfanity = getToxicityScore('fuck');
      const multipleProfanity = getToxicityScore('fuck you bitch');
      expect(multipleProfanity).toBeGreaterThan(singleProfanity);
    });

    it('should penalize hate speech patterns', () => {
      const hateScore = getToxicityScore('all muslims are bad');
      expect(hateScore).toBeGreaterThan(0.3);
    });

    it('should penalize all caps', () => {
      const normalScore = getToxicityScore('hello');
      const capsScore = getToxicityScore('HELLO THIS IS YELLING');
      expect(capsScore).toBeGreaterThan(normalScore);
    });

    it('should penalize excessive punctuation', () => {
      const normalScore = getToxicityScore('Hey!');
      const excessiveScore = getToxicityScore('Hey!! What?? No?? Go!!');
      expect(excessiveScore).toBeGreaterThan(normalScore);
    });

    it('should return score between 0 and 1', () => {
      const score = getToxicityScore('fuck you bitch motherfucker!!!');
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(1);
    });
  });

  describe('shouldAutoFlag', () => {
    it('should auto-flag highly toxic content', () => {
      expect(shouldAutoFlag('rape terrorist nazi')).toBe(true);
      expect(shouldAutoFlag('christians are terrible people')).toBe(true);
    });

    it('should auto-flag severe profanity', () => {
      expect(shouldAutoFlag('rape')).toBe(true);
      expect(shouldAutoFlag('madarchod')).toBe(true);
    });

    it('should not auto-flag mild profanity', () => {
      expect(shouldAutoFlag('damn')).toBe(false);
      expect(shouldAutoFlag('hell')).toBe(false);
    });

    it('should not auto-flag clean text', () => {
      expect(shouldAutoFlag('Hello, how are you?')).toBe(false);
      expect(shouldAutoFlag('This is a nice day')).toBe(false);
    });

    it('should auto-flag content with toxicity >= 0.6', () => {
      // toxic pattern (0.3) + hate speech (0.4) + profanity (0.1) = 0.8 >= 0.6
      const toxicText = 'kill yourself all muslims are bad fuck';
      expect(shouldAutoFlag(toxicText)).toBe(true);
    });
  });

  describe('getModerationRecommendation', () => {
    it('should recommend no action for clean text', () => {
      const result = getModerationRecommendation('Hello, how are you?');
      expect(result.shouldFlag).toBe(false);
      expect(result.recommendedAction).toBe('none');
      expect(result.toxicityScore).toBe(0);
    });

    it('should recommend warning for mild violations', () => {
      const result = getModerationRecommendation('This is rape');
      expect(result.shouldFlag).toBe(true);
      expect(['warning', 'hide']).toContain(result.recommendedAction);
    });

    it('should recommend hide for moderate violations', () => {
      // toxic pattern (0.3) + profanity fuck+bitch+damn (0.3) = 0.6 → 'hide'
      const result = getModerationRecommendation('kill yourself fuck bitch damn');
      expect(result.shouldFlag).toBe(true);
      expect(['hide', 'ban']).toContain(result.recommendedAction);
    });

    it('should recommend ban for severe violations', () => {
      // toxic pattern "kill yourself" (+0.3) + hate speech "all muslims are" (+0.4)
      // + profanity "fuck shit" (+0.2) = 0.9 → recommendedAction 'ban', toxicityScore > 0.6
      const result = getModerationRecommendation('kill yourself all muslims are fuck shit');
      expect(result.shouldFlag).toBe(true);
      expect(result.recommendedAction).toBe('ban');
      expect(result.toxicityScore).toBeGreaterThan(0.6);
    });

    it('should include flagged words in response', () => {
      const result = getModerationRecommendation('fuck you bitch');
      expect(result.flaggedWords.length).toBeGreaterThan(0);
      expect(result.flaggedWords).toContain('fuck');
    });

    it('should include reason in response', () => {
      const result = getModerationRecommendation('fuck you');
      expect(result.reason).toBeDefined();
      expect(result.reason.length).toBeGreaterThan(0);
    });
  });

  describe('cleanProfanity', () => {
    it('should replace profanity with asterisks', () => {
      const cleaned = cleanProfanity('fuck you');
      expect(cleaned).not.toContain('fuck');
      expect(cleaned).toContain('*');
    });

    it('should preserve clean words', () => {
      const text = 'Hello world';
      expect(cleanProfanity(text)).toBe(text);
    });

    it('should clean multiple profane words', () => {
      const cleaned = cleanProfanity('fuck you bitch');
      expect(cleaned).not.toContain('fuck');
      expect(cleaned).not.toContain('bitch');
      expect(cleaned).toContain('*');
    });

    it('should clean Hindi/Hinglish profanity', () => {
      const cleaned = cleanProfanity('Tu chutiya hai');
      expect(cleaned).not.toContain('chutiya');
      expect(cleaned).toContain('*');
    });

    it('should maintain text structure', () => {
      const original = 'Hello fuck you world';
      const cleaned = cleanProfanity(original);
      expect(cleaned.split(' ').length).toBe(original.split(' ').length);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty strings', () => {
      expect(containsProfanity('')).toBe(false);
      expect(getFlaggedWords('')).toEqual([]);
      expect(getToxicityScore('')).toBe(0);
      expect(shouldAutoFlag('')).toBe(false);
    });

    it('should handle very long text', () => {
      const longText = 'Hello '.repeat(1000) + 'fuck';
      expect(containsProfanity(longText)).toBe(true);
      const score = getToxicityScore(longText);
      expect(score).toBeGreaterThan(0);
      expect(score).toBeLessThanOrEqual(1);
    });

    it('should handle special characters', () => {
      expect(containsProfanity('f*ck')).toBe(false); // Obfuscated profanity not detected
      expect(containsProfanity('f u c k')).toBe(false); // Spaced profanity not detected
    });

    it('should handle Unicode characters', () => {
      const result = getToxicityScore('Hello 你好 مرحبا');
      expect(result).toBeGreaterThanOrEqual(0);
      expect(result).toBeLessThanOrEqual(1);
    });

    it('should handle numbers and symbols', () => {
      expect(containsProfanity('123!@#$%^&*()')).toBe(false);
      expect(getToxicityScore('123!@#$%^&*()')).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Performance', () => {
    it('should process text quickly', () => {
      const start = Date.now();
      for (let i = 0; i < 100; i++) {
        containsProfanity('This is a test message with some fuck profanity');
      }
      const duration = Date.now() - start;
      expect(duration).toBeLessThan(1000); // Should complete 100 checks in under 1 second
    });
  });
});
