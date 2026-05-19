// ===========================================
// CONTEXT BUILDER SERVICE
// ===========================================
// Builds conversation context with history and knowledge retrieval

import prisma from '../../../prisma/client';
import * as knowledgeRetrieval from './knowledge-retrieval.service';
import { logInfo } from '../../utils/logger';

export interface ConversationContext {
    systemPrompt: string;
    conversationHistory: { role: string; content: string }[];
    retrievedKnowledge: string[];
}

/**
 * Builds the full context for AI generation
 */
export async function buildContext(
    messageId: string,
    conversationId: string,
    creatorId: string,
    userMessage: string
): Promise<ConversationContext> {
    // 1. Fetch Creator Profile
    const creator = await prisma.creator.findUnique({
        where: { id: creatorId },
        select: {
            displayName: true,
            bio: true,
            aiPersonality: true,
            aiTone: true,
            welcomeMessage: true,
            responseStyle: true
        }
    });

    if (!creator) {
        throw new Error('Creator not found');
    }

    // 2. Fetch Recent Conversation History (last 10 messages)
    const messages = await prisma.message.findMany({
        where: {
            conversationId,
            processingStatus: { not: 'FAILED' }
        },
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: {
            role: true,
            content: true
        }
    });

    const conversationHistory = messages.reverse().map(msg => ({
        role: msg.role.toLowerCase(),
        content: msg.content
    }));

    // 3. Retrieve Relevant Knowledge (RAG)
    const retrievedKnowledge = await knowledgeRetrieval.retrieveRelevantKnowledge(
        creatorId,
        userMessage,
        3 // top 3 chunks
    );

    // 4. Build System Prompt (include retrieved knowledge)
    const basePrompt = `You are ${creator.displayName}, an AI assistant representing this creator.
${creator.bio ? `About: ${creator.bio}` : ''}
${creator.aiPersonality ? `Personality: ${creator.aiPersonality}` : ''}
${creator.aiTone ? `Tone: ${creator.aiTone}` : ''}

Respond naturally and helpfully to user questions. Be conversational and engaging.`;

    const knowledgeText = retrievedKnowledge.length > 0
        ? `\n\nRelevant knowledge from the creator's content:\n${retrievedKnowledge.map((chunk, index) => `(${index + 1}) ${chunk}`).join('\n\n')}`
        : '';

    const systemPrompt = `${basePrompt}${knowledgeText}`;

    logInfo(`[ContextBuilder] Built context for conversation ${conversationId}`);

    return {
        systemPrompt,
        conversationHistory,
        retrievedKnowledge
    };
}
