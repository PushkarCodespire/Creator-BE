# Testing Guide

## Overview

This document provides comprehensive guidance on testing the AI Creator Platform backend. Our testing strategy includes unit tests, integration tests, and automated CI/CD pipelines to ensure code quality and reliability.

## Table of Contents

1. [Quick Start](#quick-start)
2. [Test Structure](#test-structure)
3. [Running Tests](#running-tests)
4. [Writing Tests](#writing-tests)
5. [Test Coverage](#test-coverage)
6. [CI/CD Pipeline](#cicd-pipeline)
7. [Troubleshooting](#troubleshooting)

---

## Quick Start

### Prerequisites

- Node.js 20+
- PostgreSQL 15+ (running via Docker or local)
- OpenAI API key (for integration tests involving AI features)

### Setup Test Environment

```bash
# 1. Install dependencies
npm install

# 2. Set up test database
docker-compose up -d  # Start PostgreSQL

# 3. Generate Prisma client
npm run db:generate

# 4. Push schema to test database
npx prisma db push --schema=src/prisma/schema.prisma

# 5. Run tests
npm test
```

---

## Test Structure

### Directory Organization

```
Backend/
├── src/
│   ├── __tests__/
│   │   ├── setup.ts              # Jest configuration
│   │   ├── helpers/
│   │   │   └── testHelpers.ts    # Test utilities
│   │   ├── integration/
│   │   │   ├── auth.test.ts      # Auth endpoint tests
│   │   │   ├── chat.test.ts      # Chat endpoint tests (TODO)
│   │   │   ├── content.test.ts   # Content endpoint tests (TODO)
│   │   │   └── creator.test.ts   # Creator endpoint tests (TODO)
│   │   └── unit/
│   │       ├── validation.test.ts # Validation utility tests
│   │       ├── logger.test.ts     # Logger utility tests
│   │       ├── openai.test.ts     # OpenAI utility tests (TODO)
│   │       └── vectorStore.test.ts # Vector store tests (TODO)
│   └── ...
├── jest.config.js                 # Jest configuration
└── package.json                   # Test scripts
```

### Test Types

1. **Unit Tests** (`src/__tests__/unit/`)
   - Test individual functions and utilities in isolation
   - No external dependencies (database, APIs)
   - Fast execution (<100ms per test)
   - Examples: Validation functions, logging, data transformations

2. **Integration Tests** (`src/__tests__/integration/`)
   - Test complete API endpoints with database
   - Verify request/response flows
   - Test authentication and authorization
   - Examples: POST /api/auth/register, GET /api/creators/:id

---

## Running Tests

### All Tests

```bash
npm test
```

Runs all tests with coverage report.

### Watch Mode

```bash
npm run test:watch
```

Runs tests in watch mode for active development. Tests automatically re-run when files change.

### CI Mode

```bash
npm run test:ci
```

Runs tests in CI environment with:
- Coverage report generation
- Maximum 2 workers for resource efficiency
- No watch mode
- Optimized for GitHub Actions

### Unit Tests Only

```bash
npm run test:unit
```

Runs only unit tests (faster feedback loop).

### Integration Tests Only

```bash
npm run test:integration
```

Runs only integration tests (requires database).

### Specific Test File

```bash
npx jest src/__tests__/integration/auth.test.ts
```

### With Coverage

```bash
npx jest --coverage
```

Generates coverage report in `coverage/` directory.

---

## Writing Tests

### Test Helpers

We provide test utilities in `src/__tests__/helpers/testHelpers.ts`:

#### Create Test User

```typescript
import { createTestUser } from '../helpers/testHelpers';

const testUser = await createTestUser(UserRole.USER, {
  name: 'Custom Name',
  email: 'custom@example.com'
});

// testUser includes: id, email, password, name, role, token
```

#### Create Test Creator

```typescript
import { createTestCreator } from '../helpers/testHelpers';

const creator = await createTestCreator({
  displayName: 'Test Creator',
  bio: 'Test bio',
  isVerified: true
});
```

#### Auth Header

```typescript
import { authHeader } from '../helpers/testHelpers';

const response = await request(app)
  .get('/api/users/profile')
  .set('Authorization', authHeader(testUser.token));
```

#### Cleanup Test Data

```typescript
import { cleanupTestData } from '../helpers/testHelpers';

afterAll(async () => {
  await cleanupTestData(); // Deletes all test users and related data
});
```

### Integration Test Template

```typescript
import request from 'supertest';
import app from '../../server';
import { createTestUser, authHeader, cleanupTestData } from '../helpers/testHelpers';
import { UserRole } from '@prisma/client';

describe('POST /api/your-endpoint', () => {
  let testUser: any;

  beforeAll(async () => {
    testUser = await createTestUser(UserRole.USER);
  });

  afterAll(async () => {
    await cleanupTestData();
  });

  it('should perform expected action successfully', async () => {
    const response = await request(app)
      .post('/api/your-endpoint')
      .set('Authorization', authHeader(testUser.token))
      .send({ data: 'test data' });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data).toHaveProperty('expectedField');
  });

  it('should return 401 if not authenticated', async () => {
    const response = await request(app)
      .post('/api/your-endpoint')
      .send({ data: 'test data' });

    expect(response.status).toBe(401);
  });

  it('should return 400 if validation fails', async () => {
    const response = await request(app)
      .post('/api/your-endpoint')
      .set('Authorization', authHeader(testUser.token))
      .send({ data: '' }); // Invalid empty data

    expect(response.status).toBe(400);
    expect(response.body.error).toContain('Validation failed');
  });
});
```

### Unit Test Template

```typescript
import { yourUtilityFunction } from '../../utils/yourUtility';

describe('yourUtilityFunction', () => {
  it('should return expected result for valid input', () => {
    const result = yourUtilityFunction('valid input');
    expect(result).toBe('expected output');
  });

  it('should throw error for invalid input', () => {
    expect(() => yourUtilityFunction('')).toThrow('Invalid input');
  });

  it('should handle edge cases', () => {
    expect(yourUtilityFunction(null)).toBeNull();
    expect(yourUtilityFunction(undefined)).toBeUndefined();
  });
});
```

### Testing Best Practices

#### 1. AAA Pattern (Arrange, Act, Assert)

```typescript
it('should update user profile', async () => {
  // Arrange
  const testUser = await createTestUser(UserRole.USER);
  const updateData = { name: 'Updated Name' };

  // Act
  const response = await request(app)
    .put('/api/users/profile')
    .set('Authorization', authHeader(testUser.token))
    .send(updateData);

  // Assert
  expect(response.status).toBe(200);
  expect(response.body.data.name).toBe('Updated Name');
});
```

#### 2. Clear Test Names

```typescript
// ✅ Good - Describes what and expected outcome
it('should return 400 when email is invalid', async () => { ... });

// ❌ Bad - Vague description
it('test email', async () => { ... });
```

#### 3. Test One Thing

```typescript
// ✅ Good - Tests single behavior
it('should return 400 when email is missing', async () => { ... });
it('should return 400 when password is too short', async () => { ... });

// ❌ Bad - Tests multiple behaviors
it('should validate all fields', async () => { ... });
```

#### 4. Avoid Test Interdependence

```typescript
// ✅ Good - Each test is independent
describe('User API', () => {
  beforeEach(async () => {
    testUser = await createTestUser(); // Fresh user for each test
  });

  it('test 1', async () => { ... });
  it('test 2', async () => { ... });
});

// ❌ Bad - Tests depend on execution order
it('create user', async () => { userId = ... });
it('update user', async () => { /* uses userId from previous test */ });
```

#### 5. Clean Up After Tests

```typescript
afterAll(async () => {
  await cleanupTestData(); // Remove test data
  await prisma.$disconnect(); // Close database connection
});
```

---

## Test Coverage

### Coverage Thresholds

We maintain the following coverage requirements:

- **Branches**: 70%
- **Functions**: 70%
- **Lines**: 70%
- **Statements**: 70%

Tests will fail if coverage drops below these thresholds.

### Viewing Coverage

After running tests with coverage, open the HTML report:

```bash
npm test
open coverage/lcov-report/index.html
```

### Coverage by File Type

**Target Coverage**:
- **Controllers**: 80%+ (critical business logic)
- **Routes**: 90%+ (API endpoints)
- **Middleware**: 80%+ (auth, validation)
- **Utilities**: 70%+ (helper functions)
- **Models**: Not applicable (Prisma-generated)

### Excluding Files from Coverage

Some files are excluded from coverage reports:

```javascript
// jest.config.js
coveragePathIgnorePatterns: [
  '/node_modules/',
  '/dist/',
  '/__tests__/',
  '/src/prisma/',
  '/src/types/'
]
```

---

## CI/CD Pipeline

### GitHub Actions Workflow

Our CI/CD pipeline runs automatically on:
- Push to `main` or `develop` branches
- Pull requests to `main` or `develop`

### Pipeline Jobs

#### 1. Backend Tests

```yaml
test-backend:
  runs-on: ubuntu-latest
  services:
    postgres: # Test database
  steps:
    - Install dependencies
    - Generate Prisma client
    - Run database migrations
    - Run tests with coverage
    - Upload coverage to Codecov
```

**Key Features**:
- PostgreSQL 15 service container
- Automated database setup
- Coverage reporting
- Fails if tests fail or coverage < 70%

#### 2. Frontend Build

```yaml
build-frontend:
  runs-on: ubuntu-latest
  steps:
    - Install dependencies
    - Build frontend
    - Check build size
```

#### 3. Code Quality

```yaml
lint-and-format:
  runs-on: ubuntu-latest
  steps:
    - Backend TypeScript check
    - Frontend TypeScript check
```

#### 4. Security Scan

```yaml
security-scan:
  runs-on: ubuntu-latest
  steps:
    - npm audit (Backend)
    - npm audit (Frontend)
```

#### 5. Docker Build

```yaml
build-docker:
  runs-on: ubuntu-latest
  if: github.ref == 'refs/heads/main'
  steps:
    - Build Backend Docker image
    - Build Frontend Docker image
```

### Viewing CI Results

1. Go to GitHub repository
2. Click "Actions" tab
3. Select workflow run
4. View job logs and test results

### Local CI Simulation

Run the same tests that CI runs:

```bash
npm run test:ci
```

---

## Troubleshooting

### Common Issues

#### 1. Database Connection Error

**Error**: `Can't reach database server`

**Solution**:
```bash
# Ensure PostgreSQL is running
docker-compose up -d

# Check DATABASE_URL in .env
DATABASE_URL=postgresql://creator_admin:admin_password@localhost:5432/creator_platform

# Verify connection
npx prisma db push --schema=src/prisma/schema.prisma
```

#### 2. Prisma Client Not Generated

**Error**: `Cannot find module '@prisma/client'`

**Solution**:
```bash
npm run db:generate
```

#### 3. Tests Timeout

**Error**: `Timeout - Async callback was not invoked within the 5000 ms timeout`

**Solution**:
```typescript
// Increase timeout for specific test
it('slow test', async () => {
  // test code
}, 10000); // 10 second timeout

// Or globally in jest.config.js
module.exports = {
  testTimeout: 10000
};
```

#### 4. Port Already in Use

**Error**: `EADDRINUSE: address already in use :::5000`

**Solution**:
```bash
# Kill process on port 5000
lsof -ti:5000 | xargs kill -9

# Or use different port for tests
export PORT=5001
npm test
```

#### 5. Coverage Below Threshold

**Error**: `Jest: Coverage for X (65%) does not meet threshold (70%)`

**Solution**:
- Write more tests for uncovered files
- Focus on files with lowest coverage
- Check coverage report: `open coverage/lcov-report/index.html`

#### 6. Test Data Conflicts

**Error**: `Unique constraint failed on the fields: (email)`

**Solution**:
```typescript
// Use random emails in tests
import { randomEmail } from '../helpers/testHelpers';

const testUser = await createTestUser(UserRole.USER, {
  email: randomEmail() // Generates unique email
});
```

### Debugging Tests

#### 1. Run Single Test

```bash
npx jest -t "should register a new user"
```

#### 2. Enable Verbose Output

```bash
npx jest --verbose
```

#### 3. Use console.log

```typescript
it('debug test', async () => {
  const response = await request(app).post('/api/auth/register').send(data);
  console.log('Response:', response.body); // View response
  expect(response.status).toBe(201);
});
```

#### 4. Use Node Debugger

```bash
node --inspect-brk node_modules/.bin/jest --runInBand
```

Then open Chrome DevTools: `chrome://inspect`

---

## Test Environment Variables

Test-specific environment variables are set in `src/__tests__/setup.ts`:

```typescript
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret';
process.env.DATABASE_URL = 'postgresql://creator_admin:admin_password@localhost:5432/creator_platform_test';
```

**Important**: Never use production credentials in tests.

---

## Adding New Tests

When adding new features, follow this checklist:

### For New API Endpoints

1. **Create integration test file** (e.g., `src/__tests__/integration/feature.test.ts`)
2. **Test success cases**:
   - Valid request returns expected response
   - Correct status code (200, 201, etc.)
   - Response structure matches API contract
3. **Test error cases**:
   - 401 Unauthorized (no token)
   - 403 Forbidden (wrong role)
   - 400 Bad Request (validation errors)
   - 404 Not Found (resource doesn't exist)
4. **Test edge cases**:
   - Empty strings
   - Very long inputs
   - Special characters
   - Null/undefined values

### For New Utilities

1. **Create unit test file** (e.g., `src/__tests__/unit/utility.test.ts`)
2. **Test pure functions**:
   - Valid inputs return expected outputs
   - Invalid inputs throw errors
   - Edge cases handled correctly
3. **Mock external dependencies**:
   - Database calls
   - API requests
   - File system operations

---

## Performance Testing

While not part of automated tests, consider manual performance testing:

### Load Testing with Apache Bench

```bash
# Test auth endpoint
ab -n 1000 -c 10 -p register.json -T application/json http://localhost:5000/api/auth/register

# register.json:
{
  "email": "loadtest@example.com",
  "password": "Test1234",
  "name": "Load Test User",
  "role": "USER"
}
```

### Monitor Response Times

```bash
# Add timing logs in tests
const start = Date.now();
await request(app).get('/api/endpoint');
const duration = Date.now() - start;
console.log(`Request took ${duration}ms`);
```

---

## Future Test Coverage Goals

**Current Coverage**: ~40% (auth endpoints + utilities)

**Phase 1** (Target: 60%):
- [ ] Chat endpoint tests
- [ ] Content endpoint tests
- [ ] Creator endpoint tests

**Phase 2** (Target: 70%):
- [ ] OpenAI utility tests (with mocks)
- [ ] Vector store tests
- [ ] Subscription endpoint tests

**Phase 3** (Target: 80%):
- [ ] Company endpoint tests
- [ ] Opportunity endpoint tests
- [ ] Admin endpoint tests
- [ ] Socket.io event tests

**Phase 4** (Target: 90%):
- [ ] E2E tests with Playwright/Cypress
- [ ] Performance benchmarks
- [ ] Security penetration tests

---

## Resources

- [Jest Documentation](https://jestjs.io/docs/getting-started)
- [Supertest Documentation](https://github.com/visionmedia/supertest)
- [Prisma Testing Guide](https://www.prisma.io/docs/guides/testing/unit-testing)
- [GitHub Actions Documentation](https://docs.github.com/en/actions)

---

## Questions or Issues?

If you encounter testing issues:
1. Check this documentation first
2. Review existing test files for examples
3. Check GitHub Actions logs for CI failures
4. Create an issue in the project repository

---

**Last Updated**: 2025-12-18
**Maintainer**: AI Creator Platform Team
