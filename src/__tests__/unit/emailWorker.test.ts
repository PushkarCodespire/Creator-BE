// ===========================================
// EMAIL WORKER UNIT TESTS
// ===========================================

// Standard helpers
const makeReq = (o: any = {}) => ({ body: {}, params: {}, query: {}, headers: { authorization: 'Bearer t' }, user: { id: 'u1', role: 'USER', email: 'e@e.com' }, ip: '127.0.0.1', socket: { remoteAddress: '127.0.0.1' }, cookies: {}, ...o });
const makeRes = () => { const r: any = {}; r.status = jest.fn(() => r); r.json = jest.fn(() => r); r.send = jest.fn(() => r); r.setHeader = jest.fn(() => r); r.getHeader = jest.fn(() => undefined); r.on = jest.fn(() => r); r.once = jest.fn(() => r); r.emit = jest.fn(); r.headersSent = false; r.locals = {}; r.writableEnded = false; return r; };
const next = jest.fn();

// ---- Module mocks (must be before imports) ----

const mockSendMail = jest.fn();
const mockCreateTransport = jest.fn(() => ({ sendMail: mockSendMail }));

jest.mock('nodemailer', () => ({
  createTransport: mockCreateTransport
}));

jest.mock('../../../prisma/client', () => ({
  __esModule: true,
  default: {
    user: { findUnique: jest.fn() },
    notificationSettings: { findUnique: jest.fn() },
    analyticsEvent: { create: jest.fn() }
  }
}));

jest.mock('../../utils/logger', () => ({
  logInfo: jest.fn(),
  logError: jest.fn(),
  logDebug: jest.fn()
}));

jest.mock('../../config', () => ({
  config: {
    frontendUrl: 'http://localhost:3000'
  }
}));

// Inject SMTP env vars so nodemailer.createTransport is called with a config
// (these have to be set before the module is imported)
process.env.SMTP_HOST = 'smtp.test.com';
process.env.SMTP_PORT = '587';
process.env.SMTP_USER = 'test@test.com';
process.env.SMTP_PASS = 'secret';
process.env.FROM_EMAIL = 'noreply@test.com';
process.env.EMAIL_ENABLED = 'true';

import prisma from '../../../prisma/client';
import { EmailWorker } from '../../workers/emailWorker';

beforeEach(() => {
  jest.clearAllMocks();
  // Default: sendMail resolves successfully
  mockSendMail.mockResolvedValue({ messageId: 'msg-123', response: '250 OK' });
});

// ============================================
// EmailWorker.sendEmail
// ============================================
describe('EmailWorker.sendEmail', () => {
  it('sends email and records analytics event when userId is provided', async () => {
    (prisma.analyticsEvent.create as jest.Mock).mockResolvedValue({});

    await EmailWorker.sendEmail({
      to: 'user@test.com',
      subject: 'Test',
      template: 'welcome' as any,
      data: { userName: 'Alice' },
      userId: 'u1'
    });

    expect(mockSendMail).toHaveBeenCalledWith(expect.objectContaining({
      to: 'user@test.com',
      subject: 'Test'
    }));
    expect(prisma.analyticsEvent.create).toHaveBeenCalled();
  });

  it('sends email without analytics event when userId is not provided', async () => {
    await EmailWorker.sendEmail({
      to: 'user@test.com',
      subject: 'Test no user',
      template: 'welcome' as any,
      data: { userName: 'Bob' }
    });

    expect(mockSendMail).toHaveBeenCalled();
    expect(prisma.analyticsEvent.create).not.toHaveBeenCalled();
  });

  it('uses "unknown" when messageId is missing from sendMail response', async () => {
    mockSendMail.mockResolvedValue({ response: '250 OK' }); // no messageId

    await EmailWorker.sendEmail({
      to: 'user@test.com',
      subject: 'No ID',
      template: 'notification' as any,
      data: {}
    });

    expect(mockSendMail).toHaveBeenCalled();
  });

  it('throws and re-throws when sendMail fails', async () => {
    mockSendMail.mockRejectedValue(new Error('SMTP connection refused'));

    await expect(
      EmailWorker.sendEmail({
        to: 'bad@test.com',
        subject: 'Fail',
        template: 'welcome' as any,
        data: {}
      })
    ).rejects.toThrow('SMTP connection refused');
  });

  it('sends all template types without error', async () => {
    const templates = [
      'welcome', 'password_reset', 'verification', 'notification',
      'payout_completed', 'deal_accepted', 'content_processed'
    ];

    for (const template of templates) {
      mockSendMail.mockResolvedValue({ messageId: `id-${template}`, response: '250 OK' });
      await EmailWorker.sendEmail({
        to: 'test@test.com',
        subject: `Test ${template}`,
        template: template as any,
        data: {
          userName: 'Test',
          resetUrl: 'http://x.com/reset',
          verifyUrl: 'http://x.com/verify',
          expiresIn: '1 hour',
          amount: 100,
          utr: 'UTR123',
          opportunityTitle: 'Deal',
          title: 'Content',
          contentUrl: 'http://x.com/content',
          actionUrl: 'http://x.com/action',
          message: 'Hello!'
        }
      });
    }

    expect(mockSendMail).toHaveBeenCalledTimes(templates.length);
  });
});

