// ===========================================
// PERMISSIONS CONTROLLER UNIT TESTS
// ===========================================

jest.mock('../../../../prisma/client', () => ({
  __esModule: true,
  default: {
    subscription: { findUnique: jest.fn() }
  }
}));

jest.mock('../../../middleware/errorHandler', () => {
  class AppError extends Error {
    statusCode: number;
    constructor(message: string, statusCode: number) { super(message); this.statusCode = statusCode; }
  }
  return { AppError, asyncHandler: (fn: Function) => fn };
});

jest.mock('../../../config/rolePermissions', () => ({
  getRolePermissions: jest.fn(),
}));

import { Request, Response } from 'express';
import prisma from '../../../../prisma/client';
import {
  getRolePermissionsEndpoint,
  getSpecificRolePermissions
} from '../../../controllers/permissions.controller';
import { getRolePermissions } from '../../../config/rolePermissions';

const mockReq = (overrides = {}) =>
  ({ body: {}, params: {}, query: {}, user: { id: 'user-1', role: 'USER' }, ...overrides } as unknown as Request);

const mockRes = () => {
  const res = {} as Response;
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

describe('Permissions Controller', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (getRolePermissions as jest.Mock).mockImplementation((role: string) => ({
      role,
      roleLabel: role,
      description: 'desc',
      features: {},
      accessiblePages: [],
    }));
  });

  describe('getRolePermissionsEndpoint', () => {
    it('should return guest permissions when not authenticated', async () => {
      const req = mockReq({ user: undefined });
      const res = mockRes();

      await getRolePermissionsEndpoint(req, res);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ success: true, data: expect.objectContaining({ isGuest: true }) })
      );
    });

    it('should return authenticated user permissions', async () => {
      const req = mockReq();
      const res = mockRes();

      (prisma.subscription.findUnique as jest.Mock).mockResolvedValue({ plan: 'FREE' });

      await getRolePermissionsEndpoint(req, res);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: expect.objectContaining({ isAuthenticated: true, isUser: true })
        })
      );
    });

    it('should return creator permissions', async () => {
      const req = mockReq({ user: { id: 'user-1', role: 'CREATOR' } });
      const res = mockRes();

      await getRolePermissionsEndpoint(req, res);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: expect.objectContaining({ isCreator: true })
        })
      );
    });

    it('should return admin permissions', async () => {
      const req = mockReq({ user: { id: 'user-1', role: 'ADMIN' } });
      const res = mockRes();

      await getRolePermissionsEndpoint(req, res);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: expect.objectContaining({ isAdmin: true })
        })
      );
    });
  });

  describe('getSpecificRolePermissions', () => {
    it('should return permissions for specified role', async () => {
      const req = mockReq({ params: { role: 'CREATOR' }, query: {} });
      const res = mockRes();

      await getSpecificRolePermissions(req, res);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    });

    it('should throw 400 for invalid role', async () => {
      const req = mockReq({ params: { role: 'INVALID' }, query: {} });
      const res = mockRes();

      await expect(getSpecificRolePermissions(req, res)).rejects.toThrow('Invalid role specified');
    });
  });

  // ===========================================
  // NEW BRANCH COVERAGE TESTS
  // ===========================================

  describe('getRolePermissionsEndpoint — additional branches', () => {
    it('should NOT query subscription for CREATOR role', async () => {
      const req = mockReq({ user: { id: 'u1', role: 'CREATOR' } });
      const res = mockRes();

      await getRolePermissionsEndpoint(req, res);

      expect(prisma.subscription.findUnique).not.toHaveBeenCalled();
    });

    it('should NOT query subscription for ADMIN role', async () => {
      const req = mockReq({ user: { id: 'u1', role: 'ADMIN' } });
      const res = mockRes();

      await getRolePermissionsEndpoint(req, res);

      expect(prisma.subscription.findUnique).not.toHaveBeenCalled();
    });

    it('should NOT query subscription for COMPANY role', async () => {
      const req = mockReq({ user: { id: 'u1', role: 'COMPANY' } });
      const res = mockRes();

      await getRolePermissionsEndpoint(req, res);

      expect(prisma.subscription.findUnique).not.toHaveBeenCalled();
    });

    it('should set isCompany=true for COMPANY role', async () => {
      const req = mockReq({ user: { id: 'u1', role: 'COMPANY' } });
      const res = mockRes();

      await getRolePermissionsEndpoint(req, res);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ isCompany: true }) })
      );
    });

    it('should set isPremium=true and isFree=false for PREMIUM subscription', async () => {
      const req = mockReq({ user: { id: 'u1', role: 'USER' } });
      const res = mockRes();
      (prisma.subscription.findUnique as jest.Mock).mockResolvedValue({ plan: 'PREMIUM' });

      await getRolePermissionsEndpoint(req, res);

      const call = (res.json as jest.Mock).mock.calls[0][0];
      expect(call.data.isPremium).toBe(true);
      expect(call.data.isFree).toBe(false);
    });

    it('should set isPremium=false and isFree=true for FREE subscription', async () => {
      const req = mockReq({ user: { id: 'u1', role: 'USER' } });
      const res = mockRes();
      (prisma.subscription.findUnique as jest.Mock).mockResolvedValue({ plan: 'FREE' });

      await getRolePermissionsEndpoint(req, res);

      const call = (res.json as jest.Mock).mock.calls[0][0];
      expect(call.data.isPremium).toBe(false);
      expect(call.data.isFree).toBe(true);
    });

    it('should set isFree=true when no subscription found for USER', async () => {
      const req = mockReq({ user: { id: 'u1', role: 'USER' } });
      const res = mockRes();
      (prisma.subscription.findUnique as jest.Mock).mockResolvedValue(null);

      await getRolePermissionsEndpoint(req, res);

      const call = (res.json as jest.Mock).mock.calls[0][0];
      expect(call.data.isFree).toBe(true);
      expect(call.data.subscriptionPlan).toBeNull();
    });

    it('should always set isGuest=false for authenticated users', async () => {
      const req = mockReq({ user: { id: 'u1', role: 'USER' } });
      const res = mockRes();
      (prisma.subscription.findUnique as jest.Mock).mockResolvedValue(null);

      await getRolePermissionsEndpoint(req, res);

      const call = (res.json as jest.Mock).mock.calls[0][0];
      expect(call.data.isGuest).toBe(false);
      expect(call.data.isAuthenticated).toBe(true);
    });

    it('should pass subscriptionPlan to getRolePermissions for USER', async () => {
      const req = mockReq({ user: { id: 'u1', role: 'USER' } });
      const res = mockRes();
      (prisma.subscription.findUnique as jest.Mock).mockResolvedValue({ plan: 'PREMIUM' });

      await getRolePermissionsEndpoint(req, res);

      expect(getRolePermissions).toHaveBeenCalledWith('USER', 'PREMIUM');
    });
  });

  describe('getSpecificRolePermissions — additional branches', () => {
    it('should accept lowercase role and normalise it', async () => {
      const req = mockReq({ params: { role: 'user' }, query: {} });
      const res = mockRes();

      await getSpecificRolePermissions(req, res);

      expect(getRolePermissions).toHaveBeenCalledWith('USER', undefined);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    });

    it('should accept mixed-case role', async () => {
      const req = mockReq({ params: { role: 'Admin' }, query: {} });
      const res = mockRes();

      await getSpecificRolePermissions(req, res);

      expect(getRolePermissions).toHaveBeenCalledWith('ADMIN', undefined);
    });

    it('should pass subscriptionPlan from query to getRolePermissions', async () => {
      const req = mockReq({ params: { role: 'USER' }, query: { plan: 'PREMIUM' } });
      const res = mockRes();

      await getSpecificRolePermissions(req, res);

      expect(getRolePermissions).toHaveBeenCalledWith('USER', 'PREMIUM');
    });

    it('should return data shape with role, roleLabel, description, features, accessiblePages', async () => {
      (getRolePermissions as jest.Mock).mockReturnValue({
        role: 'GUEST',
        roleLabel: 'Guest',
        description: 'Limited access',
        features: { canChat: false },
        accessiblePages: ['/home']
      });
      const req = mockReq({ params: { role: 'GUEST' }, query: {} });
      const res = mockRes();

      await getSpecificRolePermissions(req, res);

      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: {
          role: 'GUEST',
          roleLabel: 'Guest',
          description: 'Limited access',
          features: { canChat: false },
          accessiblePages: ['/home']
        }
      });
    });

    it('should handle COMPANY role correctly', async () => {
      const req = mockReq({ params: { role: 'COMPANY' }, query: {} });
      const res = mockRes();

      await getSpecificRolePermissions(req, res);

      expect(getRolePermissions).toHaveBeenCalledWith('COMPANY', undefined);
    });
  });
});
