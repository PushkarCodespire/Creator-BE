// ===========================================
// TRAINING CONTROLLER
// Creator corrections + fine-tune pipeline
// ===========================================

import { Response } from 'express';
import { AuthRequest } from '../../middleware/auth';
import { asyncHandler, AppError } from '../../middleware/errorHandler';
import prisma from '../../../prisma/client';
import { triggerCreatorFineTune, syncFineTuneStatus } from '../../services/ai/fine-tune.service';
import { invalidateCorrectionsCache } from '../chat.controller';
import { generateEmbedding, isOpenAIConfigured } from '../../utils/openai';
import { storeVector, deleteVectorsByContent, vectorExists } from '../../utils/vectorStore';

// Store a correction in the vector store so RAG can retrieve it.
// The embedding is generated from the userMessage (what to search against).
// The stored text is "Q: ...\nA: ..." so the retrieved chunk is self-contained.
async function indexCorrectionVector(
  correctionId: string,
  creatorId: string,
  userMessage: string,
  chosenResponse: string
): Promise<void> {
  if (!isOpenAIConfigured()) return;
  const embedding = await generateEmbedding(userMessage);
  storeVector({
    id:        correctionId,
    creatorId,
    contentId: correctionId,
    text:      `Q: ${userMessage}\nA: ${chosenResponse}`,
    embedding,
    metadata:  { type: 'correction', userMessage, chosenResponse },
  });
}

const MIN_CORRECTIONS_TO_TRAIN = 10;

// ── Helper: resolve creatorId from the authenticated user ────────────────────
async function resolveCreatorId(req: AuthRequest): Promise<string> {
  const userId = req.user?.id;
  if (!userId) throw new AppError('Authentication required', 401);
  const creator = await prisma.creator.findUnique({
    where: { userId },
    select: { id: true },
  });
  if (!creator) throw new AppError('Creator profile not found', 404);
  return creator.id;
}

// ── GET /api/creators/training/corrections ───────────────────────────────────
export const getCorrections = asyncHandler(async (req: AuthRequest, res: Response) => {
  const creatorId = await resolveCreatorId(req);

  const corrections = await prisma.messageCorrection.findMany({
    where: { creatorId },
    orderBy: { createdAt: 'desc' },
    take: 200,
  });

  res.json({ success: true, data: { corrections, total: corrections.length } });
});

// ── POST /api/creators/training/correct ──────────────────────────────────────
export const saveCorrection = asyncHandler(async (req: AuthRequest, res: Response) => {
  const creatorId = await resolveCreatorId(req);
  const { userMessage, rejectedResponse, chosenResponse } = req.body;

  if (!userMessage?.trim() || !rejectedResponse?.trim() || !chosenResponse?.trim()) {
    throw new AppError('userMessage, rejectedResponse, and chosenResponse are required', 400);
  }
  if (chosenResponse.trim() === rejectedResponse.trim()) {
    throw new AppError('Corrected response must differ from the original', 400);
  }

  const correction = await prisma.messageCorrection.create({
    data: {
      creatorId,
      userMessage:      userMessage.trim(),
      rejectedResponse: rejectedResponse.trim(),
      chosenResponse:   chosenResponse.trim(),
    },
  });

  invalidateCorrectionsCache(creatorId);

  // Index in vector store so RAG can retrieve it immediately (non-blocking)
  indexCorrectionVector(correction.id, creatorId, correction.userMessage, correction.chosenResponse)
    .catch(() => {});

  res.status(201).json({ success: true, data: correction });
});

