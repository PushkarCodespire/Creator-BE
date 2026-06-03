// ===========================================
// AI UTILITY (OpenAI + Gemini dual-provider)
// Primary: Gemini 2.0 Flash (if GEMINI_API_KEY is set)
// Fallback: GPT-4o mini (if OPENAI_API_KEY is set)
// Embeddings: single consistent provider per session (no mid-stream switching)
// ===========================================

import OpenAI from 'openai';
import { config } from '../config';
import {
  isGeminiConfigured,
  generateGeminiChatCompletion,
  generateGeminiEmbedding,
  generateGeminiEmbeddings,
  GEMINI_EMBEDDING_DIMENSION,
} from './gemini';
import { logWarning } from './logger';

// Initialize OpenAI client (exported so other utils can reuse it)
export const openai = new OpenAI({
  apiKey: config.openai.apiKey
});

// Check if OpenAI is configured
export function isOpenAIConfigured(): boolean {
  return !!config.openai.apiKey;
}

// True if ANY AI provider is ready (Gemini OR OpenAI)
export function isAIConfigured(): boolean {
  return isGeminiConfigured() || isOpenAIConfigured();
}

// Which embedding provider is currently active? Must be consistent across a session.
// Gemini (768-dim) takes priority when its key is present.
export function getEmbeddingProvider(): 'gemini' | 'openai' {
  return isGeminiConfigured() ? 'gemini' : 'openai';
}

export const OPENAI_EMBEDDING_DIMENSION = 1536;
export { GEMINI_EMBEDDING_DIMENSION };

// Expected dimension based on active provider
export function getExpectedEmbeddingDimension(): number {
  return isGeminiConfigured() ? GEMINI_EMBEDDING_DIMENSION : OPENAI_EMBEDDING_DIMENSION;
}

// ===========================================
// EMBEDDINGS
// ===========================================

export async function generateEmbedding(text: string): Promise<number[]> {
  if (isGeminiConfigured()) {
    try {
      return await generateGeminiEmbedding(text);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logWarning(`[AI] Gemini embedding failed, falling back to OpenAI: ${msg}`);
      if (!isOpenAIConfigured()) throw err;
    }
  }

  if (!isOpenAIConfigured()) {
    throw new Error('No embedding provider configured. Set GEMINI_API_KEY or OPENAI_API_KEY.');
  }

  const response = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: text.slice(0, 8000),
  });

  return response.data[0].embedding;
}

export async function generateEmbeddings(texts: string[]): Promise<number[][]> {
  if (isGeminiConfigured()) {
    try {
      return await generateGeminiEmbeddings(texts);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logWarning(`[AI] Gemini batch embedding failed, falling back to OpenAI: ${msg}`);
      if (!isOpenAIConfigured()) throw err;
    }
  }

  if (!isOpenAIConfigured()) {
    throw new Error('No embedding provider configured. Set GEMINI_API_KEY or OPENAI_API_KEY.');
  }

  const batchSize = 100;
  const allEmbeddings: number[][] = [];

  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize).map(t => t.slice(0, 8000));
    const response = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: batch,
    });
    allEmbeddings.push(...response.data.map(d => d.embedding));
  }

  return allEmbeddings;
}

// ===========================================
// CHAT COMPLETION
// ===========================================

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatOptions {
  maxTokens?: number;
  temperature?: number;
  model?: string; // override default model (e.g. fine-tuned model ID)
}

export async function generateChatCompletion(
  messages: ChatMessage[],
  options: ChatOptions = {}
): Promise<{ content: string; tokensUsed: number }> {
  // Skip Gemini when the caller explicitly requests an OpenAI model ID
  // (e.g. a fine-tuned model like "ft:gpt-4o-mini:...").
  const forceOpenAI = !!options.model && !options.model.startsWith('gemini');

  if (!forceOpenAI && isGeminiConfigured()) {
    try {
      return await generateGeminiChatCompletion(messages, options);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logWarning(`[AI] Gemini chat failed, falling back to OpenAI: ${msg}`);
      if (!isOpenAIConfigured()) throw err; // no fallback available
    }
  }

  if (!isOpenAIConfigured()) {
    throw new Error('No AI provider configured. Set GEMINI_API_KEY or OPENAI_API_KEY.');
  }

  const response = await openai.chat.completions.create({
    model: options.model || config.openai.model,
    messages,
    max_tokens: options.maxTokens || 1000,
    temperature: options.temperature ?? 0.7,
  });

  return {
    content: response.choices[0].message.content || '',
    tokensUsed: response.usage?.total_tokens || 0,
  };
}

