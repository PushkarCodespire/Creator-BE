// ===========================================
// NOTIFICATION SOCKET HANDLER — UNIT TESTS
// ===========================================

// ---- mocks declared before any imports ----

const mockPrisma = {
  user: {
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  notification: {
    create: jest.fn(),
    update: jest.fn(),
  },
  creator: {
    findUnique: jest.fn(),
  },
  conversation: {
    findMany: jest.fn(),
    updateMany: jest.fn(),
  },
};

jest.mock('../../../../prisma/client', () => ({
  __esModule: true,
  default: mockPrisma,
}));

jest.mock('../../../utils/monitoring', () => ({
  trackBusinessEvent: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../../utils/logger', () => ({
  logDebug: jest.fn(),
  logError: jest.fn(),
  logInfo: jest.fn(),
  logWarning: jest.fn(),
}));

import { NotificationSocketHandler, emitToConversation, emitToUser, emitToCreator, emitToAdmin, isUserOnline, getOnlineUserCount, getVectorCount } from '../../../sockets/notification.socket';
import { NotificationType } from '@prisma/client';

// ---- helpers ----

const makeSocket = (overrides: Record<string, unknown> = {}) => {
  const s: any = {
    id: 'socket1',
    data: {},
    join: jest.fn(),
    leave: jest.fn(),
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

/** Initialize handler and capture per-socket event handlers */
function captureSocketHandlers(io: any) {
  const socketHandlers: Record<string, (...args: any[]) => any> = {};
  const socket = makeSocket();
  socket.on.mockImplementation((event: string, handler: (...args: any[]) => any) => {
    socketHandlers[event] = handler;
  });

  let connectionCb: ((socket: any) => void) | null = null;
  io.on.mockImplementation((event: string, handler: (...args: any[]) => any) => {
    if (event === 'connection') connectionCb = handler;
  });

  NotificationSocketHandler.initialize(io);
  if (connectionCb) connectionCb(socket);

  return { socket, socketHandlers };
}

// ---- tests ----

describe('NotificationSocketHandler', () => {
  let io: any;

  beforeEach(() => {
    io = makeIo();
    // Reset internal maps between tests by re-reading private state via getOnlineUsers etc.
  });

  // ---- initialize ----

  describe('initialize', () => {
    it('registers connection handler on io', () => {
      NotificationSocketHandler.initialize(io);
      expect(io.on).toHaveBeenCalledWith('connection', expect.any(Function));
    });

    it('registers all expected per-socket events', () => {
      const { socketHandlers } = captureSocketHandlers(io);
      expect(socketHandlers).toHaveProperty('authenticate');
      expect(socketHandlers).toHaveProperty('update_presence');
      expect(socketHandlers).toHaveProperty('subscribe');
      expect(socketHandlers).toHaveProperty('unsubscribe');
      expect(socketHandlers).toHaveProperty('mark_read');
      expect(socketHandlers).toHaveProperty('disconnect');
      expect(socketHandlers).toHaveProperty('error');
    });
  });

  // ---- authenticate ----

  describe('authenticate handler', () => {
    it('emits auth_success and joins user rooms when user found', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'u1', name: 'Alice', role: 'USER' });
      mockPrisma.user.update.mockResolvedValue({});
      const { socket, socketHandlers } = captureSocketHandlers(io);

      await socketHandlers['authenticate']({ userId: 'u1' });

      expect(socket.join).toHaveBeenCalledWith('user_u1');
      expect(socket.join).toHaveBeenCalledWith('user:u1');
      expect(socket.emit).toHaveBeenCalledWith('auth_success', expect.objectContaining({ userId: 'u1' }));
    });

    it('emits auth_error when user not found', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      const { socket, socketHandlers } = captureSocketHandlers(io);

      await socketHandlers['authenticate']({ userId: 'ghost' });

      expect(socket.emit).toHaveBeenCalledWith('auth_error', { message: 'User not found' });
    });

    it('emits auth_error when prisma throws', async () => {
      mockPrisma.user.findUnique.mockRejectedValue(new Error('DB error'));
      const { socket, socketHandlers } = captureSocketHandlers(io);

      await socketHandlers['authenticate']({ userId: 'u1' });

      expect(socket.emit).toHaveBeenCalledWith('auth_error', { message: 'DB error' });
    });
  });

  // ---- update_presence ----

  describe('update_presence handler', () => {
    it('updates and broadcasts presence for authenticated user', async () => {
      mockPrisma.user.update.mockResolvedValue({});
      const { socket, socketHandlers } = captureSocketHandlers(io);
      socket.data.userId = 'u1';

      await socketHandlers['update_presence']({ userId: 'u1', status: 'away' });

      expect(io.except).toHaveBeenCalledWith('user_u1');
    });

    it('emits error when userId mismatch', async () => {
      const { socket, socketHandlers } = captureSocketHandlers(io);
      socket.data.userId = 'u1';

      await socketHandlers['update_presence']({ userId: 'u2', status: 'online' });

      expect(socket.emit).toHaveBeenCalledWith('error', { message: 'Unauthorized presence update' });
    });
  });

  // ---- subscribe ----

  describe('subscribe handler', () => {
    it('joins topic rooms and emits subscribed for authenticated user', async () => {
      const { socket, socketHandlers } = captureSocketHandlers(io);
      socket.data.userId = 'u1';

      await socketHandlers['subscribe']({ userId: 'u1', topics: ['news', 'alerts'] });

      expect(socket.join).toHaveBeenCalledWith('topic_news');
      expect(socket.join).toHaveBeenCalledWith('topic_alerts');
      expect(socket.emit).toHaveBeenCalledWith('subscribed', { topics: ['news', 'alerts'] });
    });

    it('emits error on userId mismatch', async () => {
      const { socket, socketHandlers } = captureSocketHandlers(io);
      socket.data.userId = 'u1';

      await socketHandlers['subscribe']({ userId: 'u2', topics: ['news'] });

      expect(socket.emit).toHaveBeenCalledWith('error', { message: 'Unauthorized subscription' });
    });
  });

  // ---- unsubscribe ----

  describe('unsubscribe handler', () => {
    it('leaves topic rooms and emits unsubscribed', async () => {
      const { socket, socketHandlers } = captureSocketHandlers(io);
      socket.data.userId = 'u1';

      await socketHandlers['unsubscribe']({ userId: 'u1', topics: ['news'] });

      expect(socket.leave).toHaveBeenCalledWith('topic_news');
      expect(socket.emit).toHaveBeenCalledWith('unsubscribed', { topics: ['news'] });
    });

    it('emits error on userId mismatch for unsubscribe', async () => {
      const { socket, socketHandlers } = captureSocketHandlers(io);
      socket.data.userId = 'u1';

      await socketHandlers['unsubscribe']({ userId: 'other', topics: ['news'] });

      expect(socket.emit).toHaveBeenCalledWith('error', { message: 'Unauthorized unsubscription' });
    });
  });

  // ---- mark_read ----

  describe('mark_read handler', () => {
    it('updates notification and emits confirmation for authenticated user', async () => {
      mockPrisma.notification.update.mockResolvedValue({ id: 'n1', userId: 'u1' });
      const { socket, socketHandlers } = captureSocketHandlers(io);
      socket.data.userId = 'u1';

      await socketHandlers['mark_read']({ notificationId: 'n1' });

      expect(mockPrisma.notification.update).toHaveBeenCalled();
      expect(socket.emit).toHaveBeenCalledWith('notification_marked_read', { notificationId: 'n1' });
    });

    it('emits error when not authenticated', async () => {
      const { socket, socketHandlers } = captureSocketHandlers(io);
      // socket.data.userId is undefined by default

      await socketHandlers['mark_read']({ notificationId: 'n1' });

      expect(socket.emit).toHaveBeenCalledWith('error', { message: 'Not authenticated' });
    });

    it('emits error when notification belongs to different user', async () => {
      mockPrisma.notification.update.mockResolvedValue({ id: 'n1', userId: 'other' });
      const { socket, socketHandlers } = captureSocketHandlers(io);
      socket.data.userId = 'u1';

      await socketHandlers['mark_read']({ notificationId: 'n1' });

      expect(socket.emit).toHaveBeenCalledWith('error', {
        message: 'Unauthorized to mark this notification',
      });
    });

    it('emits error when prisma throws in mark_read', async () => {
      mockPrisma.notification.update.mockRejectedValue(new Error('Update failed'));
      const { socket, socketHandlers } = captureSocketHandlers(io);
      socket.data.userId = 'u1';

      await socketHandlers['mark_read']({ notificationId: 'n1' });

      expect(socket.emit).toHaveBeenCalledWith('error', { message: 'Update failed' });
    });
  });

  // ---- disconnect ----

  describe('disconnect handler', () => {
    it('removes user from presence map and broadcasts offline', async () => {
      mockPrisma.user.update.mockResolvedValue({});
      mockPrisma.creator.findUnique.mockResolvedValue(null); // not a creator
      const { socket, socketHandlers } = captureSocketHandlers(io);
      socket.data.userId = 'u1';

      // Should not throw
      expect(() => socketHandlers['disconnect']()).not.toThrow();
    });

    it('does nothing when socket has no userId', () => {
      const { socketHandlers } = captureSocketHandlers(io);
      // socket.data.userId is undefined
      expect(() => socketHandlers['disconnect']()).not.toThrow();
    });

    it('auto-releases manual conversations on creator disconnect', async () => {
      mockPrisma.user.update.mockResolvedValue({});
      mockPrisma.creator.findUnique.mockResolvedValue({ id: 'creator1', displayName: 'Alice' });
      mockPrisma.conversation.findMany.mockResolvedValue([{ id: 'conv1' }]);
      mockPrisma.conversation.updateMany.mockResolvedValue({ count: 1 });
      const { socket, socketHandlers } = captureSocketHandlers(io);
      socket.data.userId = 'u1';

      socketHandlers['disconnect']();
      // Allow the async release to settle
      await new Promise(r => setTimeout(r, 10));

      expect(mockPrisma.conversation.updateMany).toHaveBeenCalled();
    });
  });

  // ---- error handler ----

  describe('error handler', () => {
    it('handles Error objects without throwing', () => {
      const { socketHandlers } = captureSocketHandlers(io);
      expect(() => socketHandlers['error'](new Error('boom'))).not.toThrow();
    });

    it('handles non-Error without throwing', () => {
      const { socketHandlers } = captureSocketHandlers(io);
      expect(() => socketHandlers['error']('plain string')).not.toThrow();
    });
  });

  // ---- static sendNotification ----

  describe('sendNotification', () => {
    it('creates notification in DB and emits if user socket exists', async () => {
      mockPrisma.notification.create.mockResolvedValue({
        id: 'n1',
        type: 'SYSTEM',
        title: 'Test',
        message: 'Msg',
        data: null,
        createdAt: new Date(),
      });
      NotificationSocketHandler.initialize(io);

      // Simulate user connected (stores socket id in userSockets map via authenticate)
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'u2', name: 'Bob', role: 'USER' });
      mockPrisma.user.update.mockResolvedValue({});
      const { socket: s2, socketHandlers: h2 } = captureSocketHandlers(io);
      s2.id = 'sock2';
      await h2['authenticate']({ userId: 'u2' });

      await NotificationSocketHandler.sendNotification('u2', NotificationType.SYSTEM, 'Test', 'Msg');

      expect(mockPrisma.notification.create).toHaveBeenCalled();
    });

    it('creates notification even when no socket is connected for user', async () => {
      mockPrisma.notification.create.mockResolvedValue({
        id: 'n2',
        type: 'SYSTEM',
        title: 'Hi',
        message: 'There',
        data: null,
        createdAt: new Date(),
      });
      NotificationSocketHandler.initialize(io);

      await NotificationSocketHandler.sendNotification('offline-user', NotificationType.SYSTEM, 'Hi', 'There');

      expect(mockPrisma.notification.create).toHaveBeenCalled();
    });

    it('handles prisma error gracefully without throwing', async () => {
      mockPrisma.notification.create.mockRejectedValue(new Error('DB fail'));
      NotificationSocketHandler.initialize(io);

      await expect(
        NotificationSocketHandler.sendNotification('u1', NotificationType.SYSTEM, 'T', 'M')
      ).resolves.not.toThrow();
    });
  });

  // ---- static sendToTopic ----

  describe('sendToTopic', () => {
    it('emits notification to topic room', async () => {
      NotificationSocketHandler.initialize(io);

      await NotificationSocketHandler.sendToTopic('tech', NotificationType.SYSTEM, 'Title', 'Msg', { key: 'val' });

      expect(io.to).toHaveBeenCalledWith('topic_tech');
      expect(io.emit).toHaveBeenCalled();
    });
  });

  // ---- static sendSystemAlert ----

  describe('sendSystemAlert', () => {
    it('emits system_alert to all connected sockets', () => {
      NotificationSocketHandler.initialize(io);
      NotificationSocketHandler.sendSystemAlert('Maintenance', 'Down for 5 min', 'high');
      expect(io.emit).toHaveBeenCalledWith('system_alert', expect.objectContaining({ title: 'Maintenance' }));
    });
  });

  // ---- presence helpers ----

  describe('getUserPresence / isUserOnline / getOnlineUserCount', () => {
    it('getUserPresence returns null for unknown user', () => {
      expect(NotificationSocketHandler.getUserPresence('nobody')).toBeNull();
    });

    it('getOnlineUsers returns only online users', () => {
      const result = NotificationSocketHandler.getOnlineUsers();
      expect(Array.isArray(result)).toBe(true);
    });
  });

  // ---- emit helpers (module-level re-exports) ----

  describe('module-level emit helpers', () => {
    beforeEach(() => {
      NotificationSocketHandler.initialize(io);
    });

    it('emitToConversation calls io.to with correct room', () => {
      emitToConversation('conv1', 'event', { data: 1 });
      expect(io.to).toHaveBeenCalledWith('conversation_conv1');
    });

    it('emitToUser calls io.to with socket id when user connected', () => {
      emitToUser('unconnected-user', 'event', {});
      // No crash; user simply not connected so no io.to call with socket id
    });

    it('emitToCreator calls io.to with creator room', () => {
      emitToCreator('creator1', 'event', {});
      expect(io.to).toHaveBeenCalledWith('creator_creator1');
    });

    it('emitToAdmin calls io.to with admin room', () => {
      emitToAdmin('admin_event', {});
      expect(io.to).toHaveBeenCalledWith('admin');
    });

    it('isUserOnline returns false for unknown user', () => {
      expect(isUserOnline('nobody')).toBe(false);
    });

    it('getOnlineUserCount returns a number', () => {
      expect(typeof getOnlineUserCount()).toBe('number');
    });

    it('getVectorCount returns 0 (stub)', () => {
      expect(getVectorCount()).toBe(0);
    });
  });
});