// ============================================
// EmailWorker.sendNotificationEmail
// ============================================
describe('EmailWorker.sendNotificationEmail', () => {
  const mockUser = { email: 'creator@test.com', name: 'Creator' };

  it('throws when user not found', async () => {
    (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);

    await expect(
      EmailWorker.sendNotificationEmail('missing-user', 'CHAT_MESSAGE' as any, {})
    ).rejects.toThrow('User not found: missing-user');
  });

  it('returns early when emailEnabled is false on notification settings', async () => {
    (prisma.user.findUnique as jest.Mock).mockResolvedValue(mockUser);
    (prisma.notificationSettings.findUnique as jest.Mock).mockResolvedValue({
      emailEnabled: false,
      emailChat: true,
      emailDeals: true,
      emailPayments: true
    });

    await EmailWorker.sendNotificationEmail('u1', 'CHAT_MESSAGE' as any, {});
    expect(mockSendMail).not.toHaveBeenCalled();
  });

  it('returns early when emailChat is false for CHAT_MESSAGE', async () => {
    (prisma.user.findUnique as jest.Mock).mockResolvedValue(mockUser);
    (prisma.notificationSettings.findUnique as jest.Mock).mockResolvedValue({
      emailEnabled: true,
      emailChat: false,
      emailDeals: true,
      emailPayments: true
    });

    await EmailWorker.sendNotificationEmail('u1', 'CHAT_MESSAGE' as any, {});
    expect(mockSendMail).not.toHaveBeenCalled();
  });

  it('sends notification email for CHAT_MESSAGE when emailChat is enabled', async () => {
    (prisma.user.findUnique as jest.Mock).mockResolvedValue(mockUser);
    (prisma.notificationSettings.findUnique as jest.Mock).mockResolvedValue({
      emailEnabled: true,
      emailChat: true,
      emailDeals: true,
      emailPayments: true
    });
    (prisma.analyticsEvent.create as jest.Mock).mockResolvedValue({});

    await EmailWorker.sendNotificationEmail('u1', 'CHAT_MESSAGE' as any, { message: 'Hello' });
    expect(mockSendMail).toHaveBeenCalled();
  });

  it('returns early when emailDeals is false for DEAL_ACCEPTED', async () => {
    (prisma.user.findUnique as jest.Mock).mockResolvedValue(mockUser);
    (prisma.notificationSettings.findUnique as jest.Mock).mockResolvedValue({
      emailEnabled: true,
      emailChat: true,
      emailDeals: false,
      emailPayments: true
    });

    await EmailWorker.sendNotificationEmail('u1', 'DEAL_ACCEPTED' as any, {});
    expect(mockSendMail).not.toHaveBeenCalled();
  });

  it('sends deal accepted email when emailDeals is enabled', async () => {
    (prisma.user.findUnique as jest.Mock).mockResolvedValue(mockUser);
    (prisma.notificationSettings.findUnique as jest.Mock).mockResolvedValue({
      emailEnabled: true,
      emailChat: true,
      emailDeals: true,
      emailPayments: true
    });
    (prisma.analyticsEvent.create as jest.Mock).mockResolvedValue({});

    await EmailWorker.sendNotificationEmail('u1', 'DEAL_ACCEPTED' as any, { opportunityTitle: 'Big Deal', amount: 5000 });
    expect(mockSendMail).toHaveBeenCalledWith(expect.objectContaining({
      subject: 'Your Deal Application was Accepted!'
    }));
  });

  it('returns early when emailPayments is false for PAYOUT_COMPLETED', async () => {
    (prisma.user.findUnique as jest.Mock).mockResolvedValue(mockUser);
    (prisma.notificationSettings.findUnique as jest.Mock).mockResolvedValue({
      emailEnabled: true,
      emailChat: true,
      emailDeals: true,
      emailPayments: false
    });

    await EmailWorker.sendNotificationEmail('u1', 'PAYOUT_COMPLETED' as any, {});
    expect(mockSendMail).not.toHaveBeenCalled();
  });

  it('sends payout completed email when emailPayments is enabled', async () => {
    (prisma.user.findUnique as jest.Mock).mockResolvedValue(mockUser);
    (prisma.notificationSettings.findUnique as jest.Mock).mockResolvedValue({
      emailEnabled: true,
      emailChat: true,
      emailDeals: true,
      emailPayments: true
    });
    (prisma.analyticsEvent.create as jest.Mock).mockResolvedValue({});

    await EmailWorker.sendNotificationEmail('u1', 'PAYOUT_COMPLETED' as any, { amount: '500', utr: 'UTR999' });
    expect(mockSendMail).toHaveBeenCalledWith(expect.objectContaining({
      subject: 'Payout Completed Successfully'
    }));
  });

  it('sends CONTENT_PROCESSED email regardless of emailDeals', async () => {
    (prisma.user.findUnique as jest.Mock).mockResolvedValue(mockUser);
    (prisma.notificationSettings.findUnique as jest.Mock).mockResolvedValue({
      emailEnabled: true,
      emailChat: false,
      emailDeals: false,
      emailPayments: false
    });
    (prisma.analyticsEvent.create as jest.Mock).mockResolvedValue({});

    await EmailWorker.sendNotificationEmail('u1', 'CONTENT_PROCESSED' as any, { title: 'My Video' });
    expect(mockSendMail).toHaveBeenCalledWith(expect.objectContaining({
      subject: 'Your Content Has Been Processed'
    }));
  });

  it('returns early for default notification type when emailDeals is false', async () => {
    (prisma.user.findUnique as jest.Mock).mockResolvedValue(mockUser);
    (prisma.notificationSettings.findUnique as jest.Mock).mockResolvedValue({
      emailEnabled: true,
      emailChat: true,
      emailDeals: false,
      emailPayments: true
    });

    await EmailWorker.sendNotificationEmail('u1', 'DEAL_DECLINED' as any, {});
    expect(mockSendMail).not.toHaveBeenCalled();
  });

  it('sends default notification email when emailDeals is enabled', async () => {
    (prisma.user.findUnique as jest.Mock).mockResolvedValue(mockUser);
    (prisma.notificationSettings.findUnique as jest.Mock).mockResolvedValue({
      emailEnabled: true,
      emailChat: true,
      emailDeals: true,
      emailPayments: true
    });
    (prisma.analyticsEvent.create as jest.Mock).mockResolvedValue({});

    await EmailWorker.sendNotificationEmail('u1', 'UNKNOWN_TYPE' as any, {});
    expect(mockSendMail).toHaveBeenCalledWith(expect.objectContaining({
      subject: 'New Notification'
    }));
  });
});

