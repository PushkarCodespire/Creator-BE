// ===========================================
// JEST SETUP FILE
// ===========================================
// Runs before all tests

import { config } from '../config';

// Set test environment
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret-key-for-testing-only';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgresql://creator_admin:creator_password_123@localhost:5432/creator_platform_test';

// Increase test timeout for database operations
jest.setTimeout(10000);

// Mock console methods to reduce noise in tests
global.console = {
  ...console,
  log: jest.fn(), // Suppress console.log
  debug: jest.fn(), // Suppress console.debug
  info: jest.fn(), // Suppress console.info
  warn: jest.fn(), // Keep warnings
  error: jest.fn(), // Keep errors for debugging
};

// Clean up after all tests
afterAll(async () => {
  // Give time for async operations to complete
  await new Promise(resolve => setTimeout(resolve, 500));
});
