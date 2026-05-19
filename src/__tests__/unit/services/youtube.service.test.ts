// ===========================================
// YOUTUBE SERVICE — UNIT TESTS
// ===========================================

const mockRedis = {
  get: jest.fn(),
  setEx: jest.fn(),
  del: jest.fn(),
};

jest.mock('../../../utils/redis', () => ({
  getRedisClient: jest.fn(() => mockRedis),
  isRedisConnected: jest.fn(() => true),
}));

jest.mock('../../../utils/youtube', () => ({
  fetchYouTubeTranscript: jest.fn(),
  cleanTranscript: jest.fn(),
  extractVideoId: jest.fn(),
}));

jest.mock('../../../utils/errors', () => ({
  AppError: class AppError extends Error {
    statusCode: number;
    constructor(message: string, statusCode: number) {
      super(message);
      this.statusCode = statusCode;
    }
  },
}));

import { fetchCachedTranscript, invalidateTranscriptCache } from '../../../services/content/youtube.service';
import { fetchYouTubeTranscript, cleanTranscript, extractVideoId } from '../../../utils/youtube';
import { getRedisClient, isRedisConnected } from '../../../utils/redis';

const mockExtractVideoId = extractVideoId as jest.MockedFunction<typeof extractVideoId>;
const mockFetchTranscript = fetchYouTubeTranscript as jest.MockedFunction<typeof fetchYouTubeTranscript>;
const mockCleanTranscript = cleanTranscript as jest.MockedFunction<typeof cleanTranscript>;

describe('YouTubeService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRedis.get.mockResolvedValue(null);
    mockRedis.setEx.mockResolvedValue('OK');
    mockRedis.del.mockResolvedValue(0);
    (getRedisClient as jest.Mock).mockReturnValue(mockRedis);
    (isRedisConnected as jest.Mock).mockReturnValue(true);
  });

  describe('fetchCachedTranscript', () => {
    it('should return cached transcript when available', async () => {
      mockExtractVideoId.mockReturnValue('abc123');
      const cachedData = {
        videoId: 'abc123',
        transcript: 'Cached transcript text',
        segments: [],
      };
      mockRedis.get.mockResolvedValue(JSON.stringify(cachedData));

      const result = await fetchCachedTranscript('https://youtube.com/watch?v=abc123');

      expect(result.cached).toBe(true);
      expect(result.videoId).toBe('abc123');
      expect(mockFetchTranscript).not.toHaveBeenCalled();
    });

    it('should fetch from YouTube when cache miss', async () => {
      mockExtractVideoId.mockReturnValue('xyz789');
      mockRedis.get.mockResolvedValue(null);
      mockFetchTranscript.mockResolvedValue({
        videoId: 'xyz789',
        transcript: 'Raw transcript',
        segments: [{ text: 'segment1', start: 0, duration: 5 }],
      } as any);
      mockCleanTranscript.mockReturnValue('Cleaned transcript');

      const result = await fetchCachedTranscript('https://youtube.com/watch?v=xyz789');

      expect(result.cached).toBe(false);
      expect(result.transcript).toBe('Cleaned transcript');
      expect(mockRedis.setEx).toHaveBeenCalled();
    });

    it('should throw AppError for invalid YouTube URL', async () => {
      mockExtractVideoId.mockReturnValue(null as any);

      await expect(
        fetchCachedTranscript('https://invalid-url.com')
      ).rejects.toThrow('Invalid YouTube URL');
    });

    it('should throw AppError when transcript is empty', async () => {
      mockExtractVideoId.mockReturnValue('empty123');
      mockRedis.get.mockResolvedValue(null);
      mockFetchTranscript.mockResolvedValue({
        videoId: 'empty123',
        transcript: '',
        segments: [],
      } as any);
      mockCleanTranscript.mockReturnValue('');

      await expect(
        fetchCachedTranscript('https://youtube.com/watch?v=empty123')
      ).rejects.toThrow('Transcript is empty');
    });

    it('should still fetch from YouTube when Redis is not connected', async () => {
      mockExtractVideoId.mockReturnValue('vid456');
      (isRedisConnected as jest.Mock).mockReturnValue(false);
      mockFetchTranscript.mockResolvedValue({
        videoId: 'vid456',
        transcript: 'Transcript text',
        segments: [],
      } as any);
      mockCleanTranscript.mockReturnValue('Clean text');

      const result = await fetchCachedTranscript('https://youtube.com/watch?v=vid456');

      expect(result.cached).toBe(false);
      expect(result.transcript).toBe('Clean text');
    });
  });

  describe('invalidateTranscriptCache', () => {
    it('should delete cache key for the video', async () => {
      mockRedis.del.mockResolvedValue(1);

      await invalidateTranscriptCache('abc123');

      expect(mockRedis.del).toHaveBeenCalledWith('transcript:abc123');
    });

    it('should skip when Redis is not connected', async () => {
      (isRedisConnected as jest.Mock).mockReturnValue(false);

      await invalidateTranscriptCache('abc123');

      expect(mockRedis.del).not.toHaveBeenCalled();
    });

    it('should skip when redis client is null', async () => {
      (getRedisClient as jest.Mock).mockReturnValue(null);
      (isRedisConnected as jest.Mock).mockReturnValue(true);

      await invalidateTranscriptCache('nullredis');

      expect(mockRedis.del).not.toHaveBeenCalled();
    });
  });
});

// ==========================================================
// EXTENDED BRANCH COVERAGE
// ==========================================================

