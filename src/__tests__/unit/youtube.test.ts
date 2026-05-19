// ===========================================
// YOUTUBE UNIT TESTS
// ===========================================

// Mock heavy dependencies to avoid loading them
jest.mock('@danielxceron/youtube-transcript', () => ({
  YoutubeTranscript: {
    fetchTranscript: jest.fn(),
  },
}));

jest.mock('youtube-transcript', () => ({
  fetchTranscript: jest.fn(),
}));

jest.mock('axios', () => ({
  get: jest.fn(),
  default: { get: jest.fn() },
}));

jest.mock('@distube/ytdl-core', () => ({
  __esModule: true,
  default: {
    getInfo: jest.fn(),
    createAgent: jest.fn(),
    createProxyAgent: jest.fn(),
  },
  getInfo: jest.fn(),
  createAgent: jest.fn(),
  createProxyAgent: jest.fn(),
}));

jest.mock('https-proxy-agent', () => ({
  HttpsProxyAgent: jest.fn(),
}));

jest.mock('../../utils/openai', () => ({
  openai: null,
  isOpenAIConfigured: jest.fn().mockReturnValue(false),
}));

jest.mock('fs', () => ({
  existsSync: jest.fn().mockReturnValue(false),
  readFileSync: jest.fn(),
  createWriteStream: jest.fn(),
  unlinkSync: jest.fn(),
}));

import {
  extractVideoId,
  cleanTranscript,
  segmentTranscriptByTime,
} from '../../utils/youtube';

