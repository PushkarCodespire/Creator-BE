const { PrismaClient } = require('@prisma/client');
require('dotenv').config();

const prisma = new PrismaClient();

(async () => {
  const creators = await prisma.creator.findMany({
    take: 5,
    select: { id: true, displayName: true, isActive: true }
  });

  console.log(JSON.stringify(creators, null, 2));
  await prisma.$disconnect();
})().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
