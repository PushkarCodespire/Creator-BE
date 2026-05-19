// ===========================================
// NOTIFICATION SERVICE — UNIT TESTS
// ===========================================

jest.mock('../../../../prisma/client', () => ({
  __esModule: true,
  default: {
    notification: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      count: jest.fn(),
      delete: jest.fn(),
      deleteMany: jest.fn(),
    },
    notificationSettings: {
      findUnique: jest.fn(),
      create: jest.fn(),
      upsert: jest.fn(),
    },
  },
}));

import prisma from '../../../../prisma/client';
import {
  create,
  createAndEmit,
  markAsRead,
  markAllAsRead,
  getByUser,
  getUnreadCount,
  deleteNotification,
  deleteOldNotifications,
  getSettings,
  updateSettings,
  shouldNotify,
} from '../../../services/notification.service';

const mockPrisma = prisma as jest.Mocked<typeof prisma>;

describe('NotificationService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('create', () => {
    it('should create a notification with correct params', async () => {
      const mockNotification = { id: 'n1', userId: 'u1', type: 'CHAT_MESSAGE', title: 'New message', message: 'You have a new message' };
      (mockPrisma.notification.create as jest.Mock).mockResolvedValue(mockNotification);

      const result = await create({
        userId: 'u1',
        type: 'CHAT_MESSAGE' as any,
        title: 'New message',
        message: 'You have a new message',
      });

      expect(result.id).toBe('n1');
      expect(mockPrisma.notification.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: 'u1',
          type: 'CHAT_MESSAGE',
          priority: 'NORMAL',
        }),
      });
    });

    it('should use custom priority when provided', async () => {
      (mockPrisma.notification.create as jest.Mock).mockResolvedValue({ id: 'n2' });

      await create({
        userId: 'u1',
        type: 'MODERATION_WARNING' as any,
        title: 'Warning',
        message: 'You received a warning',
        priority: 'HIGH' as any,
      });

      expect(mockPrisma.notification.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ priority: 'HIGH' }),
      });
    });
  });

  describe('createAndEmit', () => {
    it('should create notification and emit via socket.io', async () => {
      const mockNotification = { id: 'n1', userId: 'u1' };
      (mockPrisma.notification.create as jest.Mock).mockResolvedValue(mockNotification);

      const mockIo = {
        to: jest.fn().mockReturnThis(),
        emit: jest.fn(),
      };

      const result = await createAndEmit(mockIo as any, {
        userId: 'u1',
        type: 'CHAT_MESSAGE' as any,
        title: 'Test',
        message: 'Test msg',
      });

      expect(result.id).toBe('n1');
      expect(mockIo.to).toHaveBeenCalledWith('user_u1');
      expect(mockIo.to).toHaveBeenCalledWith('user:u1');
      expect(mockIo.emit).toHaveBeenCalledWith('notification:new', mockNotification);
    });
  });

  describe('markAsRead', () => {
    it('should mark a notification as read', async () => {
      (mockPrisma.notification.findUnique as jest.Mock).mockResolvedValue({
        id: 'n1',
        userId: 'u1',
      });
      (mockPrisma.notification.update as jest.Mock).mockResolvedValue({
        id: 'n1',
        isRead: true,
      });

      const result = await markAsRead('n1', 'u1');

      expect(mockPrisma.notification.update).toHaveBeenCalledWith({
        where: { id: 'n1' },
        data: expect.objectContaining({ isRead: true }),
      });
    });

    it('should throw error for non-existent notification', async () => {
      (mockPrisma.notification.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(markAsRead('n-missing', 'u1')).rejects.toThrow('Notification not found');
    });

    it('should throw error when notification belongs to different user', async () => {
      (mockPrisma.notification.findUnique as jest.Mock).mockResolvedValue({
        id: 'n1',
        userId: 'u2', // different user
      });

      await expect(markAsRead('n1', 'u1')).rejects.toThrow('Notification not found');
    });
  });

  describe('markAllAsRead', () => {
    it('should mark all unread notifications as read', async () => {
      (mockPrisma.notification.updateMany as jest.Mock).mockResolvedValue({ count: 5 });

      await markAllAsRead('u1');

      expect(mockPrisma.notification.updateMany).toHaveBeenCalledWith({
        where: { userId: 'u1', isRead: false },
        data: expect.objectContaining({ isRead: true }),
      });
    });
  });

  describe('getByUser', () => {
    it('should return paginated notifications', async () => {
      (mockPrisma.notification.deleteMany as jest.Mock).mockResolvedValue({ count: 0 });
      (mockPrisma.notification.findMany as jest.Mock).mockResolvedValue([
        { id: 'n1' },
        { id: 'n2' },
      ]);
      (mockPrisma.notification.count as jest.Mock).mockResolvedValue(2);

      const result = await getByUser('u1', { page: 1, limit: 20 });

      expect(result.notifications).toHaveLength(2);
      expect(result.pagination.total).toBe(2);
      expect(result.pagination.totalPages).toBe(1);
    });

    it('should filter by isRead when provided', async () => {
      (mockPrisma.notification.deleteMany as jest.Mock).mockResolvedValue({ count: 0 });
      (mockPrisma.notification.findMany as jest.Mock).mockResolvedValue([]);
      (mockPrisma.notification.count as jest.Mock).mockResolvedValue(0);

      await getByUser('u1', { isRead: false });

      expect(mockPrisma.notification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ isRead: false }),
        })
      );
    });

    it('should delete expired notifications first', async () => {
      (mockPrisma.notification.deleteMany as jest.Mock).mockResolvedValue({ count: 1 });
      (mockPrisma.notification.findMany as jest.Mock).mockResolvedValue([]);
      (mockPrisma.notification.count as jest.Mock).mockResolvedValue(0);

      await getByUser('u1');

      expect(mockPrisma.notification.deleteMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            userId: 'u1',
            expiresAt: expect.objectContaining({ lt: expect.any(Date) }),
          }),
        })
      );
    });
  });

  describe('getUnreadCount', () => {
    it('should return count of unread, non-expired notifications', async () => {
      (mockPrisma.notification.count as jest.Mock).mockResolvedValue(7);

      const count = await getUnreadCount('u1');

      expect(count).toBe(7);
    });
  });

  describe('deleteNotification', () => {
    it('should delete notification owned by user', async () => {
      (mockPrisma.notification.findUnique as jest.Mock).mockResolvedValue({
        id: 'n1',
        userId: 'u1',
      });
      (mockPrisma.notification.delete as jest.Mock).mockResolvedValue({ id: 'n1' });

      await deleteNotification('n1', 'u1');

      expect(mockPrisma.notification.delete).toHaveBeenCalledWith({ where: { id: 'n1' } });
    });

    it('should throw error for wrong user', async () => {
      (mockPrisma.notification.findUnique as jest.Mock).mockResolvedValue({
        id: 'n1',
        userId: 'u2',
      });

      await expect(deleteNotification('n1', 'u1')).rejects.toThrow('Notification not found');
    });
  });

  describe('deleteOldNotifications', () => {
    it('should delete read notifications older than specified days', async () => {
      (mockPrisma.notification.deleteMany as jest.Mock).mockResolvedValue({ count: 10 });

      await deleteOldNotifications(30);

      expect(mockPrisma.notification.deleteMany).toHaveBeenCalledWith({
        where: {
          isRead: true,
          createdAt: expect.objectContaining({ lt: expect.any(Date) }),
        },
      });
    });
  });

  describe('getSettings', () => {
    it('should return existing settings', async () => {
      const mockSettings = { userId: 'u1', emailEnabled: true, pushEnabled: true };
      (mockPrisma.notificationSettings.findUnique as jest.Mock).mockResolvedValue(mockSettings);

      const result = await getSettings('u1');

      expect(result).toEqual(mockSettings);
    });

    it('should create default settings when none exist', async () => {
      (mockPrisma.notificationSettings.findUnique as jest.Mock).mockResolvedValue(null);
      (mockPrisma.notificationSettings.create as jest.Mock).mockResolvedValue({
        userId: 'u1',
        emailEnabled: true,
        pushEnabled: true,
      });

      const result = await getSettings('u1');

      expect(mockPrisma.notificationSettings.create).toHaveBeenCalledWith({
        data: { userId: 'u1' },
      });
    });
  });

  describe('shouldNotify', () => {
    it('should return email and push settings based on notification type', async () => {
      (mockPrisma.notificationSettings.findUnique as jest.Mock).mockResolvedValue({
        userId: 'u1',
        emailEnabled: true,
        emailChat: true,
        emailDeals: false,
        pushEnabled: true,
      });

      const chatResult = await shouldNotify('u1', 'CHAT_MESSAGE' as any);
      expect(chatResult.email).toBe(true);
      expect(chatResult.push).toBe(true);

      (mockPrisma.notificationSettings.findUnique as jest.Mock).mockResolvedValue({
        userId: 'u1',
        emailEnabled: true,
        emailChat: true,
        emailDeals: false,
        pushEnabled: false,
      });

      const dealResult = await shouldNotify('u1', 'DEAL_APPLICATION' as any);
      expect(dealResult.email).toBe(false);
      expect(dealResult.push).toBe(false);
    });
  });
});

