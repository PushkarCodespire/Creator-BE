// ===========================================
// CONTENT ROUTES
// ===========================================

import { Router } from 'express';
import { body, param } from 'express-validator';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import {
  addYouTubeContent,
  addManualContent,
  addFAQContent,
  getCreatorContent,
  getContentDetails,
  deleteContent,
  retrainContent
} from '../controllers/content.controller';
import { authenticate, requireCreator } from '../middleware/auth';
import { autoModerateContent } from '../middleware/ai-moderation.middleware';
import { validate } from '../middleware/validation';
import { validateContent } from '../middleware/content.validation';
// eslint-disable-next-line no-duplicate-imports
import { youtubeUrlSchema, manualContentSchema, faqSchema } from '../middleware/content.validation';
import { uploadVoiceAudioMulti } from '../middleware/upload';
import prisma from '../../prisma/client';
import { isCloudinaryConfigured, uploadToCloudinary } from '../utils/cloudinary';
import { buildUploadUrl } from '../utils/uploadPaths';

const router = Router();

// All routes require creator authentication
router.use(authenticate, requireCreator);

// Validation rules
const youtubeValidation = [
  body('url')
    .notEmpty()
    .withMessage('YouTube URL is required')
    .matches(/^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be)\/[^\s]+$/)
    .withMessage('Valid YouTube URL is required'),
  body('title')
    .optional()
    .trim()
    .isLength({ min: 1, max: 200 })
    .withMessage('Title must be between 1 and 200 characters'),
];

const _manualContentValidation = [
  body('title')
    .trim()
    .notEmpty()
    .withMessage('Title is required')
    .isLength({ min: 1, max: 200 })
    .withMessage('Title must be between 1 and 200 characters'),
  body('text')
    .trim()
    .notEmpty()
    .withMessage('Content text is required')
    .isLength({ min: 10, max: 50000 })
    .withMessage('Content must be between 10 and 50,000 characters'),
];

const _faqValidation = [
  body('title')
    .trim()
    .notEmpty()
    .withMessage('Title is required')
    .isLength({ min: 1, max: 200 })
    .withMessage('Title must be between 1 and 200 characters'),
  body('faqs')
    .isArray({ min: 1 })
    .withMessage('At least one FAQ is required'),
  body('faqs.*.question')
    .trim()
    .notEmpty()
    .withMessage('Question is required')
    .isLength({ min: 5, max: 500 })
    .withMessage('Question must be between 5 and 500 characters'),
  body('faqs.*.answer')
    .trim()
    .notEmpty()
    .withMessage('Answer is required')
    .isLength({ min: 5, max: 2000 })
    .withMessage('Answer must be between 5 and 2000 characters'),
];

const contentIdValidation = [
  param('contentId')
    .isUUID()
    .withMessage('Valid content ID is required'),
];

// Get or generate AI summary
router.get('/ai-summary', async (req, res) => {
  try {
    const creatorId = req.user?.creator?.id;
    if (!creatorId) return res.status(400).json({ success: false, error: { message: 'Creator profile not found' } });

    const creator = await prisma.creator.findUnique({
      where: { id: creatorId },
      select: { aiSummary: true, aiSummaryHash: true },
    });

    // Get current content hash
    const contents = await prisma.creatorContent.findMany({
      where: { creatorId, status: 'COMPLETED' },
      select: { id: true },
      orderBy: { id: 'asc' },
    });
    const currentHash = contents.map(c => c.id).join(',') + ':' + contents.length;

    // If summary exists and hash matches, return cached
    if (creator?.aiSummary && creator?.aiSummaryHash === currentHash) {
      return res.json({ success: true, data: { summary: creator.aiSummary, cached: true } });
    }

    // No cached summary or content changed
    res.json({ success: true, data: { summary: null, cached: false, needsRegenerate: true } });
  } catch (err: unknown) {
    res.status(500).json({ success: false, error: { message: err instanceof Error ? err.message : String(err) } });
  }
});

