// ===========================================
// CHAT CONTROLLER
// Core AI-powered chat functionality
// ===========================================

// ── In-memory corrections cache ───────────────────────────────────────────────
// Avoids a DB query on every message. TTL: 5 min.
// Exported so training.controller can invalidate on save/toggle/delete.
const _corrCache = new Map<string, { data: { userMessage: string; chosenResponse: string }[]; ts: number }>();
const CORR_TTL = 5 * 60 * 1000;

export function invalidateCorrectionsCache(creatorId: string) {
  _corrCache.delete(creatorId);
}

async function getCachedCorrections(creatorId: string, prismaClient: typeof import('../../prisma/client').default) {
  const cached = _corrCache.get(creatorId);
  if (cached && Date.now() - cached.ts < CORR_TTL) return cached.data;
  const data = await prismaClient.messageCorrection.findMany({
    where:   { creatorId, isActive: true },
    orderBy: { createdAt: 'desc' },
    take:    5, // max 5 → ~200 extra tokens per message
    select:  { userMessage: true, chosenResponse: true },
  });
  _corrCache.set(creatorId, { data, ts: Date.now() });
  return data;
}
// ─────────────────────────────────────────────────────────────────────────────

import { Request, Response } from 'express';
import { ModerationAction, ReportType } from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';
import prisma from '../../prisma/client';
import { asyncHandler, AppError } from '../middleware/errorHandler';
import { config } from '../config';
import {
  generateCreatorResponse,
  isOpenAIConfigured,
  isAIConfigured,
  stripMarkdown
} from '../utils/openai';
import { buildEnhancedContext } from '../utils/contextBuilder';
import { emitToConversation, emitToUser } from '../sockets';
import type { Server } from 'socket.io';
import {
  getToxicityScore,
  getFlaggedWords,
  shouldAutoFlag
} from '../utils/profanityFilter';
import { distributeEarnings } from '../utils/earnings';
import moderationActionsService from '../services/moderation/moderation-actions.service';
import { buildAttachmentContext } from '../services/media/media-processor.service';
import { preprocessForTTS } from '../utils/voiceTextProcessor';
import * as notificationService from '../services/notification.service';
import { getRedisClient, isRedisConfigured, isRedisConnected } from '../utils/redis';
import { logError, logDebug, logWarning, logInfo } from '../utils/logger';

// ===========================================
// START OR GET CONVERSATION
// ===========================================

export const startConversation = asyncHandler(async (req: Request, res: Response) => {
  const { creatorId } = req.body;
  const userId = req.user?.id;
  const guestId = req.headers['x-guest-id'] as string;

  if (!creatorId) {
    throw new AppError('Creator ID is required', 400);
  }

  // Verify creator exists
  const creator = await prisma.creator.findUnique({
    where: { id: creatorId },
    select: {
      id: true,
      displayName: true,
      welcomeMessage: true,
      isActive: true,
      allowNewConversations: true
    }
  });

  if (!creator || !creator.isActive) {
    throw new AppError('Creator not found or inactive', 404);
  }

  // Check for existing conversation
  let conversation = await prisma.conversation.findFirst({
    where: {
      creatorId,
      ...(userId ? { userId } : { guestId })
    },
    include: {
      messages: {
        orderBy: { createdAt: 'desc' },
        take: 20
      }
    }
  });

  if (!conversation && !creator.allowNewConversations) {
    throw new AppError('Creator is not accepting new conversations', 403);
  }

  // Create new conversation if none exists
  if (!conversation) {
    conversation = await prisma.conversation.create({
      data: {
        creatorId,
        userId: userId || null,
        guestId: userId ? null : (guestId || uuidv4())
      },
      include: {
        messages: true
      }
    });

    // Add welcome message if configured
    if (creator.welcomeMessage) {
      await prisma.message.create({
        data: {
          conversationId: conversation.id,
          role: 'ASSISTANT',
          content: creator.welcomeMessage
        }
      });

      conversation = await prisma.conversation.findUnique({
        where: { id: conversation.id },
        include: {
          messages: {
            orderBy: { createdAt: 'asc' }
          }
        }
      });
    }
  }

  res.json({
    success: true,
    data: {
      conversation,
      creator: {
        id: creator.id,
        displayName: creator.displayName
      },
      guestId: conversation?.guestId
    }
  });
});

// ===========================================
// SEND MESSAGE
// ===========================================

