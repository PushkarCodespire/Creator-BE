// ===========================================
// KNOWLEDGE RETRIEVAL SERVICE (RAG)
// ===========================================
// Retrieves relevant creator content chunks using embeddings

import prisma from '../../../prisma/client';
import { generateEmbedding } from '../../utils/openai';
import { hybridSearch } from '../../utils/vectorStore';
import { logError } from '../../utils/logger';

/**
 * Retrieves relevant knowledge chunks for a creator based on user query
 */
export async function retrieveRelevantKnowledge(
    creatorId: string,
    query: string,
    topK: number = 3
): Promise<string[]> {
    try {
        // 1. Generate embedding for the query
        const queryEmbedding = await generateEmbedding(query);

        if (!queryEmbedding) {
            return [];
        }

        // 2. Hybrid search (semantic + keyword) over local vector store
        // 0.55 threshold (was 0.7) — allows short-form content like Instagram captions
        // and FAQ entries to be retrieved. Long-form content scores higher anyway
        // so this doesn't noticeably degrade precision on YouTube/article results.
        const hybridResults = hybridSearch(creatorId, queryEmbedding, query, topK, 0.55);

        if (hybridResults.length > 0) {
            return hybridResults.map(result => result.text);
        }

        // 3. Fallback: recent chunks (if vector store is empty/disabled)
        const chunks = await prisma.contentChunk.findMany({
            where: {
                content: {
                    creatorId,
                    status: 'COMPLETED'
                }
            },
            orderBy: { createdAt: 'desc' },
            take: topK,
            select: {
                text: true
            }
        });

        return chunks.map(chunk => chunk.text);
    } catch (error: unknown) {
        logError(error instanceof Error ? error : new Error(String(error)), { context: 'Knowledge Retrieval', creatorId, query });
        return [];
    }
}
