import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import axios, { AxiosResponse } from 'axios';
import { isCloudinaryConfigured, uploadToCloudinary } from '../../utils/cloudinary';

const INWORLD_TTS_BASE   = 'https://api.inworld.ai';
const INWORLD_VOICES_BASE = 'https://api.inworld.ai';

const INWORLD_MODEL_ID = 'inworld-tts-1.5-mini';

// Default TTS prosody — used when a creator hasn't set their own values.
// speakingRate: 0.25–2.0 (1.0 = normal pace). pitch: semitones offset (-20 to +20).
const DEFAULT_SPEAKING_RATE   = 1.1;
const DEFAULT_PITCH_SEMITONES = 2.0; // Inworld clamps pitch to -5.0 – +5.0

function getApiKey(): string {
  const key = process.env.INWORLD_API_KEY;
  if (!key) throw new Error('INWORLD_API_KEY not configured');
  return key;
}

function authHeader() {
  return { 'Authorization': `Basic ${getApiKey()}` };
}

/**
 * Clone a voice from one or more audio files using Inworld's instant voice cloning.
 * Multiple diverse samples (up to 3) produce a significantly better voice clone —
 * they capture different emotions, speeds, and phoneme patterns.
 * Returns the cloned voiceId (format: "{workspace}__{voice}") to store in the DB.
 */
export async function cloneVoice(name: string, audioFilePaths: string[]): Promise<string> {
  if (!audioFilePaths.length) throw new Error('At least one audio file is required');

  const allSamples = audioFilePaths.map(fp => ({
    audioData: fs.readFileSync(fp).toString('base64'),
  }));

  const attemptClone = async (voiceSamples: { audioData: string }[]): Promise<string> => {
    const res = await axios.post(
      `${INWORLD_VOICES_BASE}/voices/v1/voices:clone`,
      {
        displayName: name,
        langCode:    'AUTO',
        voiceSamples,
        // Do NOT remove background noise — on clean samples this strips voice
        // characteristics (timbre, resonance) and produces a robotic clone.
        audioProcessingConfig: { removeBackgroundNoise: false },
      },
      {
        headers: { ...authHeader(), 'Content-Type': 'application/json' },
        timeout: 90000,
      }
    );

    // Inworld returns voice: null when audio samples fail validation,
    // with details in audioSamplesValidated[].errors
    if (!res.data?.voice) {
      const errors: string[] = (res.data?.audioSamplesValidated ?? [])
        .flatMap((s: { errors?: { text: string }[] }) => (s.errors ?? []).map(e => e.text));
      throw new Error(`Inworld rejected audio: ${errors.join('; ') || 'unknown validation error'}`);
    }

    const rawId = res.data.voice?.voiceId
      ?? res.data.voice?.name
      ?? res.data?.voiceId
      ?? res.data?.name;
    if (!rawId) throw new Error(`Inworld clone response missing voiceId. Keys: ${Object.keys(res.data || {}).join(', ')}`);

    console.log('[inworld] storing voiceId:', rawId);
    return rawId;
  };

  // Try all samples together first (more samples = better quality)
  try {
    return await attemptClone(allSamples);
  } catch (batchErr) {
    if (allSamples.length <= 1) throw batchErr;

    // Batch failed — retry each sample individually and return the first success.
    // This handles cases where one sample is silent/corrupted but others are valid.
    console.warn('[inworld] batch clone failed, retrying individual samples:', batchErr instanceof Error ? batchErr.message : String(batchErr));
    let lastErr: unknown = batchErr;
    for (let i = 0; i < allSamples.length; i++) {
      try {
        console.log(`[inworld] trying sample ${i + 1}/${allSamples.length} individually`);
        return await attemptClone([allSamples[i]]);
      } catch (singleErr) {
        lastErr = singleErr;
        console.warn(`[inworld] sample ${i + 1} failed:`, singleErr instanceof Error ? singleErr.message : String(singleErr));
      }
    }
    throw lastErr;
  }
}

/**
 * Delete a previously cloned Inworld voice.
 */
export async function deleteVoice(voiceId: string): Promise<void> {
  await axios.delete(
    `${INWORLD_VOICES_BASE}/voices/v1/voices/${encodeURIComponent(voiceId)}`,
    { headers: authHeader(), timeout: 15000 }
  ).catch(() => {}); // non-fatal
}

