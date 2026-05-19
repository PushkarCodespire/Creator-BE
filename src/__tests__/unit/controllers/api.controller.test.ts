// ===========================================
// API CONTROLLER UNIT TESTS
// ===========================================

jest.mock('../../../../prisma/client', () => {
  const aPIKey = {
    create: jest.fn(),
    findMany: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn()
  };
  return {
    __esModule: true,
    default: { aPIKey }
  };
});

import { Request, Response } from 'express';
import prisma from '../../../../prisma/client';
import {
  createAPIKey,
  getAPIKeys,
  revokeAPIKey,
  getAPIUsage
} from '../../../controllers/api.controller';

const mockReq = (overrides = {}) =>
  ({ body: {}, params: {}, query: {}, user: { id: 'user-1', role: 'USER' }, ...overrides } as unknown as Request);

const mockRes = () => {
  const res = {} as Response;
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

describe('API Controller', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('createAPIKey', () => {
    it('should create an API key', async () => {
      const req = mockReq({ body: { name: 'test-key', permissions: ['read'] } });
      const res = mockRes();

      ((prisma as any).aPIKey.create as jest.Mock).mockResolvedValue({
        id: 'k-1', name: 'test-key', key: 'cp_abc123'
      });

      await createAPIKey(req, res);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ success: true })
      );
    });
  });

  describe('getAPIKeys', () => {
    it('should return API keys', async () => {
      const req = mockReq();
      const res = mockRes();

      ((prisma as any).aPIKey.findMany as jest.Mock).mockResolvedValue([]);

      await getAPIKeys(req, res);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ success: true, data: [] })
      );
    });
  });

  describe('revokeAPIKey', () => {
    it('should revoke an API key', async () => {
      const req = mockReq({ params: { keyId: 'k-1' } });
      const res = mockRes();

      ((prisma as any).aPIKey.findUnique as jest.Mock).mockResolvedValue({
        id: 'k-1', userId: 'user-1'
      });
      ((prisma as any).aPIKey.update as jest.Mock).mockResolvedValue({});

      await revokeAPIKey(req, res);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ success: true, message: 'API key revoked successfully' })
      );
    });

    it('should throw 404 when key not found', async () => {
      const req = mockReq({ params: { keyId: 'bad' } });
      const res = mockRes();

      ((prisma as any).aPIKey.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(revokeAPIKey(req, res)).rejects.toThrow('API key not found');
    });

    it('should throw 404 when key belongs to other user', async () => {
      const req = mockReq({ params: { keyId: 'k-1' } });
      const res = mockRes();

      ((prisma as any).aPIKey.findUnique as jest.Mock).mockResolvedValue({
        id: 'k-1', userId: 'other-user'
      });

      await expect(revokeAPIKey(req, res)).rejects.toThrow('API key not found');
    });
  });

  describe('getAPIUsage', () => {
    it('should return API usage', async () => {
      const req = mockReq({ params: { keyId: 'k-1' }, query: {} });
      const res = mockRes();

      ((prisma as any).aPIKey.findUnique as jest.Mock).mockResolvedValue({
        id: 'k-1', userId: 'user-1', rateLimit: 100
      });

      await getAPIUsage(req, res);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ success: true })
      );
    });

    it('should throw 404 when key not found', async () => {
      const req = mockReq({ params: { keyId: 'bad' }, query: {} });
      const res = mockRes();

      ((prisma as any).aPIKey.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(getAPIUsage(req, res)).rejects.toThrow('API key not found');
    });
  });
});
