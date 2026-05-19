/**
 * One-shot production seed for the 6 featured creators.
 *
 * Runs INSIDE the main server process (not a separate script) so it
 * executes regardless of how the container is launched (docker CMD vs
 * npm start). Idempotent via a marker row so container restarts don't
 * re-upsert data that hasn't changed.
 *
 * After this has run successfully on prod, remove the import from
 * src/index.ts and delete this file + the avatars/ subfolder.
 */

import prismaClient from '../../prisma/client';
import bcrypt from 'bcryptjs';
import fs from 'fs';
import path from 'path';
import { config } from '../config';
import { logInfo, logError, logWarning } from '../utils/logger';
import { RAGHAV_PNG_B64 } from './avatars/raghav';
import { KRISHANSH_PNG_B64 } from './avatars/krishansh';
import { RAVYA_PNG_B64 } from './avatars/ravya';

const MARKER_EMAIL = '__featured_seed_v1@system.local';

// ElevenLabs public preset voice IDs (always-available, no cloning needed).
const PRESET_VOICES = {
  male: 'pNInz6obpbZtV8k9EZMl',   // Adam
  female: '21m00Tcm4TlvDq8ikWAM', // Rachel
};

interface CreatorDef {
  email: string;
  password: string;
  name: string;
  profileImage: string | null;
  featuredOrder: number;
  isMainHighlight?: boolean;
  voiceId: string;
  creator: {
    displayName: string;
    bio: string;
    tagline: string;
    category: string;
    tags: string[];
    suggestedQuestions: string[];
    totalChats: number;
    aiTone: string;
    welcomeMessage: string;
    aiPersonality: string;
    responseStyle: string;
    pricePerMessage: number;
    firstMessageFree: boolean;
    discountFirstFive: number;
    maxMessagesPerDay: number;
    allowNewConversations: boolean;
    isVerified: boolean;
    youtubeUrl?: string;
    instagramUrl?: string;
    websiteUrl?: string;
  };
  bank: {
    bankName: string;
    accountHolderName: string;
    accountNumber: string;
    ifscCode: string;
  };
  content: Array<{ title: string; text: string }>;
}

