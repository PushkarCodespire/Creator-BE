import { Router, Request, Response } from 'express';
import { authenticate, optionalAuth } from '../middleware/auth';
import prisma from '../../prisma/client';
import { asyncHandler, AppError } from '../middleware/errorHandler';
import * as notificationService from '../services/notification.service';
import { sendEmail, bookingRequestEmail, bookingConfirmedEmail } from '../utils/email';
import { sanitizeMessage } from '../utils/profanity';

const router = Router();

// ========================
// PUBLIC ENDPOINT (no auth)
// ========================

// GET available booking slots for a creator (public, with optional auth to flag user's own bookings)
router.get('/public/:creatorId', optionalAuth, asyncHandler(async (req: Request, res: Response) => {
  const creatorId = req.params.creatorId as string;
  const currentUserId = req.user?.id;

  const slots = await prisma.bookingSlot.findMany({
    where: {
      creatorId,
      endTime: { gt: new Date() }, // Slots that haven't ended yet
      // isAvailable filter removed — booked slots are returned too
      // so the public view can show them as "Booked" (frontend handles this via isAvailable === false)
    },
    select: {
      id: true,
      title: true,
      isAvailable: true,
      startTime: true,
      endTime: true,
      price: true,
      type: true,
    },
    orderBy: { startTime: 'asc' },
  });

  // If user is authenticated, check accepted bookings (for meeting links) and pending requests
  let userBookings: Record<string, string | null> = {};
  let userPendingSlotIds = new Set<string>();
  if (currentUserId && slots.length > 0) {
    const slotIds = slots.map(s => s.id);
    const [myAcceptedRequests, myPendingRequests] = await Promise.all([
      prisma.bookingRequest.findMany({
        where: { userId: currentUserId, status: 'ACCEPTED', slotId: { in: slotIds } },
        select: { slotId: true, meetingLink: true },
      }),
      prisma.bookingRequest.findMany({
        where: { userId: currentUserId, status: 'PENDING', slotId: { in: slotIds } },
        select: { slotId: true },
      }),
    ]);
    userBookings = Object.fromEntries(
      myAcceptedRequests.map(r => [r.slotId, r.meetingLink])
    );
    userPendingSlotIds = new Set(myPendingRequests.map(r => r.slotId));
  }

  const slotsWithBookingInfo = slots.map(s => ({
    ...s,
    bookedByMe: Object.prototype.hasOwnProperty.call(userBookings, s.id),
    meetingLink: userBookings[s.id] || null,
    requestedByMe: userPendingSlotIds.has(s.id),
  }));

  res.json({ success: true, data: slotsWithBookingInfo });
}));

// ========================
// AUTHENTICATED ENDPOINTS
// ========================

// GET creator's booking slots
router.get('/slots', authenticate, asyncHandler(async (req: Request, res: Response) => {
  const creator = await prisma.creator.findUnique({ where: { userId: req.user!.id } });
  if (!creator) throw new AppError('Creator profile not found', 404);

  const slots = await prisma.bookingSlot.findMany({
    where: { creatorId: creator.id },
    include: { bookings: { include: { user: { select: { id: true, name: true, email: true, avatar: true } } } } },
    orderBy: { startTime: 'asc' },
  });

  res.json({ success: true, data: slots });
}));

// CREATE booking slot
router.post('/slots', authenticate, asyncHandler(async (req: Request, res: Response) => {
  const creator = await prisma.creator.findUnique({ where: { userId: req.user!.id } });
  if (!creator) throw new AppError('Creator profile not found', 404);

  const { title, startTime, endTime, price, type } = req.body;
  if (!startTime || !endTime) throw new AppError('Start and end time required', 400);

  // Check for overlapping slot
  const start = new Date(startTime);
  const end = new Date(endTime);
  const existing = await prisma.bookingSlot.findFirst({
    where: {
      creatorId: creator.id,
      OR: [
        { startTime: { lt: end }, endTime: { gt: start } },
      ],
    },
  });
  if (existing) throw new AppError('Slot already exists', 400);

  const slot = await prisma.bookingSlot.create({
    data: {
      creatorId: creator.id,
      title: title || 'Available',
      startTime: new Date(startTime),
      endTime: new Date(endTime),
      price: price || 0,
      type: type || 'consultation',
    },
  });

  res.status(201).json({ success: true, data: slot });
}));

// DELETE booking slot
router.delete('/slots/:id', authenticate, asyncHandler(async (req: Request, res: Response) => {
  const creator = await prisma.creator.findUnique({ where: { userId: req.user!.id } });
  if (!creator) throw new AppError('Creator profile not found', 404);

  await prisma.bookingSlot.deleteMany({ where: { id: req.params.id as string, creatorId: creator.id } });
  res.json({ success: true, message: 'Slot deleted' });
}));

