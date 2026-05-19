// ===========================================
// LOGGER UNIT TESTS
// ===========================================

import { logger, logInfo, logError, logWarning } from '../../utils/logger';

describe('Logger Utils - Unit Tests', () => {
  beforeEach(() => {
    // Clear mocks before each test
    jest.clearAllMocks();
  });

  it('should create logger instance', () => {
    expect(logger).toBeDefined();
    expect(typeof logger.info).toBe('function');
    expect(typeof logger.error).toBe('function');
    expect(typeof logger.warn).toBe('function');
  });

  it('should have correct log levels', () => {
    expect(logger.levels).toBeDefined();
  });

  describe('Helper functions', () => {
    it('should log info messages', () => {
      const message = 'Test info message';
      const metadata = { userId: '123' };

      expect(() => logInfo(message, metadata)).not.toThrow();
    });

    it('should log errors with stack trace', () => {
      const error = new Error('Test error');
      const context = { route: '/api/test' };

      expect(() => logError(error, context)).not.toThrow();
    });

    it('should log warnings', () => {
      const message = 'Test warning';
      const metadata = { code: 'WARN_001' };

      expect(() => logWarning(message, metadata)).not.toThrow();
    });
  });
});
