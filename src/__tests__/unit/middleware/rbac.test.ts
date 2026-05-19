// ===========================================
// RBAC MIDDLEWARE UNIT TESTS
// ===========================================

import { Request, Response, NextFunction } from 'express';
import { UserRole } from '@prisma/client';

jest.mock('../../../../prisma/client', () => ({
  __esModule: true,
  default: {
    user: { findUnique: jest.fn() },
    creatorContent: { findUnique: jest.fn() },
    opportunity: { findUnique: jest.fn() }
  }
}));
jest.mock('../../../utils/jwt', () => ({
  verifyAccessToken: jest.fn(),
  generateAccessToken: jest.fn(),
  generateRefreshToken: jest.fn(),
  generateTokenPair: jest.fn(),
  verifyRefreshToken: jest.fn(),
  isValidRefreshToken: jest.fn(),
  revokeRefreshToken: jest.fn(),
  generateSessionId: jest.fn(),
  generateDeviceId: jest.fn(),
  createSession: jest.fn(),
  validateSession: jest.fn(),
  destroySession: jest.fn(),
  getUserActiveSessions: jest.fn(),
  terminateAllUserSessions: jest.fn(),
  validatePassword: jest.fn()
}));

import {
  hasPermission,
  canAccessResource,
  authenticate,
  authorize,
  requirePermission,
  requireResourceAccess,
  getUserPermissions,
  getUserRoleHierarchy
} from '../../../middleware/rbac';
import prisma from '../../../../prisma/client';
import { verifyAccessToken } from '../../../utils/jwt';

const createMockReq = (overrides: Partial<Request> = {}): Request => ({
  headers: {},
  body: {},
  query: {},
  params: {},
  ...overrides
} as unknown as Request);

const createMockRes = (): Response => {
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis()
  } as unknown as Response;
  return res;
};