describe('YouTubeService — extended coverage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRedis.get.mockResolvedValue(null);
    mockRedis.setEx.mockResolvedValue('OK');
    mockRedis.del.mockResolvedValue(0);
    (getRedisClient as jest.Mock).mockReturnValue(mockRedis);
    (isRedisConnected as jest.Mock).mockReturnValue(true);
  });

  // ---- fetchCachedTranscript branches ----

  it('returns cached result and sets cached: true', async () => {
    mockExtractVideoId.mockReturnValue('vid1');
    const payload = { videoId: 'vid1', transcript: 'Full transcript', segments: [{ text: 'hi', offset: 0, duration: 100 }] };
    mockRedis.get.mockResolvedValue(JSON.stringify(payload));

    const result = await fetchCachedTranscript('https://youtube.com/watch?v=vid1');

    expect(result.cached).toBe(true);
    expect(result.segments).toHaveLength(1);
  });

  it('skips cache read when redis client is null, fetches fresh', async () => {
    (getRedisClient as jest.Mock).mockReturnValue(null);
    mockExtractVideoId.mockReturnValue('nored');
    mockFetchTranscript.mockResolvedValue({ videoId: 'nored', transcript: 'fresh', segments: [] } as any);
    mockCleanTranscript.mockReturnValue('fresh');

    const result = await fetchCachedTranscript('https://youtube.com/watch?v=nored');

    expect(result.cached).toBe(false);
    expect(mockRedis.setEx).not.toHaveBeenCalled();
  });

  it('skips all redis operations when isRedisConnected returns false from start', async () => {
    mockExtractVideoId.mockReturnValue('no-write');
    (isRedisConnected as jest.Mock).mockReturnValue(false);
    mockFetchTranscript.mockResolvedValue({ videoId: 'no-write', transcript: 'data', segments: [] } as any);
    mockCleanTranscript.mockReturnValue('data');

    const result = await fetchCachedTranscript('https://youtube.com/watch?v=no-write');

    expect(result.cached).toBe(false);
    expect(mockRedis.setEx).not.toHaveBeenCalled();
    expect(mockRedis.get).not.toHaveBeenCalled();
  });

  it('handles cache read throwing an error gracefully and falls back to fetch', async () => {
    mockExtractVideoId.mockReturnValue('err-read');
    mockRedis.get.mockRejectedValue(new Error('Redis read error'));
    mockFetchTranscript.mockResolvedValue({ videoId: 'err-read', transcript: 'raw', segments: [] } as any);
    mockCleanTranscript.mockReturnValue('raw');

    const result = await fetchCachedTranscript('https://youtube.com/watch?v=err-read');

    expect(result.cached).toBe(false);
    expect(result.transcript).toBe('raw');
  });

  it('handles cache write throwing an error gracefully', async () => {
    mockExtractVideoId.mockReturnValue('err-write');
    mockRedis.get.mockResolvedValue(null);
    mockFetchTranscript.mockResolvedValue({ videoId: 'err-write', transcript: 'text', segments: [] } as any);
    mockCleanTranscript.mockReturnValue('text');
    mockRedis.setEx.mockRejectedValue(new Error('Redis write error'));

    // Should not throw
    const result = await fetchCachedTranscript('https://youtube.com/watch?v=err-write');

    expect(result.cached).toBe(false);
    expect(result.transcript).toBe('text');
  });

  it('returns segments from YouTube when transcript is present', async () => {
    mockExtractVideoId.mockReturnValue('segs');
    mockRedis.get.mockResolvedValue(null);
    const segs = [{ text: 'seg1', offset: 0, duration: 1000 }, { text: 'seg2', offset: 1000, duration: 1000 }];
    mockFetchTranscript.mockResolvedValue({ videoId: 'segs', transcript: 'seg1 seg2', segments: segs } as any);
    mockCleanTranscript.mockReturnValue('seg1 seg2');

    const result = await fetchCachedTranscript('https://youtube.com/watch?v=segs');

    expect(result.segments).toHaveLength(2);
    expect(result.cached).toBe(false);
  });

  it('skips redis operations when redis not connected even with client present', async () => {
    (isRedisConnected as jest.Mock).mockReturnValue(false);
    mockExtractVideoId.mockReturnValue('disc');
    mockFetchTranscript.mockResolvedValue({ videoId: 'disc', transcript: 'ok', segments: [] } as any);
    mockCleanTranscript.mockReturnValue('ok');

    const result = await fetchCachedTranscript('https://youtube.com/watch?v=disc');

    expect(result.cached).toBe(false);
    expect(mockRedis.get).not.toHaveBeenCalled();
    expect(mockRedis.setEx).not.toHaveBeenCalled();
  });

  it('passes the correct cache key to redis.get and redis.setEx', async () => {
    mockExtractVideoId.mockReturnValue('keycheck');
    mockRedis.get.mockResolvedValue(null);
    mockFetchTranscript.mockResolvedValue({ videoId: 'keycheck', transcript: 'hello', segments: [] } as any);
    mockCleanTranscript.mockReturnValue('hello');

    await fetchCachedTranscript('https://youtube.com/watch?v=keycheck');

    expect(mockRedis.get).toHaveBeenCalledWith('transcript:keycheck');
    expect(mockRedis.setEx).toHaveBeenCalledWith('transcript:keycheck', expect.any(Number), expect.any(String));
  });

  // ---- invalidateTranscriptCache extra branch ----

  it('calls redis.del with the correct key on valid connection', async () => {
    mockRedis.del.mockResolvedValue(1);

    await invalidateTranscriptCache('myVideoId');

    expect(mockRedis.del).toHaveBeenCalledWith('transcript:myVideoId');
  });

  it('handles invalidateTranscriptCache when client is null and connected is true', async () => {
    (getRedisClient as jest.Mock).mockReturnValue(null);
    (isRedisConnected as jest.Mock).mockReturnValue(true);

    await invalidateTranscriptCache('null-client');

    expect(mockRedis.del).not.toHaveBeenCalled();
  });
});
