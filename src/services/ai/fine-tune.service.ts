// ===========================================
// TRAINING SERVICE (RAG-only — no fine-tuning)
// ===========================================
// Instead of uploading to OpenAI for fine-tuning, corrections and
// fewShot Q&A are embedded and stored in the vector DB as high-priority
// examples.  They are retrieved via similarity search on every chat request
// (injected as `correctionExamples` in the system prompt).
//
// This is cheaper, instant, and works with Gemini or OpenAI embeddings.
// ===========================================

import { buildCreatorSystemPrompt, PersonaConfig, FewShotQA } from '../../utils/openai';
import { storeVector } from '../../utils/vectorStore';
import { generateEmbedding } from '../content/embedding.service';
import prisma from '../../../prisma/client';
import { logInfo, logWarning } from '../../utils/logger';

const MIN_EXAMPLES = 3; // minimum before RAG indexing makes sense

export interface FineTuneResult {
  jobId: string;
  status: string;
}

// ── Collect training examples from DB ────────────────────────────────────────

async function collectExamples(creatorId: string): Promise<{
  examples: { question: string; answer: string }[];
  systemPrompt: string;
}> {
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
        take: 200,
      },
    },
  });

  if (!creator) throw new Error('Creator not found');

  const fewShotQA = (creator.fewShotQA as unknown as FewShotQA[] | null) || [];
  const answeredQA = fewShotQA.filter(qa => qa.answer?.trim());

  const systemPrompt = buildCreatorSystemPrompt({
    creatorName:   creator.displayName,
    personality:   creator.aiPersonality || undefined,
    tone:          creator.aiTone || undefined,
    responseStyle: creator.responseStyle || undefined,
    welcomeMessage: creator.welcomeMessage || undefined,
    personaConfig: (creator.personaConfig as PersonaConfig | null) || null,
    fewShotQA:     null,
    relevantChunks: [],
  });

  const examples: { question: string; answer: string }[] = [
    ...answeredQA.map(qa => ({ question: qa.scenario, answer: qa.answer.trim() })),
    ...creator.corrections.map(c => ({ question: c.userMessage, answer: c.chosenResponse })),
  ];

  return { examples, systemPrompt };
}

// ── Trigger RAG indexing ──────────────────────────────────────────────────────

export async function triggerCreatorFineTune(creatorId: string): Promise<FineTuneResult> {
  const { examples } = await collectExamples(creatorId);

  if (examples.length < MIN_EXAMPLES) {
    throw new Error(
      `Need at least ${MIN_EXAMPLES} training examples to index (have ${examples.length}). ` +
      `Add more corrections or Q&A pairs in your AI settings.`
    );
  }

  const jobId = `rag-${creatorId}-${Date.now()}`;
  let indexed = 0;
  let skipped = 0;

  logInfo(`[RAG Training] Indexing ${examples.length} examples for creator ${creatorId}`);

  for (let i = 0; i < examples.length; i++) {
    const { question, answer } = examples[i];
    if (!question?.trim() || !answer?.trim()) { skipped++; continue; }

    try {
      // Store as a combined Q&A text so similarity search can retrieve it
      // when a fan asks something similar to the question.
      const combinedText = `Q: ${question.trim()}\nA: ${answer.trim()}`;
      const embedding    = await generateEmbedding(combinedText);

      storeVector({
        id:        `correction-${creatorId}-${i}`,
        creatorId,
        text:      combinedText,
        embedding,
        metadata:  {
          type:     'correction',
          priority: 'high',
          question: question.trim(),
          answer:   answer.trim(),
        },
      });

      indexed++;
    } catch (err) {
      logWarning(`[RAG Training] Failed to embed example ${i}: ${err instanceof Error ? err.message : String(err)}`);
      skipped++;
    }
  }

  logInfo(`[RAG Training] Done: ${indexed} indexed, ${skipped} skipped`);

  // Mark as ready in the DB — no external job to poll
  await prisma.creator.update({
    where: { id: creatorId },
    data: {
      fineTuneJobId:    jobId,
      fineTuneStatus:   'ready',
      fineTunedModelId: null, // RAG mode — base model is used, no custom model
      lastFineTunedAt:  new Date(),
    },
  });

  return { jobId, status: 'ready' };
}

// ── Status check ──────────────────────────────────────────────────────────────

export async function syncFineTuneStatus(creatorId: string): Promise<{
  status: string;
  modelId: string | null;
  lastFineTunedAt: Date | null;
}> {
  const creator = await prisma.creator.findUnique({
    where: { id: creatorId },
    select: { fineTuneStatus: true, lastFineTunedAt: true },
  });

  // RAG is always "ready" once indexed — nothing to poll
  return {
    status:          creator?.fineTuneStatus || 'none',
    modelId:         null, // no custom model in RAG mode
    lastFineTunedAt: creator?.lastFineTunedAt ?? null,
  };
}
