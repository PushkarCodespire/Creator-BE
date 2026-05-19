import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import axios from 'axios';

function getEndpointUrl(): string {
  const url = process.env.MODAL_CHATTERBOX_URL;
  if (!url) throw new Error('MODAL_CHATTERBOX_URL not configured');
  return url;
}

/**
 * "Clone" a voice for Chatterbox: copy the uploaded reference audio to a stable
 * location and return that path as the voiceId. The reference audio is sent as
 * an audio prompt on every TTS call (zero-shot voice cloning).
 */
export async function cloneVoice(_name: string, audioFilePath: string): Promise<string> {
  const uploadsDir = process.env.UPLOAD_DIR || './uploads';
  const voiceDir = path.join(uploadsDir, 'voices');
  if (!fs.existsSync(voiceDir)) fs.mkdirSync(voiceDir, { recursive: true });

  const ext = path.extname(audioFilePath) || '.wav';
  const filename = `chatterbox_ref_${uuidv4()}${ext}`;
  const destPath = path.join(voiceDir, filename);
  fs.copyFileSync(audioFilePath, destPath);

  return `voices/${filename}`;
}

/**
 * Generate speech from text using the Modal Chatterbox endpoint.
 * voiceId is the relative path to the reference audio file.
 * Returns saved WAV file path relative to uploads dir.
 */
export async function textToSpeech(voiceId: string, text: string): Promise<string> {
  const endpointUrl = getEndpointUrl();
  const uploadsDir = process.env.UPLOAD_DIR || './uploads';

  let audioPromptB64: string | undefined;
  const refPath = path.join(uploadsDir, voiceId);
  if (fs.existsSync(refPath)) {
    audioPromptB64 = fs.readFileSync(refPath).toString('base64');
  }

  const res = await axios.post(
    endpointUrl,
    {
      prompt: text,
      audio_prompt_b64: audioPromptB64,
    },
    {
      responseType: 'arraybuffer',
      timeout: 120000,
    }
  );

  const chatDir = path.join(uploadsDir, 'chat');
  if (!fs.existsSync(chatDir)) fs.mkdirSync(chatDir, { recursive: true });

  const filename = `voice_${uuidv4()}.wav`;
  fs.writeFileSync(path.join(chatDir, filename), Buffer.from(res.data));

  return `chat/${filename}`;
}

export function isConfigured(): boolean {
  return true; // cloneVoice copies locally — no external URL needed
}

export function isTtsConfigured(): boolean {
  return !!process.env.MODAL_CHATTERBOX_URL;
}