const CREATORS: CreatorDef[] = [
  {
    email: 'raghav@creator.test',
    password: 'Password123!',
    name: 'Raghav Budhraja',
    profileImage: '/uploads/avatars/raghav.png',
    featuredOrder: 1,
    isMainHighlight: true,
    voiceId: PRESET_VOICES.male,
    creator: {
      displayName: 'Raghav Budhraja',
      bio: 'Lost 25kg, founder of PeakPals, helped 400+ clients globally using structured fat loss systems, data-driven nutrition, and personalized training.',
      tagline: 'Weight loss expert',
      category: 'Fat Loss',
      tags: ['Cross fit', 'Weight Loss', 'Diet training'],
      suggestedQuestions: [
        'How do I lose belly fat?',
        'How much protein should I eat?',
        'What workout should I follow?',
      ],
      totalChats: 540,
      aiTone: 'friendly',
      welcomeMessage: "Hey, I'm Raghav. Tell me where you're stuck — fat loss, training, or nutrition — and I'll coach you through it.",
      aiPersonality:
        "You are Raghav Budhraja's AI clone. Raghav is a weight-loss coach who lost 25kg and founded PeakPals. Speak in his voice: warm, direct, no fluff. Lead with empathy ('I've been there'), then give a clear 2–3 step plan grounded in progressive training and calorie-aware nutrition. Avoid fads; prefer sustainable habits. If the user asks about medical conditions, recommend they consult a doctor.",
      responseStyle: 'conversational',
      pricePerMessage: 75,
      firstMessageFree: true,
      discountFirstFive: 20,
      maxMessagesPerDay: 100,
      allowNewConversations: true,
      isVerified: true,
      youtubeUrl: 'https://youtube.com/@peakpals',
      instagramUrl: 'https://instagram.com/raghavbudhraja',
      websiteUrl: 'https://peakpals.com',
    },
    bank: {
      bankName: 'HDFC Bank',
      accountHolderName: 'Raghav Budhraja',
      accountNumber: '50100123456789',
      ifscCode: 'HDFC0000123',
    },
    content: [
      {
        title: 'The 25kg Fat Loss Playbook',
        text: "When I started I weighed 95kg. Over 14 months I dropped to 70kg and kept it off for three years. The core rules that worked: (1) calorie deficit of 300–500 kcal, not crash dieting. (2) Strength training 4x a week, progressive overload on compound lifts. (3) 1.6–2.2g of protein per kg of bodyweight, every day. (4) 8,000+ steps as a non-negotiable. (5) Sleep 7+ hours — fat loss stalls without it. (6) Track weekly averages, not daily scale readings. (7) One planned cheat meal a week — not a cheat day. The hardest part was not the gym, it was learning to stop eating out of boredom.",
      },
      {
        title: 'How I Train PeakPals Clients',
        text: "Every client starts with a 2-week baseline: log everything, don't change anything. Then we set a protein floor before touching calories. Training is 4 sessions: two push/pull upper days and two lower-body days, each with a compound lift as the anchor. Cardio is walking, not HIIT, because HIIT destroys recovery when you're in a deficit. We check in weekly on the trend — weight, waist, photos — not the daily number.",
      },
    ],
  },
  {
    email: 'krishansh@creator.test',
    password: 'Password123!',
    name: 'Krishansh Arora',
    profileImage: '/uploads/avatars/krishansh.png',
    featuredOrder: 2,
    voiceId: PRESET_VOICES.male,
    creator: {
      displayName: 'Krishansh Arora',
      bio: 'Gained 15kg of lean muscle and founded IronLab — a hypertrophy-first coaching program that has transformed 300+ naturals. Functional strength, smart periodization, and the unsexy work that actually builds size.',
      tagline: 'Muscle building expert',
      category: 'Muscle Gain',
      tags: ['Muscle Building', 'Strength Training', 'Hypertrophy', 'Powerlifting'],
      suggestedQuestions: [
        'How do I build muscle fast?',
        'What should I eat post-workout?',
        'How often should I train?',
      ],
      totalChats: 420,
      aiTone: 'professional',
      welcomeMessage: "I'm Krishansh. Ask me anything about training splits, progression, or hitting your first plateau — I'll keep it practical.",
      aiPersonality:
        "You are Krishansh Arora's AI clone. Krishansh is a hypertrophy coach and natural lifter who founded IronLab. Tone: confident, technical, no hype. Always ground answers in progressive overload, volume landmarks (MEV/MAV/MRV), and recovery. If asked about gear or shortcuts, redirect to natural training principles. Cite exercises by movement pattern, not brand names.",
      responseStyle: 'detailed',
      pricePerMessage: 80,
      firstMessageFree: true,
      discountFirstFive: 15,
      maxMessagesPerDay: 100,
      allowNewConversations: true,
      isVerified: true,
      instagramUrl: 'https://instagram.com/krishansh.ironlab',
      youtubeUrl: 'https://youtube.com/@ironlabstrength',
    },
    bank: {
      bankName: 'ICICI Bank',
      accountHolderName: 'Krishansh Arora',
      accountNumber: '60201234567890',
      ifscCode: 'ICIC0000456',
    },
    content: [
      {
        title: 'The 15kg Lean Gain Framework',
        text: "To add real muscle as a natural, you need three things: (1) Progressive overload — add reps or weight every week on your main compound (bench, squat, deadlift, overhead press, row). (2) A calorie surplus of 200–400 kcal, with 1.8–2.2g protein per kg bodyweight. More is not better. (3) Sleep and recovery — I gained nothing in the year I slept 5 hours. When I shifted to 8, I added 6kg. Split that actually works for most naturals: Upper/Lower/Push/Pull/Legs with one rest day. Ignore celebrity routines — they trained on substances you don't have.",
      },
      {
        title: 'Volume Landmarks By Muscle Group',
        text: "MEV (minimum effective volume) and MRV (maximum recoverable volume) per muscle per week: Chest 8–22 sets, Back 10–25, Quads 8–20, Hamstrings 6–15, Shoulders (side delts) 8–22, Biceps 8–20, Triceps 6–18. Start at MEV, add 1–2 sets a week until progress stalls, then deload for a week. Most people undertrain their back and overtrain chest — rebalance.",
      },
    ],
  },
  {
    email: 'ravya@creator.test',
    password: 'Password123!',
    name: 'Ravya Arora',
    profileImage: '/uploads/avatars/ravya.png',
    featuredOrder: 3,
    voiceId: PRESET_VOICES.female,
    creator: {
      displayName: 'Ravya Arora',
      bio: "Reversed my own PCOS naturally and became a certified women's health coach. I've helped 250+ women balance hormones through cycle-synced training, anti-inflammatory nutrition, and lifestyle design — not pills.",
      tagline: 'PCOS & wellness expert',
      category: 'PCOS',
      tags: ["Women's Fitness", 'PCOS', 'Hormone Health', 'Nutrition'],
      suggestedQuestions: [
        'How do I manage PCOS naturally?',
        "What's the best diet for hormones?",
        'How do I lose weight with PCOS?',
      ],
      totalChats: 360,
      aiTone: 'friendly',
      welcomeMessage: "Hi, I'm Ravya. Whether it's irregular periods, stubborn belly fat, or energy crashes — tell me what's going on and let's figure it out together.",
      aiPersonality:
        "You are Ravya Arora's AI clone. Ravya is a women's health coach specializing in PCOS recovery. Tone: warm, knowledgeable, patient. Always remind users that PCOS presents differently for everyone, so personalization matters. Recommend blood work before major dietary changes, and always defer to a doctor for insulin resistance or thyroid issues. Lead with sustainable habits: sleep, stress, strength training, and balanced meals.",
      responseStyle: 'conversational',
      pricePerMessage: 70,
      firstMessageFree: true,
      discountFirstFive: 25,
      maxMessagesPerDay: 100,
      allowNewConversations: true,
      isVerified: true,
      instagramUrl: 'https://instagram.com/ravya.wellness',
      websiteUrl: 'https://ravyawellness.com',
    },
    bank: {
      bankName: 'Axis Bank',
      accountHolderName: 'Ravya Arora',
      accountNumber: '91101234567890',
      ifscCode: 'UTIB0000789',
    },
    content: [
      {
        title: 'PCOS Recovery — What Actually Moved The Needle',
        text: "After 4 years of irregular cycles and weight gain I reversed my PCOS. What worked: (1) Stopped crash dieting — cortisol was the enemy. (2) Strength trained 3x a week; cardio was walking, never long runs. (3) Ate 30g protein at breakfast to stabilize morning insulin. (4) Cut sugar-sweetened drinks entirely; kept fruit and whole grains. (5) Fixed sleep — 10:30pm to 6:30am, no exceptions. (6) Tracked cycle for 6 months to see what food/training windows actually correlated with energy. PCOS isn't one disease — it's a pattern. Yours will respond differently than mine.",
      },
      {
        title: 'Cycle-Synced Training For PCOS',
        text: "Follicular phase (days 1–14): energy is high — this is when you lift heaviest and do harder conditioning. Ovulation: strength peaks, good time for PRs. Luteal phase (days 15–28): insulin sensitivity drops — focus on moderate training, lower-intensity cardio, and slightly higher protein. Women with PCOS often have irregular cycles, so track symptoms more than dates. Adjust intensity down by 10–20% in the week leading up to your period.",
      },
    ],
  },
  {
    email: 'priya@creator.test',
    password: 'Password123!',
    name: 'Priya Menon',
    profileImage: null,
    featuredOrder: 4,
    voiceId: PRESET_VOICES.female,
    creator: {
      displayName: 'Priya Menon',
      bio: 'Yoga teacher and mental wellness coach with 10+ years on the mat. I help busy professionals rebuild their nervous system with 15-minute daily practices — no incense, no chanting, just science-backed breathwork and movement.',
      tagline: 'Yoga & breathwork coach',
      category: 'Mental Wellness',
      tags: ['Yoga', 'Breathwork', 'Stress Management', 'Mental Wellness'],
      suggestedQuestions: [
        'How do I manage daily stress?',
        'What breathwork should a beginner try?',
        'How do I build a 15-minute routine?',
      ],
      totalChats: 280,
      aiTone: 'friendly',
      welcomeMessage: "Hi, I'm Priya. Are you feeling stuck, anxious, or just exhausted? Let's find a small practice that fits your week.",
      aiPersonality:
        "You are Priya Menon's AI clone. Priya is a yoga and mental-wellness coach. Tone: calm, spacious, never preachy. Prioritize simple, short practices the user can do today. When someone describes anxiety or burnout, validate first, then offer one breath technique and one movement. Always clarify you are not a therapist; recommend professional support for persistent issues.",
      responseStyle: 'concise',
      pricePerMessage: 60,
      firstMessageFree: true,
      discountFirstFive: 20,
      maxMessagesPerDay: 100,
      allowNewConversations: true,
      isVerified: true,
      instagramUrl: 'https://instagram.com/priya.breathe',
    },
    bank: {
      bankName: 'SBI',
      accountHolderName: 'Priya Menon',
      accountNumber: '10234567890123',
      ifscCode: 'SBIN0001234',
    },
    content: [
      {
        title: '15-Minute Reset For Overwhelmed Days',
        text: "When you're spiraling, don't try to meditate for 30 minutes — you'll quit. Instead: (1) 3 minutes of box breathing: inhale 4, hold 4, exhale 4, hold 4. (2) 5 minutes of legs-up-the-wall pose — this drops cortisol measurably. (3) 5 minutes of gentle neck and shoulder rolls. (4) 2 minutes of eyes-closed quiet. This is a nervous-system reset, not a spiritual practice. Do it before bed if you can't sleep.",
      },
      {
        title: 'Breathwork For Beginners',
        text: "Three techniques, each for a specific state: Box breathing (4-4-4-4) for anxiety. Extended exhale (inhale 4, exhale 8) for pre-sleep. Bhastrika / bellows breath for low energy mornings — 30 fast breaths through nose, then hold. Never do bhastrika late at night or if pregnant. Start with 2 minutes, build up.",
      },
    ],
  },
  {
    email: 'arjun@creator.test',
    password: 'Password123!',
    name: 'Arjun Kapoor',
    profileImage: null,
    featuredOrder: 5,
    voiceId: PRESET_VOICES.male,
    creator: {
      displayName: 'Arjun Kapoor',
      bio: 'Registered sports nutritionist and former national-level athlete. I translate nutrition research into meal plans busy people can actually follow — macros, timing, and the 20% of habits that drive 80% of results.',
      tagline: 'Sports nutrition coach',
      category: 'Nutrition',
      tags: ['Nutrition', 'Sports Performance', 'Meal Planning', 'Macros'],
      suggestedQuestions: [
        'How do I calculate my macros?',
        'What should I eat before training?',
        'How do I plan meals on a busy week?',
      ],
      totalChats: 320,
      aiTone: 'educational',
      welcomeMessage: "I'm Arjun. Tell me your goal — fat loss, muscle, performance — and what a normal week looks like. I'll design the simplest plan that works.",
      aiPersonality:
        "You are Arjun Kapoor's AI clone. Arjun is a sports nutritionist and former athlete. Tone: clear, evidence-based, no tribalism (he is not keto vs. carb — he is whatever works for your goal). Always start by clarifying the goal, training frequency, and food preferences before recommending macros. Give specific grams, not vague 'eat more protein.' Flag when someone needs blood work or a registered dietitian.",
      responseStyle: 'detailed',
      pricePerMessage: 85,
      firstMessageFree: true,
      discountFirstFive: 15,
      maxMessagesPerDay: 100,
      allowNewConversations: true,
      isVerified: true,
      instagramUrl: 'https://instagram.com/arjun.fuelscience',
      websiteUrl: 'https://fuelscience.in',
    },
    bank: {
      bankName: 'Kotak Mahindra Bank',
      accountHolderName: 'Arjun Kapoor',
      accountNumber: '70301234567890',
      ifscCode: 'KKBK0001357',
    },
    content: [
      {
        title: 'Macros Made Simple',
        text: "Step 1: protein first. 1.6–2.2g per kg bodyweight for active people. Step 2: fats — 0.8–1.2g per kg, never under 0.5g. Step 3: fill the rest with carbs. If you train, you need carbs; cutting them is how people tank performance. Step 4: fiber — 30g+ per day, from whole foods. Step 5: calorie target comes last. A 10% deficit for fat loss, 10% surplus for muscle, maintenance for performance.",
      },
      {
        title: "Nutrient Timing — What Matters, What Doesn't",
        text: "Things that matter: total daily protein, total daily calories, pre-workout carbs within 2 hours of training, post-workout protein within 3 hours. Things that don't: the anabolic window is not 30 minutes, it's hours. Breakfast isn't 'the most important meal.' Fasted cardio burns the same fat over 24 hours as fed cardio. Stop obsessing over timing before you've fixed totals.",
      },
    ],
  },
  {
    email: 'sneha@creator.test',
    password: 'Password123!',
    name: 'Sneha Reddy',
    profileImage: null,
    featuredOrder: 6,
    voiceId: PRESET_VOICES.female,
    creator: {
      displayName: 'Sneha Reddy',
      bio: "Clinical nutritionist specializing in gut health and IBS. I've helped 500+ clients rebuild their microbiome through elimination protocols, fiber cycling, and stress-gut axis work. No miracle teas, just systematic reintroduction.",
      tagline: 'Gut health nutritionist',
      category: 'Gut Health',
      tags: ['Gut Health', 'IBS', 'Nutrition', 'Microbiome'],
      suggestedQuestions: [
        'How do I fix constant bloating?',
        'Do I need a low-FODMAP diet?',
        'Which probiotics actually work?',
      ],
      totalChats: 300,
      aiTone: 'professional',
      welcomeMessage: "Hi, I'm Sneha. Bloating, IBS, or mystery gut symptoms? Let's map out what you eat, how you feel, and a plan to find your triggers.",
      aiPersonality:
        "You are Sneha Reddy's AI clone. Sneha is a clinical gut-health nutritionist. Tone: methodical, careful, never alarmist. Always gather symptom timing, food diary, and stress context before recommending protocols. Default to low-FODMAP as a diagnostic tool, not a long-term diet. Always recommend a GI consult for red-flag symptoms (blood in stool, unexplained weight loss, persistent pain).",
      responseStyle: 'detailed',
      pricePerMessage: 80,
      firstMessageFree: true,
      discountFirstFive: 20,
      maxMessagesPerDay: 100,
      allowNewConversations: true,
      isVerified: true,
      instagramUrl: 'https://instagram.com/sneha.gutclinic',
    },
    bank: {
      bankName: 'IDFC First Bank',
      accountHolderName: 'Sneha Reddy',
      accountNumber: '80401234567890',
      ifscCode: 'IDFB0001579',
    },
    content: [
      {
        title: 'The Low-FODMAP Diagnostic Protocol',
        text: "Low-FODMAP is not a lifestyle — it's a 6-week diagnostic. Week 1–2: eliminate high-FODMAP foods (onion, garlic, wheat, certain fruits, beans). Week 3–6: systematic reintroduction, one category at a time, 3 days per category. Track symptoms on a 0–10 scale. By the end you know which FODMAPs are your triggers. Long-term restriction hurts your microbiome, so reintroduce as much as you tolerate.",
      },
      {
        title: 'Gut-Brain Axis — Why Stress Fixes Matter More Than Diet',
        text: "I've had clients do perfect elimination diets and still flare from gut symptoms. The missing piece was stress. The vagus nerve connects gut to brain bidirectionally — chronic stress disrupts motility, bile flow, and microbiome diversity. Non-negotiables: 7+ hours of sleep, one meal per day eaten slowly with no screen, and a 10-minute post-meal walk. These move the needle more than supplements.",
      },
    ],
  },
];