describe('RBAC Middleware', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ===========================================
  // hasPermission
  // ===========================================
  describe('hasPermission', () => {
    it('should return true for direct permission', () => {
      expect(hasPermission(UserRole.ADMIN, 'user.read')).toBe(true);
      expect(hasPermission(UserRole.CREATOR, 'content.write')).toBe(true);
    });

    it('should return true for inherited permission', () => {
      // ADMIN inherits from CREATOR, which has 'content.write'
      expect(hasPermission(UserRole.ADMIN, 'profile.read')).toBe(true);
    });

    it('should return false for missing permission', () => {
      expect(hasPermission(UserRole.USER, 'admin.write')).toBe(false);
      expect(hasPermission(UserRole.USER, 'content.delete')).toBe(false);
    });

    it('should return true for USER having profile.read', () => {
      expect(hasPermission(UserRole.USER, 'profile.read')).toBe(true);
    });

    it('should return true for COMPANY having opportunity.write', () => {
      expect(hasPermission(UserRole.COMPANY, 'opportunity.write')).toBe(true);
    });
  });

  // ===========================================
  // canAccessResource
  // ===========================================
  describe('canAccessResource', () => {
    it('should allow admin to access any resource without condition', () => {
      const req = createMockReq();
      req.user = { id: 'admin-1', email: 'a@a.com', name: 'Admin', role: UserRole.ADMIN };

      expect(canAccessResource(UserRole.ADMIN, 'content', 'write', req)).toBe(true);
    });

    it('should allow resource owner access with condition', () => {
      const req = createMockReq();
      req.user = { id: 'user-1', email: 'u@u.com', name: 'User', role: UserRole.CREATOR };

      // Creator's profile write has condition: req.user.id === owner
      expect(canAccessResource(UserRole.CREATOR, 'profile', 'write', req, 'user-1')).toBe(true);
    });

    it('should deny non-owner access with condition', () => {
      const req = createMockReq();
      req.user = { id: 'user-1', email: 'u@u.com', name: 'User', role: UserRole.CREATOR };

      expect(canAccessResource(UserRole.CREATOR, 'profile', 'write', req, 'other-user')).toBe(false);
    });

    it('should return false for non-existent resource/action', () => {
      const req = createMockReq();
      req.user = { id: 'user-1', email: 'u@u.com', name: 'User', role: UserRole.USER };

      expect(canAccessResource(UserRole.USER, 'admin', 'delete', req)).toBe(false);
    });
  });

  // ===========================================
  // authenticate (RBAC version)
  // ===========================================
  describe('authenticate', () => {
    it('should authenticate with valid token', async () => {
      const req = createMockReq({
        headers: { authorization: 'Bearer valid-token' } as any
      });
      const res = createMockRes();
      const next = jest.fn();

      (verifyAccessToken as jest.Mock).mockReturnValue({
        userId: 'user-1',
        email: 'test@example.com',
        role: UserRole.CREATOR
      });
      (prisma.user.findUnique as jest.Mock).mockResolvedValue({
        id: 'user-1',
        email: 'test@example.com',
        name: 'Test',
        role: UserRole.CREATOR,
        creator: { id: 'c-1' },
        company: null
      });

      await authenticate(req, res, next);

      expect(req.user).toBeDefined();
      expect(req.user!.id).toBe('user-1');
      expect(next).toHaveBeenCalled();
    });

    it('should return 401 when Authorization header is missing', async () => {
      const req = createMockReq();
      const res = createMockRes();
      const next = jest.fn();

      await authenticate(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(next).not.toHaveBeenCalled();
    });

    it('should return 401 when Authorization header is malformed', async () => {
      const req = createMockReq({
        headers: { authorization: 'InvalidFormat token' } as any
      });
      const res = createMockRes();
      const next = jest.fn();

      await authenticate(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
    });

    it('should return 401 when token is invalid', async () => {
      const req = createMockReq({
        headers: { authorization: 'Bearer invalid-token' } as any
      });
      const res = createMockRes();
      const next = jest.fn();

      (verifyAccessToken as jest.Mock).mockReturnValue(null);

      await authenticate(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
    });

    it('should return 401 when user not found in DB', async () => {
      const req = createMockReq({
        headers: { authorization: 'Bearer valid-token' } as any
      });
      const res = createMockRes();
      const next = jest.fn();

      (verifyAccessToken as jest.Mock).mockReturnValue({
        userId: 'nonexistent',
        email: 'test@example.com',
        role: UserRole.CREATOR
      });
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);

      await authenticate(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
    });

    it('should return 500 on unexpected error', async () => {
      const req = createMockReq({
        headers: { authorization: 'Bearer valid-token' } as any
      });
      const res = createMockRes();
      const next = jest.fn();

      (verifyAccessToken as jest.Mock).mockImplementation(() => {
        throw new Error('unexpected');
      });

      await authenticate(req, res, next);

      expect(res.status).toHaveBeenCalledWith(500);
    });
  });

  // ===========================================
  // authorize
  // ===========================================
  describe('authorize', () => {
    it('should allow user with exact matching role', () => {
      const req = createMockReq();
      req.user = { id: '1', email: 'a@a.com', name: 'A', role: UserRole.CREATOR };
      const res = createMockRes();
      const next = jest.fn();

      const middleware = authorize(UserRole.CREATOR);
      middleware(req, res, next);

      expect(next).toHaveBeenCalled();
    });

    it('should allow user with higher role via hierarchy', () => {
      const req = createMockReq();
      req.user = { id: '1', email: 'a@a.com', name: 'A', role: UserRole.ADMIN };
      const res = createMockRes();
      const next = jest.fn();

      const middleware = authorize(UserRole.CREATOR);
      middleware(req, res, next);

      expect(next).toHaveBeenCalled();
    });

    it('should deny user without matching role', () => {
      const req = createMockReq();
      req.user = { id: '1', email: 'a@a.com', name: 'A', role: UserRole.USER };
      const res = createMockRes();
      const next = jest.fn();

      const middleware = authorize(UserRole.ADMIN);
      middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(next).not.toHaveBeenCalled();
    });

    it('should return 401 when user is not authenticated', () => {
      const req = createMockReq();
      const res = createMockRes();
      const next = jest.fn();

      const middleware = authorize(UserRole.ADMIN);
      middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
    });
  });

  // ===========================================
  // requirePermission
  // ===========================================
  describe('requirePermission', () => {
    it('should allow user with the required permission', () => {
      const req = createMockReq();
      req.user = { id: '1', email: 'a@a.com', name: 'A', role: UserRole.ADMIN };
      const res = createMockRes();
      const next = jest.fn();

      const middleware = requirePermission('user.write');
      middleware(req, res, next);

      expect(next).toHaveBeenCalled();
    });

    it('should deny user without the required permission', () => {
      const req = createMockReq();
      req.user = { id: '1', email: 'a@a.com', name: 'A', role: UserRole.USER };
      const res = createMockRes();
      const next = jest.fn();

      const middleware = requirePermission('admin.write');
      middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
    });

    it('should return 401 when no user', () => {
      const req = createMockReq();
      const res = createMockRes();
      const next = jest.fn();

      const middleware = requirePermission('user.read');
      middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
    });
  });

  // ===========================================
  // requireResourceAccess
  // ===========================================
  describe('requireResourceAccess', () => {
    it('should return 401 when no user', async () => {
      const req = createMockReq();
      const res = createMockRes();
      const next = jest.fn();

      const middleware = requireResourceAccess('profile', 'read');
      await middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
    });

    it('should allow admin to access profile resource', async () => {
      const req = createMockReq({ params: { id: 'user-1' } });
      req.user = { id: 'admin-1', email: 'a@a.com', name: 'Admin', role: UserRole.ADMIN };
      const res = createMockRes();
      const next = jest.fn();

      const middleware = requireResourceAccess('profile', 'read');
      await middleware(req, res, next);

      expect(next).toHaveBeenCalled();
    });

    it('should check content resource ownership', async () => {
      const req = createMockReq({ params: { id: 'content-1' } });
      req.user = { id: 'user-1', email: 'c@c.com', name: 'Creator', role: UserRole.CREATOR };
      const res = createMockRes();
      const next = jest.fn();

      (prisma.creatorContent.findUnique as jest.Mock).mockResolvedValue({
        creatorId: 'user-1'
      });

      const middleware = requireResourceAccess('content', 'write');
      await middleware(req, res, next);

      expect(next).toHaveBeenCalled();
    });

    it('should deny non-owner content access for creator', async () => {
      const req = createMockReq({ params: { id: 'content-1' } });
      req.user = { id: 'user-1', email: 'c@c.com', name: 'Creator', role: UserRole.CREATOR };
      const res = createMockRes();
      const next = jest.fn();

      (prisma.creatorContent.findUnique as jest.Mock).mockResolvedValue({
        creatorId: 'other-user'
      });

      const middleware = requireResourceAccess('content', 'write');
      await middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
    });

    it('should handle errors gracefully', async () => {
      const req = createMockReq({ params: { id: 'content-1' } });
      req.user = { id: 'user-1', email: 'c@c.com', name: 'Creator', role: UserRole.CREATOR };
      const res = createMockRes();
      const next = jest.fn();

      (prisma.creatorContent.findUnique as jest.Mock).mockRejectedValue(new Error('DB error'));

      const middleware = requireResourceAccess('content', 'write');
      await middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(500);
    });
  });

  // ===========================================
  // getUserPermissions
  // ===========================================
  describe('getUserPermissions', () => {
    it('should return direct permissions for a role', () => {
      const perms = getUserPermissions(UserRole.USER);
      expect(perms).toContain('profile.read');
      expect(perms).toContain('profile.write');
    });

    it('should include inherited permissions', () => {
      const perms = getUserPermissions(UserRole.ADMIN);
      // ADMIN inherits from COMPANY, CREATOR, USER
      expect(perms).toContain('admin.write');
      expect(perms).toContain('profile.read');
      expect(perms).toContain('chat.read');
    });

    it('should not duplicate permissions', () => {
      const perms = getUserPermissions(UserRole.ADMIN);
      const unique = [...new Set(perms)];
      expect(perms.length).toBe(unique.length);
    });
  });

  // ===========================================
  // getUserRoleHierarchy
  // ===========================================
  describe('getUserRoleHierarchy', () => {
    it('should return role and inherited roles for ADMIN', () => {
      const hierarchy = getUserRoleHierarchy(UserRole.ADMIN);
      expect(hierarchy[0]).toBe(UserRole.ADMIN);
      expect(hierarchy).toContain(UserRole.COMPANY);
      expect(hierarchy).toContain(UserRole.CREATOR);
      expect(hierarchy).toContain(UserRole.USER);
    });

    it('should return only self for USER', () => {
      const hierarchy = getUserRoleHierarchy(UserRole.USER);
      expect(hierarchy).toEqual([UserRole.USER]);
    });

    it('should include USER in CREATOR hierarchy', () => {
      const hierarchy = getUserRoleHierarchy(UserRole.CREATOR);
      expect(hierarchy).toContain(UserRole.CREATOR);
      expect(hierarchy).toContain(UserRole.USER);
    });
  });

  // ===========================================
  // hasPermission — additional branches
  // ===========================================
  describe('hasPermission — additional branches', () => {
    it('should return false for unknown role', () => {
      expect(hasPermission('UNKNOWN_ROLE' as any, 'profile.read')).toBe(false);
    });

    it('COMPANY should inherit USER permissions via hierarchy', () => {
      // COMPANY inherits CREATOR and USER; USER has 'chat.read'
      expect(hasPermission(UserRole.COMPANY, 'chat.read')).toBe(true);
    });

    it('CREATOR should inherit USER permissions', () => {
      expect(hasPermission(UserRole.CREATOR, 'follow.write')).toBe(true);
    });

    it('ADMIN should have all inherited permissions', () => {
      expect(hasPermission(UserRole.ADMIN, 'bookmark.write')).toBe(true);
      expect(hasPermission(UserRole.ADMIN, 'deal.read')).toBe(true);
    });

    it('USER should not have CREATOR-only permissions', () => {
      expect(hasPermission(UserRole.USER, 'content.delete')).toBe(false);
      expect(hasPermission(UserRole.USER, 'analytics.read')).toBe(false);
    });
  });

  // ===========================================
  // canAccessResource — additional branches
  // ===========================================
  describe('canAccessResource — additional branches', () => {
    it('should allow ADMIN to write profile without condition', () => {
      const req = createMockReq();
      req.user = { id: 'a', email: 'a@a.com', name: 'A', role: UserRole.ADMIN };
      expect(canAccessResource(UserRole.ADMIN, 'profile', 'write', req)).toBe(true);
    });

    it('should allow ADMIN to delete profile without condition', () => {
      const req = createMockReq();
      req.user = { id: 'a', email: 'a@a.com', name: 'A', role: UserRole.ADMIN };
      expect(canAccessResource(UserRole.ADMIN, 'profile', 'delete', req)).toBe(true);
    });

    it('should allow COMPANY to read opportunity', () => {
      const req = createMockReq();
      req.user = { id: 'c', email: 'c@c.com', name: 'C', role: UserRole.COMPANY };
      expect(canAccessResource(UserRole.COMPANY, 'opportunity', 'read', req)).toBe(true);
    });

    it('should allow COMPANY to write own opportunity', () => {
      const req = createMockReq();
      req.user = { id: 'c', email: 'c@c.com', name: 'C', role: UserRole.COMPANY };
      expect(canAccessResource(UserRole.COMPANY, 'opportunity', 'write', req, 'c')).toBe(true);
    });

    it('should deny COMPANY writing another company opportunity', () => {
      const req = createMockReq();
      req.user = { id: 'c', email: 'c@c.com', name: 'C', role: UserRole.COMPANY };
      expect(canAccessResource(UserRole.COMPANY, 'opportunity', 'write', req, 'other')).toBe(false);
    });

    it('should return false for action not listed for role', () => {
      const req = createMockReq();
      req.user = { id: 'u', email: 'u@u.com', name: 'U', role: UserRole.USER };
      expect(canAccessResource(UserRole.USER, 'opportunity', 'write', req)).toBe(false);
    });

    it('should use empty string as resourceOwner when none provided and condition exists', () => {
      const req = createMockReq();
      req.user = { id: '', email: 'u@u.com', name: 'U', role: UserRole.CREATOR };
      // condition: req.user.id === owner — both empty string, should be true
      expect(canAccessResource(UserRole.CREATOR, 'content', 'write', req, undefined)).toBe(true);
    });
  });

  // ===========================================
  // authorize — additional branches
  // ===========================================
  describe('authorize — additional branches', () => {
    it('should allow COMPANY role when COMPANY is specified', () => {
      const req = createMockReq();
      req.user = { id: '1', email: 'c@c.com', name: 'C', role: UserRole.COMPANY };
      const res = createMockRes();
      const next = jest.fn();

      const middleware = authorize(UserRole.COMPANY);
      middleware(req, res, next);

      expect(next).toHaveBeenCalled();
    });

    it('should allow ADMIN when CREATOR is required (hierarchy)', () => {
      const req = createMockReq();
      req.user = { id: '1', email: 'a@a.com', name: 'A', role: UserRole.ADMIN };
      const res = createMockRes();
      const next = jest.fn();

      // ADMIN hierarchy includes CREATOR
      const middleware = authorize(UserRole.USER);
      middleware(req, res, next);

      expect(next).toHaveBeenCalled();
    });

    it('should deny CREATOR when COMPANY is required', () => {
      const req = createMockReq();
      req.user = { id: '1', email: 'c@c.com', name: 'C', role: UserRole.CREATOR };
      const res = createMockRes();
      const next = jest.fn();

      const middleware = authorize(UserRole.COMPANY);
      middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(next).not.toHaveBeenCalled();
    });
  });

  // ===========================================
  // requirePermission — additional branches
  // ===========================================
  describe('requirePermission — additional branches', () => {
    it('CREATOR should have content.write permission', () => {
      const req = createMockReq();
      req.user = { id: '1', email: 'c@c.com', name: 'C', role: UserRole.CREATOR };
      const res = createMockRes();
      const next = jest.fn();

      const middleware = requirePermission('content.write');
      middleware(req, res, next);

      expect(next).toHaveBeenCalled();
    });

    it('COMPANY should have content.write via CREATOR inheritance', () => {
      // COMPANY role hierarchy includes CREATOR, which has content.write
      const req = createMockReq();
      req.user = { id: '1', email: 'c@c.com', name: 'C', role: UserRole.COMPANY };
      const res = createMockRes();
      const next = jest.fn();

      const middleware = requirePermission('content.write');
      middleware(req, res, next);

      expect(next).toHaveBeenCalled();
    });

    it('USER should not have admin.write permission', () => {
      const req = createMockReq();
      req.user = { id: '1', email: 'u@u.com', name: 'U', role: UserRole.USER };
      const res = createMockRes();
      const next = jest.fn();

      const middleware = requirePermission('admin.write');
      middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
    });
  });

  // ===========================================
  // requireResourceAccess — additional branches
  // ===========================================
  describe('requireResourceAccess — additional branches', () => {
    it('should handle opportunity resource and allow owner', async () => {
      const req = createMockReq({ params: { id: 'opp-1' } });
      req.user = { id: 'company-1', email: 'c@c.com', name: 'C', role: UserRole.COMPANY };
      const res = createMockRes();
      const next = jest.fn();

      (prisma.opportunity.findUnique as jest.Mock).mockResolvedValue({
        companyId: 'company-1'
      });

      const middleware = requireResourceAccess('opportunity', 'write');
      await middleware(req, res, next);

      expect(next).toHaveBeenCalled();
    });

    it('should deny opportunity write for non-owner company', async () => {
      const req = createMockReq({ params: { id: 'opp-1' } });
      req.user = { id: 'company-X', email: 'c@c.com', name: 'C', role: UserRole.COMPANY };
      const res = createMockRes();
      const next = jest.fn();

      (prisma.opportunity.findUnique as jest.Mock).mockResolvedValue({
        companyId: 'company-other'
      });

      const middleware = requireResourceAccess('opportunity', 'write');
      await middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
    });

    it('should work without req.params.id (no resource lookup)', async () => {
      const req = createMockReq({ params: {} });
      req.user = { id: 'a', email: 'a@a.com', name: 'A', role: UserRole.ADMIN };
      const res = createMockRes();
      const next = jest.fn();

      const middleware = requireResourceAccess('profile', 'read');
      await middleware(req, res, next);

      // ADMIN can read profile unconditionally
      expect(next).toHaveBeenCalled();
    });

    it('should handle unknown resource type gracefully (no owner lookup)', async () => {
      const req = createMockReq({ params: { id: 'x-1' } });
      req.user = { id: 'a', email: 'a@a.com', name: 'A', role: UserRole.ADMIN };
      const res = createMockRes();
      const next = jest.fn();

      const middleware = requireResourceAccess('analytics', 'read');
      await middleware(req, res, next);

      // ADMIN can read analytics unconditionally
      expect(next).toHaveBeenCalled();
    });

    it('should handle opportunity DB error', async () => {
      const req = createMockReq({ params: { id: 'opp-1' } });
      req.user = { id: 'c', email: 'c@c.com', name: 'C', role: UserRole.COMPANY };
      const res = createMockRes();
      const next = jest.fn();

      (prisma.opportunity.findUnique as jest.Mock).mockRejectedValue(new Error('DB error'));

      const middleware = requireResourceAccess('opportunity', 'write');
      await middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(500);
    });
  });

  // ===========================================
  // getUserPermissions — additional branches
  // ===========================================
  describe('getUserPermissions — additional branches', () => {
    it('should return correct permissions for CREATOR', () => {
      const perms = getUserPermissions(UserRole.CREATOR);
      expect(perms).toContain('content.write');
      expect(perms).toContain('analytics.read');
      // Inherited from USER
      expect(perms).toContain('follow.write');
      expect(perms).toContain('bookmark.write');
    });

    it('should return correct permissions for COMPANY', () => {
      const perms = getUserPermissions(UserRole.COMPANY);
      expect(perms).toContain('opportunity.write');
      expect(perms).toContain('deal.read');
      // Inherited from CREATOR and USER
      expect(perms).toContain('follow.write');
    });
  });
});
