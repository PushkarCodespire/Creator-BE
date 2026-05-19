// ===========================================
// TEST HELPERS
// ===========================================
// Utility functions for testing

import { generateToken } from '../../middleware/auth';
import { UserRole } from '@prisma/client';
import prisma from '../../../prisma/client';
import bcrypt from 'bcryptjs';

// ===========================================
// USER HELPERS
// ===========================================

export interface TestUser {
  id: string;
  email: string;
  password: string;
  name: string;
  role: UserRole;
  token: string;
}

/**
 * Create a test user with authentication
 */
export async function createTestUser(
  role: UserRole = UserRole.USER,
  overrides: Partial<TestUser> = {}
): Promise<TestUser> {
  const timestamp = Date.now();
  const email = overrides.email || `test-${role.toLowerCase()}-${timestamp}@test.com`;
  const password = overrides.password || 'Test1234';
  const name = overrides.name || `Test ${role}`;

  const hashedPassword = await bcrypt.hash(password, 10);

  const user = await prisma.user.create({
    data: {
      email,
      password: hashedPassword,
      name,
      role,
    },
  });

  // Create subscription for users
  if (role === UserRole.USER) {
    await prisma.subscription.create({
      data: {
        userId: user.id,
        plan: 'FREE',
        status: 'ACTIVE',
      },
    });
  }

  // Create creator profile for creators
  if (role === UserRole.CREATOR) {
    await prisma.creator.create({
      data: {
        userId: user.id,
        displayName: name,
        isVerified: false,
      },
    });
  }

  // Create company profile for companies
  if (role === UserRole.COMPANY) {
    await prisma.company.create({
      data: {
        userId: user.id,
        companyName: `${name} Company`,
      },
    });
  }

  const token = generateToken(user);

  return {
    id: user.id,
    email: user.email,
    password, // Return plain password for login tests
    name: user.name,
    role: user.role,
    token,
  };
}

/**
 * Create multiple test users at once
 */
export async function createTestUsers() {
  const [user, creator, company, admin] = await Promise.all([
    createTestUser(UserRole.USER),
    createTestUser(UserRole.CREATOR),
    createTestUser(UserRole.COMPANY),
    createTestUser(UserRole.ADMIN),
  ]);

  return { user, creator, company, admin };
}

/**
 * Delete test user and related data
 */
export async function deleteTestUser(userId: string) {
  await prisma.user.delete({
    where: { id: userId },
  });
}

// ===========================================
// CREATOR HELPERS
// ===========================================

/**
 * Create a test creator with content
 */
export async function createTestCreator(withContent = false) {
  const testUser = await createTestUser(UserRole.CREATOR);

  const creator = await prisma.creator.findUnique({
    where: { userId: testUser.id },
  });

  if (!creator) {
    throw new Error('Creator not found');
  }

  if (withContent) {
    await prisma.creatorContent.create({
      data: {
        creatorId: creator.id,
        title: 'Test Content',
        type: 'MANUAL_TEXT',
        rawText: 'This is test content for the creator',
        status: 'COMPLETED',
      },
    });
  }

  return { ...testUser, creatorId: creator.id };
}

// ===========================================
// CONVERSATION HELPERS
// ===========================================

/**
 * Create a test conversation
 */
export async function createTestConversation(userId: string, creatorId: string) {
  return await prisma.conversation.create({
    data: {
      userId,
      creatorId,
      isActive: true,
    },
  });
}

/**
 * Create a test message
 */
export async function createTestMessage(
  conversationId: string,
  userId: string,
  content: string,
  role: 'USER' | 'ASSISTANT' = 'USER'
) {
  return await prisma.message.create({
    data: {
      conversationId,
      userId,
      content,
      role,
    },
  });
}

// ===========================================
// CLEANUP HELPERS
// ===========================================

/**
 * Clean up test database
 */
export async function cleanupTestData() {
  // Delete in reverse order of dependencies
  // Social & engagement models
  await prisma.comment.deleteMany({}).catch(() => {});
  await prisma.bookmark.deleteMany({}).catch(() => {});
  await prisma.like.deleteMany({}).catch(() => {});
  await prisma.post.deleteMany({}).catch(() => {});
  await prisma.follow.deleteMany({}).catch(() => {});
  await prisma.creatorReview.deleteMany({}).catch(() => {});
  await prisma.messageBookmark.deleteMany({}).catch(() => {});
  await prisma.notificationSettings.deleteMany({}).catch(() => {});
  await prisma.notification.deleteMany({}).catch(() => {});

  // Booking models
  await prisma.bookingRequest.deleteMany({}).catch(() => {});
  await prisma.bookingSlot.deleteMany({}).catch(() => {});

  // Chat & content models
  await prisma.message.deleteMany({});
  await prisma.conversation.deleteMany({});
  await prisma.contentChunk.deleteMany({});
  await prisma.creatorContent.deleteMany({});

  // Financial models
  await prisma.transaction.deleteMany({});
  await prisma.subscription.deleteMany({});
  await prisma.deal.deleteMany({});
  await prisma.application.deleteMany({});
  await prisma.opportunity.deleteMany({});

  // Core models
  await prisma.creator.deleteMany({});
  await prisma.company.deleteMany({});
  await prisma.user.deleteMany({});
}

// ===========================================
// API HELPERS
// ===========================================

/**
 * Get authorization header with token
 */
export function authHeader(token: string) {
  return { Authorization: `Bearer ${token}` };
}

/**
 * Generate random email
 */
export function randomEmail() {
  return `test-${Date.now()}-${Math.random().toString(36).substring(7)}@test.com`;
}

/**
 * Generate random string
 */
export function randomString(length = 10) {
  return Math.random().toString(36).substring(2, length + 2);
}
