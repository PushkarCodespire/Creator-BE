// ===========================================
// AI ERROR HANDLER SERVICE — UNIT TESTS
// ===========================================

jest.mock('../../../utils/logger', () => ({
  logError: jest.fn(),
}));

import { handleOpenAIError } from '../../../services/ai/error-handler.service';

describe('ErrorHandlerService', () => {
  describe('handleOpenAIError', () => {
    it('should classify rate limit errors (status 429)', () => {
      const error = { status: 429 };
      const result = handleOpenAIError(error);

      expect(result.code).toBe('RATE_LIMIT');
      expect(result.shouldRetry).toBe(true);
      expect(result.retryAfter).toBe(60000);
    });

    it('should classify rate limit errors (code rate_limit_exceeded)', () => {
      const error = { code: 'rate_limit_exceeded' };
      const result = handleOpenAIError(error);

      expect(result.code).toBe('RATE_LIMIT');
      expect(result.shouldRetry).toBe(true);
    });

    it('should classify authentication errors (status 401)', () => {
      const error = { status: 401 };
      const result = handleOpenAIError(error);

      expect(result.code).toBe('AUTH_ERROR');
      expect(result.shouldRetry).toBe(false);
      expect(result.retryAfter).toBeUndefined();
    });

    it('should classify authentication errors (code invalid_api_key)', () => {
      const error = { code: 'invalid_api_key' };
      const result = handleOpenAIError(error);

      expect(result.code).toBe('AUTH_ERROR');
      expect(result.shouldRetry).toBe(false);
    });

    it('should classify context length errors', () => {
      const error = { code: 'context_length_exceeded' };
      const result = handleOpenAIError(error);

      expect(result.code).toBe('CONTEXT_TOO_LONG');
      expect(result.shouldRetry).toBe(false);
      expect(result.userMessage).toContain('too long');
    });

    it('should classify server errors (5xx)', () => {
      const error = { status: 500 };
      const result = handleOpenAIError(error);

      expect(result.code).toBe('SERVER_ERROR');
      expect(result.shouldRetry).toBe(true);
      expect(result.retryAfter).toBe(30000);
    });

    it('should classify server errors (503)', () => {
      const error = { status: 503 };
      const result = handleOpenAIError(error);

      expect(result.code).toBe('SERVER_ERROR');
      expect(result.shouldRetry).toBe(true);
    });

    it('should classify network errors (ECONNREFUSED)', () => {
      const error = { code: 'ECONNREFUSED' };
      const result = handleOpenAIError(error);

      expect(result.code).toBe('NETWORK_ERROR');
      expect(result.shouldRetry).toBe(true);
      expect(result.retryAfter).toBe(10000);
    });

    it('should classify network errors (ETIMEDOUT)', () => {
      const error = { code: 'ETIMEDOUT' };
      const result = handleOpenAIError(error);

      expect(result.code).toBe('NETWORK_ERROR');
      expect(result.shouldRetry).toBe(true);
    });

    it('should return unknown error for unrecognized errors', () => {
      const error = { message: 'something weird' };
      const result = handleOpenAIError(error);

      expect(result.code).toBe('UNKNOWN_ERROR');
      expect(result.shouldRetry).toBe(true);
      expect(result.retryAfter).toBe(5000);
    });

    it('should handle null/undefined errors gracefully', () => {
      const result = handleOpenAIError(null);

      expect(result.code).toBe('UNKNOWN_ERROR');
      expect(result.shouldRetry).toBe(true);
    });
  });
});