export const sendMessage = asyncHandler(async (req: Request, res: Response) => {
  const { conversationId, content, media, voiceMode } = req.body;
  const userId = req.user?.id;
  const guestId = req.headers['x-guest-id'] as string;
  const ip =
    (req.headers['x-forwarded-for'] as string)?.split(',')[0].trim() ||
    req.ip ||
    req.socket.remoteAddress ||
    'unknown';

  if (!conversationId) {
    throw new AppError('Conversation ID is required', 400);
  }

  if (!content?.trim() && (!media || media.length === 0)) {
    throw new AppError('Message content or media is required', 400);
  }

  if (content && content.length > 2000) {
    throw new AppError('Message must be less than 2000 characters', 400);
  }

  // Get conversation with creator info
  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId as string },
    include: {
      creator: {
        select: {
          id: true,
          userId: true,
          displayName: true,
          aiPersonality: true,
          aiTone: true,
          responseStyle: true,
          welcomeMessage: true,
          personaConfig: true,
          fewShotQA: true,
          fineTunedModelId: true,
          voiceId: true,
          voiceIdInworld: true,
        }
      },
      messages: {
        orderBy: { createdAt: 'desc' },
        take: 10
      }
    }
  });

  if (!conversation) {
    throw new AppError('Conversation not found', 404);
  }

  // Verify ownership
  if (userId && conversation.userId !== userId) {
    throw new AppError('Unauthorized', 403);
  }
  if (!userId && conversation.guestId !== guestId) {
    throw new AppError('Unauthorized', 403);
  }

  // Fetch user onboarding profile for personalised AI responses
  let userProfile: string | undefined;
  if (userId) {
    const fanProfile = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        ageRange:        true,
        fitnessGoal:     true,
        fitnessChallenge: true,
        coachStyle:      true,
        dietPreference:  true,
        heightCm:        true,
        weightKg:        true,
      }
    });
    if (fanProfile) {
      const parts: string[] = [];
      if (fanProfile.fitnessGoal)      parts.push(`Goal: ${fanProfile.fitnessGoal}`);
      if (fanProfile.fitnessChallenge) parts.push(`Biggest challenge: ${fanProfile.fitnessChallenge}`);
      if (fanProfile.coachStyle)       parts.push(`Preferred coaching style: ${fanProfile.coachStyle}`);
      if (fanProfile.dietPreference)   parts.push(`Diet: ${fanProfile.dietPreference}`);
      if (fanProfile.ageRange)         parts.push(`Age range: ${fanProfile.ageRange}`);
      if (fanProfile.heightCm)         parts.push(`Height: ${fanProfile.heightCm}cm`);
      if (fanProfile.weightKg)         parts.push(`Weight: ${fanProfile.weightKg}kg`);
      if (parts.length > 0) {
        userProfile = `Fan profile — ${parts.join(', ')}.`;
        logInfo(`[Chat] User profile injected for ${userId}: ${userProfile}`);
      } else {
        logInfo(`[Chat] No onboarding data for user ${userId} — all profile fields are null`);
      }
    }
  }

  // Check message limits
  await checkMessageLimits(userId, guestId, ip);

  // Check for profanity and toxicity (fall back to empty string for media-only messages)
  const messageText = (content || '').trim();
  const toxicityScore = getToxicityScore(messageText);
  const flaggedKeywords = getFlaggedWords(messageText);
  const autoFlag = shouldAutoFlag(messageText);
  const moderationResult = (req as unknown as { moderationResult?: { shouldFlag: boolean } }).moderationResult;

  // Save user message with moderation data
  const userMessage = await prisma.message.create({
    data: {
      conversationId,
      userId: userId || null,
      role: 'USER',
      content: messageText,
      media: media || null,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      toxicityScore: toxicityScore as any,
      flaggedKeywords
    }
  });

  // If AI flagged content, create report and log action
  if (moderationResult && moderationResult.shouldFlag) {
    await moderationActionsService.createAIReport(
      ReportType.MESSAGE,
      userMessage.id,
      userId || null,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      moderationResult as any
    ).catch((err: unknown) => {
      logError(err instanceof Error ? err : new Error(String(err)), { context: 'Failed to create AI moderation report' });
    });

    await moderationActionsService.logModerationAction(
      'MESSAGE',
      userMessage.id,
      ModerationAction.NO_ACTION,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      moderationResult as any
    );
  }

  // Auto-create report if message is flagged
  if (autoFlag) {
    await prisma.report.create({
      data: {
        reporterId: userId,
        targetType: 'MESSAGE',
        targetId: userMessage.id,
        reason: toxicityScore >= 0.8 ? 'HATE_SPEECH' : 'HARASSMENT',
        description: 'Auto-flagged by profanity filter',
        priority: toxicityScore >= 0.8 ? 'HIGH' : 'MEDIUM',
        status: 'PENDING',
        metadata: {
          toxicityScore,
          flaggedKeywords,
          autoFlagged: true
        }
      }
    }).catch((err: unknown) => {
      // Don't fail the message send if report creation fails
      logError(err instanceof Error ? err : new Error(String(err)), { context: 'Failed to create auto-flag report' });
    });
  }

  // Block abusive guest IPs to prevent repeated misuse when bad language is detected
  if (!userId && (autoFlag || flaggedKeywords.length > 0 || (toxicityScore ?? 0) >= 0.8)) {
    await blockGuestIp(ip);
  }

  // Get Socket.io instance
  const io: Server = req.app.get('io');

  // Notify the creator (out-of-band) that a fan/user sent a new message
  if (conversation.creator.userId && conversation.creator.userId !== userId) {
    await notificationService.createAndEmit(io, {
      userId: conversation.creator.userId,
      type: 'CHAT_MESSAGE',
      title: 'New chat message',
      message: messageText || 'You have a new message',
      actionUrl: `/conversations/${conversationId}`,
      data: {
        conversationId,
        senderId: userId || guestId || 'guest',
        creatorId: conversation.creator.id
      }
    }).catch((err) => {
      logError(err instanceof Error ? err : new Error(String(err)), { context: 'Failed to send chat notification to creator' });
    });
  }

  // Emit user message to conversation room
  emitToConversation(conversationId, 'message:new', {
    message: userMessage
  });

  // Also push to the creator's user room so their inbox updates in real time
  if (conversation.creator.userId && conversation.creator.userId !== userId) {
    emitToUser(conversation.creator.userId, 'creator:message:new', {
      conversationId,
      message: userMessage,
      creatorId: conversation.creator.id
    });
  }

  // ===========================================
  // MANUAL TAKEOVER GATE
  // If the creator has taken over this conversation, the AI must NOT
  // respond. Save the user message (done above), notify the creator
  // (done above), bump quota for FREE users, and return immediately.
  // The creator will reply manually via /api/creators/conversations/me/:id/reply.
  // ===========================================
  if ((conversation as unknown as { chatMode?: string }).chatMode === 'MANUAL') {
    if (userId) {
      const subscription = await prisma.subscription.findUnique({
        where: { userId },
        select: { id: true, plan: true }
      });
      if (subscription && subscription.plan !== 'PREMIUM') {
        await prisma.subscription.update({
          where: { id: subscription.id },
          data: { messagesUsedToday: { increment: 1 } }
        });
      }
    }

    res.json({
      success: true,
      data: {
        userMessage,
        aiMessage: null,
        manualMode: true
      }
    });
    return;
  }

  // Generate AI response
  let aiResponse = { content: '', tokensUsed: 0 };

  if (isAIConfigured()) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { combined: attachmentContext } = await buildAttachmentContext(media as any);

      const userPrompt = [
        messageText,
        attachmentContext ? `Attachment context:\n${attachmentContext}` : ''
      ].filter(Boolean).join('\n\n') || '[User sent media attachments]';

      // Build conversation history
      const conversationHistory = conversation.messages
        .reverse()
        .map((m) => ({
          role: m.role.toLowerCase() as 'user' | 'assistant',
          content: m.content
        }));

      // ── RAG retrieval ────────────────────────────────────────────────────────
      // Skip entirely for conversational / short messages — generating an
      // embedding + searching the vector store for "thanks" or "hey" is pure
      // waste. Only run RAG when the message is substantive enough that a
      // relevant chunk could plausibly exist.
      const isConversational = isConversationalMessage(userPrompt);

      const context = isConversational
        ? { relevantChunks: [], correctionExamples: [], conversationSummary: undefined, enhancedHistory: conversationHistory.slice(-10) }
        : await buildEnhancedContext({
            creatorId: conversation.creator.id,
            userMessage: userPrompt,
            conversationHistory,
            maxChunks: 6,
            minScore: 0.50,
            useHybridSearch: true,
            includeConversationSummary: conversationHistory.length > 10
          });

      logInfo(`[Chat] RAG chunks=${context.relevantChunks.length} conversational=${isConversational} for: "${userPrompt.slice(0, 60)}"`);
      if (context.relevantChunks.length > 0) {
        context.relevantChunks.forEach((c, i) => {
          logInfo(`[Chat] chunk[${i}] score=${c.score.toFixed(3)} text="${c.text.slice(0, 300)}"`);
        });
      }


      logInfo(`[Chat] personaConfig=${JSON.stringify(conversation.creator.personaConfig)}`);

      // Generate response — voice mode keeps it short and plain text
      const effectivePrompt = voiceMode
        ? `${userPrompt}\n\n[IMPORTANT: Keep your answer to 1-2 short sentences. No markdown, no bullet points, no formatting. Speak naturally as if in a voice conversation.]`
        : userPrompt;
      const startTime = Date.now();
      aiResponse = await generateCreatorResponse(
        effectivePrompt,
        {
          creatorName: conversation.creator.displayName,
          personality: conversation.creator.aiPersonality || undefined,
          tone: conversation.creator.aiTone || undefined,
          responseStyle: conversation.creator.responseStyle || undefined,
          welcomeMessage: conversation.creator.welcomeMessage || undefined,
          personaConfig: (conversation.creator.personaConfig as import('../utils/openai').PersonaConfig | null) || null,
          fewShotQA: (conversation.creator.fewShotQA as unknown as import('../utils/openai').FewShotQA[] | null) || null,
          relevantChunks: context.relevantChunks.map(c => c.text),
          correctionExamples: context.correctionExamples,
          conversationSummary: context.conversationSummary,
          userProfile,
          modelOverride: (conversation.creator as { fineTunedModelId?: string | null }).fineTunedModelId || undefined,
        },
        context.enhancedHistory,
        context.conversationSummary
      );

      // The line `const transcript = data.segments.map((m: any) => m.text).join(' ');` was not added here
      // as 'data' is not defined in this scope and would cause a syntax error.

      const responseTime = Date.now() - startTime;

      // Save AI message — strip markdown here as a hard guarantee
      const aiMessage = await prisma.message.create({
        data: {
          conversationId,
          role: 'ASSISTANT',
          content: stripMarkdown(aiResponse.content),
          tokensUsed: aiResponse.tokensUsed,
          modelUsed: config.openai.model,
          responseTimeMs: responseTime
        }
      });

      // Detect intent and build suggested cards
      const lowerMsg = messageText.toLowerCase();
      type SuggestedCard =
        | { type: 'program'; id: string; name: string; price: number; link?: string; promoCode?: string; description?: string; duration?: string; level?: string }
        | { type: 'product'; id: string; name: string; price: number; link?: string; promoCode?: string; imageUrl?: string; description?: string }
        | { type: 'booking'; creatorId: string };
      const suggestedCards: SuggestedCard[] = [];
      const hasBookingIntent = ['book', 'booking', 'meet', 'meeting', 'schedule', 'appointment', 'slot', 'availability', 'available', 'consult', 'consultation', 'session', '1:1', 'one-on-one', 'call', 'video call', 'zoom', 'google meet', 'calendar', 'reschedule', 'free time', 'hop on', 'connect live', 'talk live', 'live chat', 'when are you', 'what day', 'what time', 'free slot', 'speak to you', 'speak with you', 'talk to you', 'talk with you', 'chat with you', 'get in touch', 'catch up', 'connect with', 'arrange a', 'set up a', 'fix a time', 'find a time'].some(kw => lowerMsg.includes(kw));
      const hasProgramIntent = ['program', 'programmes', 'course', 'courses', 'coaching', 'training', 'workout', 'workouts', 'fitness plan', 'fitness program', 'challenge', 'diet plan', 'meal plan', 'nutrition plan', 'routine', 'regime', 'transformation', 'weight loss', 'lose weight', 'build muscle', 'gain muscle', 'get fit', 'get in shape', 'enroll', 'sign up', 'join', 'membership', 'class', 'lesson', 'tutorial', 'guide me', 'help me train', 'help me lose', 'help me gain'].some(kw => lowerMsg.includes(kw));
      const hasProductIntent = ['product', 'products', 'buy', 'purchase', 'order', 'supplement', 'supplements', 'protein', 'vitamins', 'gear', 'equipment', 'recommend', 'recommendation', 'suggest', 'suggestion', 'shop', 'store', 'sell', 'selling', 'discount', 'promo code', 'promo', 'offer', 'deal', 'what do you sell', 'do you have', 'how much', 'price', 'cost'].some(kw => lowerMsg.includes(kw));
      if (hasBookingIntent) {
        suggestedCards.push({ type: 'booking', creatorId: conversation.creator.id });
      }
      if (hasProgramIntent || hasProductIntent) {
        try {
          const creatorPrograms = await prisma.program.findMany({
            where: { creatorId: conversation.creator.id },
            select: { id: true, name: true, price: true, description: true, category: true },
            take: 4,
          });
          for (const p of creatorPrograms) {
            let d: Record<string, string> = {};
            try { d = JSON.parse(p.description || '{}'); } catch { d = {}; }
            const isProduct = p.category === '__product__';
            if (isProduct && hasProductIntent) {
              suggestedCards.push({ type: 'product', id: p.id, name: p.name, price: Number(p.price || 0), link: d.link || undefined, promoCode: d.promoCode || undefined, imageUrl: d.imageUrl || undefined, description: d.desc || undefined });
            } else if (!isProduct && hasProgramIntent) {
              suggestedCards.push({ type: 'program', id: p.id, name: p.name, price: Number(p.price || 0), link: d.link || undefined, promoCode: d.promoCode || undefined, description: d.desc || undefined, duration: d.duration || undefined, level: d.level || undefined });
            }
          }
        } catch (cardErr) {
          logWarning('Failed to fetch programs for cards: ' + (cardErr instanceof Error ? cardErr.message : String(cardErr)));
        }
      }

      // Generate voice audio only when the client explicitly requests it (voiceMode: true).
      // Never generate TTS for regular text chat — it burns API quota.
      let audioUrl: string | null = null;
      let voiceProviderUsed: string | null = null;
      let voiceBlocked = false;
      let voiceTrialsRemaining = 0;
      let shouldIncrementVoiceTrial = false;

      if (req.body?.voiceMode && userId) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const voiceSub = await (prisma.subscription as any).findUnique({
          where: { userId },
          select: { plan: true, voiceTrialUsed: true }
        }) as { plan: string; voiceTrialUsed: number } | null;
        if (voiceSub?.plan !== 'PREMIUM') {
          const used = voiceSub?.voiceTrialUsed ?? 0;
          const limit = config.subscription.freeVoiceTrials;
          if (used >= limit) {
            voiceBlocked = true;
          } else {
            shouldIncrementVoiceTrial = true;
            voiceTrialsRemaining = limit - used - 1;
          }
        }
      }

      if (req.body?.voiceMode && !voiceBlocked) try {
        const creatorAny = conversation.creator as unknown as { voiceIdInworld?: string | null };

        let prosodyRow: { voiceSpeakingRate: number | null; voicePitch: number | null } | undefined;
        try {
          const [row] = await prisma.$queryRaw<Array<{ voiceSpeakingRate: number | null; voicePitch: number | null }>>`
            SELECT "voiceSpeakingRate", "voicePitch" FROM "Creator" WHERE id::text = ${conversation.creator.id}
          `;
          prosodyRow = row;
        } catch { /* non-fatal — TTS proceeds with default prosody values */ }

        const inworldSvc = require('../services/voice/inworld.service');
        const ttsText    = preprocessForTTS(aiResponse.content);

        if (inworldSvc.isConfigured() && creatorAny.voiceIdInworld) {
          const audioPath = await inworldSvc.textToSpeech(
            creatorAny.voiceIdInworld,
            ttsText,
            {
              speakingRate: prosodyRow?.voiceSpeakingRate ?? undefined,
              pitch:        prosodyRow?.voicePitch        ?? undefined,
            }
          );
          if (audioPath) {
            audioUrl = audioPath.startsWith('http') ? audioPath : `/uploads/${audioPath}`;
            voiceProviderUsed = 'inworld';
          }
        }
      } catch (voiceErr: unknown) {
        logWarning('Voice TTS failed (non-blocking): ' + (voiceErr instanceof Error ? voiceErr.message : String(voiceErr)));
      }

      // Emit AI response
      emitToConversation(conversationId, 'message:new', {
        message: { ...aiMessage, audioUrl, voiceProviderUsed, suggestedCards }
      });

      // Also push AI response to the creator's user room (live inbox)
      if (conversation.creator.userId) {
        emitToUser(conversation.creator.userId, 'creator:message:new', {
          conversationId,
          message: aiMessage,
          creatorId: conversation.creator.id
        });
      }

      // Update conversation timestamp
      await prisma.conversation.update({
        where: { id: conversationId },
        data: { lastMessageAt: new Date() }
      });

      // Update creator stats
      await prisma.creator.update({
        where: { id: conversation.creator.id },
        data: {
          totalMessages: { increment: 2 }
        }
      });

      // Update user message count / token balance and credit creator
      if (userId) {
        await prisma.subscription.upsert({
          where: { userId },
          update: {},
          create: { userId, plan: 'FREE', status: 'ACTIVE' }
        });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const subscription = (await (prisma.subscription as any).findUnique({
          where: { userId },
          select: { id: true, plan: true, tokenBalance: true, tokenGrant: true, voiceTrialUsed: true }
        })) as { id: string; plan: string; tokenBalance: number | null; tokenGrant: number | null; voiceTrialUsed: number };

        if (subscription.plan === 'PREMIUM') {
          const tokensPerMessage = config.subscription.tokensPerMessage;
          const tokensPerVoice = audioUrl ? config.subscription.tokensPerVoice : 0;
          const totalTokens = tokensPerMessage + tokensPerVoice;
          const tokenGrant = subscription.tokenGrant || config.subscription.tokenGrant || 1_000_000;

          if ((subscription.tokenBalance ?? 0) < totalTokens) {
            throw new AppError('Out of tokens. Please renew your premium plan.', 402);
          }

          // Atomic decrement of tokens and increment usage
          const updated = await prisma.subscription.update({
            where: { id: subscription.id },
            data: {
              tokenBalance: { decrement: totalTokens },
              messagesUsedToday: { increment: 1 }
            },
            select: { id: true, tokenBalance: true, tokenGrant: true }
          });

          const monthlyCreatorShare = (config.subscription.premiumPrice / 100) * config.subscription.creatorShare;
          const perTokenValue = monthlyCreatorShare / (tokenGrant || 1);
          const perMessageEarning = perTokenValue * totalTokens;

          try {
            await distributeEarnings({
              creatorId: conversation.creator.id,
              amount: perMessageEarning,
              sourceType: 'subscription',
              sourceId: updated.id,
              description: `Earnings from premium user chat (${conversation.creator.displayName}) via tokens`
            });
            logDebug(`Distributed earning to creator ${conversation.creator.displayName} for premium message (tokens: ${tokensPerMessage})`);
          } catch (earningsError: unknown) {
            logError(earningsError instanceof Error ? earningsError : new Error(String(earningsError)), { context: 'Failed to distribute earnings' });
          }

          // Attach remaining tokens to response for UI
          (res as unknown as { __tokenInfo?: unknown }).__tokenInfo = {
            tokenBalance: updated.tokenBalance,
            tokenGrant: updated.tokenGrant || tokenGrant,
            tokensPerMessage
          };
        } else {
          await prisma.subscription.update({
            where: { id: subscription.id },
            data: {
              messagesUsedToday: { increment: 1 },
              ...(shouldIncrementVoiceTrial && audioUrl ? { voiceTrialUsed: { increment: 1 } } : {})
            }
          });
        }
      }

      res.json({
        success: true,
        data: {
          userMessage,
          aiMessage: { ...aiMessage, audioUrl, voiceProviderUsed, suggestedCards },
          ...(req.body?.voiceMode ? {
            voice: {
              blocked: voiceBlocked,
              trialsRemaining: voiceBlocked ? 0 : voiceTrialsRemaining,
              requiresUpgrade: voiceBlocked
            }
          } : {})
        }
      });

    } catch (error: unknown) {
      // Log with a distinctive prefix and the full error object so the backend
      // console shows stack + response body if it's an OpenAI API error.
      const errName = error instanceof Error ? error.name : 'Error';
      const errMsg = error instanceof Error ? error.message : String(error);
      const errObj = error as Record<string, unknown>;
      const errResponse = errObj?.response as Record<string, unknown> | undefined;
      const errStatus = errObj?.status || errResponse?.status;
      const errBody = errResponse?.data || errObj?.error;
      logError(error instanceof Error ? error : new Error(errMsg as string), {
        context: '[chat.sendMessage] AI pipeline failed',
        name: errName,
        status: errStatus,
        body: errBody
      });

      // IMPORTANT: even if AI failed, the user did send a message and it IS
      // saved in the DB. Bump their daily quota so the counter doesn't freeze
      // forever on repeated failures. (PREMIUM users don't get tokens charged
      // because tokens represent actual AI compute that didn't happen.)
      try {
        if (userId) {
          const sub = await prisma.subscription.findUnique({
            where: { userId },
            select: { id: true, plan: true }
          });
          if (sub && sub.plan !== 'PREMIUM') {
            await prisma.subscription.update({
              where: { id: sub.id },
              data: { messagesUsedToday: { increment: 1 } }
            });
          }
        }
      } catch (quotaErr) {
        logError(quotaErr instanceof Error ? quotaErr : new Error(String(quotaErr)), { context: 'Failed to bump quota after AI error' });
      }

      // Emit an error event to the conversation room so the fan UI can show
      // a graceful inline error instead of a silent broken state.
      try {
        emitToConversation(conversationId, 'ai:error', {
          conversationId,
          messageId: userMessage.id,
          userMessage: errMsg
        });
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      } catch (_) {
        // swallow — best effort
      }

      // Leak the real error message in dev mode so the frontend DevTools can
      // surface it. In production we still return the generic message.
      const exposed =
        process.env.NODE_ENV === 'production'
          ? 'Failed to generate response'
          : `AI failed: ${errMsg}${errStatus ? ` (HTTP ${errStatus})` : ''}`;
      throw new AppError(exposed, 500);
    }
  } else {
    // OpenAI not configured - return placeholder
    const aiMessage = await prisma.message.create({
      data: {
        conversationId,
        role: 'ASSISTANT',
        content: `Thank you for your message! I'm ${conversation.creator.displayName}. AI responses are currently disabled — no AI provider is configured. Please set GEMINI_API_KEY (or OPENAI_API_KEY) in the server environment.`
      }
    });

    emitToConversation(conversationId, 'message:new', {
      message: aiMessage
    });

    // Also push placeholder AI response to the creator's user room (live inbox)
    if (conversation.creator.userId) {
      emitToUser(conversation.creator.userId, 'creator:message:new', {
        conversationId,
        message: aiMessage,
        creatorId: conversation.creator.id
      });
    }

    // Still count the message against the user's daily quota even when AI is disabled,
    // otherwise the rate-limit counter would never decrement on the placeholder path.
    if (userId) {
      const subscription = await prisma.subscription.findUnique({
        where: { userId },
        select: { id: true, plan: true }
      });
      if (subscription && subscription.plan !== 'PREMIUM') {
        await prisma.subscription.update({
          where: { id: subscription.id },
          data: { messagesUsedToday: { increment: 1 } }
        });
      }
    }

    res.json({
      success: true,
      data: {
        userMessage,
        aiMessage,
        tokens: (res as unknown as { __tokenInfo?: unknown }).__tokenInfo || undefined
      }
    });
  }
});

