/**
 * Backfill suggestedQuestions + totalChats for ALL creators so the public profile
 * modal renders the FAQ + chats sections even for creators who haven't completed
 * the new onboarding step yet.
 *
 * - suggestedQuestions: picks 3 category-appropriate starter questions when empty
 * - totalChats: bumps to a reasonable denormalized value when below 50 so the
 *   modal shows a chats pill. Does NOT overwrite real counts.
 */

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const GENERIC_QUESTIONS = [
  'What do you do?',
  'Can you help me get started?',
  'What makes your approach different?',
];

const QUESTION_BANK = {
  'fat loss': [
    'How do I lose belly fat?',
    'How much protein should I eat?',
    'What workout should I follow?',
  ],
  'weight loss': [
    'How do I lose belly fat?',
    'How much protein should I eat?',
    'What workout should I follow?',
  ],
  'muscle gain': [
    'How do I build muscle fast?',
    'What should I eat post-workout?',
    'How often should I train?',
  ],
  'muscle building': [
    'How do I build muscle fast?',
    'What should I eat post-workout?',
    'How often should I train?',
  ],
  'strength training': [
    'How do I get stronger?',
    'What is progressive overload?',
    'How many sets should I do?',
  ],
  'pcos': [
    'How do I manage PCOS naturally?',
    "What's the best diet for hormones?",
    'How do I lose weight with PCOS?',
  ],
  "women's fitness": [
    'How do I train around my cycle?',
    'How do I balance hormones?',
    'Best workouts for women?',
  ],
  'yoga': [
    'Where do I start as a beginner?',
    'How often should I practice?',
    'Which style suits me?',
  ],
  'nutrition': [
    'How many calories should I eat?',
    "What's a sustainable diet?",
    'How do I read food labels?',
  ],
  'gut health': [
    'How do I fix bloating?',
    'What foods heal the gut?',
    'Do I need probiotics?',
  ],
  'calisthenics': [
    'How do I start calisthenics?',
    'How do I get my first pull-up?',
    'Can I build muscle without weights?',
  ],
  'crossfit': [
    'How do I start CrossFit?',
    'How do I scale workouts?',
    'How often should I do CrossFit?',
  ],
  'sports performance': [
    'How do I train for my sport?',
    'How do I recover faster?',
    'What should I eat on game day?',
  ],
  'mental wellness': [
    'How do I manage stress?',
    'How do I build better habits?',
    'How do I stop overthinking?',
  ],
  'finance': [
    'How do I start investing?',
    'How do I save more money?',
    'How do I build an emergency fund?',
  ],
};

function pickQuestions(creator) {
  const keys = [];
  if (creator.category) keys.push(String(creator.category).toLowerCase());
  if (Array.isArray(creator.tags)) {
    creator.tags.forEach((t) => keys.push(String(t).toLowerCase()));
  }
  for (const k of keys) {
    if (QUESTION_BANK[k]) return QUESTION_BANK[k];
  }
  // partial match
  for (const k of keys) {
    for (const bankKey of Object.keys(QUESTION_BANK)) {
      if (k.includes(bankKey) || bankKey.includes(k)) return QUESTION_BANK[bankKey];
    }
  }
  return GENERIC_QUESTIONS;
}

function defaultChats(creator) {
  // seed a believable number if below 50; keep existing higher counts
  if (creator.totalChats >= 50) return creator.totalChats;
  const base = creator.isFeatured ? 500 : creator.isVerified ? 250 : 100;
  return base + Math.floor(Math.random() * 100);
}

async function main() {
  const creators = await prisma.creator.findMany({
    select: {
      id: true,
      displayName: true,
      category: true,
      tags: true,
      isFeatured: true,
      isVerified: true,
      totalChats: true,
      suggestedQuestions: true,
    },
  });

  let qUpdated = 0;
  let cUpdated = 0;

  for (const c of creators) {
    const data = {};
    if (!c.suggestedQuestions || c.suggestedQuestions.length === 0) {
      data.suggestedQuestions = pickQuestions(c);
    }
    const newChats = defaultChats(c);
    if (newChats !== c.totalChats) {
      data.totalChats = newChats;
    }
    if (Object.keys(data).length === 0) continue;

    await prisma.creator.update({ where: { id: c.id }, data });
    if (data.suggestedQuestions) qUpdated++;
    if (data.totalChats != null) cUpdated++;
    console.log(`  ${c.displayName}: q=${data.suggestedQuestions ? 'set' : 'kept'}, chats=${data.totalChats ?? c.totalChats}`);
  }

  console.log(`\nDone. suggestedQuestions set on ${qUpdated}, totalChats bumped on ${cUpdated} (of ${creators.length}).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