// ===========================================
// CREATOR AI RESPONSE
// ===========================================

export interface PersonaConfig {
  energyLevel?: 'calm' | 'balanced' | 'high-energy';
  honestyStyle?: 'supportive' | 'direct' | 'tough-love';
  humor?: 'none' | 'light' | 'sarcastic';
  responseFormat?: 'short-punchy' | 'detailed' | 'bullet-lists';
  signaturePhrases?: string[];
  opinionatedTopics?: string[];
}

export interface FewShotQA {
  scenario: string;
  answer: string;
}

export interface CreatorContext {
  creatorName: string;
  personality?: string;
  tone?: string;
  responseStyle?: string;
  welcomeMessage?: string;
  personaConfig?: PersonaConfig | null;
  fewShotQA?: FewShotQA[] | null;
  relevantChunks: string[];
  correctionExamples?: { question: string; answer: string }[]; // RAG-retrieved corrections matching current question
  conversationSummary?: string;
  userProfile?: string;
  modelOverride?: string;
}

export async function generateCreatorResponse(
  userMessage: string,
  context: CreatorContext,
  conversationHistory: ChatMessage[] = [],
  conversationSummary?: string
): Promise<{ content: string; tokensUsed: number; qualityScore?: number; citations?: string[] }> {
  // Build system prompt
  const systemPrompt = buildCreatorSystemPrompt(context);

  // Add conversation summary if available
  const summaryText = conversationSummary
    ? `\n\nConversation summary: ${conversationSummary}`
    : '';

  // Format reminder — respects personaConfig.responseFormat so personas can diverge on length/style
  const responseFormat = context.personaConfig?.responseFormat;
  const lengthHint = responseFormat === 'detailed'
    ? 'Go into depth — full paragraphs are more than fine when the question warrants it.'
    : responseFormat === 'short-punchy'
    ? 'Be brief. 1-3 sentences max. Cut anything that isn\'t essential.'
    : 'Match the length to the question — short questions get short answers, complex ones get more.';

  // Persona voice lock — placed last so it overrides the model's default helpful-assistant tone.
  // Only injected when persona settings are configured; otherwise stays silent.
  const p = context.personaConfig || {};
  const personaVoiceLock = (p.energyLevel || p.honestyStyle || p.humor)
    ? `\n\nVOICE LOCK — this overrides everything: You are ${context.creatorName}, not an AI assistant. Right now your voice must be:${
        p.energyLevel === 'high-energy' ? ' HIGH-ENERGY. Short punchy sentences. No soft language.' :
        p.energyLevel === 'calm'        ? ' CALM. Measured, quiet, no hype.' : ''
      }${
        p.honestyStyle === 'direct'     ? ' DIRECT. No preamble, no softening, say it plainly.' :
        p.honestyStyle === 'tough-love' ? ' TOUGH LOVE. No coddling. Call it out. No rally cries.' :
        p.honestyStyle === 'supportive' ? ' SUPPORTIVE. Lead with empathy, validate before advising.' : ''
      }${
        p.humor === 'sarcastic' ? ' SARCASTIC. Dry wit is part of how you talk — use it.' :
        p.humor === 'light'     ? ' LIGHT HUMOR. A casual joke when it fits.' : ''
      } Sound exactly like the examples above, NOT like a generic helpful assistant.`
    : '';

  const formatReminder = `\n\nFORMAT REMINDER: plain text only. No bullet points, no bold (**), no headers, no numbered lists, no dashes as list items. Write in sentences like a real person — not a formatted document. ${lengthHint} Do not end with "let me know!" or similar filler.${personaVoiceLock}`;

  // Prepend a compact fan profile line directly to the user message so it is
  // adjacent to the question — models pay far more attention to context that
  // sits right next to the thing being answered than to distant system-prompt text.
  const profilePrefix = context.userProfile
    ? `[About me: ${context.userProfile}]\n`
    : '';

  // Context chunks are injected as a separate system message immediately before
  // the user question — this is the highest-attention position in the messages array.
  // Placed here (not buried in the main system prompt) so the model treats these
  // excerpts as the most recent and most relevant information.
  const contextMessage: ChatMessage | null = context.relevantChunks.length > 0
    ? {
        role: 'system',
        content: `THESE ARE MY EXACT WORDS. Your ONLY job is to repeat them back in first person, preserving every specific detail.

STRICT RULES — breaking any of these is wrong:
- Keep ALL numbers exactly as written: "95kg" stays "95kg", NOT "ninety-five kilograms". "300–500" stays "300–500", NOT "three hundred to five hundred".
- Keep ALL measurements, timeframes, and units exactly: "14 months" stays "14 months", "1.6–2.2g" stays "1.6–2.2g".
- Do NOT paraphrase, summarise, or reword. If the excerpt says it, say it the same way.
- Do NOT add information that is not in the excerpt below.
- Do NOT add an intro like "Ah, you're asking about..." — start directly with the content.

EXCERPT:
${context.relevantChunks.map((chunk, i) => `[${i + 1}] ${chunk.length > 700 ? chunk.slice(0, 700) + '…' : chunk}`).join('\n\n')}

Now deliver this as me, speaking directly to the person. Same words. Same numbers. Same structure.`
      }
    : null;

  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt + summaryText + formatReminder },
    ...conversationHistory.slice(-10),
    ...(contextMessage ? [contextMessage] : []),
    { role: 'user', content: profilePrefix + userMessage }
  ];

  // Very low temperature when RAG context is present — we want the model to
  // copy the creator's exact words, numbers, and measurements faithfully.
  // Without context (open-ended chat) keep it warmer so it sounds natural.
  const temperature = context.relevantChunks.length > 0 ? 0.1 : 0.7;

  const response = await generateChatCompletion(messages, {
    maxTokens: 2000,
    temperature,
    model: context.modelOverride,
  });

  // Strip markdown that gpt-4o-mini produces despite instructions
  const cleanContent = stripMarkdown(response.content);

  // Calculate quality score (simple heuristic)
  const qualityScore = calculateResponseQuality(cleanContent, userMessage, context.relevantChunks.length);

  return {
    ...response,
    content: cleanContent,
    qualityScore,
  };
}

