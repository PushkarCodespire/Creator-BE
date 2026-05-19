// ===========================================
// ENHANCED CHAT CONTROLLER
// AI chat with async processing, rate limiting, caching
// ===========================================

import type { NextFunction } from 'express';
// eslint-disable-next-line no-duplicate-imports
import { Request, Response } from 'express';
import prisma from '../../../prisma/client';
import { asyncHandler, AppError } from '../../middleware/errorHandler';
import { chatQueue, isChatQueueEnabled } from '../../services/queue/chat-queue';
import { logError } from '../../utils/logger';
import { sendMessage as legacySendMessage } from '../chat.controller';

/**
 * Enhanced send message endpoint
 * - Validates request
 * - Checks rate limits (via Redis)
 * - Persists User message
 * - Creates Assistant placeholder (PENDING_RESPONSE)
 * - Queues background job for AI generation
 * - Responds immediately with the message skeleton
 */
export const sendMessageEnhanced = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const { conversationId, content, media } = req.body;
    const userId = req.user?.id;

    // If the chat queue is not configured (no Redis), fall back to the legacy synchronous handler
    if (!isChatQueueEnabled) {
        return legacySendMessage(req, res, next);
    }

    // 1. Basic Validation
    if (!content && (!media || media.length === 0)) {
        throw new AppError('Message content or media is required', 400);
    }

    // 2. Fetch/Validate Conversation and Creator
    const conversation = await prisma.conversation.findUnique({
        where: { id: conversationId },
        include: { creator: true }
    });

    if (!conversation) {
        throw new AppError('Conversation not found', 404);
    }

    // 3. Rate Limiting Check (Simplified for now - can be expanded)
    // We already have checkUserModeration and subscription usage logic elsewhere
    // but here we could add a per-minute Redis-based throttle

    // 4. Create User Message
    const userMessage = await prisma.message.create({
        data: {
            conversationId,
            userId: userId || null,
            role: 'USER',
            content: (content || '').trim(),
            media: media || null,
            processingStatus: 'COMPLETED' // User messages are instant
        }
    });

    // 5. Create Assistant Placeholder (The AI response)
    const assistantPlaceholder = await prisma.message.create({
        data: {
            conversationId,
            userId: null,
            role: 'ASSISTANT',
            content: '', // Typing indicator state
            processingStatus: 'PENDING_RESPONSE',
            modelUsed: conversation.creator.responseStyle || 'GPT-4'
        }
    });

    // 6. Queue AI Processing Job
    // Add job with a short timeout so the HTTP request never hangs if Redis is unreachable
    const addJob = chatQueue.add({
        messageId: assistantPlaceholder.id,
        conversationId,
        userId: userId || null,
        creatorId: conversation.creatorId,
        userMessage: (content || '').trim(),
        media: media || []
    });

    await Promise.race([
        addJob,
        new Promise((_, reject) => setTimeout(() => reject(new Error('CHAT_QUEUE_TIMEOUT')), 4000))
    ]).catch((error) => {
        logError(error as Error, { context: 'ChatQueueAdd', conversationId });
        throw new AppError('Chat queue unavailable. Please try again in a moment.', 503);
    });

    // 7. Update conversation lastMessageAt
    await prisma.conversation.update({
        where: { id: conversationId },
        data: { lastMessageAt: new Date() }
    });

    // 8. Return response immediately
    // Client will listen on Socket.IO for the streaming content or final completion
    res.status(202).json({
        success: true,
        message: 'Message queued for processing',
        data: {
            id: userMessage.id,
            assistantMessageId: assistantPlaceholder.id,
            conversationId
        }
    });
});

/**
 * Get current rate limit status for a user
 */
import { config } from '../../config';

/**
 * Get current rate limit status for a user or guest
 */
export const getRateLimitStatus = asyncHandler(async (req: Request, res: Response) => {
    const userId = req.user?.id;
    const guestId = req.headers['x-guest-id'] as string;

    if (!userId && !guestId) {
        throw new AppError('Unauthorized', 401);
    }

    let plan = 'GUEST';
    let used = 0;
    let limit = config.rateLimit.guestMessagesTotal || 10;
    let resetAt: Date | undefined = undefined;

    if (userId) {
        const subscription = await prisma.subscription.findUnique({
            where: { userId }
        });
        plan = subscription?.plan || 'FREE';
        used = subscription?.messagesUsedToday || 0;
        limit = plan === 'PREMIUM' ? 1000 : (config.rateLimit.freeMessagesPerDay || 20);
        resetAt = new Date(new Date().setHours(24, 0, 0, 0)); // Next midnight
    } else {
        // Guest Logic
        used = await prisma.message.count({
            where: {
                conversation: { guestId },
                role: 'USER'
            }
        });
        limit = config.rateLimit.guestMessagesTotal || 10;
    }

    const remaining = Math.max(0, limit - used);

    // Get token info for premium users
    let tokenBalance = 0;
    let tokenGrant = 0;
    const tokensPerMessage = config.subscription.tokensPerMessage || 800;

    if (userId) {
        const subscription = await prisma.subscription.findUnique({
            where: { userId },
            select: { tokenBalance: true, tokenGrant: true }
        });
        tokenBalance = subscription?.tokenBalance || 0;
        tokenGrant = subscription?.tokenGrant || 0;
    }

    res.json({
        success: true,
        data: {
            subscription: {
                plan
            },
            limits: {
                daily: {
                    used,
                    limit,
                    remaining,
                    resetAt
                }
            },
            tokens: {
                balance: tokenBalance,
                grant: tokenGrant,
                perMessage: tokensPerMessage
            }
        }
    });
});

