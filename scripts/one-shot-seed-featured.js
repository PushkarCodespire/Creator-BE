/**
 * ONE-SHOT: seed the 6 featured creators + backfill FAQ + sync totalChats
 * on an already-populated DB. Used to recover from an earlier boot where
 * seed-featured-creators crashed on a missing require.
 *
 * Idempotency: checks for user `__featured_v1@system.local`. If present,
 * skips. Otherwise runs the three scripts and writes the marker.
 *
 * After this has run in prod, remove the `node scripts/one-shot-seed-featured.js &&`
 * prefix from the start script and delete this file.
 */

require('dotenv/config');
const path = require('path');
const { spawnSync } = require('child_process');
const { PrismaClient } = require('@prisma/client');

const MARKER_EMAIL = '__featured_v1@system.local';

const prisma = new PrismaClient();

async function hasMarker() {
  try {
    const row = await prisma.user.findUnique({ where: { email: MARKER_EMAIL } });
    return !!row;
  } catch (_e) {
    return false;
  }
}

function runNode(script) {
  const result = spawnSync(process.execPath, [script], {
    stdio: 'inherit',
    env: process.env,
  });
  if (result.status !== 0) {
    throw new Error(`${path.basename(script)} failed (exit ${result.status})`);
  }
}

async function main() {
  if (await hasMarker()) {
    console.log('[one-shot-seed-featured] marker found, skipping');
    return;
  }
  console.log('[one-shot-seed-featured] marker missing — running featured seed chain');

  await prisma.$disconnect();

  runNode(path.join(__dirname, 'seed-featured-creators.js'));
  runNode(path.join(__dirname, 'backfill-creator-faq.js'));
  runNode(path.join(__dirname, 'sync-creator-totalchats.js'));

  const post = new PrismaClient();
  const bcrypt = require('bcryptjs');
  const hash = await bcrypt.hash(`marker-${Date.now()}`, 4);
  await post.user.create({
    data: {
      email: MARKER_EMAIL,
      password: hash,
      name: 'featured seed marker (do not delete)',
      role: 'USER',
      isVerified: false,
    },
  });
  await post.$disconnect();
  console.log('[one-shot-seed-featured] marker written — done');
}

main()
  .catch(async (e) => {
    console.error('[one-shot-seed-featured] FAILED:', e);
    try { await prisma.$disconnect(); } catch (_) { /* noop */ }
    // Exit 0 so a failure here can't block the API from starting
    process.exit(0);
  })
  .finally(async () => {
    try { await prisma.$disconnect(); } catch (_) { /* noop */ }
  });
