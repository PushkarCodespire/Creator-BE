import { Router, Request, Response } from 'express';
import { authenticate } from '../middleware/auth';
import prisma from '../../prisma/client';
import { asyncHandler, AppError } from '../middleware/errorHandler';

const router = Router();

// GET public programs for a creator (no auth required)
router.get('/creator/:creatorId', asyncHandler(async (req: Request, res: Response) => {
  const programs = await prisma.program.findMany({
    where: { creatorId: req.params.creatorId as string, isActive: true },
    orderBy: { createdAt: 'desc' },
    select: { id: true, name: true, description: true, price: true, category: true, createdAt: true },
  });
  res.json({ success: true, data: programs });
}));

// GET all programs for authenticated creator
router.get('/', authenticate, asyncHandler(async (req: Request, res: Response) => {
  const creator = await prisma.creator.findUnique({ where: { userId: req.user!.id } });
  if (!creator) throw new AppError('Creator profile not found', 404);

  const programs = await prisma.program.findMany({
    where: { creatorId: creator.id },
    orderBy: { createdAt: 'desc' },
  });

  res.json({ success: true, data: programs });
}));

// CREATE program
router.post('/', authenticate, asyncHandler(async (req: Request, res: Response) => {
  const creator = await prisma.creator.findUnique({ where: { userId: req.user!.id } });
  if (!creator) throw new AppError('Creator profile not found', 404);

  const { name, description, price, category } = req.body;
  if (!name) throw new AppError('Program name is required', 400);

  const program = await prisma.program.create({
    data: {
      creatorId: creator.id,
      name,
      description: description || '',
      price: price || 0,
      category: category || null,
    },
  });

  res.status(201).json({ success: true, data: program });
}));

// UPDATE program
router.put('/:id', authenticate, asyncHandler(async (req: Request, res: Response) => {
  const creator = await prisma.creator.findUnique({ where: { userId: req.user!.id } });
  if (!creator) throw new AppError('Creator profile not found', 404);

  const programId = req.params.id as string;
  const program = await prisma.program.findFirst({ where: { id: programId, creatorId: creator.id } });
  if (!program) throw new AppError('Program not found', 404);

  const { name, description, price, category, isActive } = req.body;

  const updated = await prisma.program.update({
    where: { id: programId },
    data: {
      ...(name !== undefined && { name }),
      ...(description !== undefined && { description }),
      ...(price !== undefined && { price }),
      ...(category !== undefined && { category }),
      ...(isActive !== undefined && { isActive }),
    },
  });

  res.json({ success: true, data: updated });
}));

// DELETE program
router.delete('/:id', authenticate, asyncHandler(async (req: Request, res: Response) => {
  const creator = await prisma.creator.findUnique({ where: { userId: req.user!.id } });
  if (!creator) throw new AppError('Creator profile not found', 404);

  const programId = req.params.id as string;
  const program = await prisma.program.findFirst({ where: { id: programId, creatorId: creator.id } });
  if (!program) throw new AppError('Program not found', 404);

  await prisma.program.delete({ where: { id: programId } });

  res.json({ success: true, message: 'Program deleted' });
}));

export default router;
