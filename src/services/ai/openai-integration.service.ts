// ===========================================
// OPENAI INTEGRATION SERVICE
// ===========================================

import OpenAI from 'openai';
import { logError } from '../../utils/logger';

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

export interface AIResponse {
    content: string;
    model: string;
    usage: {
        promptTokens: number;
        completionTokens: number;
        totalTokens: number;
    };
    cost: number;
}

/**
 * Generates a streaming response from OpenAI
 */
export async function generateStreamingResponse(
    systemPrompt: string,
    history: { role: string; content: string }[],
    userMessage: string,
    onChunk: (delta: string, accumulated: string) => void,
    model: string = 'gpt-4o',
    temperature: number = 0.7
): Promise<AIResponse> {
    try {
        const messages: { role: string; content: string }[] = [
            { role: 'system', content: systemPrompt },
            ...history,
            { role: 'user', content: userMessage }
        ];

        const stream = await openai.chat.completions.create({
            model,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            messages: messages as any,
            temperature,
            stream: true,
        });

        let fullContent = '';
        for await (const chunk of stream) {
            const delta = chunk.choices[0]?.delta?.content || '';
            fullContent += delta;
            onChunk(delta, fullContent);
        }

        // Tiktoken or estimation for usage
        // In a real scenario, we might use the non-streaming call or logprobs to get exact usage
        const promptTokens = Math.ceil((systemPrompt.length + userMessage.length) / 4);
        const completionTokens = Math.ceil(fullContent.length / 4);

        return {
            content: fullContent,
            model,
            usage: {
                promptTokens,
                completionTokens,
                totalTokens: promptTokens + completionTokens
            },
            cost: (promptTokens / 1000) * 0.005 + (completionTokens / 1000) * 0.015
        };
    } catch (error) {
        logError(error instanceof Error ? error : new Error(String(error)), { context: 'OpenAI Streaming' });
        throw error;
    }
}
