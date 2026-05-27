// ===========================================
// AI INTEGRATION SERVICE — Streaming
// Primary: Gemini 2.0 Flash streaming
// Fallback: OpenAI GPT-4o streaming
// ===========================================

import OpenAI from 'openai';
import { logError, logWarning } from '../../utils/logger';
import { isGeminiConfigured, generateGeminiStreamingResponse } from '../../utils/gemini';
import { isOpenAIConfigured } from '../../utils/openai';

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
 * Generates a streaming AI response.
 * Tries Gemini first; falls back to OpenAI if Gemini is unavailable or errors.
 */
export async function generateStreamingResponse(
  systemPrompt: string,
  history: { role: string; content: string }[],
  userMessage: string,
  onChunk: (delta: string, accumulated: string) => void,
  model: string = 'gemini-2.0-flash',
  temperature: number = 0.7
): Promise<AIResponse> {
  // ── Gemini path ───────────────────────────────────────────────────────────
  if (isGeminiConfigured()) {
    try {
      const result = await generateGeminiStreamingResponse(
        systemPrompt,
        history,
        userMessage,
        onChunk,
        model,
        temperature
      );

      const promptTokens  = Math.ceil((systemPrompt.length + userMessage.length) / 4);
      const completionTokens = Math.ceil(result.content.length / 4);

      return {
        content: result.content,
        model: result.model,
        usage: {
          promptTokens,
          completionTokens,
          totalTokens: result.tokensUsed || promptTokens + completionTokens,
        },
        cost: 0, // Gemini free tier
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logWarning(`[AI Streaming] Gemini failed, falling back to OpenAI: ${msg}`);
      if (!isOpenAIConfigured()) throw err;
    }
  }

  // ── OpenAI fallback ───────────────────────────────────────────────────────
  if (!isOpenAIConfigured()) {
    throw new Error('No AI provider configured. Set GEMINI_API_KEY or OPENAI_API_KEY.');
  }

  try {
    const openaiModel = model.startsWith('gemini') ? 'gpt-4o' : model;
    const messages: { role: string; content: string }[] = [
      { role: 'system', content: systemPrompt },
      ...history,
      { role: 'user', content: userMessage },
    ];

    const stream = await openai.chat.completions.create({
      model: openaiModel,
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

    const promptTokens     = Math.ceil((systemPrompt.length + userMessage.length) / 4);
    const completionTokens = Math.ceil(fullContent.length / 4);

    return {
      content: fullContent,
      model: openaiModel,
      usage: {
        promptTokens,
        completionTokens,
        totalTokens: promptTokens + completionTokens,
      },
      cost: (promptTokens / 1000) * 0.005 + (completionTokens / 1000) * 0.015,
    };
  } catch (error) {
    logError(
      error instanceof Error ? error : new Error(String(error)),
      { context: 'AI Streaming (OpenAI fallback)' }
    );
    throw error;
  }
}
