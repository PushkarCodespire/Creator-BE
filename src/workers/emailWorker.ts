// ===========================================
// EMAIL WORKER
// ===========================================
// Background job for sending emails
// Delegates to sendEmail() in utils/email.ts which handles Resend (prod)
// and nodemailer SMTP (local dev) transparently.

import { NotificationType } from '@prisma/client';
import prisma from '../../prisma/client';
import { config } from '../config';
import { sendEmail } from '../utils/email';
import { logInfo, logError, logDebug } from '../utils/logger';

interface EmailJob {
  to: string;
  subject: string;
  html: string;
  userId?: string;
  template?: string;
}

export class EmailWorker {
  static async sendEmail(job: EmailJob): Promise<void> {
    try {
      logInfo(`[EmailWorker] Sending email to ${job.to}: ${job.subject}`);
      const sent = await sendEmail({ to: job.to, subject: job.subject, html: job.html });

      if (sent && job.userId) {
        await prisma.analyticsEvent.create({
          data: {
            userId: job.userId,
            eventType: 'email',
            eventName: `sent_${job.template || 'generic'}`,
            properties: { to: job.to, subject: job.subject },
          },
        });
      }

      if (sent) {
        logInfo(`[EmailWorker] Email sent successfully to ${job.to}`);
      }
    } catch (error) {
      logError(error instanceof Error ? error : new Error(String(error)), {
        context: `[EmailWorker] Error sending email to ${job.to}`,
      });
      throw error;
    }
  }

  static async sendNotificationEmail(
    userId: string,
    type: NotificationType,
    data: Record<string, any>
  ): Promise<void> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, name: true },
    });
    if (!user) throw new Error(`User not found: ${userId}`);

    const notificationSettings = await prisma.notificationSettings.findUnique({ where: { userId } });
    if (!notificationSettings?.emailEnabled) {
      logDebug(`[EmailWorker] Email notifications disabled for user ${userId}`);
      return;
    }

    let subject: string;
    let html: string;

    switch (type) {
      case NotificationType.CHAT_MESSAGE:
        if (!notificationSettings.emailChat) return;
        subject = 'New Message from Creator';
        html = this.notificationTemplate(user.name, data.message || 'You have a new message.', data.actionUrl);
        break;
      case NotificationType.DEAL_ACCEPTED:
        if (!notificationSettings.emailDeals) return;
        subject = 'Your Deal Application was Accepted!';
        html = this.dealAcceptedTemplate(user.name, data.opportunityTitle, data.amount);
        break;
      case NotificationType.PAYOUT_COMPLETED:
        if (!notificationSettings.emailPayments) return;
        subject = 'Payout Completed Successfully';
        html = this.payoutTemplate(user.name, data.amount, data.utr);
        break;
      case NotificationType.CONTENT_PROCESSED:
        subject = 'Your Content Has Been Processed';
        html = this.contentProcessedTemplate(user.name, data.title, data.contentUrl);
        break;
      default:
        if (!notificationSettings.emailDeals) return;
        subject = 'New Notification';
        html = this.notificationTemplate(user.name, data.message || 'You have a new notification.', data.actionUrl);
    }

    await this.sendEmail({ to: user.email, subject, html, userId, template: type });
  }

  static async sendWelcomeEmail(userId: string): Promise<void> {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true, name: true } });
    if (!user) throw new Error(`User not found: ${userId}`);

    await this.sendEmail({
      to: user.email,
      subject: 'Welcome to Creator Platform!',
      html: this.welcomeTemplate(user.name),
      userId,
      template: 'welcome',
    });
  }

  static async sendPasswordResetEmail(email: string, token: string, name: string): Promise<void> {
    const resetUrl = `${config.frontendUrl}/reset-password?token=${token}`;
    await this.sendEmail({
      to: email,
      subject: 'Password Reset Request',
      html: this.passwordResetTemplate(name, resetUrl),
      template: 'password_reset',
    });
  }

  static async sendVerificationEmail(email: string, token: string, name: string, redirect?: string): Promise<void> {
    const redirectSuffix = redirect ? `&redirect=${encodeURIComponent(redirect)}` : '';
    const verifyUrl = `${config.frontendUrl}/verify-email?token=${token}${redirectSuffix}`;
    await this.sendEmail({
      to: email,
      subject: 'Verify Your Email Address',
      html: this.verificationTemplate(name, verifyUrl),
      template: 'verification',
    });
  }

  // ── Templates ──────────────────────────────────────────────────────────────

  private static wrap(content: string): string {
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Creator Platform</title></head>
<body style="font-family:Arial,sans-serif;line-height:1.6;color:#333;">
<div style="max-width:600px;margin:0 auto;padding:20px;">
${content}
<hr style="margin:30px 0;border:none;border-top:1px solid #eee;">
<p style="font-size:12px;color:#666;">This email was sent from Creator Platform. If you didn't request this, please ignore it.</p>
<p style="font-size:12px;color:#666;">&copy; ${new Date().getFullYear()} Creator Platform. All rights reserved.</p>
</div></body></html>`;
  }

  private static welcomeTemplate(name: string): string {
    return this.wrap(`<h1>Welcome to Creator Platform, ${name}!</h1>
<p>Thank you for joining our platform. You can now start connecting with creators and building your presence.</p>
<p><a href="${config.frontendUrl}">Get Started</a></p>`);
  }

  private static verificationTemplate(name: string, verifyUrl: string): string {
    return this.wrap(`<h1>Verify Your Email</h1>
<p>Hello ${name},</p>
<p>Please verify your email address by clicking the link below:</p>
<p><a href="${verifyUrl}" style="padding:12px 24px;background:#667eea;color:white;text-decoration:none;border-radius:5px;">Verify Email</a></p>
<p>Or copy this link: ${verifyUrl}</p>`);
  }

  private static passwordResetTemplate(name: string, resetUrl: string): string {
    return this.wrap(`<h1>Password Reset Request</h1>
<p>Hello ${name},</p>
<p>Click the link below to set a new password:</p>
<p><a href="${resetUrl}" style="padding:12px 24px;background:#667eea;color:white;text-decoration:none;border-radius:5px;">Reset Password</a></p>
<p>This link will expire in 1 hour. If you didn't request this, ignore this email.</p>`);
  }

  private static notificationTemplate(name: string, message: string, actionUrl?: string): string {
    return this.wrap(`<h1>New Notification</h1>
<p>Hello ${name},</p>
<p>${message}</p>
${actionUrl ? `<p><a href="${actionUrl}">View Details</a></p>` : ''}`);
  }

  private static payoutTemplate(name: string, amount: number, utr: string): string {
    return this.wrap(`<h1>Payout Completed</h1>
<p>Hello ${name},</p>
<p>Your payout of ₹${amount} has been processed successfully.</p>
<p>UTR: ${utr}</p>`);
  }

  private static dealAcceptedTemplate(name: string, title: string, amount: number): string {
    return this.wrap(`<h1>Deal Accepted!</h1>
<p>Hello ${name},</p>
<p>Your application for "${title}" has been accepted.</p>
<p>Amount: ₹${amount}</p>
<p><a href="${config.frontendUrl}/deals">View Deal Details</a></p>`);
  }

  private static contentProcessedTemplate(name: string, title: string, contentUrl?: string): string {
    return this.wrap(`<h1>Content Processed</h1>
<p>Hello ${name},</p>
<p>Your content "${title}" has been successfully processed and is now live.</p>
<p><a href="${contentUrl || config.frontendUrl}">View Content</a></p>`);
  }
}
