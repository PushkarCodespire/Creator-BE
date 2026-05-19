// ===========================================
// FINE-TUNE SERVICE
// Formats creator corrections → OpenAI supervised fine-tuning
// ===========================================

import { openai, buildCreatorSystemPrompt, PersonaConfig, FewShotQA } from '../../utils/openai';
import prisma from '../../../prisma/client';

const MIN_CORRECTIONS = 10; // minimum before fine-tuning makes sense

export interface FineTuneResult {
  jobId: string;
  status: string;
}

// ── Build JSONL training data from creator corrections ────────────────────────
async function buildTrainingData(creatorId: string): Promise<{ jsonl: string; totalExamples: number }> {
  const creator = await prisma.creator.findUnique({
    where: { id: creatorId },
    select: {
      displayName: true,
      aiPersonality: true,
      aiTone: true,
      responseStyle: true,
      welcomeMessage: true,
      personaConfig: true,
      fewShotQA: true,
      corrections: {
        where: { isActive: true },
        orderBy: { createdAt: 'desc' },
        take: 100,
      },
    },
  });

  if (!creator) throw new Error('Creator not found');

  // Parse fewShotQA — stored as JSON, shape: { scenario: string; answer: string }[]
  const fewShotQA = (creator.fewShotQA as FewShotQA[] | null) || [];
  const answeredQA = fewShotQA.filter(qa => qa.answer?.trim());

  const totalExamples = creator.corrections.length + answeredQA.length;
  if (totalExamples < MIN_CORRECTIONS) {
    throw new Error(`Need at least ${MIN_CORRECTIONS} training examples to fine-tune (have ${totalExamples})`);
  }

  // System prompt without fewShotQA — the Q&A examples become the training examples
  // themselves rather than sitting in every system prompt (that would double-count them).
  const systemPrompt = buildCreatorSystemPrompt({
    creatorName: creator.displayName,
    personality: creator.aiPersonality || undefined,
    tone: creator.aiTone || undefined,
    responseStyle: creator.responseStyle || undefined,
    welcomeMessage: creator.welcomeMessage || undefined,
    personaConfig: (creator.personaConfig as PersonaConfig | null) || null,
    fewShotQA: null,
    relevantChunks: [],
  });

  const lines: string[] = [];

  // 1. fewShotQA examples — creator's own curated answers, highest voice signal
  for (const qa of answeredQA) {
    lines.push(JSON.stringify({
      messages: [
        { role: 'system',    content: systemPrompt },
        { role: 'user',      content: qa.scenario },
        { role: 'assistant', content: qa.answer.trim() },
      ],
    }));
  }

  // 2. Corrections — real fan questions with creator-approved answers
  for (const c of creator.corrections) {
    lines.push(JSON.stringify({
      messages: [
        { role: 'system',    content: systemPrompt },
        { role: 'user',      content: c.userMessage },
        { role: 'assistant', content: c.chosenResponse },
      ],
    }));
  }

  return { jsonl: lines.join('\n'), totalExamples };
}

// ── Upload JSONL to OpenAI Files API ─────────────────────────────────────────
async function uploadTrainingFile(jsonl: string): Promise<string> {
  const buffer = Buffer.from(jsonl, 'utf-8');
  const blob = new Blob([buffer], { type: 'application/jsonl' });
  const file = new File([blob], 'training.jsonl', { type: 'application/jsonl' });

  const uploaded = await openai.files.create({
    file,
    purpose: 'fine-tune',
  });

  return uploaded.id;
}

// ── Trigger fine-tuning job ───────────────────────────────────────────────────
export async function triggerCreatorFineTune(creatorId: string): Promise<FineTuneResult> {
  const { jsonl } = await buildTrainingData(creatorId);
  const fileId = await uploadTrainingFile(jsonl);

  const job = await openai.fineTuning.jobs.create({
    training_file: fileId,
    model: 'gpt-4o-mini-2024-07-18',
  });

  // Persist job ID + pending status
  await prisma.creator.update({
    where: { id: creatorId },
    data: {
      fineTuneJobId:  job.id,
      fineTuneStatus: 'pending',
    },
  });

  return { jobId: job.id, status: job.status };
}

// ── Poll job status (called by GET /training/status) ─────────────────────────
export async function syncFineTuneStatus(creatorId: string): Promise<{
  status: string;
  modelId: string | null;
  lastFineTunedAt: Date | null;
}> {
  const creator = await prisma.creator.findUnique({
    where: { id: creatorId },
    select: { fineTuneJobId: true, fineTuneStatus: true, fineTunedModelId: true, lastFineTunedAt: true },
  });

  if (!creator?.fineTuneJobId) {
    return { status: creator?.fineTuneStatus || 'none', modelId: null, lastFineTunedAt: null };
  }

  // If already settled, return cached state (no OpenAI call needed)
  if (creator.fineTuneStatus === 'ready' || creator.fineTuneStatus === 'failed') {
    return {
      status: creator.fineTuneStatus,
      modelId: creator.fineTunedModelId,
      lastFineTunedAt: creator.lastFineTunedAt,
    };
  }

  // Still pending — check OpenAI
  const job = await openai.fineTuning.jobs.retrieve(creator.fineTuneJobId);

  if (job.status === 'succeeded' && job.fine_tuned_model) {
    await prisma.creator.update({
      where: { id: creatorId },
      data: {
        fineTuneStatus:   'ready',
        fineTunedModelId: job.fine_tuned_model,
        lastFineTunedAt:  new Date(),
      },
    });
    return { status: 'ready', modelId: job.fine_tuned_model, lastFineTunedAt: new Date() };
  }

  if (job.status === 'failed') {
    await prisma.creator.update({
      where: { id: creatorId },
      data: { fineTuneStatus: 'failed' },
    });
    return { status: 'failed', modelId: null, lastFineTunedAt: null };
  }

  return { status: 'pending', modelId: null, lastFineTunedAt: null };
}
