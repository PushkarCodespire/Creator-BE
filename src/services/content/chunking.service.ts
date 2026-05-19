// ===========================================
// TEXT CHUNKING SERVICE
// ===========================================
// Intelligent text splitting with semantic awareness
// Custom implementation (LangChain alternative)

import { logWarning, logInfo } from '../../utils/logger';

export interface ChunkingOptions {
  chunkSize?: number;
  chunkOverlap?: number;
  contentType?: 'transcript' | 'text'; // transcript uses sentence-aware chunking
}

export interface Chunk {
  text: string;
  index: number;
  characterCount: number;
  wordCount: number;
}

// ===========================================
// TRANSCRIPT-AWARE CHUNKER
// Splits by complete ideas (sentence groups), not character count
// ===========================================

/**
 * Clean a raw YouTube transcript.
 * Only removes non-speech auto-caption markers — keeps all natural speech
 * patterns (filler words, pauses, verbal tics) because they carry the
 * creator's authentic voice and help the AI mirror how they actually talk.
 */
function cleanTranscript(text: string): string {
  return text
    // Remove auto-caption markers that aren't speech at all
    .replace(/\[Music\]/gi, ' ')
    .replace(/\[Applause\]/gi, ' ')
    .replace(/\[Laughter\]/gi, ' ')
    .replace(/\[Inaudible\]/gi, ' ')
    .replace(/\[.*?\]/g, ' ')   // catch-all for any other bracketed markers
    // Collapse multiple spaces / newlines introduced by removals
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * Split text into individual sentences using punctuation boundaries.
 * Handles common transcript patterns where sentences run together.
 */
function splitIntoSentences(text: string): string[] {
  // Insert a sentinel after sentence-ending punctuation so we can split on it
  const marked = text
    // Standard sentence endings
    .replace(/([.!?])\s+([A-Z])/g, '$1\n$2')
    // Handle "...and" / "...so" as soft sentence breaks (creator speaking style)
    .replace(/,\s+(and|but|so|because|however|therefore|now|look|listen|here's|that's why)\s+/gi, '.\n$1 ')
    // Dash as thought break
    .replace(/\s+—\s+/g, '.\n');

  return marked
    .split('\n')
    .map(s => s.trim())
    .filter(s => s.length > 20); // drop fragments
}

/**
 * Group sentences into idea-unit chunks.
 * Each chunk = 3-5 complete sentences, target 400-600 chars.
 * Overlap = last 1 sentence of previous chunk carried into next.
 */
function chunkBySentences(sentences: string[], targetChars = 500, overlapSentences = 1): string[] {
  const chunks: string[] = [];
  let i = 0;

  while (i < sentences.length) {
    const group: string[] = [];
    let charCount = 0;

    // Build a group until we hit the target size or run out of sentences
    while (i < sentences.length) {
      const s = sentences[i];
      if (group.length >= 3 && charCount + s.length > targetChars) break;
      if (group.length >= 6) break; // hard cap — never more than 6 sentences
      group.push(s);
      charCount += s.length + 1;
      i++;
    }

    if (group.length > 0) {
      chunks.push(group.join(' '));
      // Overlap: step back by overlapSentences so next chunk starts with context
      i = Math.max(i - overlapSentences, i - group.length + 1);
      // Guard against infinite loop on single very long sentence
      if (overlapSentences >= group.length) i++;
    }
  }

  return chunks;
}

/**
 * Chunk text using LangChain's RecursiveCharacterTextSplitter
 * Optimal chunk size: 800 characters with 100-char overlap
 */
export function chunkContent(
  text: string,
  options: ChunkingOptions = {}
): Chunk[] {
  const {
    chunkSize = 800,
    chunkOverlap = 100,
    contentType = 'text'
  } = options;

  // Transcript content gets the sentence-aware pipeline
  if (contentType === 'transcript') {
    const cleaned = cleanTranscript(text);
    const sentences = splitIntoSentences(cleaned);
    const rawChunks = chunkBySentences(sentences, 500, 1);

    const validatedChunks: Chunk[] = rawChunks
      .map((chunkText, index) => {
        const trimmed = chunkText.trim();
        if (!trimmed || trimmed.length < 40) return null;
        return {
          text: trimmed,
          index,
          characterCount: trimmed.length,
          wordCount: trimmed.split(/\s+/).length,
        };
      })
      .filter((c): c is Chunk => c !== null);

    const avgSize = validatedChunks.reduce((s, c) => s + c.characterCount, 0) / (validatedChunks.length || 1);
    logInfo(`[Chunking] Transcript: ${validatedChunks.length} idea-chunks (avg: ${Math.round(avgSize)} chars)`);
    return validatedChunks;
  }

  // Custom recursive character splitter implementation
  // Hierarchical splitting: paragraph -> sentence -> word -> character
  const separators = [
    '\n\n',  // Paragraph breaks (priority 1)
    '\n',    // Line breaks (priority 2)
    '. ',    // Sentence end (priority 3)
    '! ',    // Exclamation (priority 4)
    '? ',    // Question (priority 5)
    '; ',    // Semicolon (priority 6)
    ': ',    // Colon (priority 7)
    ', ',    // Comma (priority 8)
    ' ',     // Space (priority 9)
    ''       // Character (last resort)
  ];

  // Recursive splitting function
  function splitRecursive(text: string, separatorIndex: number): string[] {
    if (separatorIndex >= separators.length) {
      // Last resort: split by character
      return text.length > chunkSize 
        ? [text.substring(0, chunkSize), text.substring(chunkSize)]
        : [text];
    }

    const separator = separators[separatorIndex];
    if (separator === '') {
      // Character-level splitting
      const chunks: string[] = [];
      for (let i = 0; i < text.length; i += chunkSize) {
        chunks.push(text.substring(i, i + chunkSize));
      }
      return chunks;
    }

    const parts = text.split(separator);
    
    // If splitting by this separator produces chunks that are too large, try next separator
    if (parts.some(part => part.length > chunkSize)) {
      return splitRecursive(text, separatorIndex + 1);
    }

    // Build chunks with overlap
    const chunks: string[] = [];
    let currentChunk = '';

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const separatorToAdd = i > 0 ? separator : '';
      const potentialChunk = currentChunk + separatorToAdd + part;

      if (potentialChunk.length <= chunkSize) {
        currentChunk = potentialChunk;
      } else {
        if (currentChunk) {
          chunks.push(currentChunk);
        }
        // Add overlap
        const overlapStart = Math.max(0, currentChunk.length - chunkOverlap);
        currentChunk = currentChunk.substring(overlapStart) + separatorToAdd + part;
      }
    }

    if (currentChunk) {
      chunks.push(currentChunk);
    }

    return chunks;
  }

  // Split text into chunks
  const chunks = splitRecursive(text, 0);

  // Validate and format chunks
  const validatedChunks: Chunk[] = chunks
    .map((chunkText, index) => {
      const trimmed = chunkText.trim();
      
      // Filter out invalid chunks
      if (!trimmed || trimmed.length < 50) {
        return null;
      }

      // Check maximum size
      if (trimmed.length > 1500) {
        logWarning(`[Chunking] Chunk ${index} exceeds 1500 chars (${trimmed.length})`);
      }

      return {
        text: trimmed,
        index,
        characterCount: trimmed.length,
        wordCount: trimmed.split(/\s+/).length
      };
    })
    .filter((chunk): chunk is Chunk => chunk !== null);

  // Quality checks
  const avgSize = validatedChunks.reduce((sum, c) => sum + c.characterCount, 0) / validatedChunks.length;
  const sizeStdDev = Math.sqrt(
    validatedChunks.reduce((sum, c) => sum + Math.pow(c.characterCount - avgSize, 2), 0) / validatedChunks.length
  );

  logInfo(`[Chunking] Created ${validatedChunks.length} chunks (avg: ${Math.round(avgSize)} chars, std: ${Math.round(sizeStdDev)})`);

  return validatedChunks;
}

/**
 * Validate chunk quality
 */
export function validateChunks(chunks: Chunk[]): {
  valid: boolean;
  issues: string[];
} {
  const issues: string[] = [];

  // Check minimum chunks
  if (chunks.length === 0) {
    issues.push('No chunks created');
    return { valid: false, issues };
  }

  // Check chunk sizes
  const sizes = chunks.map(c => c.characterCount);
  const minSize = Math.min(...sizes);
  const maxSize = Math.max(...sizes);
  const avgSize = sizes.reduce((a, b) => a + b, 0) / sizes.length;

  if (minSize < 50) {
    issues.push(`Some chunks are too small (min: ${minSize} chars)`);
  }

  if (maxSize > 1500) {
    issues.push(`Some chunks are too large (max: ${maxSize} chars)`);
  }

  if (avgSize < 300 || avgSize > 1200) {
    issues.push(`Average chunk size is suboptimal (avg: ${Math.round(avgSize)} chars, target: 800)`);
  }

  // Check for empty chunks
  const emptyChunks = chunks.filter(c => !c.text.trim());
  if (emptyChunks.length > 0) {
    issues.push(`${emptyChunks.length} empty chunks found`);
  }

  return {
    valid: issues.length === 0,
    issues
  };
}