// GET booking requests for creator
router.get('/requests', authenticate, asyncHandler(async (req: Request, res: Response) => {
  const creator = await prisma.creator.findUnique({ where: { userId: req.user!.id } });
  if (!creator) throw new AppError('Creator profile not found', 404);

  const requests = await prisma.bookingRequest.findMany({
    where: { slot: { creatorId: creator.id } },
    include: {
      user: { select: { id: true, name: true, email: true, avatar: true } },
      slot: true,
    },
    orderBy: { createdAt: 'desc' },
  });

  res.json({ success: true, data: requests });
}));

// USER requests a booking
router.post('/request', authenticate, asyncHandler(async (req: Request, res: Response) => {
  const { slotId, message, type } = req.body;
  if (!slotId) throw new AppError('Slot ID required', 400);

  const slot = await prisma.bookingSlot.findUnique({
    where: { id: slotId },
    include: { creator: { select: { userId: true, displayName: true } } },
  });
  if (!slot || !slot.isAvailable) throw new AppError('Slot not available', 400);

  const cleanMessage = message ? sanitizeMessage(message) : '';

  const booking = await prisma.bookingRequest.create({
    data: {
      slotId,
      userId: req.user!.id,
      message: cleanMessage,
      type: type || 'consultation',
    },
  });

  const user = await prisma.user.findUnique({ where: { id: req.user!.id }, select: { name: true, email: true } });
  const slotDate = new Date(slot.startTime).toLocaleDateString('en-IN', { weekday: 'short', month: 'short', day: 'numeric' });
  const slotTime = new Date(slot.startTime).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });

  // Email creator about the new request
  if (slot.creator?.userId) {
    const creatorUser = await prisma.user.findUnique({ where: { id: slot.creator.userId }, select: { email: true } });
    if (creatorUser?.email) {
      const tpl = bookingRequestEmail(
        slot.creator.displayName || 'Creator',
        user?.name || 'A user',
        slotDate,
        slotTime,
        slot.type || 'consultation',
        cleanMessage,
      );
      sendEmail({ to: creatorUser.email, ...tpl }).catch(() => {});
    }
  }

  // In-app notifications for creator and user
  const io = req.app.get('io');
  if (io) {
    if (slot.creator?.userId) {
      await notificationService.createAndEmit(io, {
        userId: slot.creator.userId,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        type: 'BOOKING_REQUEST' as any,
        title: 'New booking request',
        message: `${user?.name || 'A user'} requested a meeting on ${slotDate} at ${slotTime}`,
        actionUrl: '/creator-dashboard/bookings',
        data: { bookingId: booking.id, slotId, userId: req.user!.id },
      }).catch(() => {});
    }
    // Confirm to the user that their request was sent
    await notificationService.createAndEmit(io, {
      userId: req.user!.id,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      type: 'BOOKING_REQUEST' as any,
      title: 'Booking request sent',
      message: `Your meeting request for ${slotDate} at ${slotTime} has been sent. You'll be notified once the creator responds.`,
      actionUrl: '/user/profile',
      data: { bookingId: booking.id, slotId },
    }).catch(() => {});
  }

  res.status(201).json({ success: true, data: booking });
}));

// ACCEPT booking request
router.post('/requests/:id/accept', authenticate, asyncHandler(async (req: Request, res: Response) => {
  const requestId = req.params.id as string;
  const { meetingLink } = req.body as { meetingLink?: string };

  // Validate meeting link if provided
  let validatedLink: string | null = null;
  if (meetingLink && typeof meetingLink === 'string' && meetingLink.trim().length > 0) {
    const trimmed = meetingLink.trim();
    try {
      const url = new URL(trimmed);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        throw new AppError('Meeting link must be http:// or https:// URL', 400);
      }
      validatedLink = trimmed;
    } catch {
      throw new AppError('Invalid meeting link URL', 400);
    }
  }

  const request = await prisma.bookingRequest.findUnique({
    where: { id: requestId },
    include: { slot: { include: { creator: { select: { displayName: true } } } } },
  });
  if (!request) throw new AppError('Request not found', 404);

  const creator = await prisma.creator.findUnique({ where: { userId: req.user!.id } });
  if (!creator || request.slot.creatorId !== creator.id) throw new AppError('Not authorized', 403);

  const updated = await prisma.bookingRequest.update({
    where: { id: requestId },
    data: {
      status: 'ACCEPTED',
      ...(validatedLink !== null ? { meetingLink: validatedLink } : {}),
    },
  });

  // Mark slot as unavailable
  await prisma.bookingSlot.update({ where: { id: request.slotId }, data: { isAvailable: false } });

  // Email user that their booking is confirmed
  const bookingUser = await prisma.user.findUnique({ where: { id: request.userId }, select: { name: true, email: true } });
  if (bookingUser?.email) {
    const confirmedSlotDate = new Date(request.slot.startTime).toLocaleDateString('en-IN', { weekday: 'short', month: 'short', day: 'numeric' });
    const confirmedSlotTime = new Date(request.slot.startTime).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
    const tpl = bookingConfirmedEmail(
      bookingUser.name || 'there',
      request.slot.creator?.displayName || 'The creator',
      confirmedSlotDate,
      confirmedSlotTime,
      validatedLink,
      request.slot.creatorId,
    );
    sendEmail({ to: bookingUser.email, ...tpl }).catch(() => {});
  }

  // Notify fan that booking was confirmed
  const io = req.app.get('io');
  if (io) {
    await notificationService.createAndEmit(io, {
      userId: request.userId,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      type: 'BOOKING_CONFIRMED' as any,
      title: 'Booking confirmed!',
      message: `${request.slot.creator?.displayName || 'The creator'} confirmed your meeting on ${new Date(request.slot.startTime).toLocaleDateString('en-IN', { weekday: 'short', month: 'short', day: 'numeric' })} at ${new Date(request.slot.startTime).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}${validatedLink ? ' — meeting link attached' : ''}`,
      actionUrl: validatedLink || '/dashboard',
      data: { bookingId: request.id, slotId: request.slotId, meetingLink: validatedLink },
    }).catch(() => {});
  }

  res.json({ success: true, data: updated });
}));