async function hasMarker(prisma: typeof prismaClient): Promise<boolean> {
  try {
    const row = await prisma.user.findUnique({ where: { email: MARKER_EMAIL } });
    return !!row;
  } catch {
    return false;
  }
}

function writeAvatarPng(avatarsDir: string, filename: string, b64: string): void {
  const dst = path.join(avatarsDir, filename);
  // Always overwrite — ensures correct image content is written even if the
  // file already exists from a previous (potentially wrong) deployment.
  fs.writeFileSync(dst, Buffer.from(b64, 'base64'));
  logInfo(`[prod-reset] wrote avatar ${dst}`);
}

// Writes the 3 featured-creator PNGs to the served uploads dir.
// Runs unconditionally (idempotent) so a PVC that is missing the files
// after a mount change or a restart can still catch up even if the DB
// marker is already present.
export function ensureFeaturedAvatars(): void {
  try {
    const avatarsDir = path.join(config.upload.dir, 'avatars');
    fs.mkdirSync(avatarsDir, { recursive: true });
    writeAvatarPng(avatarsDir, 'raghav.png', RAGHAV_PNG_B64);
    writeAvatarPng(avatarsDir, 'krishansh.png', RAVYA_PNG_B64);
    writeAvatarPng(avatarsDir, 'ravya.png', KRISHANSH_PNG_B64);
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    logError(err, { stage: 'ensureFeaturedAvatars' });
  }
}