// ===========================================
// EXTENDED COVERAGE TESTS
// ===========================================

describe('NotificationService — extended coverage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ---- create ----
  describe('create — extended', () => {
    it('should default priority to NORMAL when not supplied', async () => {
      (mockPrisma.notification.create as jest.Mock).mockResolvedValue({ id: 'n10' });

      await create({
        userId: 'u2',
        type: 'PAYMENT_SUCCESS' as any,
        title: 'Payment received',
        message: 'Your payment was successful',
      });

      expect(mockPrisma.notification.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ priority: 'NORMAL' }),
        })
      );
    });

    it('should include actionUrl when provided', async () => {
      (mockPrisma.notification.create as jest.Mock).mockResolvedValue({ id: 'n11' });

      await create({
        userId: 'u2',
        type: 'DEAL_ACCEPTED' as any,
        title: 'Deal accepted',
        message: 'Your deal was accepted',
        actionUrl: '/deals/deal-123',
      });

      expect(mockPrisma.notification.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ actionUrl: '/deals/deal-123' }),
        })
      );
    });

    it('should include data payload when provided', async () => {
      (mockPrisma.notification.create as jest.Mock).mockResolvedValue({ id: 'n12' });

      await create({
        userId: 'u2',
        type: 'CHAT_MESSAGE' as any,
        title: 'New msg',
        message: 'msg',
        data: { conversationId: 'conv-99' },
      });

      expect(mockPrisma.notification.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ data: { conversationId: 'conv-99' } }),
        })
      );
    });

    it('should include expiresAt when provided', async () => {
      const expiry = new Date('2030-01-01');
      (mockPrisma.notification.create as jest.Mock).mockResolvedValue({ id: 'n13' });

      await create({
        userId: 'u2',
        type: 'CHAT_MESSAGE' as any,
        title: 'Expiring',
        message: 'expires soon',
        expiresAt: expiry,
      });

      expect(mockPrisma.notification.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ expiresAt: expiry }),
        })
      );
    });

    it('should return the created notification object', async () => {
      const mockNotif = { id: 'n14', title: 'Test', isRead: false };
      (mockPrisma.notification.create as jest.Mock).mockResolvedValue(mockNotif);

      const result = await create({
        userId: 'u3',
        type: 'SYSTEM_ANNOUNCEMENT' as any,
        title: 'Test',
        message: 'msg',
      });

      expect(result).toEqual(mockNotif);
    });
  });

  // ---- createAndEmit ----
  describe('createAndEmit — extended', () => {
    it('should emit to BOTH room naming conventions', async () => {
      const mockNotif = { id: 'n20', userId: 'u5' };
      (mockPrisma.notification.create as jest.Mock).mockResolvedValue(mockNotif);

      const emitMock = jest.fn();
      const mockIo = { to: jest.fn().mockReturnThis(), emit: emitMock };

      await createAndEmit(mockIo as any, {
        userId: 'u5',
        type: 'PAYMENT_SUCCESS' as any,
        title: 'Paid',
        message: 'Payment received',
      });

      expect(mockIo.to).toHaveBeenCalledWith('user_u5');
      expect(mockIo.to).toHaveBeenCalledWith('user:u5');
      expect(emitMock).toHaveBeenCalledTimes(2);
    });

    it('should propagate prisma errors', async () => {
      (mockPrisma.notification.create as jest.Mock).mockRejectedValue(new Error('DB down'));

      const mockIo = { to: jest.fn().mockReturnThis(), emit: jest.fn() };

      await expect(
        createAndEmit(mockIo as any, {
          userId: 'u5',
          type: 'CHAT_MESSAGE' as any,
          title: 'Test',
          message: 'msg',
        })
      ).rejects.toThrow('DB down');
    });

    it('should return the created notification', async () => {
      const mockNotif = { id: 'n21', userId: 'u5', title: 'Hello' };
      (mockPrisma.notification.create as jest.Mock).mockResolvedValue(mockNotif);

      const mockIo = { to: jest.fn().mockReturnThis(), emit: jest.fn() };

      const result = await createAndEmit(mockIo as any, {
        userId: 'u5',
        type: 'CHAT_MESSAGE' as any,
        title: 'Hello',
        message: 'world',
      });

      expect(result).toEqual(mockNotif);
    });
  });

  // ---- markAsRead ----
  describe('markAsRead — extended', () => {
    it('should set readAt to a Date on update', async () => {
      (mockPrisma.notification.findUnique as jest.Mock).mockResolvedValue({
        id: 'n30',
        userId: 'u1',
      });
      (mockPrisma.notification.update as jest.Mock).mockResolvedValue({
        id: 'n30',
        isRead: true,
        readAt: new Date(),
      });

      await markAsRead('n30', 'u1');

      expect(mockPrisma.notification.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ readAt: expect.any(Date) }),
        })
      );
    });

    it('should return the updated notification object', async () => {
      const updated = { id: 'n31', isRead: true, readAt: new Date() };
      (mockPrisma.notification.findUnique as jest.Mock).mockResolvedValue({
        id: 'n31',
        userId: 'u1',
      });
      (mockPrisma.notification.update as jest.Mock).mockResolvedValue(updated);

      const result = await markAsRead('n31', 'u1');

      expect(result).toEqual(updated);
    });

    it('should throw when notification exists but userId does not match', async () => {
      (mockPrisma.notification.findUnique as jest.Mock).mockResolvedValue({
        id: 'n32',
        userId: 'different-user',
      });

      await expect(markAsRead('n32', 'u1')).rejects.toThrow('Notification not found');
      expect(mockPrisma.notification.update).not.toHaveBeenCalled();
    });
  });

  // ---- markAllAsRead ----
  describe('markAllAsRead — extended', () => {
    it('should return the prisma updateMany result', async () => {
      (mockPrisma.notification.updateMany as jest.Mock).mockResolvedValue({ count: 3 });

      const result = await markAllAsRead('u1');

      expect(result).toEqual({ count: 3 });
    });

    it('should only target the given userId and isRead: false', async () => {
      (mockPrisma.notification.updateMany as jest.Mock).mockResolvedValue({ count: 0 });

      await markAllAsRead('u-specific');

      expect(mockPrisma.notification.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'u-specific', isRead: false },
        })
      );
    });

    it('should set readAt timestamp in the update', async () => {
      (mockPrisma.notification.updateMany as jest.Mock).mockResolvedValue({ count: 2 });

      await markAllAsRead('u1');

      expect(mockPrisma.notification.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ readAt: expect.any(Date) }),
        })
      );
    });
  });

  // ---- getByUser ----
  describe('getByUser — extended', () => {
    it('should filter by notification type when provided', async () => {
      (mockPrisma.notification.deleteMany as jest.Mock).mockResolvedValue({ count: 0 });
      (mockPrisma.notification.findMany as jest.Mock).mockResolvedValue([]);
      (mockPrisma.notification.count as jest.Mock).mockResolvedValue(0);

      await getByUser('u1', { type: 'PAYMENT_SUCCESS' as any });

      expect(mockPrisma.notification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ type: 'PAYMENT_SUCCESS' }),
        })
      );
    });

    it('should compute pagination correctly for page 2', async () => {
      (mockPrisma.notification.deleteMany as jest.Mock).mockResolvedValue({ count: 0 });
      (mockPrisma.notification.findMany as jest.Mock).mockResolvedValue([]);
      (mockPrisma.notification.count as jest.Mock).mockResolvedValue(50);

      const result = await getByUser('u1', { page: 2, limit: 10 });

      expect(result.pagination.page).toBe(2);
      expect(result.pagination.totalPages).toBe(5);
    });

    it('should order by isRead asc then createdAt desc', async () => {
      (mockPrisma.notification.deleteMany as jest.Mock).mockResolvedValue({ count: 0 });
      (mockPrisma.notification.findMany as jest.Mock).mockResolvedValue([]);
      (mockPrisma.notification.count as jest.Mock).mockResolvedValue(0);

      await getByUser('u1');

      expect(mockPrisma.notification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: [{ isRead: 'asc' }, { createdAt: 'desc' }],
        })
      );
    });

    it('should use defaults (page 1, limit 20) when no options supplied', async () => {
      (mockPrisma.notification.deleteMany as jest.Mock).mockResolvedValue({ count: 0 });
      (mockPrisma.notification.findMany as jest.Mock).mockResolvedValue([]);
      (mockPrisma.notification.count as jest.Mock).mockResolvedValue(0);

      const result = await getByUser('u1');

      expect(result.pagination.page).toBe(1);
      expect(result.pagination.limit).toBe(20);
    });

    it('should not add type or isRead to where clause when neither is provided', async () => {
      (mockPrisma.notification.deleteMany as jest.Mock).mockResolvedValue({ count: 0 });
      (mockPrisma.notification.findMany as jest.Mock).mockResolvedValue([]);
      (mockPrisma.notification.count as jest.Mock).mockResolvedValue(0);

      await getByUser('u1');

      expect(mockPrisma.notification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'u1' },
        })
      );
    });
  });

  // ---- getUnreadCount ----
  describe('getUnreadCount — extended', () => {
    it('should query with OR for null or future expiresAt', async () => {
      (mockPrisma.notification.count as jest.Mock).mockResolvedValue(4);

      await getUnreadCount('u1');

      expect(mockPrisma.notification.count).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            userId: 'u1',
            isRead: false,
            OR: expect.arrayContaining([
              { expiresAt: null },
              { expiresAt: { gte: expect.any(Date) } },
            ]),
          }),
        })
      );
    });

    it('should return 0 when no unread notifications', async () => {
      (mockPrisma.notification.count as jest.Mock).mockResolvedValue(0);

      const count = await getUnreadCount('u-empty');

      expect(count).toBe(0);
    });
  });

  // ---- deleteNotification ----
  describe('deleteNotification — extended', () => {
    it('should call delete with correct id', async () => {
      (mockPrisma.notification.findUnique as jest.Mock).mockResolvedValue({
        id: 'n50',
        userId: 'u1',
      });
      (mockPrisma.notification.delete as jest.Mock).mockResolvedValue({ id: 'n50' });

      await deleteNotification('n50', 'u1');

      expect(mockPrisma.notification.delete).toHaveBeenCalledWith({ where: { id: 'n50' } });
    });

    it('should not call delete when notification not found', async () => {
      (mockPrisma.notification.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(deleteNotification('n-gone', 'u1')).rejects.toThrow('Notification not found');
      expect(mockPrisma.notification.delete).not.toHaveBeenCalled();
    });

    it('should return the deleted notification object', async () => {
      const deleted = { id: 'n51', title: 'Deleted' };
      (mockPrisma.notification.findUnique as jest.Mock).mockResolvedValue({
        id: 'n51',
        userId: 'u1',
      });
      (mockPrisma.notification.delete as jest.Mock).mockResolvedValue(deleted);

      const result = await deleteNotification('n51', 'u1');

      expect(result).toEqual(deleted);
    });
  });

  // ---- deleteOldNotifications ----
  describe('deleteOldNotifications — extended', () => {
    it('should use 30 days as default cutoff', async () => {
      (mockPrisma.notification.deleteMany as jest.Mock).mockResolvedValue({ count: 5 });

      const before = new Date();
      await deleteOldNotifications();
      const after = new Date();

      const call = (mockPrisma.notification.deleteMany as jest.Mock).mock.calls[0][0];
      const cutoff: Date = call.where.createdAt.lt;
      const expectedMin = new Date(before.getTime() - 30 * 24 * 3600 * 1000);
      const expectedMax = new Date(after.getTime() - 30 * 24 * 3600 * 1000);

      expect(cutoff.getTime()).toBeGreaterThanOrEqual(expectedMin.getTime() - 1000);
      expect(cutoff.getTime()).toBeLessThanOrEqual(expectedMax.getTime() + 1000);
    });

    it('should accept a custom daysOld argument', async () => {
      (mockPrisma.notification.deleteMany as jest.Mock).mockResolvedValue({ count: 2 });

      await deleteOldNotifications(7);

      expect(mockPrisma.notification.deleteMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ isRead: true }),
        })
      );
    });

    it('should only delete isRead: true notifications', async () => {
      (mockPrisma.notification.deleteMany as jest.Mock).mockResolvedValue({ count: 0 });

      await deleteOldNotifications(30);

      const call = (mockPrisma.notification.deleteMany as jest.Mock).mock.calls[0][0];
      expect(call.where.isRead).toBe(true);
    });
  });

  // ---- getSettings ----
  describe('getSettings — extended', () => {
    it('should return settings when they already exist without creating new ones', async () => {
      const existing = { userId: 'u1', emailEnabled: true };
      (mockPrisma.notificationSettings.findUnique as jest.Mock).mockResolvedValue(existing);

      await getSettings('u1');

      expect(mockPrisma.notificationSettings.create).not.toHaveBeenCalled();
    });

    it('should call create with userId only when no settings found', async () => {
      (mockPrisma.notificationSettings.findUnique as jest.Mock).mockResolvedValue(null);
      (mockPrisma.notificationSettings.create as jest.Mock).mockResolvedValue({
        userId: 'u-new',
        emailEnabled: true,
      });

      await getSettings('u-new');

      expect(mockPrisma.notificationSettings.create).toHaveBeenCalledWith({
        data: { userId: 'u-new' },
      });
    });
  });

  // ---- updateSettings ----
  describe('updateSettings', () => {
    it('should upsert settings for the given userId', async () => {
      const updated = { userId: 'u1', emailEnabled: false, pushEnabled: true };
      (mockPrisma.notificationSettings.upsert as jest.Mock).mockResolvedValue(updated);

      const result = await updateSettings('u1', { emailEnabled: false, pushEnabled: true });

      expect(result).toEqual(updated);
      expect(mockPrisma.notificationSettings.upsert).toHaveBeenCalledWith({
        where: { userId: 'u1' },
        create: { userId: 'u1', emailEnabled: false, pushEnabled: true },
        update: { emailEnabled: false, pushEnabled: true },
      });
    });

    it('should pass all settings fields through', async () => {
      (mockPrisma.notificationSettings.upsert as jest.Mock).mockResolvedValue({});

      await updateSettings('u2', {
        emailEnabled: true,
        emailChat: false,
        emailDeals: true,
        emailPayments: false,
        emailModeration: true,
        pushEnabled: false,
        soundEnabled: true,
      });

      const call = (mockPrisma.notificationSettings.upsert as jest.Mock).mock.calls[0][0];
      expect(call.update.emailChat).toBe(false);
      expect(call.update.soundEnabled).toBe(true);
    });

    it('should handle empty settings object', async () => {
      (mockPrisma.notificationSettings.upsert as jest.Mock).mockResolvedValue({});

      await expect(updateSettings('u3', {})).resolves.not.toThrow();
    });
  });

  // ---- shouldNotify — extended ----
  describe('shouldNotify — extended', () => {
    it('should return email: false when emailEnabled is false regardless of type', async () => {
      (mockPrisma.notificationSettings.findUnique as jest.Mock).mockResolvedValue({
        userId: 'u1',
        emailEnabled: false,
        emailPayments: true,
        pushEnabled: true,
      });

      const result = await shouldNotify('u1', 'PAYMENT_SUCCESS' as any);

      expect(result.email).toBe(false);
    });

    it('should return push: false when pushEnabled is false', async () => {
      (mockPrisma.notificationSettings.findUnique as jest.Mock).mockResolvedValue({
        userId: 'u1',
        emailEnabled: true,
        emailChat: true,
        pushEnabled: false,
      });

      const result = await shouldNotify('u1', 'CHAT_MESSAGE' as any);

      expect(result.push).toBe(false);
    });

    it('should default email to true for unmapped notification types when emailEnabled', async () => {
      (mockPrisma.notificationSettings.findUnique as jest.Mock).mockResolvedValue({
        userId: 'u1',
        emailEnabled: true,
        pushEnabled: true,
      });

      // SYSTEM_ANNOUNCEMENT is not in the mapping → defaults to true
      const result = await shouldNotify('u1', 'SYSTEM_ANNOUNCEMENT' as any);

      expect(result.email).toBe(true);
    });

    it('should create default settings when none exist, then use them', async () => {
      (mockPrisma.notificationSettings.findUnique as jest.Mock).mockResolvedValue(null);
      (mockPrisma.notificationSettings.create as jest.Mock).mockResolvedValue({
        userId: 'u-new',
        emailEnabled: true,
        emailPayments: true,
        pushEnabled: true,
      });

      const result = await shouldNotify('u-new', 'PAYMENT_SUCCESS' as any);

      expect(result.email).toBe(true);
      expect(result.push).toBe(true);
    });

    it('should handle moderation type with emailModeration setting', async () => {
      (mockPrisma.notificationSettings.findUnique as jest.Mock).mockResolvedValue({
        userId: 'u1',
        emailEnabled: true,
        emailModeration: false,
        pushEnabled: true,
      });

      const result = await shouldNotify('u1', 'MODERATION_WARNING' as any);

      expect(result.email).toBe(false);
    });
  });
});
