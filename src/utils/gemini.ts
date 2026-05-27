// ===========================================
// GEMINI AI UTILITY
// Google Gemini 2.0 Flash — primary AI provider
// Chat, embeddings, vision, audio, and moderation.
// All consumers should try this first, then fall back to OpenAI.
// ===========================================

import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold, Part } from '@google/generative-ai';
import fs from 'fs';
import mime from 'mime-types';
import { logWarning } from './logger';

// ── Provider check ────────────────────────────────────────────────────────────

export function isGeminiConfigured(): boolean {
  return !!process.env.GEMINI_API_KEY;
}

function getClient(): GoogleGenerativeAI {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY not configured');
  return new GoogleGenerativeAI(key);
}

// Single model — only gemini-2.5-flash is used.
// If it hits quota, the caller falls back to OpenAI directly.
const GEMINI_MODEL_PREFERENCE = ['gemini-2.5-flash'];
const GEMINI_CHAT_MODEL = () => process.env.GEMINI_MODEL || 'gemini-2.5-flash';

// gemini-embedding-001 is broadly available; text-embedding-004 is not on all keys
const GEMINI_EMBED_MODEL = 'gemini-embedding-001';

// gemini-embedding-001 produces 3072-dimensional embeddings
export const GEMINI_EMBEDDING_DIMENSION = 3072;