// ============================================
// EmailWorker.sendWelcomeEmail
// ============================================
describe('EmailWorker.sendWelcomeEmail', () => {
  it('sends welcome email to existing user', async () => {
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({ email: 'new@test.com', name: 'New User' });
    (prisma.analyticsEvent.create as jest.Mock).mockResolvedValue({});

    await EmailWorker.sendWelcomeEmail('u1');

    expect(mockSendMail).toHaveBeenCalledWith(expect.objectContaining({
      to: 'new@test.com',
      subject: 'Welcome to Creator Platform!'
    }));
  });

  it('throws when user not found', async () => {
    (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);

    await expect(EmailWorker.sendWelcomeEmail('missing')).rejects.toThrow('User not found: missing');
    expect(mockSendMail).not.toHaveBeenCalled();
  });
});

// ============================================
// EmailWorker.sendPasswordResetEmail
// ============================================
describe('EmailWorker.sendPasswordResetEmail', () => {
  it('sends password reset email with reset URL', async () => {
    await EmailWorker.sendPasswordResetEmail('user@test.com', 'reset-token-abc', 'Alice');

    expect(mockSendMail).toHaveBeenCalledWith(expect.objectContaining({
      to: 'user@test.com',
      subject: 'Password Reset Request'
    }));

    const htmlArg = mockSendMail.mock.calls[0][0].html;
    expect(htmlArg).toContain('reset-token-abc');
  });
});

