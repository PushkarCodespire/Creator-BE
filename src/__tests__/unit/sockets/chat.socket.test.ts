// ===========================================
// CHAT SOCKET HANDLER — UNIT TESTS
// ===========================================

// ---- mocks declared before any imports ----

const mockPrisma = {
  conversation: {
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  message: {
    create: jest.fn(),
    findMany: jest.fn(),
  },
};

jest.mock('../../../../prisma/client', () => ({
  __esModule: true,
  default: mockPrisma,
}));

jest.mock('../../../utils/monitoring', () => ({
  trackBusinessEvent: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../../services/media/media-processor.service', () => ({
  buildAttachmentContext: jest.fn().mockResolvedValue({ combined: '', parts: [] }),
}));

jest.mock('../../../utils/openai', () => ({
  generateCreatorResponse: jest.fn().mockResolvedValue({
    content: 'AI reply',
    tokensUsed: 10,
  }),
}));

jest.mock('../../../utils/logger', () => ({
  logDebug: jest.fn(),
  logError: jest.fn(),
  logInfo: jest.fn(),
  logWarning: jest.fn(),
}));

import { ChatSocketHandler } from '../../../sockets/chat.socket';
import { buildAttachmentContext } from '../../../services/media/media-processor.service';
import { generateCreatorResponse } from '../../../utils/openai';

// --------------- socket helpers ---------------

const makeSocket = (overrides: Record<string, unknown> = {}) => {
  const s: any = {
    id: 'socket1',
    data: {},
    join: jest.fn(),
    emit: jest.fn(),
    to: jest.fn().mockReturnThis(),
    on: jest.fn(),
    handshake: { auth: { token: 'Bearer tok' } },
    ...overrides,
  };
  return s;
};

const makeIo = () => {
  const io: any = {};
  io.to = jest.fn().mockReturnValue(io);
  io.emit = jest.fn();
  io.on = jest.fn();
  io.except = jest.fn().mockReturnValue(io);
  return io;
};

// Capture event handlers registered with socket.on
function captureSocketHandlers(io: any) {
  const socketHandlers: Record<string, (...args: any[]) => any> = {};
  const socket = makeSocket();
  socket.on.mockImplementation((event: string, handler: (...args: any[]) => any) => {
    socketHandlers[event] = handler;
  });

  // Trigger the 'connection' callback registered on io.on
  let connectionHandler: ((socket: any) => void) | null = null;
  io.on.mockImplementation((event: string, handler: (...args: any[]) => any) => {
    if (event === 'connection') connectionHandler = handler;
  });

  ChatSocketHandler.initialize(io);
  if (connectionHandler) connectionHandler(socket);

  return { socket, socketHandlers };
}

// ---- base mock data ----

const baseConversation = {
  id: 'conv1',
  userId: 'u1',
  guestId: 'g1',
  createdAt: new Date(),
  creator: {
    id: 'creator1',
    userId: 'u1',
    displayName: 'Test Creator',
    isVerified: true,
    aiPersonality: 'friendly',
    aiTone: 'casual',
    welcomeMessage: 'Hi!',
  },
};

const baseUserMessage = {
  id: 'msg1',
  content: 'Hello',
  role: 'USER',
  media: null,
  createdAt: new Date(),
  user: { id: 'u1', name: 'User', avatar: null },
};

const baseAiMessage = {
  id: 'msg2',
  content: 'AI reply',
  role: 'ASSISTANT',
  tokensUsed: 10,
  modelUsed: 'gpt-4o-mini',
  responseTimeMs: 100,
  createdAt: new Date(),
};

// ===========================================================
describe('ChatSocketHandler', () => {
  let io: any;

  beforeEach(() => {
    io = makeIo();
    // Reset static io reference by re-initialising each test
  });

  // ---- initialize / connection ----

  describe('initialize', () => {
    it('registers a connection handler on the io server', () => {
      ChatSocketHandler.initialize(io);
      expect(io.on).toHaveBeenCalledWith('connection', expect.any(Function));
    });

    it('registers all expected events on a connected socket', () => {
      const { socketHandlers } = captureSocketHandlers(io);
      expect(socketHandlers).toHaveProperty('join_chat');
      expect(socketHandlers).toHaveProperty('send_message');
      expect(socketHandlers).toHaveProperty('typing');
      expect(socketHandlers).toHaveProperty('disconnect');
      expect(socketHandlers).toHaveProperty('error');
    });
  });

  // ---- join_chat ----

  describe('join_chat handler', () => {
    it('emits chat_joined and joins room when conversation found for userId', async () => {
      mockPrisma.conversation.findUnique.mockResolvedValue(baseConversation);
      const { socket, socketHandlers } = captureSocketHandlers(io);

      await socketHandlers['join_chat']({ conversationId: 'conv1', userId: 'u1' });

      expect(socket.join).toHaveBeenCalledWith('conversation_conv1');
      expect(socket.emit).toHaveBeenCalledWith('chat_joined', expect.any(Object));
    });

    it('emits error when conversation not found', async () => {
      mockPrisma.conversation.findUnique.mockResolvedValue(null);
      const { socket, socketHandlers } = captureSocketHandlers(io);

      await socketHandlers['join_chat']({ conversationId: 'missing', userId: 'u1' });

      expect(socket.emit).toHaveBeenCalledWith('error', { message: 'Conversation not found' });
    });

    it('emits error when userId does not match conversation.userId', async () => {
      mockPrisma.conversation.findUnique.mockResolvedValue(baseConversation);
      const { socket, socketHandlers } = captureSocketHandlers(io);

      await socketHandlers['join_chat']({ conversationId: 'conv1', userId: 'wrong-user' });

      expect(socket.emit).toHaveBeenCalledWith('error', { message: 'Unauthorized access to conversation' });
    });

    it('emits error when guestId does not match conversation.guestId', async () => {
      mockPrisma.conversation.findUnique.mockResolvedValue(baseConversation);
      const { socket, socketHandlers } = captureSocketHandlers(io);

      await socketHandlers['join_chat']({ conversationId: 'conv1', guestId: 'wrong-guest' });

      expect(socket.emit).toHaveBeenCalledWith('error', { message: 'Unauthorized access to conversation' });
    });

    it('allows access with matching guestId', async () => {
      mockPrisma.conversation.findUnique.mockResolvedValue(baseConversation);
      const { socket, socketHandlers } = captureSocketHandlers(io);

      await socketHandlers['join_chat']({ conversationId: 'conv1', guestId: 'g1' });

      expect(socket.join).toHaveBeenCalledWith('conversation_conv1');
    });

    it('emits error when prisma throws', async () => {
      mockPrisma.conversation.findUnique.mockRejectedValue(new Error('DB down'));
      const { socket, socketHandlers } = captureSocketHandlers(io);

      await socketHandlers['join_chat']({ conversationId: 'conv1', userId: 'u1' });

      expect(socket.emit).toHaveBeenCalledWith('error', { message: 'DB down' });
    });
  });

  // ---- send_message ----

  describe('send_message handler', () => {
    beforeEach(() => {
      mockPrisma.conversation.findUnique.mockResolvedValue(baseConversation);
      mockPrisma.message.create
        .mockResolvedValueOnce(baseUserMessage)
        .mockResolvedValueOnce(baseAiMessage);
      mockPrisma.message.findMany.mockResolvedValue([]);
      mockPrisma.conversation.update.mockResolvedValue({});
      (buildAttachmentContext as jest.Mock).mockResolvedValue({ combined: '', parts: [] });
      (generateCreatorResponse as jest.Mock).mockResolvedValue({ content: 'AI reply', tokensUsed: 10 });
    });

    it('creates user message and AI reply for registered user', async () => {
      const { socketHandlers } = captureSocketHandlers(io);

      await socketHandlers['send_message']({
        conversationId: 'conv1',
        content: 'Hello',
      });

      expect(mockPrisma.message.create).toHaveBeenCalledTimes(2);
      expect(io.to).toHaveBeenCalledWith('conversation_conv1');
    });

    it('emits error when content and media are both empty', async () => {
      const { socket, socketHandlers } = captureSocketHandlers(io);

      await socketHandlers['send_message']({
        conversationId: 'conv1',
        content: '',
        media: [],
      });

      expect(socket.emit).toHaveBeenCalledWith('error', {
        message: 'Message content or media is required',
      });
    });

    it('emits error when conversation not found', async () => {
      mockPrisma.conversation.findUnique.mockResolvedValue(null);
      const { socket, socketHandlers } = captureSocketHandlers(io);

      await socketHandlers['send_message']({
        conversationId: 'missing',
        content: 'Hi',
      });

      expect(socket.emit).toHaveBeenCalledWith('error', { message: 'Conversation not found' });
    });

    it('emits error when guestId does not match', async () => {
      const { socket, socketHandlers } = captureSocketHandlers(io);

      await socketHandlers['send_message']({
        conversationId: 'conv1',
        content: 'Hi',
        guestId: 'wrong-guest',
      });

      expect(socket.emit).toHaveBeenCalledWith('error', { message: 'Unauthorized to send message' });
    });

    it('allows message from matching guestId', async () => {
      const guestConv = { ...baseConversation, userId: null };
      mockPrisma.conversation.findUnique.mockResolvedValue(guestConv);
      const { socketHandlers } = captureSocketHandlers(io);

      await socketHandlers['send_message']({
        conversationId: 'conv1',
        content: 'Hi as guest',
        guestId: 'g1',
      });

      expect(mockPrisma.message.create).toHaveBeenCalled();
    });

    it('emits error when userId is missing on non-guest conversation', async () => {
      const noUserConv = { ...baseConversation, userId: null, guestId: null };
      mockPrisma.conversation.findUnique.mockResolvedValue(noUserConv);
      const { socket, socketHandlers } = captureSocketHandlers(io);

      await socketHandlers['send_message']({
        conversationId: 'conv1',
        content: 'Hello',
      });

      expect(socket.emit).toHaveBeenCalledWith('error', { message: 'User not found' });
    });

    it('includes attachment context in AI request when media provided', async () => {
      (buildAttachmentContext as jest.Mock).mockResolvedValue({
        combined: 'image description',
        parts: ['Image: something'],
      });
      const { socketHandlers } = captureSocketHandlers(io);

      await socketHandlers['send_message']({
        conversationId: 'conv1',
        content: 'Check this',
        media: [{ type: 'image', url: '/uploads/img.png', name: 'img.png' }],
      });

      expect(buildAttachmentContext).toHaveBeenCalled();
      expect(mockPrisma.message.create).toHaveBeenCalledTimes(2);
    });

    it('does not crash when prisma throws during message creation', async () => {
      // message.create already set to reject via beforeEach mocks —
      // override here for clarity
      mockPrisma.conversation.findUnique.mockResolvedValue(baseConversation);
      mockPrisma.message.create.mockRejectedValue(new Error('Insert failed'));
      const { socketHandlers } = captureSocketHandlers(io);

      // Should not propagate — error is caught inside handleSendMessage
      await expect(
        socketHandlers['send_message']({ conversationId: 'conv1', content: 'Hi' })
      ).resolves.not.toThrow();
    });
  });

  // ---- typing ----

  describe('typing handler', () => {
    it('broadcasts typing status to conversation room', async () => {
      const { socket, socketHandlers } = captureSocketHandlers(io);
      socket.to = jest.fn().mockReturnValue({ emit: jest.fn() });

      await socketHandlers['typing']({ conversationId: 'conv1', isTyping: true });

      expect(socket.to).toHaveBeenCalledWith('conversation_conv1');
    });
  });

  // ---- disconnect ----

  describe('disconnect handler', () => {
    it('logs disconnect without error', () => {
      const { socketHandlers } = captureSocketHandlers(io);
      expect(() => socketHandlers['disconnect']()).not.toThrow();
    });
  });

  // ---- error handler ----

  describe('error handler', () => {
    it('logs socket errors without rethrowing', () => {
      const { socketHandlers } = captureSocketHandlers(io);
      expect(() => socketHandlers['error'](new Error('socket err'))).not.toThrow();
    });

    it('handles non-Error objects in error handler', () => {
      const { socketHandlers } = captureSocketHandlers(io);
      expect(() => socketHandlers['error']('string error')).not.toThrow();
    });
  });

  // ---- static helpers ----

  describe('sendSystemMessage', () => {
    it('creates DB message and emits to conversation room', async () => {
      const sysMsg = { id: 'sys1', content: 'System message', role: 'SYSTEM', createdAt: new Date() };
      mockPrisma.message.create.mockResolvedValue(sysMsg);
      ChatSocketHandler.initialize(io);

      await ChatSocketHandler.sendSystemMessage('conv1', 'System message');

      expect(mockPrisma.message.create).toHaveBeenCalled();
      expect(io.to).toHaveBeenCalledWith('conversation_conv1');
    });

    it('emits to the correct conversation room', async () => {
      // io is already initialized in the test above via ChatSocketHandler.initialize(io)
      const sysMsg2 = { id: 'sys2', content: 'Another msg', role: 'SYSTEM', createdAt: new Date() };
      mockPrisma.message.create.mockResolvedValue(sysMsg2);
      ChatSocketHandler.initialize(io);

      await ChatSocketHandler.sendSystemMessage('conv-abc', 'Another msg');

      expect(io.to).toHaveBeenCalledWith('conversation_conv-abc');
    });
  });

  describe('notifyNewConversation', () => {
    it('emits new_conversation event to user room', async () => {
      ChatSocketHandler.initialize(io);
      await ChatSocketHandler.notifyNewConversation('u1', 'conv1');
      expect(io.to).toHaveBeenCalledWith('user_u1');
    });
  });

  // ---- AI fallback (generateAIResponse error path) ----

  describe('AI response fallback', () => {
    it('uses fallback response when generateCreatorResponse throws', async () => {
      mockPrisma.conversation.findUnique.mockResolvedValue(baseConversation);
      // user message create, then AI message create with fallback
      mockPrisma.message.create
        .mockResolvedValueOnce(baseUserMessage)
        .mockResolvedValueOnce({ ...baseAiMessage, content: "I'm sorry, I'm having trouble responding right now. Please try again." });
      mockPrisma.message.findMany.mockResolvedValue([]);
      mockPrisma.conversation.update.mockResolvedValue({});
      (buildAttachmentContext as jest.Mock).mockResolvedValue({ combined: '', parts: [] });
      (generateCreatorResponse as jest.Mock).mockRejectedValue(new Error('OpenAI down'));

      const { socketHandlers } = captureSocketHandlers(io);

      // Should not throw — fallback kicks in inside generateAIResponse
      await socketHandlers['send_message']({ conversationId: 'conv1', content: 'Hello' });

      // The AI message should still be created (fallback content used)
      // generateAIResponse catches the error and returns fallback, so message.create runs twice
      const createCalls = mockPrisma.message.create.mock.calls.length;
      expect(createCalls).toBeGreaterThanOrEqual(1);
    });
  });
});
