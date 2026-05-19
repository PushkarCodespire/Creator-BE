import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import axios from 'axios';
import FormData from 'form-data';
import { isCloudinaryConfigured, uploadToCloudinary } from '../../utils/cloudinary';

const ELEVENLABS_BASE = 'https://api.elevenlabs.io/v1';

function getApiKey(): string {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) throw new Error('ELEVENLABS_API_KEY not configured');
  return key;
}

/**
 * Clone a voice from an audio file
 */
export async function cloneVoice(name: string, audioFilePath: string): Promise<string> {
  const apiKey = getApiKey();

  const form = new FormData();
  form.append('name', name);
  form.append('files', fs.createReadStream(audioFilePath));

  const res = await axios.post(`${ELEVENLABS_BASE}/voices/add`, form, {
    headers: {
      'xi-api-key': apiKey,
      ...form.getHeaders(),
    },
    timeout: 60000,
  });

  return res.data.voice_id;
}

/**
 * Generate speech from text using a cloned voice.
 * Returns the saved file path relative to uploads dir.
 */
export async function textToSpeech(voiceId: string, text: string): Promise<string> {
  const apiKey = getApiKey();

  const res = await axios.post(
    `${ELEVENLABS_BASE}/text-to-speech/${voiceId}`,
    {
      text,
      model_id: 'eleven_multilingual_v2',
      voice_settings: {
        stability: 0.5,
        similarity_boost: 0.75,
      },
    },
    {
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json',
        'Accept': 'audio/mpeg',
      },
      responseType: 'arraybuffer',
      timeout: 30000,
    }
  );

  const audioBuffer = Buffer.from(res.data);
  const filename = `voice_${uuidv4()}.mp3`;

  if (isCloudinaryConfigured) {
    return uploadToCloudinary(audioBuffer, 'chat', 'video', ['tts_audio']);
  }

  const uploadsDir = process.env.UPLOAD_DIR || './uploads';
  const chatDir = path.join(uploadsDir, 'chat');
  if (!fs.existsSync(chatDir)) fs.mkdirSync(chatDir, { recursive: true });
  fs.writeFileSync(path.join(chatDir, filename), audioBuffer);
  return `chat/${filename}`;
}

/**
 * Delete a cloned voice from ElevenLabs
 */
export async function deleteVoice(voiceId: string): Promise<void> {
  const apiKey = getApiKey();

  await axios.delete(`${ELEVENLABS_BASE}/voices/${voiceId}`, {
    headers: { 'xi-api-key': apiKey },
  });
}

/**
 * Check if ElevenLabs is configured
 */
export function isConfigured(): boolean {
  return !!process.env.ELEVENLABS_API_KEY;
}