// ===========================================
// GET CONVERSATION HISTORY
// ===========================================

export const getConversation = asyncHandler(async (req: Request, res: Response) => {
  const { conversationId } = req.params;
  const userId = req.user?.id;
  const guestId = req.headers['x-guest-id'] as string;

  // The provided diff for `getConversation` was syntactically incorrect and incomplete.
  // It attempted to define `messages` and then immediately redefine `messages` within `include`.
  // It also referenced `id`, `limit`, and `page` which were not defined in this scope.
  // The original `conversation` fetch is retained as it was syntactically correct and functional.
  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId as string },
    include: {
      creator: {
        select: {
          id: true,
          displayName: true,
          profileImage: true
        }
      },
      messages: {
        orderBy: { createdAt: 'asc' }
      }
    }
  });

  if (!conversation) {
    throw new AppError('Conversation not found', 404);
  }

  // Verify ownership
  if (userId && conversation.userId !== userId) {
    throw new AppError('Unauthorized', 403);
  }
  if (!userId && conversation.guestId !== guestId) {
    throw new AppError('Unauthorized', 403);
  }

  res.json({
    success: true,
    data: conversation
  });
});

// ===========================================
// GET USER'S CONVERSATIONS
// ===========================================

export const getUserConversations = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 20;
  const skip = (page - 1) * limit;

  const [conversations, total] = await Promise.all([
    prisma.conversation.findMany({
      where: { userId },
      include: {
        creator: {
          select: {
            id: true,
            displayName: true,
            profileImage: true
          }
        },
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1
        }
      },
      orderBy: { updatedAt: 'desc' },
      skip,
      take: limit
    }),
    prisma.conversation.count({ where: { userId } })
  ]);

  res.json({
    success: true,
    data: {
      conversations,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    }
  });
});

