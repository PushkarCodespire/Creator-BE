/**
 * Sync Creator.totalChats to the real count of ASSISTANT messages ("questions answered"),
 * so the "X CHATS" pill / "Total conversations" tile everywhere in the app matches the
 * actual questions-answered number shown on the creator dashboard.
 *
 * For the 6 seeded creators we keep a floor so their seeded baseline is never regressed.
 */

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const SEEDED_BASELINES = {
  'raghav@creator.test': 540,
  'krishansh@creator.test': 420,
  'ravya@creator.test': 360,
  'priya@creator.test': 280,
  'arjun@creator.test': 320,
  'sneha@creator.test': 300,
};

async function main() {
  const creators = await prisma.creator.findMany({
    select: {
      id: true,
      displayName: true,
      totalChats: true,
      user: { select: { email: true } },
    },
  });

  let updated = 0;

  for (const c of creators) {
    const realCount = await prisma.message.count({
      where: { role: 'ASSISTANT', conversation: { creatorId: c.id } },
    });

    const email = c.user?.email?.toLowerCase();
    const baseline = email && SEEDED_BASELINES[email] ? SEEDED_BASELINES[email] : 0;
    const next = Math.max(realCount, baseline);

    if (next === c.totalChats) {
      console.log(`  ${c.displayName}: already ${c.totalChats} (real=${realCount}, baseline=${baseline})`);
      continue;
    }

    await prisma.creator.update({
      where: { id: c.id },
      data: { totalChats: next },
    });
    updated++;
    console.log(`  ${c.displayName}: ${c.totalChats} -> ${next} (real=${realCount}, baseline=${baseline})`);
  }

  console.log(`\nDone. Updated ${updated}/${creators.length} creators.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
