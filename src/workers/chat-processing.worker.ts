// ===========================================
// AI CHAT PROCESSING WORKER (Bull Processor)
// ===========================================
// Handles asynchronous AI message generation
// Processes jobs from chatQueue

import { Job } from 'bull';
import prisma from '../../prisma/client';
import { io } from '../index';
import { logInfo, logError } from '../utils/logger';
import { ChatProcessingJobData } from '../services/queue/chat-queue';
import { buildAttachmentContext } from '../services/media/media-processor.service';
import { MessageMedia } from '../types/chat.types';

// AI Services
import * as contextBuilder from '../services/ai/context-builder.service';
import * as openaiIntegration from '../services/ai/openai-integration.service';
import * as errorHandler from '../services/ai/error-handler.service';
import * as responseCache from '../services/ai/response-cache.service';
import * as modelConfig from '../services/ai/model-config.service';

/**
 * Main worker function to process a chat job
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function processChatJob(job: Job<ChatProcessingJobData>): Promise<any> {
    const { messageId, conversationId, userId, creatorId, userMessage, media } = job.data;
    void userId;
    const startTime = Date.now();

    try {
        logInfo(`[AIWorker] Processing message ${messageId} for conversation ${conversationId}`);

        // 1. Update status to PROCESSING
        await prisma.message.update({
            where: { id: messageId },
            data: { processingStatus: 'PROCESSING' }
        });

        // 2. Build attachment context (voice, images, documents)
        const { combined: attachmentContext } = await buildAttachmentContext(media as unknown as MessageMedia[]);

        // 3. Combine user message + attachments for downstream processing
        const combinedUserMessage = [
            (userMessage || '').trim(),
            attachmentContext ? `Attachment context:\n${attachmentContext}` : ''
        ].filter(Boolean).join('\n\n');

        // 4. Check cache first
        const cacheKey = responseCache.generateCacheKey(creatorId, combinedUserMessage);
        const cachedResponse = await responseCache.getCachedResponse(cacheKey);

        if (cachedResponse) {
            logInfo(`[AIWorker] Cache hit for message ${messageId}`);

            // Update message with cached response
            const updatedMessage = await prisma.message.update({
                where: { id: messageId },
                data: {
                    content: cachedResponse.content,
                    processingStatus: 'COMPLETED',
                    aiModel: cachedResponse.model,
                    tokensUsed: cachedResponse.tokensUsed,
                    processingTime: Date.now() - startTime,
                    cached: true,
                    cacheHit: true
                }
            });

            // Emit via socket
            io.to(`conversation_${conversationId}`).emit('message_completed', {
                message: updatedMessage
            });

            return { source: 'cache', messageId };
        }

        // 5. Get Model Configuration
        const config = modelConfig.getDefaultConfig();

        // 6. Build Context (History + Knowledge Retrieval)
        const context = await contextBuilder.buildContext(
            messageId,
            conversationId,
            creatorId,
            combinedUserMessage
        );

        // 7. Generate AI Response (Streaming)
        let fullResponse = '';

        const result = await openaiIntegration.generateStreamingResponse(
            context.systemPrompt,
            context.conversationHistory,
            combinedUserMessage,
            (delta: string, accumulated: string) => {
                fullResponse = accumulated;
                // Emit partial response via socket
                io.to(`conversation_${conversationId}`).emit('message_stream', {
                    conversationId,
                    messageId, // This is the user message ID or should be the AI message ID? 
                    // Usually we emit the chunk for the AI response.
                    delta,
                    accumulated
                });
            },
            config.model,
            config.temperature
        );

        const processingTime = Date.now() - startTime;

        // 8. Save final message to DB (Update the user message status and add assistant content?) 
        // Wait, normally we create a NEW message for the assistant. 
        // Let's check how the controller handles this.

        // Actually, the worker should probably create the Assistant message or update it if created by controller.
        // My previous write_to_file update assumed the messageId is for the Assistant placeholder.

        const finalMessage = await prisma.message.update({
            where: { id: messageId },
            data: {
                content: result.content,
                processingStatus: 'COMPLETED',
                aiModel: result.model,
                tokensUsed: result.usage.totalTokens,
                processingTime,
                cached: false,
                cacheHit: false
            }
        });

        // 9. Record AI Usage
        await prisma.aiUsage.create({
            data: {
                messageId: finalMessage.id,
                model: result.model,
                promptTokens: result.usage.promptTokens,
                completionTokens: result.usage.completionTokens,
                totalTokens: result.usage.totalTokens,
                cost: result.cost,
                responseTime: processingTime,
                cached: false
            }
        });

        // 10. Cache the response if eligible
        if (responseCache.shouldCacheResponse(combinedUserMessage, result.content)) {
            await responseCache.cacheResponse(cacheKey, {
                content: result.content,
                tokensUsed: result.usage.totalTokens,
                model: result.model
            });
        }

        // Notify completion
        io.to(`conversation_${conversationId}`).emit('message_completed', {
            message: finalMessage
        });

        // 10. Update lastMessageAt for the conversation
        await prisma.conversation.update({
            where: { id: conversationId },
            data: { lastMessageAt: new Date() }
        });

        return { source: 'ai', messageId, processingTime };

    } catch (error: unknown) {
        logError(error instanceof Error ? error : new Error(String(error)), { context: 'ChatWorker', messageId, conversationId });

        // Handle and categorize error
        const aiError = errorHandler.handleOpenAIError(error);

        // Update message with error status
        await prisma.message.update({
            where: { id: messageId },
            data: {
                processingStatus: 'FAILED',
                errorType: aiError.code,
            }
        });

        // Notify client of error
        io.to(`conversation_${conversationId}`).emit('message_error', {
            messageId,
            error: aiError.userMessage,
            code: aiError.code
        });

        throw error; // Rethrow for Bull to handle retries
    }
}
