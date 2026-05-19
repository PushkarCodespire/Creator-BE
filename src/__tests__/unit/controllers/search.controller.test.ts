// ===========================================
// SEARCH CONTROLLER UNIT TESTS
// ===========================================

jest.mock('../../../../prisma/client', () => ({
  __esModule: true,
  default: {
    creator: { findMany: jest.fn() },
    post: { findMany: jest.fn() },
    user: { findMany: jest.fn() },
    follow: { findMany: jest.fn() }
  }
}));

jest.mock('../../../middleware/errorHandler', () => {
  class AppError extends Error {
    statusCode: number;
    constructor(message: string, statusCode: number) { super(message); this.statusCode = statusCode; }
  }
  return { AppError, asyncHandler: (fn: Function) => fn };
});

jest.mock('../../../services/search.service', () => ({
  formatSearchResults: jest.fn((items: any[]) => items),
  getAutocompleteSuggestions: jest.fn(() => []),
  trackSearch: jest.fn(),
  getPopularSearches: jest.fn(() => [])
}));

import { Request, Response } from 'express';
import prisma from '../../../../prisma/client';
import * as searchService from '../../../services/search.service';
import {
  globalSearch,
  autocompleteSearch,
  getPopularSearchesController,
  getSearchSuggestions
} from '../../../controllers/search.controller';

const mockReq = (overrides = {}) =>
  ({ body: {}, params: {}, query: {}, user: { id: 'user-1', role: 'USER' }, ...overrides } as unknown as Request);

const mockRes = () => {
  const res = {} as Response;
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

describe('Search Controller', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (searchService.formatSearchResults as jest.Mock).mockImplementation((items: unknown[]) => items);
    (searchService.getAutocompleteSuggestions as jest.Mock).mockReturnValue([]);
    (searchService.trackSearch as jest.Mock).mockReturnValue(undefined);
    (searchService.getPopularSearches as jest.Mock).mockReturnValue([]);
  });

  describe('globalSearch', () => {
    it('should search successfully', async () => {
      const req = mockReq({ query: { q: 'fitness', type: 'all' } });
      const res = mockRes();

      (prisma.creator.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.post.findMany as jest.Mock).mockResolvedValue([]);

      await globalSearch(req, res);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    });

    it('should throw 400 when query is missing', async () => {
      const req = mockReq({ query: {} });
      const res = mockRes();

      await expect(globalSearch(req, res)).rejects.toThrow('Search query is required');
    });

    it('should throw 400 when query is too short', async () => {
      const req = mockReq({ query: { q: 'a' } });
      const res = mockRes();

      await expect(globalSearch(req, res)).rejects.toThrow('Search query must be at least 2 characters');
    });
  });

  describe('autocompleteSearch', () => {
    it('should return autocomplete suggestions', async () => {
      const req = mockReq({ query: { q: 'fit' } });
      const res = mockRes();

      (prisma.creator.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.post.findMany as jest.Mock).mockResolvedValue([]);

      await autocompleteSearch(req, res);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    });

    it('should throw 400 when query is missing', async () => {
      const req = mockReq({ query: {} });
      const res = mockRes();

      await expect(autocompleteSearch(req, res)).rejects.toThrow('Search query is required');
    });

    it('should return empty for short query', async () => {
      const req = mockReq({ query: { q: 'a' } });
      const res = mockRes();

      await autocompleteSearch(req, res);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ data: { suggestions: [] } })
      );
    });
  });

  describe('getPopularSearchesController', () => {
    it('should return popular searches', async () => {
      const req = mockReq({ query: {} });
      const res = mockRes();

      await getPopularSearchesController(req, res);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    });
  });

  describe('getSearchSuggestions', () => {
    it('should return suggestions for authenticated user', async () => {
      const req = mockReq();
      const res = mockRes();

      (prisma.follow.findMany as jest.Mock).mockResolvedValue([]);

      await getSearchSuggestions(req, res);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    });
  });
});