describe('YouTube Utils - Unit Tests', () => {
  describe('extractVideoId', () => {
    it('should extract video ID from standard YouTube URL', () => {
      const result = extractVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
      expect(result).toBe('dQw4w9WgXcQ');
    });

    it('should extract video ID from short URL', () => {
      const result = extractVideoId('https://youtu.be/dQw4w9WgXcQ');
      expect(result).toBe('dQw4w9WgXcQ');
    });

    it('should extract video ID from embed URL', () => {
      const result = extractVideoId('https://www.youtube.com/embed/dQw4w9WgXcQ');
      expect(result).toBe('dQw4w9WgXcQ');
    });

    it('should extract video ID from shorts URL', () => {
      const result = extractVideoId('https://www.youtube.com/shorts/dQw4w9WgXcQ');
      expect(result).toBe('dQw4w9WgXcQ');
    });

    it('should extract video ID from live URL', () => {
      const result = extractVideoId('https://www.youtube.com/live/dQw4w9WgXcQ');
      expect(result).toBe('dQw4w9WgXcQ');
    });

    it('should extract video ID from /v/ URL', () => {
      const result = extractVideoId('https://www.youtube.com/v/dQw4w9WgXcQ');
      expect(result).toBe('dQw4w9WgXcQ');
    });

    it('should accept a raw 11-character video ID', () => {
      const result = extractVideoId('dQw4w9WgXcQ');
      expect(result).toBe('dQw4w9WgXcQ');
    });

    it('should return null for empty string', () => {
      const result = extractVideoId('');
      expect(result).toBeNull();
    });

    it('should return null for invalid URL', () => {
      const result = extractVideoId('https://example.com/not-youtube');
      expect(result).toBeNull();
    });

    it('should return null for null/undefined-like input', () => {
      const result = extractVideoId('');
      expect(result).toBeNull();
    });

    it('should handle URL with additional query params', () => {
      const result = extractVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=120');
      expect(result).toBe('dQw4w9WgXcQ');
    });

    it('should handle youtube-nocookie.com domain', () => {
      const result = extractVideoId('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ');
      expect(result).toBe('dQw4w9WgXcQ');
    });

    it('should handle URL without www prefix', () => {
      const result = extractVideoId('https://youtube.com/watch?v=dQw4w9WgXcQ');
      expect(result).toBe('dQw4w9WgXcQ');
    });

    it('should return null for invalid video ID length', () => {
      const result = extractVideoId('https://www.youtube.com/watch?v=short');
      expect(result).toBeNull();
    });

    it('should handle whitespace-padded input', () => {
      const result = extractVideoId('  dQw4w9WgXcQ  ');
      expect(result).toBe('dQw4w9WgXcQ');
    });

    it('should handle input without protocol by adding https://', () => {
      const result = extractVideoId('www.youtube.com/watch?v=dQw4w9WgXcQ');
      expect(result).toBe('dQw4w9WgXcQ');
    });
  });

  describe('cleanTranscript', () => {
    it('should remove [Music] annotations', () => {
      const result = cleanTranscript('Hello [Music] World');
      expect(result).toBe('Hello World');
    });

    it('should remove [Applause] annotations', () => {
      const result = cleanTranscript('Great performance [Applause]');
      expect(result).toBe('Great performance');
    });

    it('should remove multiple bracket annotations', () => {
      const result = cleanTranscript('[Music] Hello [Applause] World [Laughter]');
      expect(result).toBe('Hello World');
    });

    it('should collapse multiple spaces to single space', () => {
      const result = cleanTranscript('Hello    World    Test');
      expect(result).toBe('Hello World Test');
    });

    it('should trim leading and trailing whitespace', () => {
      const result = cleanTranscript('  Hello World  ');
      expect(result).toBe('Hello World');
    });

    it('should handle empty string', () => {
      const result = cleanTranscript('');
      expect(result).toBe('');
    });

    it('should handle transcript with only annotations', () => {
      const result = cleanTranscript('[Music] [Applause] [Laughter]');
      expect(result).toBe('');
    });

    it('should preserve normal transcript text', () => {
      const input = 'Today we are going to talk about JavaScript';
      const result = cleanTranscript(input);
      expect(result).toBe(input);
    });
  });

  describe('segmentTranscriptByTime', () => {
    it('should segment transcript into time-based groups', () => {
      const segments = [
        { text: 'Hello', offset: 0, duration: 1000 },
        { text: 'World', offset: 5000, duration: 1000 },
        { text: 'New segment', offset: 65000, duration: 1000 },
        { text: 'More text', offset: 70000, duration: 1000 },
      ];

      const result = segmentTranscriptByTime(segments, 60);

      expect(result).toHaveLength(2);
      expect(result[0]).toContain('Hello');
      expect(result[0]).toContain('World');
      expect(result[1]).toContain('New segment');
    });

    it('should use default 60-second interval', () => {
      const segments = [
        { text: 'Part 1', offset: 0, duration: 1000 },
        { text: 'Part 2', offset: 30000, duration: 1000 },
        { text: 'Part 3', offset: 61000, duration: 1000 },
      ];

      const result = segmentTranscriptByTime(segments);

      expect(result).toHaveLength(2);
    });

    it('should handle empty segments array', () => {
      const result = segmentTranscriptByTime([]);
      expect(result).toEqual([]);
    });

    it('should handle single segment', () => {
      const segments = [{ text: 'Only segment', offset: 0, duration: 1000 }];
      const result = segmentTranscriptByTime(segments);
      expect(result).toHaveLength(1);
      expect(result[0]).toContain('Only segment');
    });

    it('should clean transcript text in each segment group', () => {
      const segments = [
        { text: '[Music] Hello', offset: 0, duration: 1000 },
        { text: '[Applause] World', offset: 5000, duration: 1000 },
      ];

      const result = segmentTranscriptByTime(segments, 60);

      expect(result).toHaveLength(1);
      expect(result[0]).not.toContain('[Music]');
      expect(result[0]).not.toContain('[Applause]');
    });

    it('should create new group when interval is exceeded', () => {
      const segments = [
        { text: 'A', offset: 0, duration: 500 },
        { text: 'B', offset: 10000, duration: 500 },  // 10s
        { text: 'C', offset: 20000, duration: 500 },  // 20s - new group at 15s interval
        { text: 'D', offset: 25000, duration: 500 },  // 25s
      ];

      const result = segmentTranscriptByTime(segments, 15);

      expect(result).toHaveLength(2);
    });

    it('should handle segments all within one interval', () => {
      const segments = [
        { text: 'First', offset: 0, duration: 1000 },
        { text: 'Second', offset: 10000, duration: 1000 },
        { text: 'Third', offset: 20000, duration: 1000 },
      ];

      const result = segmentTranscriptByTime(segments, 120);

      expect(result).toHaveLength(1);
      expect(result[0]).toContain('First');
      expect(result[0]).toContain('Second');
      expect(result[0]).toContain('Third');
    });
  });
});
