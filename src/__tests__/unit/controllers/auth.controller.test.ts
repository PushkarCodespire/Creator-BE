// ===========================================
// AUTH CONTROLLER UNIT TESTS
// ===========================================

jest.mock('../../../../prisma/client', () => ({
  __esModule: true,
  default: {
    user: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
    subscription: { create: jest.fn(), upsert: jest.fn() },
    creator: { create: jest.fn(), findUnique: jest.fn() },
    company: { create: jest.fn() }
  }
}));

jest.mock('../../../middleware/auth', () => ({
  generateToken: jest.fn().mockReturnValue('mock-token')
}));

jest.mock('../../../middleware/errorHandler', () => {
  class AppError extends Error {
    statusCode: number;
    constructor(message: string, statusCode: number) {
      super(message);
      this.statusCode = statusCode;
    }
  }
  return {
    AppError,
    asyncHandler: (fn: Function) => fn
  };
});

jest.mock('../../../utils/email', () => ({
  sendEmail: jest.fn().mockResolvedValue(undefined),
  welcomeEmail: jest.fn().mockReturnValue({ subject: '', html: '', text: '' }),
  passwordResetEmail: jest.fn().mockReturnValue({ subject: '', html: '', text: '' }),
  passwordChangedEmail: jest.fn().mockReturnValue({ subject: '', html: '', text: '' })
}));

jest.mock('../../../workers/emailWorker', () => ({
  EmailWorker: {
    sendWelcomeEmail: jest.fn().mockResolvedValue(undefined),
    sendVerificationEmail: jest.fn().mockResolvedValue(undefined)
  }
}));

jest.mock('../../../utils/logger', () => ({
  logError: jest.fn(),
  logDebug: jest.fn(),
  logInfo: jest.fn(),
  logWarning: jest.fn()
}));

jest.mock('bcryptjs', () => ({
  hash: jest.fn().mockResolvedValue('hashed-password'),
  compare: jest.fn()
}));

import { Request, Response } from 'express';
import prisma from '../../../../prisma/client';
import bcrypt from 'bcryptjs';
import { AppError } from '../../../middleware/errorHandler';

import {
  register,
  login,
  getCurrentUser,
  updateProfile,
  changePassword,
  verifyEmail,
  resendVerification,
  forgotPassword,
  resetPassword,
  becomeCreator
} from '../../../controllers/auth.controller';

const mockReq = (overrides = {}) =>
  ({
    body: {},
    params: {},
    query: {},
    user: { id: 'user-1', email: 'test@test.com', name: 'Test', role: 'USER' },
    ...overrides
  } as unknown as Request);

