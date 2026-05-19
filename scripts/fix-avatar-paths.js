/**
 * One-shot script: revert avatar profileImage paths back to the correct values.
 *
 * Background: during debugging we swapped Ravya and Krishansh paths in the DB.
 * The real fix is in prod-reset.ts (it now writes the correct image content to
 * each filename). This script puts the DB paths back to what they should be:
 *   Krishansh → /uploads/avatars/krishansh.png
 *   Ravya     → /uploads/avatars/ravya.png
 *
 * Run with:  node scripts/fix-avatar-paths.js
 */

'use strict';

const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
  // Update Krishansh
  const krishansh = await prisma.creator.updateMany({
    where: { user: { email: 'krishansh@creator.test' } },
    data: { profileImage: '/uploads/avatars/krishansh.png' },
  });
  console.log(`Krishansh updated: ${krishansh.count} row(s)`);

  // Update Ravya
  const ravya = await prisma.creator.updateMany({
    where: { user: { email: 'ravya@creator.test' } },
    data: { profileImage: '/uploads/avatars/ravya.png' },
  });
  console.log(`Ravya updated: ${ravya.count} row(s)`);

  // Verify
  const rows = await prisma.creator.findMany({
    where: { user: { email: { in: ['krishansh@creator.test', 'ravya@creator.test'] } } },
    select: { profileImage: true, user: { select: { email: true } } },
  });
  console.log('\nVerification:');
  rows.forEach((r) => console.log(`  ${r.user.email} → ${r.profileImage}`));
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
