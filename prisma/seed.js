// ===========================================
// LOCAL DEV SEED
// ===========================================
// Populates the database with test users, creators, companies,
// content, posts, a conversation, and opportunities so every
// major flow (fan chat, creator dashboard, company ops, admin,
// social feed) can be exercised end-to-end.
//
// Safe to re-run: all non-admin test data is deleted and
// re-created every run so state is deterministic.
// ===========================================

require('dotenv/config');
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

const TEST_PASSWORD = 'Test@12345';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Admin@12345';

const TEST_EMAILS = [
  'fan@test.com',
  'creator1@test.com',
  'creator2@test.com',
  'company@test.com',
];

async function main() {
  console.log('Starting dev seed...\n');

  // ---------------------------------------------------------------
  // 1. Clean slate for test users (cascades delete their data)
  // ---------------------------------------------------------------
  await prisma.user.deleteMany({
    where: { email: { in: TEST_EMAILS } },
  });
  console.log('Cleared previous test users (cascade deleted their data).');

  const adminHash = await bcrypt.hash(ADMIN_PASSWORD, 12);
  const testHash = await bcrypt.hash(TEST_PASSWORD, 12);

  // ---------------------------------------------------------------
  // 2. Admin
  // ---------------------------------------------------------------
  const admin = await prisma.user.upsert({
    where: { email: 'admin@platform.com' },
    update: {
      password: adminHash,
      name: 'Platform Admin',
      role: 'ADMIN',
      isVerified: true,
      verifiedAt: new Date(),
    },
    create: {
      email: 'admin@platform.com',
      password: adminHash,
      name: 'Platform Admin',
      role: 'ADMIN',
      isVerified: true,
      verifiedAt: new Date(),
    },
  });
  console.log('Admin ready:', admin.email);

  // ---------------------------------------------------------------
  // 3. Fan (regular user) with PREMIUM subscription so they can
  //    actually chat (works around the tokenBalance=0 bug on FREE)
  // ---------------------------------------------------------------
  const fan = await prisma.user.create({
    data: {
      email: 'fan@test.com',
      password: testHash,
      name: 'Fan User',
      role: 'USER',
      isVerified: true,
      verifiedAt: new Date(),
      interests: ['fitness', 'finance'],
    },
  });

  await prisma.subscription.create({
    data: {
      userId: fan.id,
      plan: 'PREMIUM',
      status: 'ACTIVE',
      tokenBalance: 800_000,
      tokenGrant: 2_000_000,
      tokenGrantedAt: new Date(),
      currentPeriodStart: new Date(),
      currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    },
  });
  console.log('Fan ready:', fan.email, '(PREMIUM, 800k tokens)');

  // ---------------------------------------------------------------
  // 4. Creator 1 - Alex Fitness
  // ---------------------------------------------------------------
  const creator1User = await prisma.user.create({
    data: {
      email: 'creator1@test.com',
      password: testHash,
      name: 'Alex Fitness',
      role: 'CREATOR',
      isVerified: true,
      verifiedAt: new Date(),
    },
  });

  const creator1 = await prisma.creator.create({
    data: {
      userId: creator1User.id,
      displayName: 'Alex Fitness',
      tagline: 'Your personal AI fitness coach',
      bio: 'Certified personal trainer with 10+ years of experience helping people build sustainable fitness habits. Ask me anything about workouts, nutrition, and motivation.',
      category: 'fitness',
      tags: ['fitness', 'workout', 'nutrition', 'strength'],
      youtubeUrl: 'https://youtube.com/@alexfitness',
      instagramUrl: 'https://instagram.com/alexfitness',
      aiPersonality:
        'You are Alex, a friendly and motivating fitness coach. Give practical, actionable advice grounded in exercise science. Keep responses encouraging but honest.',
      aiTone: 'friendly',
      welcomeMessage:
        "Hey! I'm Alex. Ready to crush your fitness goals? Ask me anything about workouts, nutrition, or motivation.",
      responseStyle: 'conversational',
      isVerified: true,
      isActive: true,
      verifiedAt: new Date(),
      pricePerMessage: 50,
      firstMessageFree: true,
      rating: 4.8,
      totalChats: 127,
      totalMessages: 892,
      followersCount: 1,
      postsCount: 2,
    },
  });

  await prisma.creatorContent.create({
    data: {
      creatorId: creator1.id,
      title: 'Fitness FAQ',
      type: 'FAQ',
      status: 'COMPLETED',
      rawText:
        'Q: How often should I work out?\nA: For general fitness, aim for 3-5 sessions per week mixing cardio and strength training.\n\nQ: What should I eat before a workout?\nA: Eat a small meal with carbs and protein 1-2 hours before exercise.\n\nQ: How much protein do I need?\nA: Roughly 1.6-2.2g per kg of body weight for active individuals.\n\nQ: Is cardio or strength training better?\nA: Both. Strength builds muscle and metabolism; cardio builds endurance and heart health.',
      processedAt: new Date(),
    },
  });

  await prisma.creatorContent.create({
    data: {
      creatorId: creator1.id,
      title: 'Beginner workout program',
      type: 'MANUAL_TEXT',
      status: 'COMPLETED',
      rawText:
        'A simple 3-day beginner program:\nDay 1 (Upper): Pushups 3x10, Rows 3x10, Shoulder press 3x10.\nDay 2 (Lower): Bodyweight squats 3x15, Lunges 3x10/leg, Glute bridges 3x15.\nDay 3 (Full body): Burpees 3x8, Planks 3x30s, Mountain climbers 3x20.\nRest 60-90s between sets. Progress by adding reps or weight every week.',
      processedAt: new Date(),
    },
  });
  console.log('Creator ready:', creator1User.email, '(Alex Fitness)');

  // ---------------------------------------------------------------
  // 5. Creator 2 - Sarah Finance
  // ---------------------------------------------------------------
  const creator2User = await prisma.user.create({
    data: {
      email: 'creator2@test.com',
      password: testHash,
      name: 'Sarah Finance',
      role: 'CREATOR',
      isVerified: true,
      verifiedAt: new Date(),
    },
  });

  const creator2 = await prisma.creator.create({
    data: {
      userId: creator2User.id,
      displayName: 'Sarah Finance',
      tagline: 'Smart money moves for smart people',
      bio: 'Financial advisor and author. I help people take control of their finances through clear, jargon-free education.',
      category: 'finance',
      tags: ['finance', 'investing', 'budgeting', 'personal-finance'],
      youtubeUrl: 'https://youtube.com/@sarahfinance',
      aiPersonality:
        'You are Sarah, a calm and educational finance expert. Explain concepts clearly without financial jargon. Always remind users that you are not a substitute for personalized financial advice.',
      aiTone: 'professional',
      welcomeMessage:
        "Hi, I'm Sarah. Let's talk about money - the right way. What financial question is on your mind today?",
      responseStyle: 'detailed',
      isVerified: true,
      isActive: true,
      verifiedAt: new Date(),
      pricePerMessage: 75,
      firstMessageFree: true,
      rating: 4.6,
      totalChats: 89,
      totalMessages: 523,
      followersCount: 0,
      postsCount: 1,
    },
  });

  await prisma.creatorContent.create({
    data: {
      creatorId: creator2.id,
      title: 'Personal finance basics',
      type: 'FAQ',
      status: 'COMPLETED',
      rawText:
        'Q: How much should I save each month?\nA: A good rule is 50/30/20 - 50% needs, 30% wants, 20% savings.\n\nQ: What is an emergency fund?\nA: 3-6 months of expenses kept in a high-yield savings account.\n\nQ: Should I pay off debt or invest?\nA: Pay off high-interest debt (>7%) first, then invest.\n\nQ: What is compound interest?\nA: Interest earned on both your principal and previously accumulated interest - your money makes money.',
      processedAt: new Date(),
    },
  });
  console.log('Creator ready:', creator2User.email, '(Sarah Finance)');

  // ---------------------------------------------------------------
  // 6. Company - BrandX
  // ---------------------------------------------------------------
  const companyUser = await prisma.user.create({
    data: {
      email: 'company@test.com',
      password: testHash,
      name: 'BrandX Admin',
      role: 'COMPANY',
      isVerified: true,
      verifiedAt: new Date(),
    },
  });

  const company = await prisma.company.create({
    data: {
      userId: companyUser.id,
      companyName: 'BrandX',
      industry: 'Consumer goods',
      description:
        'BrandX is a modern consumer brand focused on wellness and lifestyle products. We partner with creators who share our mission of helping people live better.',
      website: 'https://brandx.example.com',
      isVerified: true,
    },
  });

  await prisma.opportunity.create({
    data: {
      companyId: company.id,
      title: 'Fitness gear sponsored post',
      description:
        'Looking for fitness creators to promote our new line of resistance bands. We want authentic reviews that show the product in real workouts.',
      type: 'SPONSORED_POST',
      budget: 15000,
      budgetType: 'FIXED',
      category: 'fitness',
      minFollowers: 1000,
      requirements:
        'Must be active in the fitness niche. Deliverables: 1 Instagram post + 1 story. Timeline: 2 weeks.',
      status: 'OPEN',
      deadline: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
    },
  });

  await prisma.opportunity.create({
    data: {
      companyId: company.id,
      title: 'Finance app brand ambassador',
      description:
        '3-month partnership with our new budgeting app. Monthly retainer + affiliate commissions.',
      type: 'BRAND_AMBASSADOR',
      budget: 50000,
      budgetType: 'MONTHLY',
      category: 'finance',
      minFollowers: 500,
      requirements:
        'Long-form content creator in the finance space. 4 videos/month featuring the app.',
      status: 'OPEN',
      deadline: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    },
  });
  console.log('Company ready:', companyUser.email, '(BrandX, 2 opportunities)');

  // ---------------------------------------------------------------
  // 7. Posts for the feed
  // ---------------------------------------------------------------
  await prisma.post.create({
    data: {
      creatorId: creator1.id,
      content:
        'Just finished a 5k run in record time! Remember - consistency beats intensity every time. What is your running goal this week?',
      type: 'TEXT',
      likesCount: 42,
      commentsCount: 7,
      publishedAt: new Date(),
    },
  });

  await prisma.post.create({
    data: {
      creatorId: creator1.id,
      content:
        'My top 5 budget-friendly protein sources:\n1. Eggs\n2. Greek yogurt\n3. Chicken thighs\n4. Canned tuna\n5. Cottage cheese\n\nWhat are your favorites?',
      type: 'TEXT',
      likesCount: 87,
      commentsCount: 14,
      publishedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
    },
  });

  await prisma.post.create({
    data: {
      creatorId: creator2.id,
      content:
        'The #1 investing mistake I see: waiting for the perfect time. Time IN the market beats timing the market. Start small, start now.',
      type: 'TEXT',
      likesCount: 156,
      commentsCount: 23,
      publishedAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000),
    },
  });

  // ---------------------------------------------------------------
  // 8. Fan follows creator1 + leaves a 5-star review
  // ---------------------------------------------------------------
  await prisma.follow.create({
    data: {
      followerId: fan.id,
      followingId: creator1.id,
    },
  });

  await prisma.creatorReview.create({
    data: {
      creatorId: creator1.id,
      userId: fan.id,
      rating: 5,
      comment: 'Amazing coaching! Changed my workout routine for the better.',
    },
  });

  // ---------------------------------------------------------------
  // 9. Seed conversation between fan and creator1 with a welcome msg
  // ---------------------------------------------------------------
  const conversation = await prisma.conversation.create({
    data: {
      userId: fan.id,
      creatorId: creator1.id,
      isActive: true,
      lastMessageAt: new Date(),
    },
  });

  await prisma.message.create({
    data: {
      conversationId: conversation.id,
      role: 'ASSISTANT',
      content:
        "Hey! I'm Alex. Ready to crush your fitness goals? Ask me anything about workouts, nutrition, or motivation.",
    },
  });

  console.log('\n=========================================');
  console.log('Seed complete.');
  console.log('=========================================');
  console.log('LOGIN CREDENTIALS:');
  console.log('  Admin    : admin@platform.com   /', ADMIN_PASSWORD);
  console.log('  Fan      : fan@test.com         /', TEST_PASSWORD, '(PREMIUM)');
  console.log('  Creator1 : creator1@test.com    /', TEST_PASSWORD, '(Alex Fitness)');
  console.log('  Creator2 : creator2@test.com    /', TEST_PASSWORD, '(Sarah Finance)');
  console.log('  Company  : company@test.com     /', TEST_PASSWORD, '(BrandX)');
  console.log('=========================================\n');
}

main()
  .catch((e) => {
    console.error('Seed error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