// UPDATE meeting link on an accepted booking request (creator only)
router.patch('/requests/:id/meeting-link', authenticate, asyncHandler(async (req: Request, res: Response) => {
  const requestId = req.params.id as string;
  const { meetingLink } = req.body as { meetingLink?: string | null };

  // Validate (empty string or null clears the link)
  let validatedLink: string | null = null;
  if (meetingLink && typeof meetingLink === 'string' && meetingLink.trim().length > 0) {
    const trimmed = meetingLink.trim();
    try {
      const url = new URL(trimmed);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        throw new AppError('Meeting link must be http:// or https:// URL', 400);
      }
      validatedLink = trimmed;
    } catch {
      throw new AppError('Invalid meeting link URL', 400);
    }
  }

  const request = await prisma.bookingRequest.findUnique({
    where: { id: requestId },
    include: { slot: { include: { creator: { select: { displayName: true } } } } },
  });
  if (!request) throw new AppError('Request not found', 404);

  const creator = await prisma.creator.findUnique({ where: { userId: req.user!.id } });
  if (!creator || request.slot.creatorId !== creator.id) throw new AppError('Not authorized', 403);
  if (request.status !== 'ACCEPTED') throw new AppError('Can only set meeting link on accepted bookings', 400);

  const updated = await prisma.bookingRequest.update({
    where: { id: requestId },
    data: { meetingLink: validatedLink },
  });

  // Notify fan about the updated link
  if (validatedLink) {
    const io = req.app.get('io');
    if (io) {
      await notificationService.createAndEmit(io, {
        userId: request.userId,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        type: 'BOOKING_CONFIRMED' as any,
        title: 'Meeting link available',
        message: `${request.slot.creator?.displayName || 'The creator'} added a meeting link for your booking`,
        actionUrl: validatedLink,
        data: { bookingId: request.id, slotId: request.slotId, meetingLink: validatedLink },
      }).catch(() => {});
    }
  }

  res.json({ success: true, data: updated });
}));

// DECLINE booking request
router.post('/requests/:id/decline', authenticate, asyncHandler(async (req: Request, res: Response) => {
  const requestId = req.params.id as string;
  const request = await prisma.bookingRequest.findUnique({
    where: { id: requestId },
    include: { slot: { include: { creator: { select: { displayName: true } } } } },
  });
  if (!request) throw new AppError('Request not found', 404);

  const creator = await prisma.creator.findUnique({ where: { userId: req.user!.id } });
  if (!creator || request.slot.creatorId !== creator.id) throw new AppError('Not authorized', 403);

  const updated = await prisma.bookingRequest.update({
    where: { id: requestId },
    data: { status: 'DECLINED' },
  });

  // Notify fan that booking was declined
  const io = req.app.get('io');
  if (io) {
    await notificationService.createAndEmit(io, {
      userId: request.userId,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      type: 'BOOKING_DECLINED' as any,
      title: 'Booking declined',
      message: `${request.slot.creator?.displayName || 'The creator'} could not accommodate your meeting request on ${new Date(request.slot.startTime).toLocaleDateString('en-IN', { weekday: 'short', month: 'short', day: 'numeric' })}`,
      actionUrl: '/dashboard',
      data: { bookingId: request.id, slotId: request.slotId },
    }).catch(() => {});
  }

  res.json({ success: true, data: updated });
}));

// GET booking stats
router.get('/stats', authenticate, asyncHandler(async (req: Request, res: Response) => {
  const creator = await prisma.creator.findUnique({ where: { userId: req.user!.id } });
  if (!creator) throw new AppError('Creator profile not found', 404);

  const totalSlots = await prisma.bookingSlot.count({ where: { creatorId: creator.id } });
  const totalBookings = await prisma.bookingRequest.count({ where: { slot: { creatorId: creator.id }, status: 'ACCEPTED' } });
  const pendingRequests = await prisma.bookingRequest.count({ where: { slot: { creatorId: creator.id }, status: 'PENDING' } });

  res.json({
    success: true,
    data: { totalSlots, totalBookings, pendingRequests },
  });
}));

export default router;
