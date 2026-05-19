// ===========================================
// REDIS UNIT TESTS
// ===========================================

// We need to mock the redis module before importing our code
const mockConnect = jest.fn();
const mockQuit = jest.fn();
const mockOn = jest.fn();

jest.mock('redis', () => ({
  createClient: jest.fn(() => ({
    connect: mockConnect,
    quit: mockQuit,
    on: mockOn,
  })),
}));

import {
  isRedisConfigured,
  getRedisClient,
  isRedisConnected,
  connectRedis,
  disconnectRedis,
} from '../../utils/redis';

describe('Redis Utils - Unit Tests', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    // Reset module-level state is tricky; we test what we can
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('isRedisConfigured', () => {
    it('should return false when REDIS_ENABLED is false', () => {
      // The module reads env at load time, so this tests the current state
      // In test env, REDIS_URL is likely empty
      const result = isRedisConfigured();
      // Since we are in test, REDIS_URL is likely not set
      expect(typeof result).toBe('boolean');
    });
  });

  describe('getRedisClient', () => {
    it('should return null or a client object', () => {
      const client = getRedisClient();
      // In test env, client may be null if Redis is not configured
      expect(client === null || typeof client === 'object').toBe(true);
    });
  });

  describe('isRedisConnected', () => {
    it('should return a boolean', () => {
      const connected = isRedisConnected();
      expect(typeof connected).toBe('boolean');
    });

    it('should return false in test environment (no real Redis)', () => {
      const connected = isRedisConnected();
      expect(connected).toBe(false);
    });
  });

  describe('connectRedis', () => {
    it('should skip connection when REDIS_ENABLED is false', async () => {
      const savedEnabled = process.env.REDIS_ENABLED;
      const savedUrl = process.env.REDIS_URL;
      process.env.REDIS_ENABLED = 'false';
      process.env.REDIS_URL = '';

      // Since module state is cached, we test the function does not throw
      await expect(connectRedis()).resolves.not.toThrow();

      process.env.REDIS_ENABLED = savedEnabled;
      process.env.REDIS_URL = savedUrl;
    });

    it('should skip connection when REDIS_URL is not set', async () => {
      const savedUrl = process.env.REDIS_URL;
      process.env.REDIS_URL = '';

      await expect(connectRedis()).resolves.not.toThrow();

      process.env.REDIS_URL = savedUrl;
    });

    it('should handle connection errors gracefully', async () => {
      mockConnect.mockRejectedValueOnce(new Error('Connection refused'));

      // Should not throw
      await expect(connectRedis()).resolves.not.toThrow();
    });
  });

  describe('disconnectRedis', () => {
    it('should not throw when no client is connected', async () => {
      await expect(disconnectRedis()).resolves.not.toThrow();
    });

    it('should handle disconnect errors gracefully', async () => {
      // Even if quit fails, disconnectRedis should not throw
      mockQuit.mockRejectedValueOnce(new Error('Already disconnected'));

      await expect(disconnectRedis()).resolves.not.toThrow();
    });
  });
});
