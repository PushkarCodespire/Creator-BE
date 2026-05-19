jest.mock('../../../middleware/errorHandler', () => {
  class AppError extends Error {
    statusCode: number;
    constructor(message: string, statusCode: number) { super(message); this.statusCode = statusCode; }
  }
  return { AppError, asyncHandler: (fn: Function) => fn };
});

jest.mock('../../../../prisma/client', () => ({
  __esModule: true,
  default: {
    creator: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    $transaction: jest.fn(),
  },
}));

import { Request, Response } from 'express';
import prisma from '../../../../prisma/client';
import {
  getHomeFeatured,
  getAllCreatorsForHome,
  updateHomeFeatured,
} from '../../../controllers/home.controller';

const makeReq = (overrides: Partial<Request> = {}) =>
  ({ body: {}, params: {}, query: {}, ...overrides } as unknown as Request);

const makeRes = () => {
  const r = {} as Response;
  r.json = jest.fn().mockReturnValue(r);
  r.status = jest.fn().mockReturnValue(r);
  return r;
};

const p = prisma as jest.Mocked<typeof prisma>;

describe('Home Controller', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (p.creator.findMany as jest.Mock).mockResolvedValue([]);
    (p.creator.findFirst as jest.Mock).mockResolvedValue(null);
    (p.creator.update as jest.Mock).mockResolvedValue({});
    (p.creator.updateMany as jest.Mock).mockResolvedValue({});
    (p.$transaction as jest.Mock).mockResolvedValue([]);
  });

  describe('getHomeFeatured', () => {
    it('returns featured creators and main highlight', async () => {
      const featured = [{ id: 'c1', displayName: 'Creator1', isFeatured: true }];
      const mainHighlight = { id: 'c2', displayName: 'Creator2', isMainHighlight: true };
      (p.creator.findMany as jest.Mock).mockResolvedValue(featured);
      (p.creator.findFirst as jest.Mock).mockResolvedValue(mainHighlight);

      const req = makeReq();
      const res = makeRes();
      await getHomeFeatured(req, res);

      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: { featured, mainHighlight },
      });
    });

    it('returns empty arrays when no featured/highlight', async () => {
      (p.creator.findMany as jest.Mock).mockResolvedValue([]);
      (p.creator.findFirst as jest.Mock).mockResolvedValue(null);

      const req = makeReq();
      const res = makeRes();
      await getHomeFeatured(req, res);

      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: { featured: [], mainHighlight: null },
      });
    });
  });

  describe('getAllCreatorsForHome', () => {
    it('returns all active creators', async () => {
      const creators = [
        { id: 'c1', displayName: 'Creator1' },
        { id: 'c2', displayName: 'Creator2' },
      ];
      (p.creator.findMany as jest.Mock).mockResolvedValue(creators);

      const req = makeReq();
      const res = makeRes();
      await getAllCreatorsForHome(req, res);

      expect(p.creator.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { isActive: true } })
      );
      expect(res.json).toHaveBeenCalledWith({ success: true, data: creators });
    });

    it('returns empty list when no active creators', async () => {
      (p.creator.findMany as jest.Mock).mockResolvedValue([]);

      const req = makeReq();
      const res = makeRes();
      await getAllCreatorsForHome(req, res);

      expect(res.json).toHaveBeenCalledWith({ success: true, data: [] });
    });
  });

  describe('updateHomeFeatured', () => {
    it('throws 400 when featured is not an array', async () => {
      const req = makeReq({ body: { featured: 'not-array' } });
      const res = makeRes();

      await expect(updateHomeFeatured(req, res)).rejects.toThrow('featured must be an array');
    });

    it('throws 400 when featured is undefined', async () => {
      const req = makeReq({ body: {} });
      const res = makeRes();

      await expect(updateHomeFeatured(req, res)).rejects.toThrow('featured must be an array');
    });

    it('throws 400 for invalid creator IDs', async () => {
      (p.creator.findMany as jest.Mock).mockResolvedValue([{ id: 'c1' }]);

      const req = makeReq({
        body: {
          featured: [
            { creatorId: 'c1', order: 1 },
            { creatorId: 'c2', order: 2 },
          ],
        },
      });
      const res = makeRes();

      await expect(updateHomeFeatured(req, res)).rejects.toThrow('One or more creator IDs are invalid');
    });

    it('throws 400 for non-integer orders', async () => {
      (p.creator.findMany as jest.Mock).mockResolvedValue([{ id: 'c1' }]);

      const req = makeReq({
        body: { featured: [{ creatorId: 'c1', order: 0 }] },
      });
      const res = makeRes();

      await expect(updateHomeFeatured(req, res)).rejects.toThrow('order must be a positive integer');
    });

    it('throws 400 for duplicate orders', async () => {
      (p.creator.findMany as jest.Mock).mockResolvedValue([{ id: 'c1' }, { id: 'c2' }]);

      const req = makeReq({
        body: {
          featured: [
            { creatorId: 'c1', order: 1 },
            { creatorId: 'c2', order: 1 },
          ],
        },
      });
      const res = makeRes();

      await expect(updateHomeFeatured(req, res)).rejects.toThrow('featured orders must be unique');
    });

    it('updates featured creators and returns new config', async () => {
      const allCreators = [{ id: 'c1' }, { id: 'c2' }];
      const updatedFeatured = [{ id: 'c1', displayName: 'Creator1', isFeatured: true }];
      const mainHighlight = { id: 'c2', displayName: 'Creator2' };

      (p.creator.findMany as jest.Mock)
        .mockResolvedValueOnce(allCreators)
        .mockResolvedValueOnce(updatedFeatured);
      (p.creator.findFirst as jest.Mock).mockResolvedValue(mainHighlight);
      (p.$transaction as jest.Mock).mockResolvedValue([]);

      const req = makeReq({
        body: {
          featured: [{ creatorId: 'c1', order: 1 }],
          mainHighlightId: 'c2',
        },
      });
      const res = makeRes();
      await updateHomeFeatured(req, res);

      expect(p.$transaction).toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: { featured: updatedFeatured, mainHighlight },
      });
    });

    it('handles empty featured array', async () => {
      const updatedFeatured: never[] = [];
      const mainHighlight = null;

      (p.creator.findMany as jest.Mock).mockResolvedValue(updatedFeatured);
      (p.creator.findFirst as jest.Mock).mockResolvedValue(mainHighlight);
      (p.$transaction as jest.Mock).mockResolvedValue([]);

      const req = makeReq({ body: { featured: [] } });
      const res = makeRes();
      await updateHomeFeatured(req, res);

      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: { featured: [], mainHighlight: null },
      });
    });

    it('includes mainHighlightId in validation when not in featured', async () => {
      const allCreators = [{ id: 'c1' }, { id: 'c2' }];
      (p.creator.findMany as jest.Mock)
        .mockResolvedValueOnce(allCreators)
        .mockResolvedValueOnce([]);
      (p.creator.findFirst as jest.Mock).mockResolvedValue(null);
      (p.$transaction as jest.Mock).mockResolvedValue([]);

      const req = makeReq({
        body: {
          featured: [{ creatorId: 'c1', order: 1 }],
          mainHighlightId: 'c2',
        },
      });
      const res = makeRes();
      await updateHomeFeatured(req, res);

      expect(p.creator.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: { in: expect.arrayContaining(['c1', 'c2']) } } })
      );
    });
  });
});