// Generate (or regenerate) AI summary
router.post('/ai-summary', async (req, res) => {
  try {
    const { generateChatCompletion } = require('../utils/openai');
    const creatorId = req.user?.creator?.id;
    if (!creatorId) return res.status(400).json({ success: false, error: { message: 'Creator profile not found' } });

    const contents = await prisma.creatorContent.findMany({
      where: { creatorId, status: 'COMPLETED' },
      select: { id: true, title: true, type: true, rawText: true },
      take: 10,
    });

    const creator = await prisma.creator.findUnique({
      where: { id: creatorId },
      select: { displayName: true, aiPersonality: true, aiTone: true, welcomeMessage: true, category: true, bio: true },
    });

    let contentSample = '';
    for (const c of contents) {
      contentSample += `\n[${c.type}: ${c.title}]\n${(c.rawText || '').substring(0, 500)}\n`;
      if (contentSample.length > 4000) break;
    }

    const prompt = `You are analyzing an AI avatar/chatbot for a creator platform. Based on the following creator profile and training content, generate a comprehensive summary.

Creator: ${creator?.displayName || 'Unknown'}
Category: ${creator?.category || 'General'}
Bio: ${creator?.bio || 'Not set'}
AI Personality: ${creator?.aiPersonality || 'Default'}
Tone: ${creator?.aiTone || 'friendly'}
Welcome Message: ${creator?.welcomeMessage || 'Hello!'}

Training Content (${contents.length} sources):
${contentSample}

Generate a summary with these sections:
1. **Who is this AI?** - A brief identity description
2. **Expertise Areas** - What topics can this AI confidently answer about
3. **Communication Style** - How will this AI talk to users
4. **Sample Questions & Answers** - Generate 3 example Q&As showing how this AI would respond
5. **Knowledge Gaps** - What topics might this AI NOT know about
6. **Recommendations** - What additional content should the creator add

Keep it concise and actionable.`;

    const result = await generateChatCompletion([
      { role: 'system', content: 'You are a helpful AI analysis assistant. Respond in markdown format.' },
      { role: 'user', content: prompt },
    ], { model: 'gpt-4o-mini', maxTokens: 1500 });

    // Save to DB
    const currentHash = contents.map(c => c.id).sort((a, b) => a.localeCompare(b)).join(',') + ':' + contents.length;
    await prisma.creator.update({
      where: { id: creatorId },
      data: { aiSummary: result.content, aiSummaryHash: currentHash },
    });

    res.json({ success: true, data: { summary: result.content, cached: false, tokensUsed: result.tokensUsed } });
  } catch (err: unknown) {
    res.status(500).json({ success: false, error: { message: (err instanceof Error ? err.message : String(err)) || 'Failed to generate summary' } });
  }
});

// Preview YouTube transcript (fetch only, don't process)
router.post('/youtube/preview', validate(youtubeValidation), async (req, res, _next) => {
  try {
    const { fetchCachedTranscript } = require('../services/content/youtube.service');
    const { url } = req.body;
    const result = await fetchCachedTranscript(url);
    res.json({
      success: true,
      data: {
        videoId: result.videoId,
        transcript: result.transcript,
        fullLength: result.transcript?.length || 0,
      }
    });
  } catch (err: unknown) {
    res.status(400).json({ success: false, error: { code: 'APP_ERROR', message: err instanceof Error ? err.message : String(err) } });
  }
});

// Add content (using Zod validation)
router.post('/youtube', validateContent(youtubeUrlSchema), addYouTubeContent);
router.post('/manual', validateContent(manualContentSchema), autoModerateContent('text', 'CREATOR_CONTENT'), addManualContent);
router.post('/faq', validateContent(faqSchema), addFAQContent);

// Get all content
router.get('/', getCreatorContent);