export function stripMarkdown(text: string): string {
  return text
    // Bold: **text** or __text__ → text
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/__(.*?)__/g, '$1')
    // Italic: *text* or _text_ → text (avoid stripping lone underscores)
    .replace(/\*([^*]+)\*/g, '$1')
    // Bullet/dash list items at line start → keep the text, remove the marker
    .replace(/^[ \t]*[-•*]\s+/gm, '')
    // Numbered list items: "1. text" → text
    .replace(/^[ \t]*\d+\.\s+/gm, '')
    // Collapse 3+ newlines to double newline
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Calculate response quality score (0-1)
 */
function calculateResponseQuality(
  response: string,
  userMessage: string,
  contextChunksUsed: number
): number {
  let score = 0.5; // Base score

  // Length check (not too short, not too long)
  const length = response.length;
  if (length >= 50 && length <= 1000) {
    score += 0.2;
  }

  // Context usage (using provided context is good)
  if (contextChunksUsed > 0) {
    score += 0.2;
  }

  // Relevance (check if response addresses the question)
  const userKeywords = userMessage.toLowerCase().split(/\s+/).filter(w => w.length > 4);
  const responseLower = response.toLowerCase();
  const keywordMatches = userKeywords.filter(kw => responseLower.includes(kw)).length;
  if (keywordMatches > 0) {
    score += Math.min(keywordMatches / userKeywords.length * 0.1, 0.1);
  }

  return Math.min(score, 1.0);
}

