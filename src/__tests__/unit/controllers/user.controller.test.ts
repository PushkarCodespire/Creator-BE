// ===========================================
// USER CONTROLLER UNIT TESTS
// ===========================================

jest.mock('../../../../prisma/client', () => ({
  __esModule: true,
  default: {
    user: { findUnique: jest.fn(), update: jest.fn() }
  }
}));

jest.mock('../../../middleware/errorHandler', () => {
  class AppError extends Error {
    statusCode: number;
    constructor(message: string, statusCode: number) {
      super(message);
      this.statusCode = statusCode;
    }
  }
  return { AppError, asyncHandler: (fn: Function) => fn };
});

import { Request, Response } from 'express';
import prisma from '../../../../prisma/client';
import { AppError } from '../../../middleware/errorHandler';
import {
  getUserProfile,
  updateUserInterests,
  getUserInterests,
  getAvailableCategories,
  updateUserProfile
} from '../../../controllers/user.controller';

const mockReq = (overrides = {}) =>
  ({ body: {}, params: {}, query: {}, user: { id: 'user-1', role: 'USER' }, ...overrides } as unknown as Request);

const mockRes = () => {
  const res = {} as Response;
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

describe('User Controller', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('getUserProfile', () => {
    it('should return user profile', async () => {
      const req = mockReq();
      const res = mockRes();

      (prisma.user.findUnique as jest.Mock).mockResolvedValue({
        id: 'user-1', email: 'u@t.com', name: 'User', role: 'USER'
      });

      await getUserProfile(req, res);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    });

    it('should throw 401 when not authenticated', async () => {
      const req = mockReq({ user: undefined });
      const res = mockRes();

      await expect(getUserProfile(req, res)).rejects.toThrow('Authentication required');
    });

    it('should throw 404 when user not found', async () => {
      const req = mockReq();
      const res = mockRes();

      (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(getUserProfile(req, res)).rejects.toThrow('User not found');
    });
  });

  describe('updateUserInterests', () => {
    it('should update interests successfully', async () => {
      const req = mockReq({ body: { interests: ['Tech', 'Fitness'] } });
      const res = mockRes();

      (prisma.user.update as jest.Mock).mockResolvedValue({ id: 'user-1', interests: ['Tech', 'Fitness'] });

      await updateUserInterests(req, res);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    });

    it('should throw 401 when not authenticated', async () => {
      const req = mockReq({ user: undefined, body: { interests: ['Tech'] } });
      const res = mockRes();

      await expect(updateUserInterests(req, res)).rejects.toThrow('Authentication required');
    });

    it('should throw 400 when interests is not an array', async () => {
      const req = mockReq({ body: { interests: 'Tech' } });
      const res = mockRes();

      await expect(updateUserInterests(req, res)).rejects.toThrow('Interests must be an array');
    });

    it('should throw 400 for invalid categories', async () => {
      const req = mockReq({ body: { interests: ['InvalidCategory'] } });
      const res = mockRes();

      await expect(updateUserInterests(req, res)).rejects.toThrow('Invalid interests');
    });
  });

  describe('getUserInterests', () => {
    it('should return user interests', async () => {
      const req = mockReq();
      const res = mockRes();

      (prisma.user.findUnique as jest.Mock).mockResolvedValue({ interests: ['Tech'] });

      await getUserInterests(req, res);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ success: true, data: { interests: ['Tech'] } })
      );
    });

    it('should throw 404 when user not found', async () => {
      const req = mockReq();
      const res = mockRes();

      (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(getUserInterests(req, res)).rejects.toThrow('User not found');
    });
  });

  describe('getAvailableCategories', () => {
    it('should return categories list', async () => {
      const req = mockReq();
      const res = mockRes();

      await getAvailableCategories(req, res);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ success: true, data: { categories: expect.any(Array) } })
      );
    });
  });

  describe('updateUserProfile', () => {
    it('should update profile name', async () => {
      const req = mockReq({ body: { name: 'New Name' } });
      const res = mockRes();

      (prisma.user.update as jest.Mock).mockResolvedValue({ id: 'user-1', name: 'New Name' });

      await updateUserProfile(req, res);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    });

    it('should throw 401 when not authenticated', async () => {
      const req = mockReq({ user: undefined, body: { name: 'X' } });
      const res = mockRes();

      await expect(updateUserProfile(req, res)).rejects.toThrow('Authentication required');
    });
  });

  // ===========================================
  // GET USER PROFILE – additional branches
  // ===========================================
  describe('getUserProfile – additional branches', () => {
    it('should return creator sub-fields when user is a creator', async () => {
      const req = mockReq({ user: { id: 'user-c', role: 'CREATOR' } });
      const res = mockRes();

      (prisma.user.findUnique as jest.Mock).mockResolvedValue({
        id: 'user-c', email: 'creator@test.com', name: 'Creator', role: 'CREATOR',
        avatar: null, interests: [],
        creator: { id: 'c-1', displayName: 'Creator', profileImage: null, isVerified: true },
        createdAt: new Date()
      });

      await getUserProfile(req, res);

      const callArg = (res.json as jest.Mock).mock.calls[0][0];
      expect(callArg.data.creator).toBeDefined();
      expect(callArg.data.creator.id).toBe('c-1');
    });

    it('should return null creator when user is a plain USER', async () => {
      const req = mockReq();
      const res = mockRes();

      (prisma.user.findUnique as jest.Mock).mockResolvedValue({
        id: 'user-1', email: 'u@t.com', name: 'User', role: 'USER',
        avatar: null, interests: ['Tech'], creator: null, createdAt: new Date()
      });

      await getUserProfile(req, res);

      const callArg = (res.json as jest.Mock).mock.calls[0][0];
      expect(callArg.data.creator).toBeNull();
    });

    it('should query prisma with the authenticated user id', async () => {
      const req = mockReq({ user: { id: 'specific-user', role: 'USER' } });
      const res = mockRes();

      (prisma.user.findUnique as jest.Mock).mockResolvedValue({
        id: 'specific-user', email: 'x@t.com', name: 'X', role: 'USER', creator: null, createdAt: new Date()
      });

      await getUserProfile(req, res);

      expect(prisma.user.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'specific-user' } })
      );
    });
  });

  // ===========================================
  // UPDATE USER INTERESTS – additional branches
  // ===========================================
  describe('updateUserInterests – additional branches', () => {
    it('should throw 400 when interests body key is missing entirely', async () => {
      const req = mockReq({ body: {} });
      const res = mockRes();

      await expect(updateUserInterests(req, res)).rejects.toThrow('Interests must be an array');
    });

    it('should accept an empty array and persist it', async () => {
      const req = mockReq({ body: { interests: [] } });
      const res = mockRes();

      (prisma.user.update as jest.Mock).mockResolvedValue({ id: 'user-1', interests: [] });

      await updateUserInterests(req, res);

      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { interests: [] } })
      );
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ success: true, message: 'Interests updated successfully' })
      );
    });

    it('should pass all valid categories without throwing', async () => {
      const allValid = ['Fitness', 'Tech', 'Business', 'Lifestyle'];
      const req = mockReq({ body: { interests: allValid } });
      const res = mockRes();

      (prisma.user.update as jest.Mock).mockResolvedValue({ id: 'user-1', interests: allValid });

      await updateUserInterests(req, res);

      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    });

    it('should include each invalid interest name in the error message', async () => {
      const req = mockReq({ body: { interests: ['Tech', 'BadOne', 'AlsoBad'] } });
      const res = mockRes();

      await expect(updateUserInterests(req, res)).rejects.toThrow('BadOne');
    });
  });

  // ===========================================
  // GET USER INTERESTS – additional branches
  // ===========================================
  describe('getUserInterests – additional branches', () => {
    it('should return empty array when interests field is null', async () => {
      const req = mockReq();
      const res = mockRes();

      (prisma.user.findUnique as jest.Mock).mockResolvedValue({ interests: null });

      await getUserInterests(req, res);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ data: { interests: [] } })
      );
    });

    it('should throw 401 when not authenticated', async () => {
      const req = mockReq({ user: undefined });
      const res = mockRes();

      await expect(getUserInterests(req, res)).rejects.toThrow('Authentication required');
    });
  });

  // ===========================================
  // GET AVAILABLE CATEGORIES – additional branches
  // ===========================================
  describe('getAvailableCategories – additional branches', () => {
    it('should return 16 categories', async () => {
      const req = mockReq();
      const res = mockRes();

      await getAvailableCategories(req, res);

      const callArg = (res.json as jest.Mock).mock.calls[0][0];
      expect(callArg.data.categories).toHaveLength(16);
    });

    it('each category should have value, label and icon fields', async () => {
      const req = mockReq();
      const res = mockRes();

      await getAvailableCategories(req, res);

      const callArg = (res.json as jest.Mock).mock.calls[0][0];
      for (const cat of callArg.data.categories) {
        expect(cat).toHaveProperty('value');
        expect(cat).toHaveProperty('label');
        expect(cat).toHaveProperty('icon');
      }
    });
  });

  // ===========================================
  // UPDATE USER PROFILE – additional branches
  // ===========================================
  describe('updateUserProfile – additional branches', () => {
    it('should update avatar when only avatar is provided', async () => {
      const req = mockReq({ body: { avatar: 'https://example.com/pic.png' } });
      const res = mockRes();

      (prisma.user.update as jest.Mock).mockResolvedValue({
        id: 'user-1', email: 'u@t.com', name: 'User', avatar: 'https://example.com/pic.png', interests: []
      });

      await updateUserProfile(req, res);

      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { avatar: 'https://example.com/pic.png' } })
      );
    });

    it('should update both name and avatar when both are provided', async () => {
      const req = mockReq({ body: { name: 'New Name', avatar: 'https://img.com/a.png' } });
      const res = mockRes();

      (prisma.user.update as jest.Mock).mockResolvedValue({
        id: 'user-1', email: 'u@t.com', name: 'New Name', avatar: 'https://img.com/a.png', interests: []
      });

      await updateUserProfile(req, res);

      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { name: 'New Name', avatar: 'https://img.com/a.png' } })
      );
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ success: true, message: 'Profile updated successfully' })
      );
    });

    it('should skip name from update data when name is falsy', async () => {
      const req = mockReq({ body: { avatar: 'https://img.com/b.png' } });
      const res = mockRes();

      (prisma.user.update as jest.Mock).mockResolvedValue({
        id: 'user-1', email: 'u@t.com', name: 'Existing', avatar: 'https://img.com/b.png', interests: []
      });

      await updateUserProfile(req, res);

      const updateCall = (prisma.user.update as jest.Mock).mock.calls[0][0];
      expect(updateCall.data).not.toHaveProperty('name');
    });
  });
});