async function upsertCreator(prisma: typeof prismaClient, def: CreatorDef): Promise<string> {
  const passwordHash = await bcrypt.hash(def.password, 12);

  const user = await prisma.user.upsert({
    where: { email: def.email },
    update: { name: def.name, role: 'CREATOR', isVerified: true, verifiedAt: new Date() },
    create: {
      email: def.email,
      password: passwordHash,
      name: def.name,
      role: 'CREATOR',
      isVerified: true,
      verifiedAt: new Date(),
    },
  });

  const creatorData: any = {
    ...def.creator,
    profileImage: def.profileImage,
    voiceId: def.voiceId,
    voiceStatus: 'READY',
    verifiedAt: def.creator.isVerified ? new Date() : null,
    isActive: true,
    isFeatured: true,
    featuredOrder: def.featuredOrder,
    isMainHighlight: !!def.isMainHighlight,
  };

  const creator = await prisma.creator.upsert({
    where: { userId: user.id },
    update: creatorData,
    create: { userId: user.id, ...creatorData },
  });

  await prisma.bankAccount.upsert({
    where: { creatorId: creator.id },
    update: {
      bankName: def.bank.bankName,
      accountHolderName: def.bank.accountHolderName,
      accountNumber: def.bank.accountNumber,
      ifscCode: def.bank.ifscCode,
      isVerified: true,
      verifiedAt: new Date(),
    },
    create: {
      creatorId: creator.id,
      bankName: def.bank.bankName,
      accountHolderName: def.bank.accountHolderName,
      accountNumber: def.bank.accountNumber,
      ifscCode: def.bank.ifscCode,
      isVerified: true,
      verifiedAt: new Date(),
    },
  });

  await prisma.creatorContent.deleteMany({
    where: {
      creatorId: creator.id,
      type: 'MANUAL_TEXT',
      title: { in: def.content.map((c) => c.title) },
    },
  });
  for (const item of def.content) {
    await prisma.creatorContent.create({
      data: {
        creatorId: creator.id,
        title: item.title,
        type: 'MANUAL_TEXT',
        status: 'COMPLETED',
        rawText: item.text,
        processedAt: new Date(),
      },
    });
  }

  return creator.id;
}

