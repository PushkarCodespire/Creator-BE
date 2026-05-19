// ===========================================
// EMAIL SERVICE
// Priority: Brevo API → nodemailer SMTP (local dev)
// Set BREVO_API_KEY for production (no domain verification needed, just sender email)
// ===========================================

import 'dotenv/config';
import { logInfo, logError, logDebug } from './logger';

const BREVO_API_KEY = process.env.BREVO_API_KEY || '';
const SMTP_HOST = process.env.SMTP_HOST || '';
const SMTP_PORT = parseInt(process.env.SMTP_PORT || '587', 10);
const SMTP_USER = process.env.SMTP_USER || '';
const SMTP_PASS = process.env.SMTP_PASS || '';
const FROM_EMAIL = process.env.FROM_EMAIL || 'noreply@creatorplatform.com';
const FROM_NAME = process.env.FROM_NAME || 'Creator Platform';
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';

const FROM_HEADER = FROM_EMAIL.includes('<')
  ? FROM_EMAIL
  : `"${FROM_NAME}" <${FROM_EMAIL}>`;

interface EmailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

// ── Brevo / Sendinblue (HTTP API — no domain verification needed) ────────────
const sendViaBrevo = async (options: EmailOptions): Promise<boolean> => {
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'api-key': BREVO_API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      sender: { name: FROM_NAME, email: FROM_EMAIL },
      to: [{ email: options.to }],
      subject: options.subject,
      htmlContent: options.html,
      ...(options.text ? { textContent: options.text } : {}),
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Brevo API error ${res.status}: ${body}`);
  }
  const data = await res.json() as { messageId?: string };
  logDebug('Brevo email sent', { to: options.to, subject: options.subject, messageId: data.messageId });
  return true;
};

// ── nodemailer SMTP (local dev fallback) ────────────────────────────────────
let _transporter: import('nodemailer').Transporter | null = null;
const getTransporter = async () => {
  if (_transporter) return _transporter;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) return null;
  const nodemailer = await import('nodemailer');
  _transporter = nodemailer.default.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_PORT === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
  return _transporter;
};

const sendViaSMTP = async (options: EmailOptions): Promise<boolean> => {
  const transporter = await getTransporter();
  if (!transporter) return false;
  const info = await transporter.sendMail({
    from: FROM_HEADER,
    to: options.to,
    subject: options.subject,
    html: options.html,
    text: options.text || '',
  });
  logDebug('SMTP email sent', { to: options.to, subject: options.subject, messageId: info.messageId });
  return true;
};

/**
 * Send email. Uses Brevo API when BREVO_API_KEY is set (production),
 * falls back to nodemailer SMTP for local dev.
 */
export const sendEmail = async (options: EmailOptions): Promise<boolean> => {
  if (process.env.EMAIL_ENABLED === 'false') {
    logInfo(`Email skipped (disabled): ${options.subject} to ${options.to}`);
    return false;
  }

  try {
    if (BREVO_API_KEY) {
      await sendViaBrevo(options);
      logInfo(`Email sent (Brevo): ${options.subject} to ${options.to}`);
      return true;
    }
    const sent = await sendViaSMTP(options);
    if (sent) {
      logInfo(`Email sent (SMTP): ${options.subject} to ${options.to}`);
      return true;
    }
    logInfo(`Email skipped (not configured): ${options.subject} to ${options.to}`);
    return false;
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    logError(new Error(msg), { context: 'Email send failed' });
    return false;
  }
};

// ===========================================
// EMAIL TEMPLATES
// ===========================================

/**
 * Welcome email for new users
 */
export const welcomeEmail = (name: string, role: string) => ({
  subject: 'Welcome to AI Creator Platform! 🎉',
  html: `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
        .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
        .button { display: inline-block; padding: 12px 30px; background: #667eea; color: white; text-decoration: none; border-radius: 5px; margin-top: 20px; }
        .footer { text-align: center; margin-top: 30px; color: #888; font-size: 12px; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>Welcome to AI Creator Platform!</h1>
        </div>
        <div class="content">
          <p>Hi ${name},</p>
          <p>Welcome aboard! We're excited to have you join our community as a <strong>${role}</strong>.</p>

          ${role === 'CREATOR' ? `
            <p>🎨 <strong>Getting Started as a Creator:</strong></p>
            <ul>
              <li>Complete your profile to attract more users</li>
              <li>Add training content (YouTube videos, text, FAQs)</li>
              <li>Train your AI clone to respond like you</li>
              <li>Start chatting with your audience!</li>
            </ul>
          ` : role === 'COMPANY' ? `
            <p>🏢 <strong>Getting Started as a Company:</strong></p>
            <ul>
              <li>Complete your company profile</li>
              <li>Browse our creator gallery</li>
              <li>Post collaboration opportunities</li>
              <li>Connect with top creators!</li>
            </ul>
          ` : `
            <p>💬 <strong>Getting Started:</strong></p>
            <ul>
              <li>Browse our creator gallery</li>
              <li>Start chatting with AI creators</li>
              <li>Upgrade to Premium for unlimited chats</li>
            </ul>
          `}

          <a href="${FRONTEND_URL}" class="button">Get Started Now</a>
        </div>
        <div class="footer">
          <p>© 2025 AI Creator Platform. All rights reserved.</p>
        </div>
      </div>
    </body>
    </html>
  `,
  text: `Welcome to AI Creator Platform, ${name}! Start exploring at ${FRONTEND_URL}`
});

/**
 * Payment receipt email
 */
export const paymentReceiptEmail = (name: string, amount: number, transactionId: string, plan: string) => ({
  subject: 'Payment Receipt - AI Creator Platform',
  html: `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: #4caf50; color: white; padding: 20px; text-align: center; border-radius: 10px 10px 0 0; }
        .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
        .receipt-box { background: white; padding: 20px; border-radius: 5px; margin: 20px 0; }
        .receipt-row { display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid #eee; }
        .receipt-row:last-child { border-bottom: none; font-weight: bold; font-size: 18px; }
        .footer { text-align: center; margin-top: 30px; color: #888; font-size: 12px; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>✅ Payment Successful!</h1>
        </div>
        <div class="content">
          <p>Hi ${name},</p>
          <p>Thank you for your payment! Your <strong>${plan}</strong> subscription is now active.</p>

          <div class="receipt-box">
            <h3>Payment Receipt</h3>
            <div class="receipt-row">
              <span>Subscription Plan:</span>
              <span>${plan}</span>
            </div>
            <div class="receipt-row">
              <span>Amount Paid:</span>
              <span>₹${amount.toFixed(2)}</span>
            </div>
            <div class="receipt-row">
              <span>Transaction ID:</span>
              <span>${transactionId}</span>
            </div>
            <div class="receipt-row">
              <span>Date:</span>
              <span>${new Date().toLocaleDateString()}</span>
            </div>
          </div>

          <p><strong>What's Next?</strong></p>
          <p>Start enjoying unlimited chats with all creators on our platform!</p>

          <p style="margin-top: 30px; font-size: 12px; color: #888;">
            Keep this receipt for your records. If you have any questions, please contact our support team.
          </p>
        </div>
        <div class="footer">
          <p>© 2025 AI Creator Platform. All rights reserved.</p>
        </div>
      </div>
    </body>
    </html>
  `,
  text: `Payment Receipt: ₹${amount} for ${plan} subscription. Transaction ID: ${transactionId}`
});

/**
 * New message notification email
 */
export const newMessageEmail = (userName: string, creatorName: string, messagePreview: string, conversationId: string) => ({
  subject: `New message from ${creatorName}`,
  html: `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: #667eea; color: white; padding: 20px; text-align: center; border-radius: 10px 10px 0 0; }
        .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
        .message-box { background: white; padding: 20px; border-left: 4px solid #667eea; margin: 20px 0; border-radius: 5px; }
        .button { display: inline-block; padding: 12px 30px; background: #667eea; color: white; text-decoration: none; border-radius: 5px; margin-top: 20px; }
        .footer { text-align: center; margin-top: 30px; color: #888; font-size: 12px; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h2>💬 New Message!</h2>
        </div>
        <div class="content">
          <p>Hi ${userName},</p>
          <p>You have a new message from <strong>${creatorName}</strong>:</p>

          <div class="message-box">
            <p><em>"${messagePreview.substring(0, 150)}${messagePreview.length > 150 ? '...' : ''}"</em></p>
          </div>

          <a href="${FRONTEND_URL}/chat/${conversationId}" class="button">View Message</a>

          <p style="margin-top: 30px; font-size: 12px; color: #888;">
            You're receiving this because you have notifications enabled. <a href="${FRONTEND_URL}/settings">Manage preferences</a>
          </p>
        </div>
        <div class="footer">
          <p>© 2025 AI Creator Platform. All rights reserved.</p>
        </div>
      </div>
    </body>
    </html>
  `,
  text: `New message from ${creatorName}: ${messagePreview.substring(0, 100)}... Reply at ${FRONTEND_URL}/chat/${conversationId}`
});

/**
 * New opportunity notification for creators
 */
export const opportunityNotificationEmail = (creatorName: string, opportunityTitle: string, companyName: string, opportunityId: string) => ({
  subject: `New Opportunity: ${opportunityTitle}`,
  html: `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: #ff6b6b; color: white; padding: 20px; text-align: center; border-radius: 10px 10px 0 0; }
        .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
        .opportunity-box { background: white; padding: 20px; border-radius: 5px; margin: 20px 0; border: 2px solid #ff6b6b; }
        .button { display: inline-block; padding: 12px 30px; background: #ff6b6b; color: white; text-decoration: none; border-radius: 5px; margin-top: 20px; }
        .footer { text-align: center; margin-top: 30px; color: #888; font-size: 12px; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h2>🎯 New Opportunity!</h2>
        </div>
        <div class="content">
          <p>Hi ${creatorName},</p>
          <p>A new collaboration opportunity has been posted that might interest you:</p>

          <div class="opportunity-box">
            <h3>${opportunityTitle}</h3>
            <p><strong>Company:</strong> ${companyName}</p>
            <p>This could be a great opportunity for you to collaborate and grow your brand!</p>
          </div>

          <a href="${FRONTEND_URL}/creator/opportunities?id=${opportunityId}" class="button">View Details & Apply</a>
        </div>
        <div class="footer">
          <p>© 2025 AI Creator Platform. All rights reserved.</p>
        </div>
      </div>
    </body>
    </html>
  `,
  text: `New opportunity: ${opportunityTitle} from ${companyName}. View at ${FRONTEND_URL}/creator/opportunities?id=${opportunityId}`
});

/**
 * Application status update email
 */
export const applicationStatusEmail = (creatorName: string, opportunityTitle: string, status: 'ACCEPTED' | 'REJECTED') => ({
  subject: `Application ${status === 'ACCEPTED' ? 'Accepted' : 'Update'}: ${opportunityTitle}`,
  html: `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: ${status === 'ACCEPTED' ? '#4caf50' : '#ff9800'}; color: white; padding: 20px; text-align: center; border-radius: 10px 10px 0 0; }
        .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
        .status-box { background: white; padding: 20px; border-radius: 5px; margin: 20px 0; text-align: center; }
        .button { display: inline-block; padding: 12px 30px; background: #667eea; color: white; text-decoration: none; border-radius: 5px; margin-top: 20px; }
        .footer { text-align: center; margin-top: 30px; color: #888; font-size: 12px; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h2>${status === 'ACCEPTED' ? '🎉 Congratulations!' : '📋 Application Update'}</h2>
        </div>
        <div class="content">
          <p>Hi ${creatorName},</p>

          ${status === 'ACCEPTED' ? `
            <div class="status-box">
              <h3 style="color: #4caf50;">Your application has been accepted!</h3>
              <p><strong>${opportunityTitle}</strong></p>
            </div>
            <p>Great news! The company has accepted your application. You can now proceed with the collaboration.</p>
            <a href="${FRONTEND_URL}/creator/deals" class="button">View Deal Details</a>
          ` : `
            <div class="status-box">
              <h3 style="color: #ff9800;">Application Status Update</h3>
              <p><strong>${opportunityTitle}</strong></p>
            </div>
            <p>Thank you for your interest. Unfortunately, the company has decided to move forward with other candidates at this time.</p>
            <p>Don't be discouraged! Keep applying to opportunities that match your skills.</p>
            <a href="${FRONTEND_URL}/creator/opportunities" class="button">Browse More Opportunities</a>
          `}
        </div>
        <div class="footer">
          <p>© 2025 AI Creator Platform. All rights reserved.</p>
        </div>
      </div>
    </body>
    </html>
  `,
  text: `Your application for ${opportunityTitle} has been ${status.toLowerCase()}.`
});

/**
 * Email verification email
 */
export const emailVerificationEmail = (name: string, verifyUrl: string) => ({
  subject: 'Verify Your Email - AI Creator Platform',
  html: `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
        .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
        .button { display: inline-block; padding: 15px 40px; background: #667eea; color: white; text-decoration: none; border-radius: 5px; margin: 20px 0; font-weight: bold; }
        .footer { text-align: center; margin-top: 30px; color: #888; font-size: 12px; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>✉️ Verify Your Email</h1>
        </div>
        <div class="content">
          <p>Hi ${name},</p>
          <p>Thank you for signing up! Please verify your email address to activate your account and start exploring our platform.</p>

          <div style="text-align: center;">
            <a href="${verifyUrl}" class="button">Verify Email Address</a>
          </div>

          <p style="margin-top: 30px; font-size: 12px; color: #888;">
            This link will expire in 24 hours. If you didn't create an account, please ignore this email.
          </p>

          <p style="margin-top: 20px; font-size: 12px; color: #888;">
            Or copy and paste this URL into your browser:<br/>
            <a href="${verifyUrl}">${verifyUrl}</a>
          </p>
        </div>
        <div class="footer">
          <p>© 2025 AI Creator Platform. All rights reserved.</p>
        </div>
      </div>
    </body>
    </html>
  `,
  text: `Verify your email address: ${verifyUrl}. This link will expire in 24 hours.`
});

/**
 * Password reset email
 */
export const passwordResetEmail = (name: string, resetUrl: string) => ({
  subject: 'Reset Your Password - AI Creator Platform',
  html: `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: #ff6b6b; color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
        .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
        .button { display: inline-block; padding: 15px 40px; background: #ff6b6b; color: white; text-decoration: none; border-radius: 5px; margin: 20px 0; font-weight: bold; }
        .warning-box { background: #fff3cd; border-left: 4px solid #ff6b6b; padding: 15px; margin: 20px 0; border-radius: 5px; }
        .footer { text-align: center; margin-top: 30px; color: #888; font-size: 12px; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>🔐 Reset Your Password</h1>
        </div>
        <div class="content">
          <p>Hi ${name},</p>
          <p>You requested to reset your password. Click the button below to create a new password:</p>

          <div style="text-align: center;">
            <a href="${resetUrl}" class="button">Reset Password</a>
          </div>

          <div class="warning-box">
            <strong>⚠️ Security Notice:</strong> If you didn't request this password reset, please ignore this email. Your password will remain unchanged.
          </div>

          <p style="margin-top: 20px; font-size: 12px; color: #888;">
            This link will expire in 1 hour for security reasons.
          </p>

          <p style="margin-top: 10px; font-size: 12px; color: #888;">
            Or copy and paste this URL into your browser:<br/>
            <a href="${resetUrl}">${resetUrl}</a>
          </p>
        </div>
        <div class="footer">
          <p>© 2025 AI Creator Platform. All rights reserved.</p>
        </div>
      </div>
    </body>
    </html>
  `,
  text: `Reset your password: ${resetUrl}. This link will expire in 1 hour. If you didn't request this, please ignore this email.`
});

/**
 * Password changed confirmation email
 */
export const passwordChangedEmail = (name: string) => ({
  subject: 'Password Changed - AI Creator Platform',
  html: `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: #4caf50; color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
        .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
        .success-box { background: white; border-left: 4px solid #4caf50; padding: 20px; margin: 20px 0; border-radius: 5px; }
        .warning-box { background: #fff3cd; border-left: 4px solid #ff9800; padding: 15px; margin: 20px 0; border-radius: 5px; }
        .button { display: inline-block; padding: 12px 30px; background: #667eea; color: white; text-decoration: none; border-radius: 5px; margin-top: 20px; }
        .footer { text-align: center; margin-top: 30px; color: #888; font-size: 12px; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>✅ Password Changed</h1>
        </div>
        <div class="content">
          <p>Hi ${name},</p>

          <div class="success-box">
            <p><strong>Your password has been successfully changed.</strong></p>
            <p>Date: ${new Date().toLocaleString()}</p>
          </div>

          <p>You can now use your new password to log in to your account.</p>

          <div class="warning-box">
            <strong>⚠️ Did you make this change?</strong><br/>
            If you didn't change your password, please contact our support team immediately. Your account security may be compromised.
          </div>

          <div style="text-align: center;">
            <a href="${FRONTEND_URL}/login" class="button">Log In Now</a>
          </div>
        </div>
        <div class="footer">
          <p>© 2025 AI Creator Platform. All rights reserved.</p>
        </div>
      </div>
    </body>
    </html>
  `,
  text: `Your password has been changed successfully. If this wasn't you, please contact support immediately.`
});

/**
 * Booking request notification email (sent to creator)
 */
export const bookingRequestEmail = (
  creatorName: string,
  userName: string,
  slotDate: string,
  slotTime: string,
  slotType: string,
  userMessage: string,
) => ({
  subject: `New booking request from ${userName}`,
  html: `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 20px; text-align: center; border-radius: 10px 10px 0 0; }
        .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
        .info-box { background: white; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #667eea; }
        .info-row { display: flex; padding: 8px 0; border-bottom: 1px solid #eee; }
        .info-row:last-child { border-bottom: none; }
        .info-label { font-weight: bold; width: 120px; color: #555; flex-shrink: 0; }
        .message-box { background: white; padding: 15px 20px; border-radius: 8px; margin: 20px 0; font-style: italic; color: #555; border: 1px solid #e0e0e0; }
        .button { display: inline-block; padding: 12px 30px; background: #667eea; color: white; text-decoration: none; border-radius: 5px; margin-top: 20px; font-weight: bold; }
        .footer { text-align: center; margin-top: 30px; color: #888; font-size: 12px; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h2>📅 New Booking Request</h2>
        </div>
        <div class="content">
          <p>Hi ${creatorName},</p>
          <p><strong>${userName}</strong> has requested a booking with you.</p>

          <div class="info-box">
            <div class="info-row">
              <span class="info-label">From</span>
              <span>${userName}</span>
            </div>
            <div class="info-row">
              <span class="info-label">Date</span>
              <span>${slotDate}</span>
            </div>
            <div class="info-row">
              <span class="info-label">Time</span>
              <span>${slotTime}</span>
            </div>
            <div class="info-row">
              <span class="info-label">Type</span>
              <span style="text-transform: capitalize;">${slotType}</span>
            </div>
          </div>

          ${userMessage ? `
          <p><strong>Message from ${userName}:</strong></p>
          <div class="message-box">"${userMessage}"</div>
          ` : ''}

          <div style="text-align: center;">
            <a href="${FRONTEND_URL}/creator-dashboard/content" class="button">Review Request</a>
          </div>

          <p style="margin-top: 20px; font-size: 12px; color: #888;">
            Log in to your dashboard to accept or decline this request.
          </p>
        </div>
        <div class="footer">
          <p>© 2025 AI Creator Platform. All rights reserved.</p>
        </div>
      </div>
    </body>
    </html>
  `,
  text: `New booking request from ${userName} for ${slotDate} at ${slotTime} (${slotType}).${userMessage ? ` Message: "${userMessage}"` : ''} Review at ${FRONTEND_URL}/creator-dashboard/content`,
});

/**
 * Booking confirmed notification email (sent to user)
 */
export const bookingConfirmedEmail = (
  userName: string,
  creatorName: string,
  slotDate: string,
  slotTime: string,
  meetingLink: string | null,
  creatorId: string,
) => ({
  subject: `Your booking with ${creatorName} is confirmed!`,
  html: `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: #4caf50; color: white; padding: 20px; text-align: center; border-radius: 10px 10px 0 0; }
        .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
        .info-box { background: white; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #4caf50; }
        .info-row { display: flex; padding: 8px 0; border-bottom: 1px solid #eee; }
        .info-row:last-child { border-bottom: none; }
        .info-label { font-weight: bold; width: 140px; color: #555; flex-shrink: 0; }
        .link-box { background: #e8f5e9; padding: 15px 20px; border-radius: 8px; margin: 20px 0; text-align: center; }
        .button { display: inline-block; padding: 12px 30px; background: #4caf50; color: white; text-decoration: none; border-radius: 5px; margin-top: 20px; font-weight: bold; }
        .footer { text-align: center; margin-top: 30px; color: #888; font-size: 12px; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h2>🎉 Booking Confirmed!</h2>
        </div>
        <div class="content">
          <p>Hi ${userName},</p>
          <p>Great news! <strong>${creatorName}</strong> has confirmed your booking.</p>

          <div class="info-box">
            <div class="info-row">
              <span class="info-label">Creator</span>
              <span>${creatorName}</span>
            </div>
            <div class="info-row">
              <span class="info-label">Date</span>
              <span>${slotDate}</span>
            </div>
            <div class="info-row">
              <span class="info-label">Time</span>
              <span>${slotTime}</span>
            </div>
            ${meetingLink ? `
            <div class="info-row">
              <span class="info-label">Meeting Link</span>
              <span><a href="${meetingLink}" style="color: #4caf50;">${meetingLink}</a></span>
            </div>
            ` : ''}
          </div>

          ${meetingLink ? `
          <div class="link-box">
            <p style="margin: 0 0 10px;"><strong>Your meeting link is ready:</strong></p>
            <a href="${meetingLink}" class="button">Join Meeting</a>
          </div>
          ` : `
          <p style="color: #888; font-size: 14px;">The meeting link will be added by the creator before your session.</p>
          <div style="text-align: center;">
            <a href="${FRONTEND_URL}/creator/${creatorId}?tab=bookings" class="button">View My Bookings</a>
          </div>
          `}
        </div>
        <div class="footer">
          <p>© 2025 AI Creator Platform. All rights reserved.</p>
        </div>
      </div>
    </body>
    </html>
  `,
  text: `Your booking with ${creatorName} is confirmed for ${slotDate} at ${slotTime}.${meetingLink ? ` Meeting link: ${meetingLink}` : ' The creator will add a meeting link before your session.'}`,
});

/**
 * Creator verification approved email
 */
export const creatorVerificationEmail = (creatorName: string, verified: boolean) => ({
  subject: verified ? 'Creator Profile Verified! ✅' : 'Creator Profile Verification Update',
  html: `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: ${verified ? '#4caf50' : '#ff9800'}; color: white; padding: 20px; text-align: center; border-radius: 10px 10px 0 0; }
        .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
        .badge { background: white; padding: 30px; border-radius: 5px; margin: 20px 0; text-align: center; }
        .button { display: inline-block; padding: 12px 30px; background: #667eea; color: white; text-decoration: none; border-radius: 5px; margin-top: 20px; }
        .footer { text-align: center; margin-top: 30px; color: #888; font-size: 12px; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>${verified ? '🎉 Congratulations!' : '📋 Profile Update'}</h1>
        </div>
        <div class="content">
          <p>Hi ${creatorName},</p>

          ${verified ? `
            <div class="badge">
              <h2 style="color: #4caf50;">✅ Your Creator Profile is Verified!</h2>
              <p>You now have the verified badge on your profile.</p>
            </div>

            <p><strong>What this means:</strong></p>
            <ul>
              <li>✨ Stand out with the verified badge</li>
              <li>📈 Increased visibility in search</li>
              <li>🤝 Higher trust from users and companies</li>
              <li>💼 Access to premium collaboration opportunities</li>
            </ul>

            <a href="${FRONTEND_URL}/creator/dashboard" class="button">View Your Dashboard</a>
          ` : `
            <p>Thank you for submitting your creator profile for verification.</p>
            <p>We need a bit more information before we can verify your profile. Please ensure:</p>
            <ul>
              <li>Complete profile information</li>
              <li>Training content added</li>
              <li>Valid social media links</li>
            </ul>
            <a href="${FRONTEND_URL}/creator/profile" class="button">Update Profile</a>
          `}
        </div>
        <div class="footer">
          <p>© 2025 AI Creator Platform. All rights reserved.</p>
        </div>
      </div>
    </body>
    </html>
  `,
  text: verified
    ? `Congratulations ${creatorName}! Your creator profile is now verified.`
    : `Your creator profile verification needs additional information.`
});