// Permissive safety settings — moderation is handled by our own layer.
// Only block the truly extreme content at the API level.
const SAFETY_SETTINGS = [
  { category: HarmCategory.HARM_CATEGORY_HARASSMENT,        threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
  { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,       threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
  { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
  { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
];

// ── Message conversion ────────────────────────────────────────────────────────
// OpenAI format: { role: 'system'|'user'|'assistant', content: string }
// Gemini format: { role: 'user'|'model', parts: [{text}] }
// System messages → systemInstruction (separate field in Gemini)

function convertMessages(messages: { role: string; content: string }[]) {
  const systemParts = messages.filter(m => m.role === 'system');
  const systemInstruction = systemParts.length > 0
    ? systemParts.map(m => m.content).join('\n\n')
    : undefined;

  const conversational = messages.filter(m => m.role !== 'system');
  const lastMessage = conversational[conversational.length - 1];

  // Map to Gemini roles
  let history = conversational.slice(0, -1).map(m => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }));

  // Gemini requires history to START with 'user' and ALTERNATE user/model.
  // The welcome message is stored as 'assistant', so it can appear first — drop
  // any leading 'model' turns until history begins with 'user'.
  while (history.length > 0 && history[0].role === 'model') {
    history = history.slice(1);
  }

  return { systemInstruction, history, lastMessage };
}

// ── CHAT COMPLETION ───────────────────────────────────────────────────────────

// Try each Gemini model in order until one succeeds (handles per-model 429s)
async function tryGeminiModels<T>(
  fn: (modelName: string) => Promise<T>,
  preferredModel?: string
): Promise<T> {
  // If caller specified a Gemini model, try it first
  const order = preferredModel?.startsWith('gemini')
    ? [preferredModel, ...GEMINI_MODEL_PREFERENCE.filter(m => m !== preferredModel)]
    : GEMINI_MODEL_PREFERENCE;

  let lastErr: unknown;
  for (const modelName of order) {
    try {
      return await fn(modelName);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const is429 = msg.includes('429') || msg.includes('Too Many Requests') || msg.includes('quota');
      if (!is429) throw err; // Non-quota errors bubble immediately
      logWarning(`[Gemini] ${modelName} quota exceeded, trying next model…`);
      lastErr = err;
    }
  }
  throw lastErr; // All models exhausted → caller falls back to OpenAI
}

export async function generateGeminiChatCompletion(
  messages: { role: string; content: string }[],
  options: { maxTokens?: number; temperature?: number; model?: string } = {}
): Promise<{ content: string; tokensUsed: number }> {
  const { systemInstruction, history, lastMessage } = convertMessages(messages);

  return tryGeminiModels(async (modelName) => {
    const model = getClient().getGenerativeModel({
      model: modelName,
      ...(systemInstruction ? { systemInstruction } : {}),
      safetySettings: SAFETY_SETTINGS,
      generationConfig: {
        maxOutputTokens: options.maxTokens || 1000,
        temperature: options.temperature ?? 0.7,
      },
    });

    const chat = model.startChat({ history });
    const result = await chat.sendMessage(lastMessage?.content || '');

    // Log finish reason so we can diagnose truncation
    const candidate = result.response.candidates?.[0];
    const finishReason = candidate?.finishReason;
    if (finishReason && finishReason !== 'STOP') {
      logWarning(`[Gemini] finishReason=${finishReason} model=${modelName} — response may be truncated`);
    }

    // When Gemini stops due to RECITATION it returns empty text() but partial
    // content is available in candidates. Fall back to raw candidate text.
    let content = '';
    try {
      content = result.response.text();
    } catch {
      content = candidate?.content?.parts?.map((p: { text?: string }) => p.text ?? '').join('') ?? '';
      logWarning(`[Gemini] text() threw (finishReason=${finishReason}), using raw candidate text (${content.length} chars)`);
    }

    const tokensUsed = result.response.usageMetadata?.totalTokenCount ?? 0;

    return { content, tokensUsed };
  }, options.model);
}

// ── STREAMING ─────────────────────────────────────────────────────────────────

export async function generateGeminiStreamingResponse(
  systemPrompt: string,
  history: { role: string; content: string }[],
  userMessage: string,
  onChunk: (delta: string, accumulated: string) => void,
  modelOverride?: string,
  temperature: number = 0.7
): Promise<{ content: string; model: string; tokensUsed: number }> {
  // Map to Gemini roles, then drop any leading 'model' turns.
  // Gemini requires the history passed to startChat() to begin with 'user'.
  // The creator welcome message is stored as 'assistant', so it can appear
  // first in the history slice — stripping it avoids the API rejection.
  let geminiHistory = history
    .filter(m => m.role !== 'system')
    .map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));
  while (geminiHistory.length > 0 && geminiHistory[0].role === 'model') {
    geminiHistory = geminiHistory.slice(1);
  }

  return tryGeminiModels(async (modelName) => {
    const model = getClient().getGenerativeModel({
      model: modelName,
      systemInstruction: systemPrompt || undefined,
      safetySettings: SAFETY_SETTINGS,
      generationConfig: { temperature },
    });

    const chat = model.startChat({ history: geminiHistory });
    const streamResult = await chat.sendMessageStream(userMessage);

    let fullContent = '';
    for await (const chunk of streamResult.stream) {
      const delta = chunk.text();
      if (delta) {
        fullContent += delta;
        onChunk(delta, fullContent);
      }
    }

    const finalResponse = await streamResult.response;
    const tokensUsed = finalResponse.usageMetadata?.totalTokenCount
      ?? Math.ceil(fullContent.length / 4);

    return { content: fullContent, model: modelName, tokensUsed };
  }, modelOverride);
}

// ── EMBEDDINGS ────────────────────────────────────────────────────────────────

export async function generateGeminiEmbedding(text: string): Promise<number[]> {
  const model = getClient().getGenerativeModel({ model: GEMINI_EMBED_MODEL });
  const result = await model.embedContent(text.slice(0, 8000));
  return result.embedding.values;
}

export async function generateGeminiEmbeddings(texts: string[]): Promise<number[][]> {
  const model = getClient().getGenerativeModel({ model: GEMINI_EMBED_MODEL });
  const results: number[][] = [];

  for (const text of texts) {
    const result = await model.embedContent(text.slice(0, 8000));
    results.push(result.embedding.values);
    // Small delay to stay within free tier rate limits (1500 RPD / 15 RPM)
    await new Promise(r => setTimeout(r, 70));
  }

  return results;
}

// ── VISION (image description) ────────────────────────────────────────────────

