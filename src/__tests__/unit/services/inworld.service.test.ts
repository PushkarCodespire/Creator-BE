jest.mock('fs');
jest.mock('uuid', () => ({ v4: jest.fn(() => 'test-uuid-5678') }));
jest.mock('axios');

import fs from 'fs';
import axios from 'axios';
import {
  cloneVoice,
  deleteVoice,
  textToSpeech,
  isConfigured,
} from '../../../services/voice/inworld.service';

const mockFs = fs as jest.Mocked<typeof fs>;
const mockAxios = axios as jest.Mocked<typeof axios>;

describe('inworld.service', () => {
  const origEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...origEnv };
    (mockFs.existsSync as jest.Mock).mockReturnValue(true);
    (mockFs.mkdirSync as jest.Mock).mockReturnValue(undefined);
    (mockFs.writeFileSync as jest.Mock).mockReturnValue(undefined);
    (mockFs.readFileSync as jest.Mock).mockReturnValue(Buffer.from('audio-data'));
  });

  afterAll(() => {
    process.env = origEnv;
  });

  describe('isConfigured', () => {
    it('returns true when INWORLD_API_KEY is set', () => {
      process.env.INWORLD_API_KEY = 'test-key';
      expect(isConfigured()).toBe(true);
    });

    it('returns false when INWORLD_API_KEY is not set', () => {
      delete process.env.INWORLD_API_KEY;
      expect(isConfigured()).toBe(false);
    });
  });

  describe('cloneVoice', () => {
    beforeEach(() => {
      process.env.INWORLD_API_KEY = 'test-api-key';
    });

    it('throws when INWORLD_API_KEY not configured', async () => {
      delete process.env.INWORLD_API_KEY;

      await expect(cloneVoice('test', '/tmp/audio.wav')).rejects.toThrow(
        'INWORLD_API_KEY not configured'
      );
    });

    it('reads audio file and sends to Inworld clone endpoint', async () => {
      const voiceId = 'workspace__voice-123';
      (mockAxios.post as jest.Mock).mockResolvedValue({ data: { voice: { voiceId } } });

      const result = await cloneVoice('Test Voice', '/tmp/audio.wav');

      expect(mockFs.readFileSync).toHaveBeenCalledWith('/tmp/audio.wav');
      expect(mockAxios.post).toHaveBeenCalledWith(
        expect.stringContaining('/voices:clone'),
        expect.objectContaining({
          displayName: 'Test Voice',
          langCode: 'AUTO',
          voiceSamples: [{ audioData: expect.any(String) }],
        }),
        expect.objectContaining({ headers: expect.objectContaining({ Authorization: expect.stringContaining('Basic') }) })
      );
      expect(result).toBe(voiceId);
    });

    it('returns voiceId from response', async () => {
      (mockAxios.post as jest.Mock).mockResolvedValue({
        data: { voice: { voiceId: 'my-workspace__my-voice' } },
      });

      const result = await cloneVoice('My Voice', '/tmp/ref.wav');
      expect(result).toBe('my-workspace__my-voice');
    });
  });

  describe('deleteVoice', () => {
    beforeEach(() => {
      process.env.INWORLD_API_KEY = 'test-api-key';
    });

    it('calls delete endpoint for given voiceId', async () => {
      (mockAxios.delete as jest.Mock).mockResolvedValue({});

      await deleteVoice('workspace__voice-123');

      expect(mockAxios.delete).toHaveBeenCalledWith(
        expect.stringContaining('workspace__voice-123'),
        expect.objectContaining({ headers: expect.objectContaining({ Authorization: expect.any(String) }) })
      );
    });

    it('does not throw on delete error (non-fatal)', async () => {
      (mockAxios.delete as jest.Mock).mockRejectedValue(new Error('Network error'));

      await expect(deleteVoice('some-voice')).resolves.toBeUndefined();
    });

    it('throws when INWORLD_API_KEY not configured', async () => {
      delete process.env.INWORLD_API_KEY;

      await expect(deleteVoice('voice-id')).rejects.toThrow('INWORLD_API_KEY not configured');
    });
  });

  describe('textToSpeech', () => {
    beforeEach(() => {
      process.env.INWORLD_API_KEY = 'test-api-key';
      (mockAxios.post as jest.Mock).mockResolvedValue({
        data: { audioContent: Buffer.from('mp3-data').toString('base64') },
      });
    });

    it('throws when INWORLD_API_KEY not configured', async () => {
      delete process.env.INWORLD_API_KEY;

      await expect(textToSpeech('voice-id', 'Hello')).rejects.toThrow('INWORLD_API_KEY not configured');
    });

    it('calls Inworld TTS endpoint with correct payload', async () => {
      await textToSpeech('Hades', 'Hello world');

      expect(mockAxios.post).toHaveBeenCalledWith(
        expect.stringContaining('/tts/v1/voice'),
        expect.objectContaining({
          text: 'Hello world',
          voiceId: 'Hades',
          audioConfig: { audioEncoding: 'MP3' },
        }),
        expect.objectContaining({ headers: expect.objectContaining({ Authorization: expect.any(String) }) })
      );
    });

    it('creates chat dir if not exists', async () => {
      (mockFs.existsSync as jest.Mock).mockReturnValue(false);

      await textToSpeech('voice-id', 'Hello');

      expect(mockFs.mkdirSync).toHaveBeenCalledWith(
        expect.stringContaining('chat'),
        { recursive: true }
      );
    });

    it('saves audio file and returns relative path', async () => {
      (mockFs.existsSync as jest.Mock).mockReturnValue(true);

      const result = await textToSpeech('voice-id', 'Hello');

      expect(mockFs.writeFileSync).toHaveBeenCalledWith(
        expect.stringContaining('voice_test-uuid-5678.mp3'),
        expect.any(Buffer)
      );
      expect(result).toBe('chat/voice_test-uuid-5678.mp3');
    });

    it('uses UPLOAD_DIR env var when set', async () => {
      process.env.UPLOAD_DIR = '/custom/uploads';
      (mockFs.existsSync as jest.Mock).mockReturnValue(true);

      await textToSpeech('voice-id', 'Hello');

      expect(mockFs.writeFileSync).toHaveBeenCalledWith(
        expect.stringContaining('custom'),
        expect.any(Buffer)
      );
    });
  });
});
