// ===========================================
// NOTIFICATION CONTROLLER UNIT TESTS
// ===========================================

jest.mock('../../../middleware/errorHandler', () => {
  class AppError extends Error {
    statusCode: number;
    constructor(message: string, statusCode: number) {
      super(message);
      this.statusCode = statusCode;
    }
  }
  return { AppError, asyncHandler: (fn: Function) => fn };
});

jest.mock('../../../services/notification.service', () => ({
  getByUser: jest.fn(),
  getUnreadCount: jest.fn(),
  markAsRead: jest.fn(),
  markAllAsRead: jest.fn(),
  deleteNotification: jest.fn(),
  getSettings: jest.fn(),
  updateSettings: jest.fn()
}));

import { Request, Response } from 'express';
import * as notificationService from '../../../services/notification.service';
import {
  getNotifications,
  getUnreadCount,
  markAsRead,
  markAllAsRead,
  deleteNotification,
  getSettings,
  updateSettings
} from '../../../controllers/notification.controller';

const mockReq = (overrides = {}) =>
  ({ body: {}, params: {}, query: {}, user: { id: 'user-1', role: 'USER' }, ...overrides } as unknown as Request);

const mockRes = () => {
  const res = {} as Response;
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

describe('Notification Controller', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('getNotifications', () => {
    it('should return paginated notifications', async () => {
      const req = mockReq({ query: { page: '1', limit: '10' } });
      const res = mockRes();

      (notificationService.getByUser as jest.Mock).mockResolvedValue({
        notifications: [],
        total: 0
      });

      await getNotifications(req, res);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    });
  });

  describe('getUnreadCount', () => {
    it('should return unread count', async () => {
      const req = mockReq();
      const res = mockRes();

      (notificationService.getUnreadCount as jest.Mock).mockResolvedValue(5);

      await getUnreadCount(req, res);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ success: true, data: { count: 5 } })
      );
    });
  });

  describe('markAsRead', () => {
    it('should mark notification as read', async () => {
      const req = mockReq({ params: { id: 'notif-1' } });
      const res = mockRes();

      (notificationService.markAsRead as jest.Mock).mockResolvedValue({ id: 'notif-1', isRead: true });

      await markAsRead(req, res);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    });

    it('should throw 404 when notification not found', async () => {
      const req = mockReq({ params: { id: 'bad-id' } });
      const res = mockRes();

      (notificationService.markAsRead as jest.Mock).mockRejectedValue(new Error('Notification not found'));

      await expect(markAsRead(req, res)).rejects.toThrow();
    });
  });

  describe('markAllAsRead', () => {
    it('should mark all as read', async () => {
      const req = mockReq();
      const res = mockRes();

      (notificationService.markAllAsRead as jest.Mock).mockResolvedValue(undefined);

      await markAllAsRead(req, res);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ success: true, message: 'All notifications marked as read' })
      );
    });
  });

  describe('deleteNotification', () => {
    it('should delete notification', async () => {
      const req = mockReq({ params: { id: 'notif-1' } });
      const res = mockRes();

      (notificationService.deleteNotification as jest.Mock).mockResolvedValue(undefined);

      await deleteNotification(req, res);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ success: true, message: 'Notification deleted' })
      );
    });
  });

  describe('getSettings', () => {
    it('should return notification settings', async () => {
      const req = mockReq();
      const res = mockRes();

      (notificationService.getSettings as jest.Mock).mockResolvedValue({ emailEnabled: true });

      await getSettings(req, res);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    });
  });

  describe('updateSettings', () => {
    it('should update notification settings', async () => {
      const req = mockReq({ body: { emailEnabled: false } });
      const res = mockRes();

      (notificationService.updateSettings as jest.Mock).mockResolvedValue({ emailEnabled: false });

      await updateSettings(req, res);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ success: true, message: 'Notification settings updated' })
      );
    });
  });

  // ===========================================
  // NEW BRANCH COVERAGE TESTS
  // ===========================================

  describe('getNotifications — additional branches', () => {
    it('should default page to 1 and limit to 20 when not provided', async () => {
      const req = mockReq({ query: {} });
      const res = mockRes();
      (notificationService.getByUser as jest.Mock).mockResolvedValue({ notifications: [], total: 0 });

      await getNotifications(req, res);

      expect(notificationService.getByUser).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({ page: 1, limit: 20 })
      );
    });

    it('should pass isRead=true when query.isRead is "true"', async () => {
      const req = mockReq({ query: { isRead: 'true' } });
      const res = mockRes();
      (notificationService.getByUser as jest.Mock).mockResolvedValue({ notifications: [], total: 0 });

      await getNotifications(req, res);

      expect(notificationService.getByUser).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({ isRead: true })
      );
    });

    it('should pass isRead=false when query.isRead is "false"', async () => {
      const req = mockReq({ query: { isRead: 'false' } });
      const res = mockRes();
      (notificationService.getByUser as jest.Mock).mockResolvedValue({ notifications: [], total: 0 });

      await getNotifications(req, res);

      expect(notificationService.getByUser).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({ isRead: false })
      );
    });

    it('should pass isRead=undefined when query.isRead is not "true"/"false"', async () => {
      const req = mockReq({ query: { isRead: 'maybe' } });
      const res = mockRes();
      (notificationService.getByUser as jest.Mock).mockResolvedValue({ notifications: [], total: 0 });

      await getNotifications(req, res);

      expect(notificationService.getByUser).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({ isRead: undefined })
      );
    });

    it('should forward the type query param', async () => {
      const req = mockReq({ query: { type: 'CHAT' } });
      const res = mockRes();
      (notificationService.getByUser as jest.Mock).mockResolvedValue({ notifications: [], total: 0 });

      await getNotifications(req, res);

      expect(notificationService.getByUser).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({ type: 'CHAT' })
      );
    });
  });

  describe('markAsRead — additional branches', () => {
    it('should rethrow as AppError when markAsRead service throws a non-Error', async () => {
      const req = mockReq({ params: { id: 'notif-x' } });
      const res = mockRes();

      (notificationService.markAsRead as jest.Mock).mockRejectedValue('string error');

      await expect(markAsRead(req, res)).rejects.toMatchObject({ statusCode: 404 });
    });

    it('should rethrow AppError with the Error message when an Error is thrown', async () => {
      const req = mockReq({ params: { id: 'notif-x' } });
      const res = mockRes();

      (notificationService.markAsRead as jest.Mock).mockRejectedValue(new Error('Not yours'));

      await expect(markAsRead(req, res)).rejects.toMatchObject({
        message: 'Not yours',
        statusCode: 404
      });
    });
  });

  describe('deleteNotification — additional branches', () => {
    it('should rethrow AppError when deleteNotification service throws an Error', async () => {
      const req = mockReq({ params: { id: 'notif-del' } });
      const res = mockRes();

      (notificationService.deleteNotification as jest.Mock).mockRejectedValue(
        new Error('Not found')
      );

      await expect(deleteNotification(req, res)).rejects.toMatchObject({
        message: 'Not found',
        statusCode: 404
      });
    });

    it('should rethrow AppError when deleteNotification service throws a non-Error', async () => {
      const req = mockReq({ params: { id: 'notif-del' } });
      const res = mockRes();

      (notificationService.deleteNotification as jest.Mock).mockRejectedValue({ code: 42 });

      await expect(deleteNotification(req, res)).rejects.toMatchObject({ statusCode: 404 });
    });
  });

  describe('updateSettings — additional branches', () => {
    it('should forward all settings fields to the service', async () => {
      const settingsPayload = {
        emailEnabled: true,
        emailChat: false,
        emailDeals: true,
        emailPayments: false,
        emailModeration: true,
        pushEnabled: false,
        soundEnabled: true
      };
      const req = mockReq({ body: settingsPayload });
      const res = mockRes();
      (notificationService.updateSettings as jest.Mock).mockResolvedValue(settingsPayload);

      await updateSettings(req, res);

      expect(notificationService.updateSettings).toHaveBeenCalledWith('user-1', settingsPayload);
    });

    it('should return updated settings object in response', async () => {
      const req = mockReq({ body: { pushEnabled: true } });
      const res = mockRes();
      const updated = { pushEnabled: true };
      (notificationService.updateSettings as jest.Mock).mockResolvedValue(updated);

      await updateSettings(req, res);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ success: true, data: updated })
      );
    });
  });
});
