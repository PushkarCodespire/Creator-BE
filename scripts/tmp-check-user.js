const { PrismaClient } = require('@prisma/client');
require('dotenv').config();

const userId = '2b645f5f-5a94-4288-9fa3-6b6184fb8f9d';
const creatorId = '7ef87bd2-65f6-40c4-8e62-35873cf2aa73';

const prisma = new PrismaClient();

(async () => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, role: true, name: true }
  });

  const creator = await prisma.creator.findUnique({
    where: { id: creatorId },
    select: { id: true, displayName: true, userId: true, isActive: true }
  });

  console.log(JSON.stringify({ user, creator }, null, 2));
  await prisma.$disconnect();
})().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