export async function runProdResetIfNeeded(): Promise<void> {
  if (process.env.SKIP_PROD_RESET === 'yes') {
    logInfo('[prod-reset] SKIP_PROD_RESET=yes, skipping');
    return;
  }

  // Always make sure the avatar PNGs exist on the served uploads dir.
  // Runs unconditionally so a PVC that's missing the files (first boot
  // after this change, or volume remount) catches up regardless of DB marker.
  ensureFeaturedAvatars();

  const prisma = prismaClient;
  try {
    if (await hasMarker(prisma)) {
      logInfo('[prod-reset] marker found, skipping');
      return;
    }
    logInfo('[prod-reset] marker missing — seeding featured creators');

    const seededIds: string[] = [];
    for (const def of CREATORS) {
      try {
        const id = await upsertCreator(prisma, def);
        seededIds.push(id);
        logInfo(`[prod-reset] upserted ${def.name}`);
      } catch (e) {
        const err = e instanceof Error ? e : new Error(String(e));
        logError(err, { stage: 'prod-reset', creator: def.email });
      }
    }

    if (seededIds.length > 0) {
      const cleared = await prisma.creator.updateMany({
        where: {
          id: { notIn: seededIds },
          OR: [{ isFeatured: true }, { isMainHighlight: true }],
        },
        data: { isFeatured: false, featuredOrder: null, isMainHighlight: false },
      });
      if (cleared.count > 0) {
        logInfo(`[prod-reset] cleared featured flag on ${cleared.count} other creator(s)`);
      }
    }

    const hash = await bcrypt.hash(`marker-${Date.now()}`, 4);
    await prisma.user.create({
      data: {
        email: MARKER_EMAIL,
        password: hash,
        name: 'featured seed marker (do not delete)',
        role: 'USER',
        isVerified: false,
      },
    });
    logInfo('[prod-reset] marker written — done');
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    logError(err, { stage: 'prod-reset' });
    logWarning('[prod-reset] continuing server boot despite failure');
  } finally {
    try { await prisma.$disconnect(); } catch { /* noop */ }
  }
}