/**
 * Generate speech from text using a cloned or preset Inworld voice.
 * voiceId can be a cloned ID ("{workspace}__{voice}") or a preset name ("Hades").
 * Saves audio locally or to Cloudinary and returns the relative path.
 */
async function _ttsRequest(voiceId: string, text: string, speakingRate: number, pitch: number): Promise<AxiosResponse<any>> {
  return axios.post(
    `${INWORLD_TTS_BASE}/tts/v1/voice`,
    { text, voiceId, modelId: INWORLD_MODEL_ID, audioConfig: { audioEncoding: 'MP3', sampleRateHertz: 24000, speakingRate, pitch } },
    { headers: { ...authHeader(), 'Content-Type': 'application/json' }, timeout: 30000 }
  );
}

export async function textToSpeech(
  voiceId: string,
  text: string,
  options?: { speakingRate?: number; pitch?: number },
): Promise<string> {
  const speakingRate = options?.speakingRate ?? DEFAULT_SPEAKING_RATE;
  const pitch        = options?.pitch        ?? DEFAULT_PITCH_SEMITONES;
  console.log(`[inworld] TTS request — voiceId: "${voiceId}", model: "${INWORLD_MODEL_ID}", chars: ${text.length}`);

  // Build candidate IDs: short ID first, then the full resource-name variant.
  // Some Inworld API versions want the UUID; others want the workspace path.
  const shortId = voiceId.includes('/') ? (voiceId.split('/').pop() ?? voiceId) : voiceId;
  const candidates = voiceId === shortId ? [voiceId] : [voiceId, shortId];

  let res: AxiosResponse<any> | null = null;
  let lastErr = '';

  for (const id of candidates) {
    try {
      res = await _ttsRequest(id, text, speakingRate, pitch);
      console.log(`[inworld] TTS succeeded with voiceId: "${id}"`);
      break;
    } catch (error) {
      if (axios.isAxiosError(error) && error.response) {
        const detail = JSON.stringify(error.response.data);
        lastErr = `Inworld TTS ${error.response.status}: ${detail}`;
        console.error(`[inworld] TTS HTTP ${error.response.status} (voiceId "${id}"):`, detail);
        // Only retry on 404 / NOT_FOUND — other errors (400 format, 401 auth) won't improve
        if (error.response.status !== 404) throw new Error(lastErr);
      } else {
        throw error;
      }
    }
  }

  // All cloned-voice candidates 404'd — the voice was likely created on a different
  // Inworld account/key. Fall back to the configured default preset voice so the
  // feature still works even if the cloned voice is unavailable.
  if (!res) {
    const fallbackId = process.env.INWORLD_DEFAULT_VOICE || 'Hades';
    if (voiceId !== fallbackId) {
      console.warn(`[inworld] All voiceId candidates failed (${lastErr}) — falling back to default voice "${fallbackId}"`);
      res = await _ttsRequest(fallbackId, text, speakingRate, pitch);
    } else {
      throw new Error(lastErr || 'Inworld TTS failed for all voiceId candidates');
    }
  }

  console.log('[inworld] TTS response keys:', Object.keys(res.data || {}));

  // Inworld may return camelCase or snake_case depending on API version
  const audioContent = res.data?.audioContent ?? res.data?.audio_content;
  if (!audioContent) {
    throw new Error(`Inworld TTS returned no audio. Response keys: ${Object.keys(res.data || {}).join(', ')}`);
  }

  const audioBuffer = Buffer.from(audioContent, 'base64');
  const filename    = `voice_${uuidv4()}.mp3`;

  if (isCloudinaryConfigured) {
    return uploadToCloudinary(audioBuffer, 'chat', 'video', ['tts_audio']);
  }

  const uploadsDir = process.env.UPLOAD_DIR || './uploads';
  const chatDir    = path.join(uploadsDir, 'chat');
  if (!fs.existsSync(chatDir)) fs.mkdirSync(chatDir, { recursive: true });
  fs.writeFileSync(path.join(chatDir, filename), audioBuffer);
  return `chat/${filename}`;
}

export function isConfigured(): boolean {
  return !!process.env.INWORLD_API_KEY;
}
