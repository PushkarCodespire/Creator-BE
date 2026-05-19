// Run: node scripts/seed-user-demographics.js
// Adds dateOfBirth and location to all existing users that don't have them

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const LOCATIONS = [
  'Mumbai, India',
  'Delhi, India',
  'Bangalore, India',
  'Hyderabad, India',
  'Chennai, India',
  'Pune, India',
  'Kolkata, India',
  'Jaipur, India',
  'Ahmedabad, India',
  'Lucknow, India',
  'Dubai, UAE',
  'London, UK',
  'New York, USA',
  'Toronto, Canada',
  'Sydney, Australia',
];

function randomDate(startYear, endYear) {
  const start = new Date(startYear, 0, 1);
  const end = new Date(endYear, 11, 31);
  return new Date(start.getTime() + Math.random() * (end.getTime() - start.getTime()));
}

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

async function main() {
  const users = await prisma.user.findMany({
    select: { id: true, name: true, dateOfBirth: true, location: true },
  });

  console.log(`Found ${users.length} users`);

  for (const user of users) {
    const updates = {};

    if (!user.dateOfBirth) {
      // Random age between 16 and 55
      updates.dateOfBirth = randomDate(1971, 2010);
    }

    if (!user.location) {
      updates.location = pickRandom(LOCATIONS);
    }

    if (Object.keys(updates).length > 0) {
      await prisma.user.update({
        where: { id: user.id },
        data: updates,
      });
      console.log(`Updated ${user.name}: DOB=${updates.dateOfBirth?.toISOString().split('T')[0] || 'kept'}, Location=${updates.location || 'kept'}`);
    } else {
      console.log(`Skipped ${user.name} (already has data)`);
    }
  }

  console.log('Done!');
  await prisma.$disconnect();
}

main().catch(console.error);
