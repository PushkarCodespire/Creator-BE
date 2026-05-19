jest.mock('fs');
jest.mock('path', () => {
  const orig = jest.requireActual('path');
  return { ...orig };
});
jest.mock('uuid', () => ({ v4: jest.fn(() => 'test-uuid-1234') }));
jest.mock('axios');

import fs from 'fs';
import path from 'path';
import axios from 'axios';
import {
  cloneVoice,
  textToSpeech,
  isConfigured,
  isTtsConfigured,
} from '../../../services/voice/chatterbox.service';

const mockFs = fs as jest.Mocked<typeof fs>;
const mockAxios = axios as jest.Mocked<typeof axios>;

describe('chatterbox.service', () => {
  const origEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...origEnv };
    (mockFs.existsSync as jest.Mock).mockReturnValue(true);
    (mockFs.mkdirSync as jest.Mock).mockReturnValue(undefined);
    (mockFs.copyFileSync as jest.Mock).mockReturnValue(undefined);
    (mockFs.writeFileSync as jest.Mock).mockReturnValue(undefined);
    (mockFs.readFileSync as jest.Mock).mockReturnValue(Buffer.from('audio-data'));
  });

  afterAll(() => {
    process.env = origEnv;
  });

  describe('isConfigured', () => {
    it('always returns true', () => {
      expect(isConfigured()).toBe(true);
    });
  });

  describe('isTtsConfigured', () => {
    it('returns true when MODAL_CHATTERBOX_URL is set', () => {
      process.env.MODAL_CHATTERBOX_URL = 'http://modal.example.com';
      expect(isTtsConfigured()).toBe(true);
    });

    it('returns false when MODAL_CHATTERBOX_URL is not set', () => {
      delete process.env.MODAL_CHATTERBOX_URL;
      expect(isTtsConfigured()).toBe(false);
    });
  });

  describe('cloneVoice', () => {
    it('creates voice dir if not exists', async () => {
      (mockFs.existsSync as jest.Mock).mockReturnValue(false);

      await cloneVoice('test-voice', '/tmp/audio.wav');

      expect(mockFs.mkdirSync).toHaveBeenCalledWith(
        expect.stringContaining('voices'),
        { recursive: true }
      );
    });

    it('copies audio file to voice dir and returns relative path', async () => {
      const result = await cloneVoice('test-voice', '/tmp/audio.wav');

      expect(mockFs.copyFileSync).toHaveBeenCalledWith(
        '/tmp/audio.wav',
        expect.stringContaining('chatterbox_ref_test-uuid-1234.wav')
      );
      expect(result).toBe('voices/chatterbox_ref_test-uuid-1234.wav');
    });

    it('preserves original file extension', async () => {
      const result = await cloneVoice('test-voice', '/tmp/audio.mp3');

      expect(result).toBe('voices/chatterbox_ref_test-uuid-1234.mp3');
    });

    it('defaults to .wav extension when file has no extension', async () => {
      const result = await cloneVoice('test-voice', '/tmp/audio');

      expect(result).toBe('voices/chatterbox_ref_test-uuid-1234.wav');
    });

    it('uses UPLOAD_DIR env var when set', async () => {
      process.env.UPLOAD_DIR = '/custom/uploads';
      await cloneVoice('test-voice', '/tmp/audio.wav');

      expect(mockFs.copyFileSync).toHaveBeenCalledWith(
        '/tmp/audio.wav',
        expect.stringContaining('custom')
      );
    });
  });

  describe('textToSpeech', () => {
    beforeEach(() => {
      process.env.MODAL_CHATTERBOX_URL = 'http://modal.example.com/generate';
      (mockAxios.post as jest.Mock).mockResolvedValue({ data: Buffer.from('wav-data') });
    });

    it('throws when MODAL_CHATTERBOX_URL not configured', async () => {
      delete process.env.MODAL_CHATTERBOX_URL;

      await expect(textToSpeech('voices/ref.wav', 'Hello world')).rejects.toThrow(
        'MODAL_CHATTERBOX_URL not configured'
      );
    });

    it('reads reference audio and sends base64 to endpoint', async () => {
      (mockFs.existsSync as jest.Mock).mockImplementation((p: string) => p.includes('voices'));

      await textToSpeech('voices/ref.wav', 'Hello world');

      expect(mockAxios.post).toHaveBeenCalledWith(
        'http://modal.example.com/generate',
        expect.objectContaining({ prompt: 'Hello world', audio_prompt_b64: expect.any(String) }),
        expect.objectContaining({ responseType: 'arraybuffer' })
      );
    });

    it('sends without audio_prompt_b64 when reference file not found', async () => {
      (mockFs.existsSync as jest.Mock).mockReturnValue(false);

      await textToSpeech('voices/missing.wav', 'Hello world');

      expect(mockAxios.post).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ audio_prompt_b64: undefined }),
        expect.anything()
      );
    });

    it('creates chat dir if not exists', async () => {
      (mockFs.existsSync as jest.Mock).mockReturnValue(false);

      await textToSpeech('voices/ref.wav', 'Hello world');

      expect(mockFs.mkdirSync).toHaveBeenCalledWith(
        expect.stringContaining('chat'),
        { recursive: true }
      );
    });

    it('saves audio file and returns relative path', async () => {
      (mockFs.existsSync as jest.Mock).mockReturnValue(true);

      const result = await textToSpeech('voices/ref.wav', 'Hello world');

      expect(mockFs.writeFileSync).toHaveBeenCalledWith(
        expect.stringContaining('voice_test-uuid-1234.wav'),
        expect.any(Buffer)
      );
      expect(result).toBe('chat/voice_test-uuid-1234.wav');
    });
  });
});