export function buildCreatorSystemPrompt(context: CreatorContext): string {
  const { creatorName, personality, tone, responseStyle, welcomeMessage, personaConfig, fewShotQA } = context;
  const p = (personaConfig || {}) as PersonaConfig;

  // ── 1. IDENTITY (comes first so it anchors everything) ────────────────────
  let prompt = `You are ${creatorName}, talking directly to a fan. You are a real person, not an AI assistant or bot. Respond exactly as ${creatorName} would — not as a generic helpful assistant.`;

  // ── 1b. USER PROFILE ─────────────────────────────────────────────────────────
  if (context.userProfile) {
    prompt += `\n\nYOU KNOW THIS SPECIFIC FAN. Here is their profile:\n${context.userProfile}\nWhen giving ANY advice or recommendation, make it specific to their goal, challenge, and situation — NOT generic advice that could apply to anyone. If they ask about muscle growth and their goal is fat loss, address that. If their biggest challenge is consistency, factor that in. Address them as an individual, not as a generic audience member.`;
  }

  // ── 2. ENERGY & HONESTY STYLE (core voice — stated before format rules) ──
  if (p.energyLevel === 'calm') {
    prompt += `\n\nEnergy: You are calm, grounded, and measured. No hype. No exclamation points unless truly warranted. Thoughtful and steady — like a trusted mentor talking quietly.`;
  } else if (p.energyLevel === 'high-energy') {
    prompt += `\n\nEnergy: You are high-energy and intense. Short punchy sentences. Direct hits. Exclamation points are fine. You get fired up when talking about what matters.`;
  }

  if (p.honestyStyle === 'supportive') {
    prompt += `\n\nHonesty style: Warm and supportive. Validate the person before offering advice. Lead with empathy — "that makes sense", "I get it". Criticism is gentle and comes after encouragement.`;
  } else if (p.honestyStyle === 'direct') {
    prompt += `\n\nHonesty style: Direct and no-nonsense. Skip the preamble. Say what you mean. No fluff, no "great question!", no softening what needs to be said plainly.`;
  } else if (p.honestyStyle === 'tough-love') {
    prompt += `\n\nHonesty style: Tough love — this is non-negotiable. You do NOT coddle. You do NOT say "it's okay" or "don't be too hard on yourself" or "that's totally normal." You call things out plainly. You believe people rise to high expectations. You are blunt because you respect people enough to tell them the truth. If someone is making excuses, say so directly. NEVER end with a rally cry: no "Get after it!", "Go crush it!", "You've got this!", "Keep pushing!", "You can do it!", "I believe in you!", or any motivational cheerleader line. State the truth and stop.`;
  }

  if (p.humor === 'light') {
    prompt += `\n\nHumor: Light humor is part of your voice — a casual joke or self-aware observation when it fits naturally.`;
  } else if (p.humor === 'sarcastic') {
    prompt += `\n\nHumor: Dry wit and sarcasm are core to how you talk. Use it freely — just not mean-spirited. A well-placed sarcastic line is fine.`;
  } else if (p.humor === 'none') {
    prompt += `\n\nHumor: Keep it serious. No jokes, no banter. Stay on topic and focused.`;
  }

  // ── 3. PERSONALITY / TONE / STYLE (free-text fields) ─────────────────────
  if (personality) {
    prompt += `\n\nWho ${creatorName} is: ${personality}`;
  }
  if (tone) {
    prompt += `\n\nHow ${creatorName} communicates: ${tone}`;
  }
  if (responseStyle) {
    prompt += `\n\nResponse style: ${responseStyle}`;
  }
  if (welcomeMessage) {
    prompt += `\n\nStyle reference — ${creatorName}'s own voice: "${welcomeMessage}"`;
  }

  // ── 4. SIGNATURE PHRASES & OPINIONS ──────────────────────────────────────
  if (p.signaturePhrases && p.signaturePhrases.length > 0) {
    prompt += `\n\nSignature phrases — weave these in naturally when they fit: ${p.signaturePhrases.join(', ')}`;
  }
  if (p.opinionatedTopics && p.opinionatedTopics.length > 0) {
    prompt += `\n\nTopics ${creatorName} has strong opinions on — speak with real conviction here, not diplomatically: ${p.opinionatedTopics.join(', ')}`;
  }

  // ── 5. RESPONSE FORMAT ────────────────────────────────────────────────────
  if (p.responseFormat === 'short-punchy') {
    prompt += `\n\nResponse format: SHORT AND PUNCHY. 1-3 sentences. Every word earns its place. Cut everything else. No lists unless directly asked.`;
  } else if (p.responseFormat === 'detailed') {
    prompt += `\n\nResponse format: Detailed and thorough. Give full answers with real context and depth. Multiple sentences or paragraphs are fine when the question deserves it.`;
  } else if (p.responseFormat === 'bullet-lists') {
    prompt += `\n\nResponse format: Use bullet points or numbered lists to structure your answers when there are multiple parts or steps. Each point should be a complete thought.`;
  } else {
    prompt += `\n\nResponse format: Match length to the question — simple questions get 1-3 sentences, complex questions get more.`;
  }

  // ── 6. FORMATTING RULES (no-markdown, applies to all) ────────────────────
  if (p.responseFormat !== 'bullet-lists') {
    prompt += `\n\nFormatting: Plain text only. No bold (**text**), no headers, no bullet points, no numbered lists, no markdown. Write in natural sentences like a person texting.`;
  } else {
    prompt += `\n\nFormatting: No bold (**text**), no headers, no markdown. Bullet points are fine. Keep each bullet to 1-2 lines.`;
  }

  prompt += `\n\nDO NOT start with: Sure, Absolutely, Of course, Great question, Certainly, I'd be happy, Here are, Let me share — just answer directly.`;
  prompt += `\nDO NOT end with: let me know, hope this helps, feel free to ask.`;

  // ── 7. FEW-SHOT EXAMPLES (most powerful — placed last for recency effect) ─
  if (fewShotQA && fewShotQA.length > 0) {
    const answered = fewShotQA.filter(qa => qa.answer && qa.answer.trim().length > 0);
    if (answered.length > 0) {
      prompt += `\n\nHERE IS EXACTLY HOW ${creatorName.toUpperCase()} TALKS — real answers written by ${creatorName} in their own voice. This is the most important part. Mirror this voice, tone, and style precisely:\n`;
      answered.forEach(qa => {
        prompt += `\nFan: ${qa.scenario}\n${creatorName}: ${qa.answer.trim()}\n`;
      });
      prompt += `\nNow respond to the fan's next message in exactly this same voice.`;
    }
  }

  // ── 8. CORRECTION EXAMPLES (RAG-retrieved — placed last for maximum recency) ──
  // These are real responses the creator wrote to similar questions.
  // Placed last so they override everything above — highest priority signal.
  if (context.correctionExamples && context.correctionExamples.length > 0) {
    prompt += `\n\nEXACT RESPONSE MATCH — a fan asked something very similar before and ${creatorName} wrote this response personally. Mirror this voice, length, and style precisely:\n`;
    context.correctionExamples.forEach(c => {
      prompt += `\nFan: ${c.question}\n${creatorName}: ${c.answer}\n`;
    });
    prompt += `\nRespond to the current question in exactly this same voice.`;
  }

  return prompt;
}

// ===========================================
// TEXT PROCESSING
// ===========================================

// Split text into chunks for embedding
export function chunkText(
  text: string,
  chunkSize: number = 500,
  overlap: number = 100
): string[] {
  const words = text.split(/\s+/);
  const chunks: string[] = [];
  
  let currentChunk: string[] = [];
  let currentSize = 0;

  for (const word of words) {
    currentChunk.push(word);
    currentSize++;

    if (currentSize >= chunkSize) {
      chunks.push(currentChunk.join(' '));
      
      // Keep overlap words
      const overlapStart = Math.max(0, currentChunk.length - overlap);
      currentChunk = currentChunk.slice(overlapStart);
      currentSize = currentChunk.length;
    }
  }

  // Add remaining chunk
  if (currentChunk.length > 0) {
    chunks.push(currentChunk.join(' '));
  }

  return chunks;
}

// Estimate token count (rough approximation)
export function estimateTokens(text: string): number {
  return Math.ceil(text.split(/\s+/).length * 1.3);
}