// ===========================================
// HELPER: CHECK MESSAGE LIMITS
// ===========================================

// ===========================================
// EDIT MESSAGE
// ===========================================

export const editMessage = asyncHandler(async (req: Request, res: Response) => {
  const { messageId } = req.params;
  const { content } = req.body;
  const userId = req.user?.id;

  if (!content || !content.trim()) {
    throw new AppError('Message content is required', 400);
  }

  if (content.length > 2000) {
    throw new AppError('Message must be less than 2000 characters', 400);
  }

  // Get message
  const message = await prisma.message.findUnique({
    where: { id: messageId as string },
    include: { conversation: true }
  });

  if (!message) {
    throw new AppError('Message not found', 404);
  }

  // Only allow editing user's own messages
  if (message.role !== 'USER' || message.userId !== userId) {
    throw new AppError('Unauthorized', 403);
  }

  // Update message
  const updatedMessage = await prisma.message.update({
    where: { id: messageId as string },
    data: { content: content.trim() }
  });

  // Emit update event
  const _io: Server = req.app.get('io');
  emitToConversation(message.conversationId, 'message:updated', {
    message: updatedMessage
  });

  res.json({
    success: true,
    data: updatedMessage
  });
});

// ===========================================
// DELETE MESSAGE
// ===========================================