const mockRes = () => {
  const res = {} as Response;
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

describe('Auth Controller', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Re-establish mocks that must return Promises (reset by resetMocks: true in jest.config)
    const { EmailWorker } = require('../../../workers/emailWorker');
    (EmailWorker.sendWelcomeEmail as jest.Mock).mockResolvedValue(undefined);
    (EmailWorker.sendVerificationEmail as jest.Mock).mockResolvedValue(undefined);
    const { generateToken } = require('../../../middleware/auth');
    (generateToken as jest.Mock).mockReturnValue('mock-token');
    (bcrypt.hash as jest.Mock).mockResolvedValue('hashed-password');
    (bcrypt.compare as jest.Mock).mockResolvedValue(false);
    const { sendEmail } = require('../../../utils/email');
    (sendEmail as jest.Mock).mockResolvedValue(undefined);
    const { passwordResetEmail, passwordChangedEmail } = require('../../../utils/email');
    if (passwordResetEmail) (passwordResetEmail as jest.Mock).mockReturnValue({ subject: '', html: '', text: '' });
    if (passwordChangedEmail) (passwordChangedEmail as jest.Mock).mockReturnValue({ subject: '', html: '', text: '' });
  });

  // ===========================================
  // REGISTER
  // ===========================================
  describe('register', () => {
    it('should register a new user successfully', async () => {
      const req = mockReq({
        body: { email: 'new@test.com', password: 'pass1234', name: 'New User' }
      });
      const res = mockRes();

      (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.user.create as jest.Mock).mockResolvedValue({
        id: 'user-new',
        email: 'new@test.com',
        name: 'New User',
        role: 'USER',
        createdAt: new Date()
      });
      (prisma.subscription.create as jest.Mock).mockResolvedValue({});

      await register(req, res);

      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ success: true })
      );
      expect(prisma.user.create).toHaveBeenCalled();
    });

    it('should throw 400 when required fields are missing', async () => {
      const req = mockReq({ body: { email: 'a@b.com' } });
      const res = mockRes();

      await expect(register(req, res)).rejects.toThrow(AppError);
      await expect(register(req, res)).rejects.toThrow('Email, password, and name are required');
    });

    it('should throw 400 if user already exists', async () => {
      const req = mockReq({
        body: { email: 'existing@test.com', password: 'pass1234', name: 'Exists' }
      });
      const res = mockRes();

      (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 'existing' });

      await expect(register(req, res)).rejects.toThrow('User with this email already exists');
    });

    it('should create creator profile when role is CREATOR', async () => {
      const req = mockReq({
        body: { email: 'creator@test.com', password: 'pass1234', name: 'Creator', role: 'CREATOR' }
      });
      const res = mockRes();

      (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.user.create as jest.Mock).mockResolvedValue({
        id: 'user-c',
        email: 'creator@test.com',
        name: 'Creator',
        role: 'CREATOR',
        createdAt: new Date()
      });
      (prisma.creator.create as jest.Mock).mockResolvedValue({});

      await register(req, res);

      expect(prisma.creator.create).toHaveBeenCalled();
    });
  });

  // ===========================================
  // LOGIN
  // ===========================================
  describe('login', () => {
    it('should login successfully with valid credentials', async () => {
      const req = mockReq({
        body: { email: 'user@test.com', password: 'correctpass' }
      });
      const res = mockRes();

      (prisma.user.findUnique as jest.Mock).mockResolvedValue({
        id: 'user-1',
        email: 'user@test.com',
        password: 'hashed',
        name: 'User',
        role: 'USER',
        lastPasswordResetAt: null,
        creator: null,
        company: null,
        subscription: { plan: 'FREE', status: 'ACTIVE' }
      });
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      (prisma.user.update as jest.Mock).mockResolvedValue({});

      await login(req, res);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ success: true })
      );
    });

    it('should throw 400 when email/password missing', async () => {
      const req = mockReq({ body: { email: 'a@b.com' } });
      const res = mockRes();

      await expect(login(req, res)).rejects.toThrow('Email and password are required');
    });

    it('should throw 401 for invalid credentials', async () => {
      const req = mockReq({
        body: { email: 'user@test.com', password: 'wrong' }
      });
      const res = mockRes();

      (prisma.user.findUnique as jest.Mock).mockResolvedValue({
        id: 'user-1',
        email: 'user@test.com',
        password: 'hashed',
        name: 'User',
        role: 'USER',
        lastPasswordResetAt: new Date(),
        creator: null,
        company: null,
        subscription: null
      });
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      await expect(login(req, res)).rejects.toThrow('Invalid email or password');
    });

    it('should throw 401 when user not found', async () => {
      const req = mockReq({
        body: { email: 'noone@test.com', password: 'pass' }
      });
      const res = mockRes();

      (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(login(req, res)).rejects.toThrow('Invalid email or password');
    });
  });

  // ===========================================
  // GET CURRENT USER
  // ===========================================
  describe('getCurrentUser', () => {
    it('should return current user data', async () => {
      const req = mockReq();
      const res = mockRes();

      (prisma.user.findUnique as jest.Mock).mockResolvedValue({
        id: 'user-1',
        email: 'test@test.com',
        name: 'Test',
        role: 'USER',
        creator: null
      });

      await getCurrentUser(req, res);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ success: true })
      );
    });

    it('should throw 404 when user not found', async () => {
      const req = mockReq();
      const res = mockRes();

      (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(getCurrentUser(req, res)).rejects.toThrow('User not found');
    });
  });

  // ===========================================
  // UPDATE PROFILE
  // ===========================================
  describe('updateProfile', () => {
    it('should update user profile', async () => {
      const req = mockReq({ body: { name: 'Updated Name' } });
      const res = mockRes();

      (prisma.user.update as jest.Mock).mockResolvedValue({
        id: 'user-1',
        name: 'Updated Name',
        email: 'test@test.com',
        role: 'USER'
      });

      await updateProfile(req, res);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ success: true })
      );
    });
  });

  // ===========================================
  // CHANGE PASSWORD
  // ===========================================
  describe('changePassword', () => {
    it('should change password successfully', async () => {
      const req = mockReq({
        body: { currentPassword: 'old', newPassword: 'newpass123' }
      });
      const res = mockRes();

      (prisma.user.findUnique as jest.Mock).mockResolvedValue({
        id: 'user-1',
        email: 'test@test.com',
        password: 'hashed',
        lastPasswordResetAt: new Date()
      });
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      (prisma.user.update as jest.Mock).mockResolvedValue({});

      await changePassword(req, res);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ success: true, message: 'Password updated successfully' })
      );
    });

    it('should throw 400 when passwords missing', async () => {
      const req = mockReq({ body: {} });
      const res = mockRes();

      await expect(changePassword(req, res)).rejects.toThrow(
        'Current and new passwords are required'
      );
    });

    it('should throw 400 when current password is wrong', async () => {
      const req = mockReq({
        body: { currentPassword: 'wrong', newPassword: 'newpass123' }
      });
      const res = mockRes();

      (prisma.user.findUnique as jest.Mock).mockResolvedValue({
        id: 'user-1',
        email: 'test@test.com',
        password: 'hashed',
        lastPasswordResetAt: new Date()
      });
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      await expect(changePassword(req, res)).rejects.toThrow('Current password is incorrect');
    });
  });

  // ===========================================
  // VERIFY EMAIL
  // ===========================================
  describe('verifyEmail', () => {
    it('should verify email successfully', async () => {
      const req = mockReq({ body: { token: 'valid-token' } });
      const res = mockRes();

      (prisma.user.findUnique as jest.Mock).mockResolvedValue({
        id: 'user-1',
        isVerified: false,
        verificationExpiry: new Date(Date.now() + 100000)
      });
      (prisma.user.update as jest.Mock).mockResolvedValue({});

      await verifyEmail(req, res);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ success: true, message: 'Email verified successfully' })
      );
    });

    it('should throw 400 for invalid token format', async () => {
      const req = mockReq({ body: {} });
      const res = mockRes();

      await expect(verifyEmail(req, res)).rejects.toThrow('Invalid verification token');
    });

    it('should throw 400 for expired token', async () => {
      const req = mockReq({ body: { token: 'expired-token' } });
      const res = mockRes();

      (prisma.user.findUnique as jest.Mock).mockResolvedValue({
        id: 'user-1',
        isVerified: false,
        verificationExpiry: new Date(Date.now() - 100000)
      });

      await expect(verifyEmail(req, res)).rejects.toThrow('Verification token expired');
    });
  });

  // ===========================================
  // FORGOT PASSWORD
  // ===========================================
  describe('forgotPassword', () => {
    it('should send reset email for existing user', async () => {
      const req = mockReq({ body: { email: 'exists@test.com' } });
      const res = mockRes();

      (prisma.user.findUnique as jest.Mock).mockResolvedValue({
        id: 'user-1',
        email: 'exists@test.com',
        name: 'Exists'
      });
      (prisma.user.update as jest.Mock).mockResolvedValue({});

      await forgotPassword(req, res);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ success: true })
      );
    });

    it('should throw 400 when email missing', async () => {
      const req = mockReq({ body: {} });
      const res = mockRes();

      await expect(forgotPassword(req, res)).rejects.toThrow('Email is required');
    });

    it('should throw 404 when account does not exist for the given email', async () => {
      const req = mockReq({ body: { email: 'noone@test.com' } });
      const res = mockRes();

      (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(forgotPassword(req, res)).rejects.toThrow('No account found with this email address');
    });
  });

  // ===========================================
  // RESET PASSWORD
  // ===========================================
  describe('resetPassword', () => {
    it('should reset password with valid token', async () => {
      const req = mockReq({
        body: { token: 'reset-token', newPassword: 'newpass1234' }
      });
      const res = mockRes();

      (prisma.user.findUnique as jest.Mock).mockResolvedValue({
        id: 'user-1',
        email: 'test@test.com',
        name: 'Test',
        resetPasswordExpiry: new Date(Date.now() + 100000)
      });
      (prisma.user.update as jest.Mock).mockResolvedValue({});

      await resetPassword(req, res);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ success: true, message: 'Password reset successfully' })
      );
    });

    it('should throw 400 for missing token or password', async () => {
      const req = mockReq({ body: {} });
      const res = mockRes();

      await expect(resetPassword(req, res)).rejects.toThrow('Token and new password are required');
    });

    it('should throw 400 for short password', async () => {
      const req = mockReq({ body: { token: 'tok', newPassword: 'abc' } });
      const res = mockRes();

      await expect(resetPassword(req, res)).rejects.toThrow('Password must be at least 8 characters');
    });

    it('should throw 400 for invalid reset token', async () => {
      const req = mockReq({ body: { token: 'bad-token', newPassword: 'newpass1234' } });
      const res = mockRes();

      (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(resetPassword(req, res)).rejects.toThrow('Invalid or expired reset token');
    });
  });

  // ===========================================
  // BECOME CREATOR
  // ===========================================
  describe('becomeCreator', () => {
    it('should upgrade user to creator', async () => {
      const req = mockReq({ body: { about: 'My bio', expertise: 'Tech' } });
      const res = mockRes();

      (prisma.user.findUnique as jest.Mock).mockResolvedValue({
        id: 'user-1',
        name: 'Test',
        role: 'USER',
        creator: null
      });
      (prisma.user.update as jest.Mock).mockResolvedValue({
        id: 'user-1',
        email: 'test@test.com',
        name: 'Test',
        avatar: null,
        role: 'CREATOR'
      });
      (prisma.creator.create as jest.Mock).mockResolvedValue({
        id: 'creator-1',
        userId: 'user-1',
        displayName: 'Test'
      });
      (prisma.subscription as any).upsert = jest.fn().mockResolvedValue({});

      await becomeCreator(req, res);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ success: true })
      );
    });

    it('should throw 404 if user not found', async () => {
      const req = mockReq();
      const res = mockRes();

      (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(becomeCreator(req, res)).rejects.toThrow('User not found');
    });

    it('should throw 400 if already a creator', async () => {
      const req = mockReq();
      const res = mockRes();

      (prisma.user.findUnique as jest.Mock).mockResolvedValue({
        id: 'user-1',
        role: 'CREATOR',
        creator: { id: 'c-1' }
      });

      await expect(becomeCreator(req, res)).rejects.toThrow('Already a creator');
    });

    it('should use existing creator profile when user is already CREATOR role but has no profile', async () => {
      const req = mockReq({ body: { about: 'Bio', topics: 'Tech, Finance' } });
      const res = mockRes();

      (prisma.user.findUnique as jest.Mock).mockResolvedValue({
        id: 'user-1',
        name: 'Test',
        role: 'USER',
        creator: null
      });
      (prisma.user.update as jest.Mock).mockResolvedValue({
        id: 'user-1', email: 'test@test.com', name: 'Test', avatar: null, role: 'CREATOR'
      });
      (prisma.creator.create as jest.Mock).mockResolvedValue({
        id: 'creator-1', userId: 'user-1', displayName: 'Test',
        bio: 'Bio', tagline: 'Tech', category: 'Tech', tags: ['Tech', 'Finance']
      });
      (prisma.subscription.upsert as jest.Mock).mockResolvedValue({});

      await becomeCreator(req, res);

      expect(prisma.creator.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ userId: 'user-1', displayName: 'Test' })
        })
      );
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ success: true, data: expect.objectContaining({ token: 'mock-token' }) })
      );
    });

    it('should skip creator.create when user has an existing creator profile on USER role', async () => {
      const existingCreator = { id: 'c-existing', userId: 'user-1', displayName: 'Test' };
      const req = mockReq({ body: {} });
      const res = mockRes();

      // role is USER but creator profile already exists
      (prisma.user.findUnique as jest.Mock).mockResolvedValue({
        id: 'user-1', name: 'Test', role: 'USER', creator: existingCreator
      });
      (prisma.user.update as jest.Mock).mockResolvedValue({
        id: 'user-1', email: 'test@test.com', name: 'Test', avatar: null, role: 'CREATOR'
      });

      await becomeCreator(req, res);

      expect(prisma.creator.create).not.toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ success: true })
      );
    });
  });

  // ===========================================
  // REGISTER – additional branches
  // ===========================================
  describe('register – additional branches', () => {
    it('should create company profile when role is COMPANY', async () => {
      const req = mockReq({
        body: { email: 'co@company.com', password: 'pass1234', name: 'Acme', role: 'COMPANY' }
      });
      const res = mockRes();

      (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.user.create as jest.Mock).mockResolvedValue({
        id: 'user-co', email: 'co@company.com', name: 'Acme', role: 'COMPANY', createdAt: new Date()
      });
      (prisma.subscription.create as jest.Mock).mockResolvedValue({});
      (prisma.company.create as jest.Mock).mockResolvedValue({});

      await register(req, res);

      expect(prisma.company.create).toHaveBeenCalled();
      expect(prisma.creator.create).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(201);
    });

    it('should default to USER role when an unrecognised role is supplied', async () => {
      const req = mockReq({
        body: { email: 'u@example.com', password: 'pass1234', name: 'Plain', role: 'ADMIN' }
      });
      const res = mockRes();

      (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.user.create as jest.Mock).mockResolvedValue({
        id: 'user-plain', email: 'u@example.com', name: 'Plain', role: 'USER', createdAt: new Date()
      });
      (prisma.subscription.create as jest.Mock).mockResolvedValue({});

      await register(req, res);

      // role passed to create should be USER, not ADMIN
      expect(prisma.user.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ role: 'USER' }) })
      );
    });

    it('should include dateOfBirth and location when supplied', async () => {
      const req = mockReq({
        body: {
          email: 'dob@test.com', password: 'pass1234', name: 'DOBUser',
          dateOfBirth: '1990-05-15', location: 'London'
        }
      });
      const res = mockRes();

      (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.user.create as jest.Mock).mockResolvedValue({
        id: 'user-dob', email: 'dob@test.com', name: 'DOBUser', role: 'USER', createdAt: new Date()
      });
      (prisma.subscription.create as jest.Mock).mockResolvedValue({});

      await register(req, res);

      expect(prisma.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ location: 'London' })
        })
      );
    });

    it('should create a subscription for every registration', async () => {
      const req = mockReq({
        body: { email: 'sub@test.com', password: 'pass', name: 'Sub' }
      });
      const res = mockRes();

      (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.user.create as jest.Mock).mockResolvedValue({
        id: 'user-sub', email: 'sub@test.com', name: 'Sub', role: 'USER', createdAt: new Date()
      });
      (prisma.subscription.create as jest.Mock).mockResolvedValue({});

      await register(req, res);

      expect(prisma.subscription.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ plan: 'FREE', status: 'ACTIVE' }) })
      );
    });

    it('should hash the password before storing it', async () => {
      const req = mockReq({
        body: { email: 'hash@test.com', password: 'plain-pass', name: 'HashUser' }
      });
      const res = mockRes();

      (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.user.create as jest.Mock).mockResolvedValue({
        id: 'user-h', email: 'hash@test.com', name: 'HashUser', role: 'USER', createdAt: new Date()
      });
      (prisma.subscription.create as jest.Mock).mockResolvedValue({});

      await register(req, res);

      expect(bcrypt.hash).toHaveBeenCalledWith('plain-pass', 12);
      expect(prisma.user.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ password: 'hashed-password' }) })
      );
    });

    it('should respond with user and token in data envelope', async () => {
      const req = mockReq({
        body: { email: 'envelope@test.com', password: 'pass1234', name: 'Envelope' }
      });
      const res = mockRes();

      (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.user.create as jest.Mock).mockResolvedValue({
        id: 'user-e', email: 'envelope@test.com', name: 'Envelope', role: 'USER', createdAt: new Date()
      });
      (prisma.subscription.create as jest.Mock).mockResolvedValue({});

      await register(req, res);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: expect.objectContaining({ user: expect.any(Object), token: 'mock-token' })
        })
      );
    });
  });

  // ===========================================
  // LOGIN – additional branches
  // ===========================================
  describe('login – additional branches', () => {
    it('should include isProfileComplete=false for creator missing bio and category', async () => {
      const req = mockReq({ body: { email: 'creator@test.com', password: 'pass' } });
      const res = mockRes();

      (prisma.user.findUnique as jest.Mock)
        .mockResolvedValueOnce({
          id: 'user-c', email: 'creator@test.com', password: 'hashed',
          name: 'Creator', role: 'CREATOR', lastPasswordResetAt: new Date(),
          creator: { id: 'c-1', displayName: 'Creator', isVerified: false, isRejected: false, rejectionReason: null },
          company: null, subscription: null
        })
        .mockResolvedValueOnce({ bio: null, category: null, profileImage: null }); // creator profile lookup

      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      (prisma.creator.findUnique as jest.Mock).mockResolvedValue({ bio: null, category: null, profileImage: null });
      (prisma.user.update as jest.Mock).mockResolvedValue({});

      await login(req, res);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ isProfileComplete: false }) })
      );
    });

    it('should include isProfileComplete=true for creator with bio set', async () => {
      const req = mockReq({ body: { email: 'fullcreator@test.com', password: 'pass' } });
      const res = mockRes();

      (prisma.user.findUnique as jest.Mock).mockResolvedValueOnce({
        id: 'user-fc', email: 'fullcreator@test.com', password: 'hashed',
        name: 'Full Creator', role: 'CREATOR', lastPasswordResetAt: new Date(),
        creator: { id: 'c-2', displayName: 'Full Creator', isVerified: true, isRejected: false, rejectionReason: null },
        company: null, subscription: null
      });
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      (prisma.creator.findUnique as jest.Mock).mockResolvedValue({ bio: 'My bio', category: 'Tech', profileImage: null });
      (prisma.user.update as jest.Mock).mockResolvedValue({});

      await login(req, res);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ isProfileComplete: true }) })
      );
    });

    it('should map creator.isRejected to rejected boolean on login response', async () => {
      const req = mockReq({ body: { email: 'rejected@test.com', password: 'pass' } });
      const res = mockRes();

      (prisma.user.findUnique as jest.Mock).mockResolvedValueOnce({
        id: 'user-rej', email: 'rejected@test.com', password: 'hashed',
        name: 'Rejected', role: 'CREATOR', lastPasswordResetAt: new Date(),
        creator: { id: 'c-r', displayName: 'Rejected', isVerified: false, isRejected: true, rejectionReason: 'Policy violation' },
        company: null, subscription: null
      });
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      (prisma.creator.findUnique as jest.Mock).mockResolvedValue({ bio: null, category: null, profileImage: null });
      (prisma.user.update as jest.Mock).mockResolvedValue({});

      await login(req, res);

      const callArg = (res.json as jest.Mock).mock.calls[0][0];
      expect(callArg.data.user.creator.rejected).toBe(true);
      expect(callArg.data.user.creator.rejectionReason).toBe('Policy violation');
    });

    it('should not include password in login response', async () => {
      const req = mockReq({ body: { email: 'user@test.com', password: 'pass' } });
      const res = mockRes();

      (prisma.user.findUnique as jest.Mock).mockResolvedValueOnce({
        id: 'user-1', email: 'user@test.com', password: 'super-secret-hash',
        name: 'User', role: 'USER', lastPasswordResetAt: new Date(),
        creator: null, company: null, subscription: null
      });
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      (prisma.user.update as jest.Mock).mockResolvedValue({});

      await login(req, res);

      const callArg = (res.json as jest.Mock).mock.calls[0][0];
      expect(callArg.data.user.password).toBeUndefined();
    });
  });

  // ===========================================
  // GET CURRENT USER – additional branches
  // ===========================================
  describe('getCurrentUser – additional branches', () => {
    it('should map creator rejection fields in getCurrentUser response', async () => {
      const req = mockReq();
      const res = mockRes();

      (prisma.user.findUnique as jest.Mock).mockResolvedValue({
        id: 'user-1', email: 'test@test.com', name: 'Test', role: 'CREATOR',
        creator: { id: 'c-1', displayName: 'Test', isRejected: true, rejectionReason: 'Spam' }
      });

      await getCurrentUser(req, res);

      const callArg = (res.json as jest.Mock).mock.calls[0][0];
      expect(callArg.data.creator.rejected).toBe(true);
      expect(callArg.data.creator.rejectionReason).toBe('Spam');
    });

    it('should return user without creator mapping for non-creator user', async () => {
      const req = mockReq();
      const res = mockRes();

      (prisma.user.findUnique as jest.Mock).mockResolvedValue({
        id: 'user-1', email: 'test@test.com', name: 'Test', role: 'USER', creator: null
      });

      await getCurrentUser(req, res);

      const callArg = (res.json as jest.Mock).mock.calls[0][0];
      expect(callArg.success).toBe(true);
      expect(callArg.data.creator).toBeNull();
    });
  });

  // ===========================================
  // CHANGE PASSWORD – additional branches
  // ===========================================
  describe('changePassword – additional branches', () => {
    it('should throw 400 when user has no password (OAuth user)', async () => {
      const req = mockReq({ body: { currentPassword: 'old', newPassword: 'newpass123' } });
      const res = mockRes();

      (prisma.user.findUnique as jest.Mock).mockResolvedValue({
        id: 'user-1', email: 'oauth@test.com', password: null, lastPasswordResetAt: null
      });

      await expect(changePassword(req, res)).rejects.toThrow('Cannot change password for OAuth users');
    });

    it('should throw 400 when user record does not exist', async () => {
      const req = mockReq({ body: { currentPassword: 'old', newPassword: 'newpass123' } });
      const res = mockRes();

      (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(changePassword(req, res)).rejects.toThrow('Cannot change password for OAuth users');
    });

    it('should hash the new password before saving', async () => {
      const req = mockReq({ body: { currentPassword: 'old', newPassword: 'brand-new-pass' } });
      const res = mockRes();

      (prisma.user.findUnique as jest.Mock).mockResolvedValue({
        id: 'user-1', email: 'test@test.com', password: 'hashed', lastPasswordResetAt: new Date()
      });
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      (prisma.user.update as jest.Mock).mockResolvedValue({});

      await changePassword(req, res);

      expect(bcrypt.hash).toHaveBeenCalledWith('brand-new-pass', 12);
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ password: 'hashed-password' }) })
      );
    });
  });

  // ===========================================
  // VERIFY EMAIL – additional branches
  // ===========================================
  describe('verifyEmail – additional branches', () => {
    it('should return success immediately when email is already verified', async () => {
      const req = mockReq({ body: { token: 'some-token' } });
      const res = mockRes();

      (prisma.user.findUnique as jest.Mock).mockResolvedValue({
        id: 'user-1', isVerified: true, verificationExpiry: null
      });

      await verifyEmail(req, res);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ success: true, message: 'Email already verified' })
      );
      // Should not call update if already verified
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('should throw 400 when token is not found in DB', async () => {
      const req = mockReq({ body: { token: 'nonexistent-token' } });
      const res = mockRes();

      (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(verifyEmail(req, res)).rejects.toThrow('Invalid or expired verification token');
    });

    it('should generate a JWT and return it after successful verification', async () => {
      const req = mockReq({ body: { token: 'good-token' } });
      const res = mockRes();

      (prisma.user.findUnique as jest.Mock).mockResolvedValue({
        id: 'user-1', isVerified: false, verificationExpiry: new Date(Date.now() + 100000)
      });
      (prisma.user.update as jest.Mock).mockResolvedValue({
        id: 'user-1', email: 'test@test.com', name: 'Test', role: 'USER', createdAt: new Date()
      });

      await verifyEmail(req, res);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ verified: true, token: 'mock-token' })
        })
      );
    });
  });

  // ===========================================
  // RESEND VERIFICATION
  // ===========================================
  describe('resendVerification', () => {
    it('should send verification email to unverified user', async () => {
      const req = mockReq();
      const res = mockRes();
      const { EmailWorker } = require('../../../workers/emailWorker');

      (prisma.user.findUnique as jest.Mock).mockResolvedValue({
        id: 'user-1', email: 'unverified@test.com', name: 'Unverified', isVerified: false
      });
      (prisma.user.update as jest.Mock).mockResolvedValue({});
      (EmailWorker.sendVerificationEmail as jest.Mock).mockResolvedValue(undefined);

      await resendVerification(req, res);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ success: true, message: 'Verification email sent' })
      );
    });

    it('should throw 404 when user not found', async () => {
      const req = mockReq();
      const res = mockRes();

      (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(resendVerification(req, res)).rejects.toThrow('User not found');
    });

    it('should throw 400 when email already verified', async () => {
      const req = mockReq();
      const res = mockRes();

      (prisma.user.findUnique as jest.Mock).mockResolvedValue({
        id: 'user-1', email: 'verified@test.com', name: 'Verified', isVerified: true
      });

      await expect(resendVerification(req, res)).rejects.toThrow('Email already verified');
    });

    it('should throw 500 when sending email fails', async () => {
      const req = mockReq();
      const res = mockRes();
      const { EmailWorker } = require('../../../workers/emailWorker');

      (prisma.user.findUnique as jest.Mock).mockResolvedValue({
        id: 'user-1', email: 'fail@test.com', name: 'Fail', isVerified: false
      });
      (prisma.user.update as jest.Mock).mockResolvedValue({});
      (EmailWorker.sendVerificationEmail as jest.Mock).mockRejectedValue(new Error('SMTP error'));

      await expect(resendVerification(req, res)).rejects.toThrow('Failed to send verification email');
    });
  });

  // ===========================================
  // FORGOT PASSWORD – additional branches
  // ===========================================
  describe('forgotPassword – additional branches', () => {
    it('should throw 404 when no account found for email', async () => {
      const req = mockReq({ body: { email: 'ghost@test.com' } });
      const res = mockRes();

      (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(forgotPassword(req, res)).rejects.toThrow('No account found with this email address');
    });

    it('should save resetPasswordToken to DB', async () => {
      const req = mockReq({ body: { email: 'save@test.com' } });
      const res = mockRes();

      (prisma.user.findUnique as jest.Mock).mockResolvedValue({
        id: 'user-save', email: 'save@test.com', name: 'Save'
      });
      (prisma.user.update as jest.Mock).mockResolvedValue({});

      await forgotPassword(req, res);

      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ resetPasswordToken: expect.any(String) })
        })
      );
    });
  });

  // ===========================================
  // RESET PASSWORD – additional branches
  // ===========================================
  describe('resetPassword – additional branches', () => {
    it('should throw 400 for expired reset token', async () => {
      const req = mockReq({ body: { token: 'expired', newPassword: 'newpass1234' } });
      const res = mockRes();

      (prisma.user.findUnique as jest.Mock).mockResolvedValue({
        id: 'user-1',
        email: 'test@test.com',
        name: 'Test',
        resetPasswordExpiry: new Date(Date.now() - 10000) // expired
      });

      await expect(resetPassword(req, res)).rejects.toThrow('Reset token expired');
    });

    it('should update lastPasswordResetAt after reset', async () => {
      const req = mockReq({ body: { token: 'valid-tok', newPassword: 'newpass1234' } });
      const res = mockRes();

      (prisma.user.findUnique as jest.Mock).mockResolvedValue({
        id: 'user-1', email: 'test@test.com', name: 'Test',
        resetPasswordExpiry: new Date(Date.now() + 100000)
      });
      (prisma.user.update as jest.Mock).mockResolvedValue({});

      await resetPassword(req, res);

      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            resetPasswordToken: null,
            resetPasswordExpiry: null,
            lastPasswordResetAt: expect.any(Date)
          })
        })
      );
    });
  });
});
