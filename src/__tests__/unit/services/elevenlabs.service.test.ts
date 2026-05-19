// ===========================================
// ELEVENLABS SERVICE — UNIT TESTS
// ===========================================

jest.mock('fs', () => ({
  createReadStream: jest.fn().mockReturnValue('mock-stream'),
  existsSync: jest.fn().mockReturnValue(true),
  mkdirSync: jest.fn(),
  writeFileSync: jest.fn(),
}));

jest.mock('uuid', () => ({
  v4: jest.fn().mockReturnValue('test-uuid-1234'),
}));

jest.mock('axios', () => ({
  __esModule: true,
  default: {
    post: jest.fn(),
    delete: jest.fn(),
  },
}));

jest.mock('form-data', () => {
  return jest.fn().mockImplementation(() => ({
    append: jest.fn(),
    getHeaders: jest.fn().mockReturnValue({ 'content-type': 'multipart/form-data' }),
  }));
});

import axios from 'axios';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import FormData from 'form-data';
import { cloneVoice, textToSpeech, deleteVoice, isConfigured } from '../../../services/voice/elevenlabs.service';

const mockAxios = axios as jest.Mocked<typeof axios>;

describe('ElevenLabsService', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv, ELEVENLABS_API_KEY: 'test-api-key' };
    (uuidv4 as jest.Mock).mockReturnValue('test-uuid-1234');
    (fs.createReadStream as jest.Mock).mockReturnValue('mock-stream');
    (fs.existsSync as jest.Mock).mockReturnValue(true);
    (FormData as unknown as jest.Mock).mockImplementation(() => ({
      append: jest.fn(),
      getHeaders: jest.fn().mockReturnValue({ 'content-type': 'multipart/form-data' }),
    }));
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('cloneVoice', () => {
    it('should clone a voice and return voice_id', async () => {
      (mockAxios.post as jest.Mock).mockResolvedValue({
        data: { voice_id: 'voice-123' },
      });

      const result = await cloneVoice('My Voice', '/path/to/audio.mp3');

      expect(result).toBe('voice-123');
      expect(mockAxios.post).toHaveBeenCalledWith(
        'https://api.elevenlabs.io/v1/voices/add',
        expect.anything(),
        expect.objectContaining({
          headers: expect.objectContaining({
            'xi-api-key': 'test-api-key',
          }),
        })
      );
    });

    it('should throw when API key is not configured', async () => {
      process.env.ELEVENLABS_API_KEY = '';

      await expect(cloneVoice('Voice', '/path/audio.mp3')).rejects.toThrow(
        'ELEVENLABS_API_KEY not configured'
      );
    });

    it('should propagate API errors', async () => {
      (mockAxios.post as jest.Mock).mockRejectedValue(new Error('API rate limit'));

      await expect(cloneVoice('Voice', '/path/audio.mp3')).rejects.toThrow('API rate limit');
    });
  });

  describe('textToSpeech', () => {
    it('should generate speech and save to file', async () => {
      const audioBuffer = Buffer.from('fake-audio-data');
      (mockAxios.post as jest.Mock).mockResolvedValue({
        data: audioBuffer,
      });

      const result = await textToSpeech('voice-123', 'Hello world');

      expect(result).toBe('chat/voice_test-uuid-1234.mp3');
      expect(fs.writeFileSync).toHaveBeenCalled();
      expect(mockAxios.post).toHaveBeenCalledWith(
        'https://api.elevenlabs.io/v1/text-to-speech/voice-123',
        expect.objectContaining({
          text: 'Hello world',
          model_id: 'eleven_multilingual_v2',
        }),
        expect.objectContaining({
          responseType: 'arraybuffer',
        })
      );
    });

    it('should throw when API key is not configured', async () => {
      process.env.ELEVENLABS_API_KEY = '';

      await expect(textToSpeech('voice-123', 'Hello')).rejects.toThrow(
        'ELEVENLABS_API_KEY not configured'
      );
    });

    it('should create directory if it does not exist', async () => {
      (fs.existsSync as jest.Mock).mockReturnValue(false);
      (mockAxios.post as jest.Mock).mockResolvedValue({
        data: Buffer.from('audio'),
      });

      await textToSpeech('voice-123', 'Hello');

      expect(fs.mkdirSync).toHaveBeenCalledWith(expect.any(String), { recursive: true });
    });
  });

  describe('deleteVoice', () => {
    it('should delete a voice via API', async () => {
      (mockAxios.delete as jest.Mock).mockResolvedValue({});

      await deleteVoice('voice-123');

      expect(mockAxios.delete).toHaveBeenCalledWith(
        'https://api.elevenlabs.io/v1/voices/voice-123',
        expect.objectContaining({
          headers: { 'xi-api-key': 'test-api-key' },
        })
      );
    });

    it('should throw when API key is not configured', async () => {
      process.env.ELEVENLABS_API_KEY = '';

      await expect(deleteVoice('voice-123')).rejects.toThrow(
        'ELEVENLABS_API_KEY not configured'
      );
    });
  });

  describe('isConfigured', () => {
    it('should return true when API key is set', () => {
      process.env.ELEVENLABS_API_KEY = 'test-key';
      expect(isConfigured()).toBe(true);
    });

    it('should return false when API key is not set', () => {
      delete process.env.ELEVENLABS_API_KEY;
      expect(isConfigured()).toBe(false);
    });
  });
});