export const deleteMessage = asyncHandler(async (req: Request, res: Response) => {
  const { messageId } = req.params;
  const userId = req.user?.id;

  // Get message
  const message = await prisma.message.findUnique({
    where: { id: messageId as string },
    include: { conversation: true }
  });

  if (!message) {
    throw new AppError('Message not found', 404);
  }

  // Only allow deleting user's own messages
  if (message.role !== 'USER' || message.userId !== userId) {
    throw new AppError('Unauthorized', 403);
  }

  // Delete message
  await prisma.message.delete({
    where: { id: messageId as string }
  });

  // Emit delete event
  const _io: Server = req.app.get('io');
  emitToConversation(message.conversationId, 'message:deleted', {
    messageId
  });

  res.json({
    success: true,
    message: 'Message deleted successfully'
  });
});

// ===========================================
// HELPERS: GUEST/IP MESSAGE LIMITING & BLOCKING
// ===========================================

const inMemoryIpCounts = new Map<string, { count: number; expiresAt: number }>();
const inMemoryBlockedIps = new Map<string, number>();
const IP_COUNT_TTL_SECONDS = 24 * 60 * 60; // 24h window
const IP_BLOCK_TTL_SECONDS = 24 * 60 * 60; // 24h block for abusive guests

async function checkMessageLimits(userId?: string, guestId?: string, ip?: string) {
  if (userId) {
    // Check or create subscription
    const subscription = await prisma.subscription.upsert({
      where: { userId },
      update: {},
      create: { userId, plan: 'FREE', status: 'ACTIVE' }
    });

    // Reset daily count if new day
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    if (subscription.lastResetDate < today) {
      await prisma.subscription.update({
        where: { userId },
        data: {
          messagesUsedToday: 0,
          lastResetDate: today
        }
      });
    } else if (subscription.plan === 'FREE') {
      // Check free tier limit
      if (subscription.messagesUsedToday >= config.rateLimit.freeMessagesPerDay) {
        throw new AppError(
          `Daily message limit reached (${config.rateLimit.freeMessagesPerDay}). Upgrade to Premium for unlimited messages.`,
          429
        );
      }
    }
    return;
  }

  // Guest users
  // Check IP blocks first
  if (ip && await isIpBlocked(ip)) {
    throw new AppError('Access blocked due to abuse. Please sign up to continue.', 403);
  }

  // IP-based counting to prevent incognito abuse
  if (ip) {
    const ipCount = await incrementIpCount(ip);
    if (ipCount > config.rateLimit.guestMessagesTotal) {
      throw new AppError(
        `Guest message limit reached (${config.rateLimit.guestMessagesTotal}). Please sign up to continue chatting.`,
        429
      );
    }
  }

  // Additional guard per guestId (legacy behaviour)
  if (guestId) {
    const guestMessageCount = await prisma.message.count({
      where: {
        conversation: { guestId },
        role: 'USER'
      }
    });

    if (guestMessageCount >= config.rateLimit.guestMessagesTotal) {
      throw new AppError(
        `Guest message limit reached (${config.rateLimit.guestMessagesTotal}). Please sign up to continue chatting.`,
        429
      );
    }
  }
}