// ── PATCH /api/creators/training/corrections/:id/toggle ──────────────────────
export const toggleCorrection = asyncHandler(async (req: AuthRequest, res: Response) => {
  const creatorId  = await resolveCreatorId(req);
  const { id }     = req.params;

  const existing = await prisma.messageCorrection.findFirst({
    where: { id, creatorId },
    select: { id: true, isActive: true, userMessage: true, chosenResponse: true },
  });
  if (!existing) throw new AppError('Correction not found', 404);

  const updated = await prisma.messageCorrection.update({
    where: { id },
    data:  { isActive: !existing.isActive },
  });

  invalidateCorrectionsCache(creatorId);

  if (!updated.isActive) {
    // Deactivated — remove from vector store so it won't be retrieved
    deleteVectorsByContent(id);
  } else {
    // Re-activated — re-index so RAG can find it again (non-blocking)
    indexCorrectionVector(id, creatorId, existing.userMessage, existing.chosenResponse)
      .catch(() => {});
  }

  res.json({ success: true, data: updated });
});

// ── DELETE /api/creators/training/corrections/:id ────────────────────────────
export const deleteCorrection = asyncHandler(async (req: AuthRequest, res: Response) => {
  const creatorId = await resolveCreatorId(req);
  const { id }    = req.params;

  const existing = await prisma.messageCorrection.findFirst({ where: { id, creatorId } });
  if (!existing) throw new AppError('Correction not found', 404);

  await prisma.messageCorrection.delete({ where: { id } });

  invalidateCorrectionsCache(creatorId);

  // Remove from vector store so it's no longer retrievable
  deleteVectorsByContent(id);

  res.json({ success: true, message: 'Correction deleted' });
});

// ── GET /api/creators/training/status ────────────────────────────────────────
export const getTrainingStatus = asyncHandler(async (req: AuthRequest, res: Response) => {
  const creatorId = await resolveCreatorId(req);

  const [statusResult, correctionCount, creator] = await Promise.all([
    syncFineTuneStatus(creatorId),
    prisma.messageCorrection.count({ where: { creatorId, isActive: true } }),
    prisma.creator.findUnique({
      where: { id: creatorId },
      select: { fewShotQA: true },
    }),
  ]);

  // Count answered fewShotQA entries
  const fewShotQA = (creator?.fewShotQA as { scenario: string; answer: string }[] | null) || [];
  const fewShotCount = fewShotQA.filter(qa => qa.answer?.trim()).length;
  const totalExamples = correctionCount + fewShotCount;

  res.json({
    success: true,
    data: {
      ...statusResult,
      correctionCount,
      fewShotCount,
      totalExamples,
      canTrain: totalExamples >= MIN_CORRECTIONS_TO_TRAIN,
      minRequired: MIN_CORRECTIONS_TO_TRAIN,
    },
  });
});

// ── POST /api/creators/training/fine-tune ────────────────────────────────────
export const startFineTune = asyncHandler(async (req: AuthRequest, res: Response) => {
  const creatorId = await resolveCreatorId(req);

  // Check existing job isn't already running
  const creator = await prisma.creator.findUnique({
    where: { id: creatorId },
    select: { fineTuneStatus: true },
  });
  if (creator?.fineTuneStatus === 'pending') {
    throw new AppError('A fine-tuning job is already in progress', 409);
  }

  const result = await triggerCreatorFineTune(creatorId);

  res.json({
    success: true,
    data: result,
    message: 'Fine-tuning started. Check back in 10–20 minutes.',
  });
});

// ── Startup backfill: index any active corrections not yet in the vector store ─
export async function backfillCorrectionVectors(): Promise<void> {
  if (!isOpenAIConfigured()) return;

  const corrections = await prisma.messageCorrection.findMany({
    where: { isActive: true },
    select: { id: true, creatorId: true, userMessage: true, chosenResponse: true },
  });

  const missing = corrections.filter(c => !vectorExists(c.id));
  if (missing.length === 0) return;

  const { logInfo } = await import('../../utils/logger');
  logInfo(`[Corrections] Backfilling ${missing.length} correction(s) into vector store…`);

  for (const c of missing) {
    await indexCorrectionVector(c.id, c.creatorId, c.userMessage, c.chosenResponse)
      .catch(() => {});
  }

  logInfo(`[Corrections] Backfill complete.`);
}