// RAG diagnostic — must be before /:contentId so Express doesn't swallow "debug-rag" as a UUID
// Usage: GET /api/content/debug-rag?q=incline+bench
router.get('/debug-rag', async (req, res) => {
  try {
    const userId = (req as unknown as { user?: { id: string } }).user?.id;
    if (!userId) { res.status(401).json({ error: 'Login required' }); return; }

    const prismaClient = (await import('../../prisma/client')).default;
    const creator = await prismaClient.creator.findUnique({ where: { userId }, select: { id: true, displayName: true } });
    if (!creator) { res.status(404).json({ error: 'No creator profile' }); return; }

    const chunks = await prismaClient.contentChunk.findMany({
      where: { content: { creatorId: creator.id, status: 'COMPLETED' } },
      select: { id: true, chunkIndex: true, text: true, embedding: true },
    });

    const report = chunks.map(c => {
      let embLen = 0;
      let embValid = false;
      try {
        const v = JSON.parse(c.embedding as string);
        embLen = Array.isArray(v) ? v.length : 0;
        embValid = embLen > 0;
      } catch { /* invalid */ }
      return { id: c.id, chunkIndex: c.chunkIndex, textPreview: c.text.slice(0, 80), embeddingDimension: embLen, embeddingValid: embValid };
    });

    const validCount = report.filter(r => r.embeddingValid).length;

    const query = (req.query.q as string) || 'incline bench upper chest';
    let searchResults: { rank: number; score: number; textPreview: string }[] = [];
    if (validCount > 0) {
      const { generateEmbedding } = await import('../utils/openai');
      const qVec = await generateEmbedding(query);
      const scored = chunks
        .map(c => {
          try {
            const v = JSON.parse(c.embedding as string) as number[];
            let dot = 0, nA = 0, nB = 0;
            for (let j = 0; j < v.length; j++) { dot += qVec[j] * v[j]; nA += qVec[j] ** 2; nB += v[j] ** 2; }
            const score = nA && nB ? dot / (Math.sqrt(nA) * Math.sqrt(nB)) : 0;
            return { score, textPreview: c.text.slice(0, 120) };
          } catch { return { score: 0, textPreview: c.text.slice(0, 120) }; }
        })
        .sort((a, b) => b.score - a.score)
        .slice(0, 5)
        .map((r, i) => ({ rank: i + 1, ...r }));
      searchResults = scored;
    }

    res.json({
      creator: creator.displayName,
      creatorId: creator.id,
      totalChunks: chunks.length,
      chunksWithValidEmbedding: validCount,
      chunksWithEmptyEmbedding: chunks.length - validCount,
      testQuery: query,
      top5Results: searchResults,
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ========================
// VOICE CLONE — must be before /:contentId routes
// Primary: Inworld (multi-sample cloning — up to 3 clips for best quality).
// Fallback: Chatterbox (free, Modal GPU, single-file zero-shot clone).
// ElevenLabs is kept for TTS playback only — not used for cloning.
// ========================

// Clone voice from up to 3 audio samples.
// More diverse samples → better voice quality (different emotions, pacing, phonemes).
router.post('/voice-clone', uploadVoiceAudioMulti, async (req, res) => {
  try {
    const chatterboxSvc = require('../services/voice/chatterbox.service');
    const inworldSvc    = require('../services/voice/inworld.service');

    const creatorId = req.user?.creator?.id;
    if (!creatorId) return res.status(400).json({ success: false, error: { message: 'Creator profile not found' } });

    // req.files is an array when using .array()
    const files = (req.files as Express.Multer.File[]) || [];
    if (!files.length) {
      return res.status(400).json({ success: false, error: { message: 'At least one audio file is required' } });
    }
    if (files.length > 10) {
      return res.status(400).json({ success: false, error: { message: 'Maximum 10 audio clips allowed' } });
    }

    // Reject suspiciously small files — likely empty recordings or corrupt uploads
    // ~10 KB is a very rough floor; real speech at any bitrate exceeds this easily
    const MIN_BYTES = 10 * 1024;
    const tooSmall  = files.filter(f => f.size < MIN_BYTES);
    if (tooSmall.length) {
      return res.status(400).json({ success: false, error: { message: `${tooSmall.map(f => f.originalname).join(', ')} — file too small. Minimum 15 seconds of speech required.` } });
    }

    const filePaths       = files.map(f => f.path);
    const firstPath       = filePaths[0]; // Chatterbox: single-file zero-shot clone
    const inworldPaths    = filePaths.slice(0, 3); // Inworld recommends max 3 diverse samples

    const existing = await prisma.creator.findUnique({
      where: { id: creatorId },
      select: { displayName: true, voiceIdChatterbox: true, voiceIdInworld: true },
    });

    await prisma.creator.update({
      where: { id: creatorId },
      data: { voiceStatus: 'PROCESSING', voiceProvider: 'inworld' },
    });

    // Clean up old Inworld voice before replacing (remote state in their system)
    if (existing?.voiceIdInworld && inworldSvc.isConfigured()) {
      await inworldSvc.deleteVoice(existing.voiceIdInworld).catch(() => {});
    }

    const name = `${existing?.displayName || 'Creator'} Voice`;

    // Clone on Inworld (primary) and Chatterbox (fallback) simultaneously.
    // Inworld receives ALL samples — more samples = better result.
    // Chatterbox receives only the first file (zero-shot, single reference).
    const [inworldRes, chatterboxRes] = await Promise.allSettled([
      inworldSvc.isConfigured()
        ? inworldSvc.cloneVoice(name, inworldPaths)
        : Promise.reject(new Error('Inworld not configured')),
      chatterboxSvc.isConfigured()
        ? chatterboxSvc.cloneVoice(name, firstPath)
        : Promise.reject(new Error('Chatterbox not configured')),
    ]);

    const voiceIdInworld    = inworldRes.status    === 'fulfilled' ? inworldRes.value    : null;
    const voiceIdChatterbox = chatterboxRes.status === 'fulfilled' ? chatterboxRes.value : null;

    // Prefer Inworld; fall back to Chatterbox if Inworld failed
    const effectiveId       = voiceIdInworld || voiceIdChatterbox;
    const effectiveProvider = voiceIdInworld ? 'inworld' : (voiceIdChatterbox ? 'chatterbox' : null);

    if (!effectiveId || !effectiveProvider) {
      const errMsg = inworldRes.status === 'rejected'
        ? (inworldRes.reason instanceof Error ? inworldRes.reason.message : String(inworldRes.reason))
        : 'Voice clone failed';
      await prisma.creator.update({ where: { id: creatorId }, data: { voiceStatus: 'FAILED' } }).catch(() => {});
      return res.status(500).json({ success: false, error: { message: errMsg } });
    }

    // Build persistent URLs for each uploaded sample.
    // Wrapped in try/catch — a URL-building failure must never cancel a successful voice clone.
    type VoiceSampleMeta = { id: string; name: string; url: string; duration: number; createdAt: string };
    let voiceSamples: VoiceSampleMeta[] = [];
    try {
      voiceSamples = await Promise.all(files.map(async (file): Promise<VoiceSampleMeta> => {
        let url: string;
        try {
          if (isCloudinaryConfigured) {
            const buffer = fs.readFileSync(file.path);
            url = await uploadToCloudinary(buffer, 'voice-samples', 'video', ['voice_sample']);
          } else {
            url = buildUploadUrl(`chat/${file.filename}`);
          }
        } catch {
          // Fall back to local path so the sample is still recorded
          url = buildUploadUrl(`chat/${file.filename}`);
        }
        return {
          id:        uuidv4(),
          name:      file.originalname.replace(/\.[^.]+$/, ''),
          url,
          duration:  0,
          createdAt: new Date().toISOString(),
        };
      }));
    } catch {
      // voiceSamples stays empty — clone still succeeds
    }

    await prisma.creator.update({
      where: { id: creatorId },
      data: {
        voiceId:          effectiveId,
        voiceIdInworld,
        voiceIdChatterbox,
        voiceIdElevenlabs: null, // ElevenLabs no longer used for cloning
        voiceStatus:      'READY',
        voiceProvider:    effectiveProvider,
        voiceSamples,
      },
    });

    res.json({
      success: true,
      data: {
        voiceId:       effectiveId,
        status:        'READY',
        voiceProvider: effectiveProvider,
        sampleCount:   filePaths.length,
        voiceSamples,
        providers: {
          inworld:    !!voiceIdInworld,
          chatterbox: !!voiceIdChatterbox,
        },
      },
    });
  } catch (err: unknown) {
    const creatorId = req.user?.creator?.id;
    if (creatorId) {
      await prisma.creator.update({ where: { id: creatorId }, data: { voiceStatus: 'FAILED' } }).catch(() => {});
    }
    res.status(500).json({ success: false, error: { message: (err instanceof Error ? err.message : String(err)) || 'Voice clone failed' } });
  }
});

// Generate a short preview TTS so the creator can verify their clone sounds right.
// Called immediately after cloning completes.
router.post('/voice-preview', async (req, res) => {
  try {
    const creatorId = req.user?.creator?.id;
    if (!creatorId) return res.status(400).json({ success: false, error: { message: 'Creator profile not found' } });

    const [creator, prosodyRows] = await Promise.all([
      prisma.creator.findUnique({
        where:  { id: creatorId },
        select: { voiceIdInworld: true, voiceIdChatterbox: true, voiceProvider: true, displayName: true },
      }),
      prisma.$queryRaw<Array<{ voiceSpeakingRate: number | null; voicePitch: number | null }>>`
        SELECT "voiceSpeakingRate", "voicePitch" FROM "Creator" WHERE id::text = ${creatorId}
      `,
    ]);
    const creatorVoice = { ...creator, ...prosodyRows[0] };

    const voiceId = creator?.voiceIdInworld || creator?.voiceIdChatterbox;
    if (!voiceId) {
      return res.status(400).json({ success: false, error: { message: 'No voice clone found. Clone your voice first.' } });
    }

    const name         = creator?.displayName || 'there';
    const previewText  = `Hey, it's ${name}! Your AI voice clone is ready. Every response will now sound just like this — powered by your real voice.`;
    const inworldSvc   = require('../services/voice/inworld.service');
    const chatterboxSvc = require('../services/voice/chatterbox.service');

    // Try each configured provider in order; on failure fall through to null
    let audioUrl: string | null = null;
    let previewError: string | null = null;

    if (creator?.voiceIdInworld && inworldSvc.isConfigured()) {
      try {
        const audioPath = await inworldSvc.textToSpeech(creator.voiceIdInworld, previewText, {
          speakingRate: creatorVoice.voiceSpeakingRate ?? undefined,
          pitch:        creatorVoice.voicePitch        ?? undefined,
        });
        const baseUrl   = process.env.API_URL || process.env.RENDER_EXTERNAL_URL || `http://localhost:${process.env.PORT || 5000}`;
        audioUrl = audioPath.startsWith('http') ? audioPath : `${baseUrl}/uploads/${audioPath}`;
      } catch (ttsErr: unknown) {
        previewError = ttsErr instanceof Error ? ttsErr.message : String(ttsErr);
        console.error('[voice-preview] Inworld TTS failed:', previewError);
      }
    }

    if (!audioUrl && creator?.voiceIdChatterbox && chatterboxSvc.isConfigured()) {
      try {
        const audioPath = await chatterboxSvc.textToSpeech(creator.voiceIdChatterbox, previewText);
        const baseUrl   = process.env.API_URL || process.env.RENDER_EXTERNAL_URL || `http://localhost:${process.env.PORT || 5000}`;
        audioUrl = audioPath.startsWith('http') ? audioPath : `${baseUrl}/uploads/${audioPath}`;
        previewError = null; // chatterbox succeeded, clear the error
      } catch (ttsErr: unknown) {
        const cbErr = ttsErr instanceof Error ? ttsErr.message : String(ttsErr);
        previewError = previewError ? `${previewError} | Chatterbox: ${cbErr}` : cbErr;
        console.error('[voice-preview] Chatterbox TTS failed:', cbErr);
      }
    }

    // Always return 200 — null audioUrl means preview is unavailable
    // previewError included so the creator dashboard can show what went wrong
    res.json({ success: true, data: { audioUrl, previewError } });
  } catch (err: unknown) {
    res.status(500).json({ success: false, error: { message: err instanceof Error ? err.message : String(err) } });
  }
});

// Get voice clone status
router.get('/voice-clone', async (req, res) => {
  try {
    const creatorId = req.user?.creator?.id;
    if (!creatorId) return res.status(400).json({ success: false, error: { message: 'Creator profile not found' } });

    const [creator, prosodyRows] = await Promise.all([
      prisma.creator.findUnique({
        where: { id: creatorId },
        select: {
          voiceId: true,
          voiceIdChatterbox: true,
          voiceIdInworld: true,
          voiceIdElevenlabs: true,
          voiceStatus: true,
          voiceProvider: true,
          voiceSamples: true,
        },
      }),
      prisma.$queryRaw<Array<{ voiceSpeakingRate: number | null; voicePitch: number | null }>>`
        SELECT "voiceSpeakingRate", "voicePitch" FROM "Creator" WHERE id::text = ${creatorId}
      `,
    ]);

    const prosody = prosodyRows[0];
    res.json({
      success: true,
      data: {
        voiceId:       creator?.voiceId,
        status:        creator?.voiceStatus,
        voiceProvider: creator?.voiceProvider || 'inworld',
        voiceSamples:  (creator?.voiceSamples ?? []) as Array<{ id: string; name: string; url: string; duration: number; createdAt: string }>,
        speakingRate:  prosody?.voiceSpeakingRate ?? null,
        pitch:         prosody?.voicePitch        ?? null,
        providers: {
          chatterbox: !!creator?.voiceIdChatterbox,
          inworld:    !!creator?.voiceIdInworld,
          elevenlabs: !!creator?.voiceIdElevenlabs,
        },
      },
    });
  } catch (err: unknown) {
    res.status(500).json({ success: false, error: { message: err instanceof Error ? err.message : String(err) } });
  }
});

// Update per-creator TTS prosody settings (speaking rate + pitch)
router.patch('/voice-clone/settings', async (req, res) => {
  try {
    const creatorId = req.user?.creator?.id;
    if (!creatorId) return res.status(400).json({ success: false, error: { message: 'Creator profile not found' } });

    const { speakingRate, pitch } = req.body as { speakingRate?: unknown; pitch?: unknown };

    if (speakingRate !== undefined) {
      const r = Number(speakingRate);
      if (isNaN(r) || r < 0.25 || r > 2.0)
        return res.status(400).json({ success: false, error: { message: 'speakingRate must be between 0.25 and 2.0' } });
    }
    if (pitch !== undefined) {
      const p = Number(pitch);
      if (isNaN(p) || p < -5 || p > 5)
        return res.status(400).json({ success: false, error: { message: 'pitch must be between -5 and 5' } });
    }

    const r = speakingRate !== undefined ? Number(speakingRate) : null;
    const p = pitch        !== undefined ? Number(pitch)        : null;

    // Use raw SQL — these columns were added after the last Prisma client generation
    if (r !== null && p !== null) {
      await prisma.$executeRaw`UPDATE "Creator" SET "voiceSpeakingRate" = ${r}, "voicePitch" = ${p} WHERE id::text = ${creatorId}`;
    } else if (r !== null) {
      await prisma.$executeRaw`UPDATE "Creator" SET "voiceSpeakingRate" = ${r} WHERE id::text = ${creatorId}`;
    } else if (p !== null) {
      await prisma.$executeRaw`UPDATE "Creator" SET "voicePitch" = ${p} WHERE id::text = ${creatorId}`;
    }

    res.json({ success: true, data: { speakingRate: r, pitch: p } });
  } catch (err: unknown) {
    res.status(500).json({ success: false, error: { message: err instanceof Error ? err.message : String(err) } });
  }
});

// Rename a voice sample
router.patch('/voice-clone/samples/:sampleId', async (req, res) => {
  try {
    const creatorId = req.user?.creator?.id;
    if (!creatorId) return res.status(400).json({ success: false, error: { message: 'Creator profile not found' } });

    const { sampleId } = req.params;
    const name = (req.body.name as string | undefined)?.trim();
    if (!name) return res.status(400).json({ success: false, error: { message: 'Name is required' } });

    const creator = await prisma.creator.findUnique({ where: { id: creatorId }, select: { voiceSamples: true } });
    const samples = (creator?.voiceSamples ?? []) as Array<{ id: string; name: string; url: string; duration: number; createdAt: string }>;
    const idx = samples.findIndex(s => s.id === sampleId);
    if (idx === -1) return res.status(404).json({ success: false, error: { message: 'Sample not found' } });

    samples[idx] = { ...samples[idx], name };
    await prisma.creator.update({ where: { id: creatorId }, data: { voiceSamples: samples } });

    res.json({ success: true, data: { sample: samples[idx] } });
  } catch (err: unknown) {
    res.status(500).json({ success: false, error: { message: err instanceof Error ? err.message : String(err) } });
  }
});

// Delete a single voice sample
router.delete('/voice-clone/samples/:sampleId', async (req, res) => {
  try {
    const creatorId = req.user?.creator?.id;
    if (!creatorId) return res.status(400).json({ success: false, error: { message: 'Creator profile not found' } });

    const { sampleId } = req.params;
    const creator = await prisma.creator.findUnique({ where: { id: creatorId }, select: { voiceSamples: true } });
    const samples = (creator?.voiceSamples ?? []) as Array<{ id: string; name: string; url: string; duration: number; createdAt: string }>;
    const updated = samples.filter(s => s.id !== sampleId);

    if (updated.length === samples.length) {
      return res.status(404).json({ success: false, error: { message: 'Sample not found' } });
    }

    await prisma.creator.update({ where: { id: creatorId }, data: { voiceSamples: updated } });
    res.json({ success: true, data: { remainingSamples: updated } });
  } catch (err: unknown) {
    res.status(500).json({ success: false, error: { message: err instanceof Error ? err.message : String(err) } });
  }
});

// Delete voice clone
router.delete('/voice-clone', async (req, res) => {
  try {
    const creatorId = req.user?.creator?.id;
    if (!creatorId) return res.status(400).json({ success: false, error: { message: 'Creator profile not found' } });

    const creator = await prisma.creator.findUnique({
      where: { id: creatorId },
      select: { voiceIdChatterbox: true, voiceIdInworld: true, voiceIdElevenlabs: true },
    });

    const elevenlabsSvc = require('../services/voice/elevenlabs.service');

    if (creator?.voiceIdElevenlabs && elevenlabsSvc.isConfigured()) {
      await elevenlabsSvc.deleteVoice(creator.voiceIdElevenlabs).catch(() => {});
    }

    await prisma.creator.update({
      where: { id: creatorId },
      data: {
        voiceId: null,
        voiceIdChatterbox: null,
        voiceIdInworld: null,
        voiceIdElevenlabs: null,
        voiceStatus: null,
        voiceSamples: [],
      },
    });

    res.json({ success: true, data: { message: 'Voice clone deleted' } });
  } catch (err: unknown) {
    res.status(500).json({ success: false, error: { message: err instanceof Error ? err.message : String(err) } });
  }
});

// Get content details
router.get('/:contentId', validate(contentIdValidation), getContentDetails);

// Delete content
router.delete('/:contentId', validate(contentIdValidation), deleteContent);

// Retrain content
router.post('/:contentId/retrain', validate(contentIdValidation), retrainContent);

export default router;