async function incrementIpCount(ip: string): Promise<number> {
  const redis = (isRedisConfigured() && isRedisConnected()) ? getRedisClient() : null;
  const key = `guest:ip:${ip}`;
  if (redis) {
    const count = await redis.incr(key);
    if (count === 1) {
      await redis.expire(key, IP_COUNT_TTL_SECONDS);
    }
    return count;
  }

  const now = Date.now();
  const current = inMemoryIpCounts.get(ip);
  if (!current || current.expiresAt < now) {
    const expiresAt = now + IP_COUNT_TTL_SECONDS * 1000;
    inMemoryIpCounts.set(ip, { count: 1, expiresAt });
    return 1;
  }
  current.count += 1;
  inMemoryIpCounts.set(ip, current);
  return current.count;
}

async function isIpBlocked(ip: string): Promise<boolean> {
  const redis = (isRedisConfigured() && isRedisConnected()) ? getRedisClient() : null;
  const key = `guest:ip:block:${ip}`;
  if (redis) {
    const blocked = await redis.get(key);
    return !!blocked;
  }

  const now = Date.now();
  const expiresAt = inMemoryBlockedIps.get(ip);
  if (!expiresAt) return false;
  if (expiresAt < now) {
    inMemoryBlockedIps.delete(ip);
    return false;
  }
  return true;
}

