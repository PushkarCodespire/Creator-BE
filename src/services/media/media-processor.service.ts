// ===========================================
// MEDIA PROCESSOR SERVICE
// Extracts usable text from chat attachments (audio, image, documents)
// ===========================================

import fs from 'fs';
import path from 'path';
import { URL } from 'url';
import pdfParse from 'pdf-parse';
import mammoth from 'mammoth';
import mime from 'mime-types';
import { config } from '../../config';
import { openai } from '../../utils/openai';
import { logError, logInfo } from '../../utils/logger';
import { getUploadPathPrefixes } from '../../utils/uploadPaths';
import type { MessageMedia } from '../../types/chat.types';

const MAX_ATTACHMENTS = 3; // safety cap per message

const uploadsPrefixes = getUploadPathPrefixes();

const resolveLocalPath = (url: string): string | null => {
  if (!url) return null;

  let pathname = url;

  // Support absolute URLs pointing to our uploads path
  try {
    const parsed = new URL(url, 'http://localhost');
    pathname = parsed.pathname;
  } catch {
    // Not a valid URL; treat as pathname
  }

  for (const prefix of uploadsPrefixes) {
    if (pathname.startsWith(prefix)) {
      const relative = pathname.substring(prefix.length);
      return path.join(config.upload.dir, relative);
    }
  }

  return null;
};

const readFileAsBase64DataUrl = (filePath: string): string => {
  const mimeType = mime.lookup(filePath) || 'application/octet-stream';
  const buffer = fs.readFileSync(filePath);
  return `data:${mimeType};base64,${buffer.toString('base64')}`;
};

const transcribeAudio = async (filePath: string): Promise<string> => {
  try {
    const result = await openai.audio.transcriptions.create({
      file: fs.createReadStream(filePath),
      model: 'whisper-1'
    });
    return result.text?.trim() || '';
  } catch (error) {
    logError(error instanceof Error ? error : new Error(String(error)), { context: 'MediaProcessor.transcribeAudio', filePath });
    return '';
  }
};

const describeImage = async (filePath: string): Promise<string> => {
  try {
    const dataUrl = readFileAsBase64DataUrl(filePath);
    const response = await openai.chat.completions.create({
      model: process.env.OPENAI_VISION_MODEL || 'gpt-4o-mini',
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: 'Analyze this image. Briefly describe what you see and extract any visible text.'
            },
            {
              type: 'image_url',
              image_url: { url: dataUrl }
            }
          ]
        }
      ],
      max_tokens: 300,
      temperature: 0.2
    });

    return response.choices[0]?.message?.content?.trim() || '';
  } catch (error) {
    logError(error instanceof Error ? error : new Error(String(error)), { context: 'MediaProcessor.describeImage', filePath });
    return '';
  }
};

const extractDocumentText = async (filePath: string): Promise<string> => {
  const ext = path.extname(filePath).toLowerCase();

  try {
    if (ext === '.pdf') {
      const data = await pdfParse(fs.readFileSync(filePath));
      return data.text?.trim() || '';
    }

    if (ext === '.docx') {
      const result = await mammoth.extractRawText({ path: filePath });
      return result.value?.trim() || '';
    }

    if (ext === '.txt') {
      return fs.readFileSync(filePath, 'utf-8').trim();
    }

    // Unsupported document type
    return '';
  } catch (error) {
    logError(error instanceof Error ? error : new Error(String(error)), { context: 'MediaProcessor.extractDocumentText', filePath, ext });
    return '';
  }
};

/**
 * Process attachments and return a combined text block to feed the LLM.
 */
export async function buildAttachmentContext(media?: MessageMedia[]): Promise<{
  combined: string;
  parts: string[];
}> {
  if (!media || media.length === 0) {
    return { combined: '', parts: [] };
  }

  const parts: string[] = [];
  const limited = media.slice(0, MAX_ATTACHMENTS);

  for (const item of limited) {
    const localPath = resolveLocalPath(item.url);
    if (!localPath || !fs.existsSync(localPath)) {
      logInfo(`[MediaProcessor] File not found for media url ${item.url}`);
      continue;
    }

    if (item.type === 'audio') {
      const transcript = await transcribeAudio(localPath);
      if (transcript) {
        parts.push(`Audio (${item.name || path.basename(localPath)}): ${transcript}`);
      }
      continue;
    }

    if (item.type === 'image') {
      const description = await describeImage(localPath);
      if (description) {
        parts.push(`Image (${item.name || path.basename(localPath)}): ${description}`);
      }
      continue;
    }

    // Documents or other files
    const docText = await extractDocumentText(localPath);
    if (docText) {
      parts.push(`File (${item.name || path.basename(localPath)}): ${docText.slice(0, 1200)}`);
    }
  }

  const combined = parts.join('\n\n').trim();
  return { combined, parts };
}