export async function describeImageWithGemini(filePath: string): Promise<string> {
  const buffer = fs.readFileSync(filePath);
  const mimeType = (mime.lookup(filePath) || 'image/jpeg') as string;

  const imagePart: Part = {
    inlineData: { data: buffer.toString('base64'), mimeType },
  };

  const model = getClient().getGenerativeModel({
    model: GEMINI_CHAT_MODEL(),
    safetySettings: SAFETY_SETTINGS,
    generationConfig: { maxOutputTokens: 300, temperature: 0.2 },
  });

  const result = await model.generateContent([
    'Analyze this image. Briefly describe what you see and extract any visible text.',
    imagePart,
  ]);

  return result.response.text().trim();
}

// ── AUDIO TRANSCRIPTION ───────────────────────────────────────────────────────

export async function transcribeAudioWithGemini(filePath: string): Promise<string> {
  const buffer = fs.readFileSync(filePath);

  // Gemini inline data limit is ~20MB — larger files fall back to Whisper
  if (buffer.length > 20 * 1024 * 1024) {
    throw new Error(
      `Audio too large for Gemini inline (${Math.round(buffer.length / 1024 / 1024)}MB > 20MB). Use Whisper fallback.`
    );
  }

  const mimeType = (mime.lookup(filePath) || 'audio/mp3') as string;
  const audioPart: Part = {
    inlineData: { data: buffer.toString('base64'), mimeType },
  };

  const model = getClient().getGenerativeModel({
    model: GEMINI_CHAT_MODEL(),
    safetySettings: SAFETY_SETTINGS,
    generationConfig: { maxOutputTokens: 1500, temperature: 0.0 },
  });

  const result = await model.generateContent([
    'Transcribe this audio accurately. Return only the transcribed text, nothing else.',
    audioPart,
  ]);

  return result.response.text().trim();
}

// ── MODERATION ────────────────────────────────────────────────────────────────

export interface GeminiModerationResult {
  flagged: boolean;
  shouldBlock: boolean;
  shouldFlag: boolean;
  highestScore: number;
  highestCategory: string;
  scores: Record<string, number>;
  categories: Record<string, boolean>;
}

export async function moderateWithGemini(content: string): Promise<GeminiModerationResult> {
  // NOTE: responseMimeType:'application/json' is set on the model — Gemini
  // will emit a JSON object directly. The prompt must NOT include an example
  // JSON blob (that triggers Gemini to copy it verbatim, producing unescaped
  // characters from the message content at ~position 209 in the output).
  const prompt = `You are a content safety classifier. Analyze the user message below and return a JSON object with exactly these keys:

flagged        (boolean) — true if shouldBlock OR shouldFlag is true
shouldBlock    (boolean) — true if any score is 0.85 or higher
shouldFlag     (boolean) — true if any score is 0.50 or higher
highestScore   (number)  — the highest score among all categories
highestCategory (string) — the key with the highest score, or "none"
categories     (object)  — { hate, harassment, sexual, violence, spam, self_harm } — each a boolean
scores         (object)  — { hate, harassment, sexual, violence, spam, self_harm } — each a 0.0–1.0 float

User message to classify:
---
${content.slice(0, 2000)}
---`;

  return tryGeminiModels(async (modelName) => {
    const model = getClient().getGenerativeModel({
      model: modelName,
      generationConfig: {
        maxOutputTokens: 300,
        temperature: 0.0,
        // Force the model to emit valid JSON — eliminates parse errors from
        // stray prose, markdown fences, or unescaped characters.
        responseMimeType: 'application/json',
      },
    });

    const result = await model.generateContent(prompt);
    const text = result.response.text().trim();

    // With responseMimeType:'application/json' the response should already be
    // valid JSON, but we still extract the first {...} block as a safety net.
    const jsonMatch = text.match(/\{[\s\S]+\}/);
    if (!jsonMatch) {
      logWarning(`[Gemini] Moderation returned non-JSON: ${text.slice(0, 100)}`);
      throw new Error('Gemini moderation response was not JSON');
    }

    return JSON.parse(jsonMatch[0]) as GeminiModerationResult;
  });
}