// Returns true for short/casual messages that don't warrant a RAG lookup.
// Saves one OpenAI embedding call + vector search per conversational turn.
function isConversationalMessage(message: string): boolean {
  const trimmed = message.trim().toLowerCase();
  if (trimmed.length < 15) return true;
  const casual = [
    /^(hi|hey|hello|sup|yo|hiya|heya)[\s!?.]*$/,
    /^(thanks|thank you|thx|ty|cheers|appreciate it|np|no problem|ok|okay|k|cool|nice|great|awesome|perfect|got it|sounds good|makes sense|understood|alright|sure)[\s!?.]*$/,
    /^(lol|lmao|haha|hehe)[\s!?.]*$/,
    /^(bye|goodbye|see you|see ya|later|cya|ttyl)[\s!?.]*$/,
  ];
  return casual.some(p => p.test(trimmed));
}

async function blockGuestIp(ip: string): Promise<void> {
  if (!ip) return;
  const redis = (isRedisConfigured() && isRedisConnected()) ? getRedisClient() : null;
  const key = `guest:ip:block:${ip}`;
  if (redis) {
    await redis.set(key, '1', { EX: IP_BLOCK_TTL_SECONDS });
    return;
  }
  const expiresAt = Date.now() + IP_BLOCK_TTL_SECONDS * 1000;
  inMemoryBlockedIps.set(ip, expiresAt);
}
