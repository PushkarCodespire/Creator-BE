import { Router, Request, Response } from 'express';
import prisma from '../../prisma/client';
import { asyncHandler, AppError } from '../middleware/errorHandler';
import { sendEmail } from '../utils/email';

const router = Router();

// Subscribe to newsletter
router.post('/subscribe', asyncHandler(async (req: Request, res: Response) => {
  const { email } = req.body;
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new AppError('Valid email is required', 400);
  }

  // Check if already subscribed
  const existing = await prisma.newsletterSubscriber.findUnique({ where: { email } });
  if (existing) {
    if (existing.isActive) {
      return res.json({ success: true, message: 'Already subscribed!' });
    }
    // Re-activate
    await prisma.newsletterSubscriber.update({ where: { email }, data: { isActive: true } });
    return res.json({ success: true, message: 'Welcome back! You\'re subscribed again.' });
  }

  await prisma.newsletterSubscriber.create({ data: { email } });

  // Send welcome email
  await sendEmail({
    to: email,
    subject: 'Welcome to CreatorPal Newsletter!',
    html: `
      <div style="font-family: -apple-system, sans-serif; max-width: 500px; margin: 0 auto; padding: 32px;">
        <h1 style="font-size: 24px; color: #111827;">Welcome to CreatorPal!</h1>
        <p style="font-size: 15px; color: #6b7280; line-height: 1.6;">
          You're now subscribed to our weekly newsletter. We'll send you the best creator insights, tips, and exclusive deals.
        </p>
        <p style="font-size: 13px; color: #9ca3af; margin-top: 24px;">
          If you didn't subscribe, you can ignore this email.
        </p>
      </div>
    `,
    text: 'Welcome to CreatorPal newsletter! You\'ll receive weekly creator insights and deals.',
  }).catch(() => {});

  res.status(201).json({ success: true, message: 'Subscribed successfully!' });
}));

export default router;
