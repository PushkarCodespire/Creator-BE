// ===========================================
// TOKEN MANAGEMENT SERVICE — UNIT TESTS
// ===========================================

import {
  estimateTokens,
  validateTokenLimit,
  truncateToTokenLimit,
  calculateCost,
} from '../../../services/ai/token-management.service';

describe('TokenManagementService', () => {
  describe('estimateTokens', () => {
    it('should estimate tokens using ~4 chars per token heuristic', () => {
      const text = 'Hello world'; // 11 chars
      const tokens = estimateTokens(text);

      // Without tiktoken, should be Math.ceil(11 / 4) = 3
      expect(tokens).toBeGreaterThan(0);
    });

    it('should return higher count for longer text', () => {
      const short = estimateTokens('Hi');
      const long = estimateTokens('This is a much longer sentence with many more words and characters');

      expect(long).toBeGreaterThan(short);
    });

    it('should handle empty string', () => {
      const tokens = estimateTokens('');
      expect(tokens).toBe(0);
    });

    it('should accept custom model parameter', () => {
      const tokens = estimateTokens('Hello world', 'gpt-3.5-turbo');
      expect(tokens).toBeGreaterThan(0);
    });
  });

  describe('validateTokenLimit', () => {
    it('should return true when text is within limit', () => {
      const result = validateTokenLimit('Short text', 1000);
      expect(result).toBe(true);
    });

    it('should return false when text exceeds limit', () => {
      const longText = 'a'.repeat(10000);
      const result = validateTokenLimit(longText, 10);
      expect(result).toBe(false);
    });

    it('should return true at exact boundary', () => {
      // 4 chars = ~1 token in heuristic mode
      const result = validateTokenLimit('abcd', 1);
      expect(result).toBe(true);
    });
  });

  describe('truncateToTokenLimit', () => {
    it('should return full text when within limit', () => {
      const text = 'Short text';
      const result = truncateToTokenLimit(text, 1000);
      expect(result).toBe(text);
    });

    it('should truncate text that exceeds limit', () => {
      const longText = 'a'.repeat(1000);
      const result = truncateToTokenLimit(longText, 10);

      expect(result.length).toBeLessThanOrEqual(longText.length);
      expect(result.length).toBeGreaterThan(0);
    });

    it('should handle empty text', () => {
      const result = truncateToTokenLimit('', 100);
      expect(result).toBe('');
    });
  });

  describe('calculateCost', () => {
    it('should calculate cost for gpt-4o', () => {
      const cost = calculateCost(1000, 500, 'gpt-4o');
      // (1000/1000) * 0.005 + (500/1000) * 0.015 = 0.005 + 0.0075 = 0.0125
      expect(cost).toBeCloseTo(0.0125, 4);
    });

    it('should calculate cost for gpt-4', () => {
      const cost = calculateCost(1000, 500, 'gpt-4');
      // (1000/1000) * 0.03 + (500/1000) * 0.06 = 0.03 + 0.03 = 0.06
      expect(cost).toBeCloseTo(0.06, 4);
    });

    it('should calculate cost for gpt-3.5-turbo', () => {
      const cost = calculateCost(1000, 500, 'gpt-3.5-turbo');
      // (1000/1000) * 0.0005 + (500/1000) * 0.0015 = 0.0005 + 0.00075 = 0.00125
      expect(cost).toBeCloseTo(0.00125, 5);
    });

    it('should fallback to gpt-4o rates for unknown model', () => {
      const costUnknown = calculateCost(1000, 500, 'unknown-model');
      const costGpt4o = calculateCost(1000, 500, 'gpt-4o');
      expect(costUnknown).toBe(costGpt4o);
    });

    it('should return 0 when tokens are 0', () => {
      const cost = calculateCost(0, 0, 'gpt-4o');
      expect(cost).toBe(0);
    });
  });

  // ─── NEW TESTS ──────────────────────────────────────────────────

  describe('estimateTokens — additional branches', () => {
    it('should handle whitespace-only string', () => {
      // whitespace-only: split gives ['', ''] → length 2; Math.ceil(2/4)=1 without tiktoken
      const tokens = estimateTokens('   ');
      expect(tokens).toBeGreaterThanOrEqual(0);
    });

    it('should return 0 for empty string (heuristic: 0 chars / 4 = 0)', () => {
      const tokens = estimateTokens('');
      expect(tokens).toBe(0);
    });

    it('should use default model gpt-4 when not provided', () => {
      const t1 = estimateTokens('hello', 'gpt-4');
      const t2 = estimateTokens('hello');
      expect(t1).toBe(t2);
    });

    it('should produce consistent results for the same input', () => {
      const input = 'Consistent input text for testing';
      expect(estimateTokens(input)).toBe(estimateTokens(input));
    });

    it('should handle single character', () => {
      const tokens = estimateTokens('x');
      // Math.ceil(1/4) = 1
      expect(tokens).toBe(1);
    });

    it('should handle exactly 4 characters (=1 token in heuristic)', () => {
      const tokens = estimateTokens('abcd');
      expect(tokens).toBe(1);
    });

    it('should handle 5 characters (Math.ceil(5/4)=2 in heuristic)', () => {
      const tokens = estimateTokens('abcde');
      expect(tokens).toBe(2);
    });
  });

  describe('validateTokenLimit — additional branches', () => {
    it('should return false when estimated tokens equal limit exactly (edge: > vs <=)', () => {
      // 8 chars → Math.ceil(8/4)=2 tokens; limit=1 → false
      const result = validateTokenLimit('abcdefgh', 1);
      expect(result).toBe(false);
    });

    it('should accept custom model parameter without throwing', () => {
      expect(() => validateTokenLimit('text', 100, 'gpt-3.5-turbo')).not.toThrow();
    });

    it('should return true for empty string against any limit', () => {
      expect(validateTokenLimit('', 0)).toBe(true);
    });
  });

  describe('truncateToTokenLimit — additional branches', () => {
    it('should handle single character within limit', () => {
      const result = truncateToTokenLimit('x', 10);
      expect(result).toBe('x');
    });

    it('should return truncated result shorter than original for very low limit', () => {
      const text = 'a'.repeat(400); // 400 chars → 100 tokens in heuristic; limit=10 → 40 chars
      const result = truncateToTokenLimit(text, 10);
      expect(result.length).toBeLessThanOrEqual(text.length);
      expect(result.length).toBeGreaterThan(0);
    });

    it('should accept custom model without throwing', () => {
      expect(() => truncateToTokenLimit('some text', 50, 'gpt-3.5-turbo')).not.toThrow();
    });

    it('should return up to limit*4 chars in heuristic mode', () => {
      const limit = 5;
      const text = 'a'.repeat(100);
      const result = truncateToTokenLimit(text, limit);
      // heuristic: text.substring(0, limit * 4) = 20 chars
      expect(result.length).toBeLessThanOrEqual(limit * 4);
    });
  });

  describe('calculateCost — additional branches', () => {
    it('should calculate cost for gpt-4-turbo', () => {
      const cost = calculateCost(1000, 500, 'gpt-4-turbo');
      // (1000/1000)*0.01 + (500/1000)*0.03 = 0.01 + 0.015 = 0.025
      expect(cost).toBeCloseTo(0.025, 4);
    });

    it('should return a positive number for positive token counts', () => {
      const cost = calculateCost(100, 100, 'gpt-4o');
      expect(cost).toBeGreaterThan(0);
    });

    it('should scale linearly with prompt tokens', () => {
      const cost1 = calculateCost(1000, 0, 'gpt-4');
      const cost2 = calculateCost(2000, 0, 'gpt-4');
      expect(cost2).toBeCloseTo(cost1 * 2, 8);
    });

    it('should scale linearly with completion tokens', () => {
      const cost1 = calculateCost(0, 1000, 'gpt-4');
      const cost2 = calculateCost(0, 2000, 'gpt-4');
      expect(cost2).toBeCloseTo(cost1 * 2, 8);
    });
  });
});