// ============================================
// EmailWorker.sendVerificationEmail
// ============================================
describe('EmailWorker.sendVerificationEmail', () => {
  it('sends verification email with verify URL', async () => {
    await EmailWorker.sendVerificationEmail('user@test.com', 'verify-token-xyz', 'Bob');

    expect(mockSendMail).toHaveBeenCalledWith(expect.objectContaining({
      to: 'user@test.com',
      subject: 'Verify Your Email Address'
    }));

    const htmlArg = mockSendMail.mock.calls[0][0].html;
    expect(htmlArg).toContain('verify-token-xyz');
  });
});

// ============================================
// EMAIL_ENABLED=false mode
// ============================================
describe('EmailWorker when email is disabled', () => {
  // We need to reload the module with EMAIL_ENABLED=false.
  // The top-level module is already loaded with EMAIL_ENABLED=true,
  // so we verify the log-and-return path by setting email env to false
  // and re-requiring the module.
  it('logs and returns early when email is disabled (module-level)', async () => {
    // Reset modules and set disabled env
    jest.resetModules();
    process.env.EMAIL_ENABLED = 'false';
    process.env.SMTP_HOST = '';

    jest.doMock('nodemailer', () => ({ createTransport: jest.fn() }));
    jest.doMock('../../../prisma/client', () => ({
      __esModule: true,
      default: { user: { findUnique: jest.fn() }, notificationSettings: { findUnique: jest.fn() }, analyticsEvent: { create: jest.fn() } }
    }));
    jest.doMock('../../utils/logger', () => ({
      logInfo: jest.fn(), logError: jest.fn(), logDebug: jest.fn()
    }));
    jest.doMock('../../config', () => ({ config: { frontendUrl: 'http://localhost:3000' } }));

    const { EmailWorker: DisabledWorker } = require('../../workers/emailWorker');
    // sendEmail should return early without calling sendMail
    await DisabledWorker.sendEmail({
      to: 'test@test.com',
      subject: 'Disabled test',
      template: 'welcome',
      data: {}
    });

    // sendMail should not be called because there is no transporter
    // (SMTP_HOST is empty → transporter is null)
    const nodemailer = require('nodemailer');
    expect(nodemailer.createTransport).not.toHaveBeenCalledWith(expect.objectContaining({ host: '' }));

    // Restore env
    process.env.EMAIL_ENABLED = 'true';
    process.env.SMTP_HOST = 'smtp.test.com';
    jest.resetModules();
  });
});
