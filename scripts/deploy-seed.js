/**
 * Idempotent deploy seed: runs the full seed chain ONLY when the DB is empty
 * (zero users). Safe to run on every deploy — it becomes a no-op once the
 * DB is populated.
 *
 * Runs in order:
 *   1. prisma/seed.js               (admin + fan + demo creators + company)
 *   2. scripts/seed-featured-creators.js  (the 6 featured creators)
 *   3. scripts/backfill-creator-faq.js    (suggestedQuestions + chat floor)
 *   4. scripts/sync-creator-totalchats.js (reconcile totalChats with real counts)
 *
 * Usage:
 *   node scripts/deploy-seed.js
 *
 * Force re-run (skip empty-DB check):
 *   FORCE_SEED=yes node scripts/deploy-seed.js
 */

require('dotenv/config');
const path = require('path');
const { spawnSync } = require('child_process');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const STEPS = [
  { label: 'Core seed',        script: path.join(__dirname, '..', 'prisma', 'seed.js') },
  { label: 'Featured creators', script: path.join(__dirname, 'seed-featured-creators.js') },
  { label: 'FAQ backfill',      script: path.join(__dirname, 'backfill-creator-faq.js') },
  { label: 'Sync totalChats',   script: path.join(__dirname, 'sync-creator-totalchats.js') },
];

function run(label, script) {
  console.log(`\n=== ${label} (${path.basename(script)}) ===`);
  const result = spawnSync(process.execPath, [script], { stdio: 'inherit' });
  if (result.status !== 0) {
    throw new Error(`${label} failed with exit code ${result.status}`);
  }
}

async function main() {
  const userCount = await prisma.user.count();
  const force = process.env.FORCE_SEED === 'yes';

  if (userCount > 0 && !force) {
    console.log(`DB already has ${userCount} users — skipping seed. (Set FORCE_SEED=yes to run anyway.)`);
    return;
  }

  if (force) {
    console.log(`FORCE_SEED=yes — running seed chain even though DB has ${userCount} users.`);
  } else {
    console.log('DB is empty — running full seed chain.');
  }

  await prisma.$disconnect();

  for (const { label, script } of STEPS) {
    run(label, script);
  }

  console.log('\nDeploy seed complete.');
}

main().catch(async (e) => {
  console.error(e);
  try { await prisma.$disconnect(); } catch (_) { /* noop */ }
  process.exit(1);
});
