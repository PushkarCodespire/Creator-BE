// ===========================================
// CONTEXT BUILDER SERVICE — UNIT TESTS
// ===========================================

jest.mock('../../../../prisma/client', () => ({
  __esModule: true,
  default: {
    creator: { findUnique: jest.fn() },
    message: { findMany: jest.fn() },
  },
}));

jest.mock('../../../services/ai/knowledge-retrieval.service', () => ({
  retrieveRelevantKnowledge: jest.fn(),
}));

jest.mock('../../../utils/logger', () => ({
  logInfo: jest.fn(),
  logError: jest.fn(),
}));

import prisma from '../../../../prisma/client';
import * as knowledgeRetrieval from '../../../services/ai/knowledge-retrieval.service';
import { buildContext } from '../../../services/ai/context-builder.service';

const mockPrisma = prisma as jest.Mocked<typeof prisma>;
const mockKnowledge = knowledgeRetrieval as jest.Mocked<typeof knowledgeRetrieval>;

describe('ContextBuilderService', () => {
  const messageId = 'msg-1';
  const conversationId = 'conv-1';
  const creatorId = 'creator-1';
  const userMessage = 'Tell me about your content';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('buildContext', () => {
    it('should build full context with creator profile, history, and knowledge', async () => {
      (mockPrisma.creator.findUnique as jest.Mock).mockResolvedValue({
        displayName: 'TestCreator',
        bio: 'A test creator',
        aiPersonality: 'Friendly',
        aiTone: 'Casual',
        welcomeMessage: 'Hello!',
        responseStyle: 'conversational',
      });

      // findMany returns desc order; buildContext reverses to chronological
      (mockPrisma.message.findMany as jest.Mock).mockResolvedValue([
        { role: 'ASSISTANT', content: 'Hello!' },
        { role: 'USER', content: 'Hi' },
      ]);

      mockKnowledge.retrieveRelevantKnowledge.mockResolvedValue([
        'Chunk about topic A',
        'Chunk about topic B',
      ]);

      const result = await buildContext(messageId, conversationId, creatorId, userMessage);

      expect(result.systemPrompt).toContain('TestCreator');
      expect(result.systemPrompt).toContain('A test creator');
      expect(result.systemPrompt).toContain('Friendly');
      expect(result.systemPrompt).toContain('Casual');
      expect(result.systemPrompt).toContain('Chunk about topic A');
      expect(result.conversationHistory).toEqual([
        { role: 'user', content: 'Hi' },
        { role: 'assistant', content: 'Hello!' },
      ]);
      expect(result.retrievedKnowledge).toHaveLength(2);
    });

    it('should throw error when creator not found', async () => {
      (mockPrisma.creator.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(
        buildContext(messageId, conversationId, creatorId, userMessage)
      ).rejects.toThrow('Creator not found');
    });

    it('should handle empty knowledge retrieval', async () => {
      (mockPrisma.creator.findUnique as jest.Mock).mockResolvedValue({
        displayName: 'TestCreator',
        bio: null,
        aiPersonality: null,
        aiTone: null,
        welcomeMessage: null,
        responseStyle: null,
      });

      (mockPrisma.message.findMany as jest.Mock).mockResolvedValue([]);
      mockKnowledge.retrieveRelevantKnowledge.mockResolvedValue([]);

      const result = await buildContext(messageId, conversationId, creatorId, userMessage);

      expect(result.systemPrompt).toContain('TestCreator');
      expect(result.systemPrompt).not.toContain('Relevant knowledge');
      expect(result.conversationHistory).toEqual([]);
      expect(result.retrievedKnowledge).toEqual([]);
    });

    it('should reverse message history to chronological order', async () => {
      (mockPrisma.creator.findUnique as jest.Mock).mockResolvedValue({
        displayName: 'TestCreator',
        bio: null,
        aiPersonality: null,
        aiTone: null,
        welcomeMessage: null,
        responseStyle: null,
      });

      // findMany returns desc order, buildContext reverses
      (mockPrisma.message.findMany as jest.Mock).mockResolvedValue([
        { role: 'ASSISTANT', content: 'Response 2' },
        { role: 'USER', content: 'Message 2' },
        { role: 'ASSISTANT', content: 'Response 1' },
        { role: 'USER', content: 'Message 1' },
      ]);

      mockKnowledge.retrieveRelevantKnowledge.mockResolvedValue([]);

      const result = await buildContext(messageId, conversationId, creatorId, userMessage);

      expect(result.conversationHistory[0].content).toBe('Message 1');
      expect(result.conversationHistory[3].content).toBe('Response 2');
    });

    it('should include bio and personality in system prompt when available', async () => {
      (mockPrisma.creator.findUnique as jest.Mock).mockResolvedValue({
        displayName: 'Creator',
        bio: 'My bio text',
        aiPersonality: 'Witty and fun',
        aiTone: 'Professional',
        welcomeMessage: null,
        responseStyle: null,
      });

      (mockPrisma.message.findMany as jest.Mock).mockResolvedValue([]);
      mockKnowledge.retrieveRelevantKnowledge.mockResolvedValue([]);

      const result = await buildContext(messageId, conversationId, creatorId, userMessage);

      expect(result.systemPrompt).toContain('About: My bio text');
      expect(result.systemPrompt).toContain('Personality: Witty and fun');
      expect(result.systemPrompt).toContain('Tone: Professional');
    });

    // ─── NEW TESTS ──────────────────────────────────────────────────

    it('should omit About line when bio is null', async () => {
      (mockPrisma.creator.findUnique as jest.Mock).mockResolvedValue({
        displayName: 'NoBio',
        bio: null,
        aiPersonality: 'Friendly',
        aiTone: null,
        welcomeMessage: null,
        responseStyle: null,
      });
      (mockPrisma.message.findMany as jest.Mock).mockResolvedValue([]);
      mockKnowledge.retrieveRelevantKnowledge.mockResolvedValue([]);

      const result = await buildContext(messageId, conversationId, creatorId, userMessage);

      expect(result.systemPrompt).not.toContain('About:');
      expect(result.systemPrompt).toContain('Personality: Friendly');
    });

    it('should omit Personality line when aiPersonality is null', async () => {
      (mockPrisma.creator.findUnique as jest.Mock).mockResolvedValue({
        displayName: 'Creator',
        bio: 'Some bio',
        aiPersonality: null,
        aiTone: 'Warm',
        welcomeMessage: null,
        responseStyle: null,
      });
      (mockPrisma.message.findMany as jest.Mock).mockResolvedValue([]);
      mockKnowledge.retrieveRelevantKnowledge.mockResolvedValue([]);

      const result = await buildContext(messageId, conversationId, creatorId, userMessage);

      expect(result.systemPrompt).not.toContain('Personality:');
      expect(result.systemPrompt).toContain('Tone: Warm');
    });

    it('should omit Tone line when aiTone is null', async () => {
      (mockPrisma.creator.findUnique as jest.Mock).mockResolvedValue({
        displayName: 'Creator',
        bio: 'bio',
        aiPersonality: 'Fun',
        aiTone: null,
        welcomeMessage: null,
        responseStyle: null,
      });
      (mockPrisma.message.findMany as jest.Mock).mockResolvedValue([]);
      mockKnowledge.retrieveRelevantKnowledge.mockResolvedValue([]);

      const result = await buildContext(messageId, conversationId, creatorId, userMessage);

      expect(result.systemPrompt).not.toContain('Tone:');
    });

    it('should include knowledge section with numbered chunks when knowledge is non-empty', async () => {
      (mockPrisma.creator.findUnique as jest.Mock).mockResolvedValue({
        displayName: 'KCreator',
        bio: null,
        aiPersonality: null,
        aiTone: null,
        welcomeMessage: null,
        responseStyle: null,
      });
      (mockPrisma.message.findMany as jest.Mock).mockResolvedValue([]);
      mockKnowledge.retrieveRelevantKnowledge.mockResolvedValue(['Alpha chunk', 'Beta chunk', 'Gamma chunk']);

      const result = await buildContext(messageId, conversationId, creatorId, userMessage);

      expect(result.systemPrompt).toContain('Relevant knowledge');
      expect(result.systemPrompt).toContain('(1) Alpha chunk');
      expect(result.systemPrompt).toContain('(2) Beta chunk');
      expect(result.systemPrompt).toContain('(3) Gamma chunk');
      expect(result.retrievedKnowledge).toHaveLength(3);
    });

    it('should call knowledgeRetrieval with correct arguments', async () => {
      (mockPrisma.creator.findUnique as jest.Mock).mockResolvedValue({
        displayName: 'Creator',
        bio: null,
        aiPersonality: null,
        aiTone: null,
        welcomeMessage: null,
        responseStyle: null,
      });
      (mockPrisma.message.findMany as jest.Mock).mockResolvedValue([]);
      mockKnowledge.retrieveRelevantKnowledge.mockResolvedValue([]);

      await buildContext(messageId, conversationId, creatorId, userMessage);

      expect(mockKnowledge.retrieveRelevantKnowledge).toHaveBeenCalledWith(creatorId, userMessage, 3);
    });

    it('should query prisma.message with correct where clause (exclude FAILED)', async () => {
      (mockPrisma.creator.findUnique as jest.Mock).mockResolvedValue({
        displayName: 'Creator',
        bio: null,
        aiPersonality: null,
        aiTone: null,
        welcomeMessage: null,
        responseStyle: null,
      });
      (mockPrisma.message.findMany as jest.Mock).mockResolvedValue([]);
      mockKnowledge.retrieveRelevantKnowledge.mockResolvedValue([]);

      await buildContext(messageId, conversationId, creatorId, userMessage);

      expect(mockPrisma.message.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            conversationId,
            processingStatus: { not: 'FAILED' },
          }),
          take: 10,
        })
      );
    });

    it('should lowercase roles in conversation history', async () => {
      (mockPrisma.creator.findUnique as jest.Mock).mockResolvedValue({
        displayName: 'Creator',
        bio: null,
        aiPersonality: null,
        aiTone: null,
        welcomeMessage: null,
        responseStyle: null,
      });
      (mockPrisma.message.findMany as jest.Mock).mockResolvedValue([
        { role: 'SYSTEM', content: 'system msg' },
      ]);
      mockKnowledge.retrieveRelevantKnowledge.mockResolvedValue([]);

      const result = await buildContext(messageId, conversationId, creatorId, userMessage);

      expect(result.conversationHistory[0].role).toBe('system');
    });

    it('should always contain creator displayName in system prompt', async () => {
      (mockPrisma.creator.findUnique as jest.Mock).mockResolvedValue({
        displayName: 'UniqueCreatorName',
        bio: null,
        aiPersonality: null,
        aiTone: null,
        welcomeMessage: null,
        responseStyle: null,
      });
      (mockPrisma.message.findMany as jest.Mock).mockResolvedValue([]);
      mockKnowledge.retrieveRelevantKnowledge.mockResolvedValue([]);

      const result = await buildContext(messageId, conversationId, creatorId, userMessage);

      expect(result.systemPrompt).toContain('UniqueCreatorName');
    });

    it('should return correct shape for ConversationContext', async () => {
      (mockPrisma.creator.findUnique as jest.Mock).mockResolvedValue({
        displayName: 'Creator',
        bio: 'bio',
        aiPersonality: 'p',
        aiTone: 't',
        welcomeMessage: 'hi',
        responseStyle: 'casual',
      });
      (mockPrisma.message.findMany as jest.Mock).mockResolvedValue([
        { role: 'USER', content: 'hello' },
      ]);
      mockKnowledge.retrieveRelevantKnowledge.mockResolvedValue(['chunk1']);

      const result = await buildContext(messageId, conversationId, creatorId, userMessage);

      expect(result).toHaveProperty('systemPrompt');
      expect(result).toHaveProperty('conversationHistory');
      expect(result).toHaveProperty('retrievedKnowledge');
      expect(typeof result.systemPrompt).toBe('string');
      expect(Array.isArray(result.conversationHistory)).toBe(true);
      expect(Array.isArray(result.retrievedKnowledge)).toBe(true);
    });

    it('should handle single knowledge chunk correctly (no extra newlines)', async () => {
      (mockPrisma.creator.findUnique as jest.Mock).mockResolvedValue({
        displayName: 'Creator',
        bio: null,
        aiPersonality: null,
        aiTone: null,
        welcomeMessage: null,
        responseStyle: null,
      });
      (mockPrisma.message.findMany as jest.Mock).mockResolvedValue([]);
      mockKnowledge.retrieveRelevantKnowledge.mockResolvedValue(['Only chunk']);

      const result = await buildContext(messageId, conversationId, creatorId, userMessage);

      expect(result.systemPrompt).toContain('(1) Only chunk');
      expect(result.retrievedKnowledge).toEqual(['Only chunk']);
    });

    it('should query creator with correct creatorId', async () => {
      (mockPrisma.creator.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(buildContext(messageId, conversationId, 'specific-creator-id', userMessage))
        .rejects.toThrow('Creator not found');

      expect(mockPrisma.creator.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'specific-creator-id' } })
      );
    });

    it('should handle exactly 10 messages (boundary)', async () => {
      (mockPrisma.creator.findUnique as jest.Mock).mockResolvedValue({
        displayName: 'Creator',
        bio: null,
        aiPersonality: null,
        aiTone: null,
        welcomeMessage: null,
        responseStyle: null,
      });

      const tenMessages = Array.from({ length: 10 }, (_, i) => ({
        role: 'USER',
        content: `Message ${i + 1}`,
      }));
      (mockPrisma.message.findMany as jest.Mock).mockResolvedValue([...tenMessages].reverse());
      mockKnowledge.retrieveRelevantKnowledge.mockResolvedValue([]);

      const result = await buildContext(messageId, conversationId, creatorId, userMessage);

      expect(result.conversationHistory).toHaveLength(10);
      expect(result.conversationHistory[0].content).toBe('Message 1');
    });

    it('should not include knowledge section when knowledge retrieval returns empty array', async () => {
      (mockPrisma.creator.findUnique as jest.Mock).mockResolvedValue({
        displayName: 'Creator',
        bio: 'bio',
        aiPersonality: 'p',
        aiTone: 't',
        welcomeMessage: null,
        responseStyle: null,
      });
      (mockPrisma.message.findMany as jest.Mock).mockResolvedValue([]);
      mockKnowledge.retrieveRelevantKnowledge.mockResolvedValue([]);

      const result = await buildContext(messageId, conversationId, creatorId, userMessage);

      expect(result.systemPrompt).not.toContain('Relevant knowledge');
      expect(result.systemPrompt).not.toContain('(1)');
    });

    it('should throw when prisma.creator.findUnique rejects', async () => {
      (mockPrisma.creator.findUnique as jest.Mock).mockRejectedValue(new Error('DB error'));

      await expect(buildContext(messageId, conversationId, creatorId, userMessage))
        .rejects.toThrow('DB error');
    });

    it('should throw when prisma.message.findMany rejects', async () => {
      (mockPrisma.creator.findUnique as jest.Mock).mockResolvedValue({
        displayName: 'Creator',
        bio: null,
        aiPersonality: null,
        aiTone: null,
        welcomeMessage: null,
        responseStyle: null,
      });
      (mockPrisma.message.findMany as jest.Mock).mockRejectedValue(new Error('Message DB error'));

      await expect(buildContext(messageId, conversationId, creatorId, userMessage))
        .rejects.toThrow('Message DB error');
    });

    it('should propagate error when knowledge retrieval throws', async () => {
      (mockPrisma.creator.findUnique as jest.Mock).mockResolvedValue({
        displayName: 'Creator',
        bio: null,
        aiPersonality: null,
        aiTone: null,
        welcomeMessage: null,
        responseStyle: null,
      });
      (mockPrisma.message.findMany as jest.Mock).mockResolvedValue([]);
      mockKnowledge.retrieveRelevantKnowledge.mockRejectedValue(new Error('RAG error'));

      await expect(buildContext(messageId, conversationId, creatorId, userMessage))
        .rejects.toThrow('RAG error');
    });

    it('should build prompt with all fields populated', async () => {
      (mockPrisma.creator.findUnique as jest.Mock).mockResolvedValue({
        displayName: 'FullCreator',
        bio: 'Complete bio',
        aiPersonality: 'Energetic',
        aiTone: 'Upbeat',
        welcomeMessage: 'Welcome!',
        responseStyle: 'brief',
      });
      (mockPrisma.message.findMany as jest.Mock).mockResolvedValue([]);
      mockKnowledge.retrieveRelevantKnowledge.mockResolvedValue(['fact one']);

      const result = await buildContext(messageId, conversationId, creatorId, userMessage);

      expect(result.systemPrompt).toContain('FullCreator');
      expect(result.systemPrompt).toContain('Complete bio');
      expect(result.systemPrompt).toContain('Energetic');
      expect(result.systemPrompt).toContain('Upbeat');
      expect(result.systemPrompt).toContain('fact one');
    });
  });
});
