// ===========================================
// PRISMA CLIENT INSTANCE
// ===========================================

import { PrismaClient, Prisma } from "@prisma/client";

function buildPooledDatabaseUrl(): string | undefined {
  const base = process.env.DATABASE_URL;
  if (!base) return undefined;

  const limit = process.env.PRISMA_CONNECTION_LIMIT || '10';
  const timeout = process.env.PRISMA_POOL_TIMEOUT || '30';
  try {
    const url = new URL(base);
    if (!url.searchParams.has('connection_limit')) {
      url.searchParams.set('connection_limit', limit);
    }
    if (!url.searchParams.has('pool_timeout')) {
      url.searchParams.set('pool_timeout', timeout);
    }
    return url.toString();
  } catch {
    return base;
  }
}

const MAX_RETRIES = parseInt(process.env.PRISMA_RETRY_ATTEMPTS || '3');
const RETRY_BASE_MS = parseInt(process.env.PRISMA_RETRY_DELAY_MS || '150');

function isRetryableError(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientInitializationError) {
    // P1001: Can't reach DB server, P1002: DB server timed out during handshake
    return ['P1001', 'P1002'].includes(error.errorCode ?? '');
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return ['P1001', 'P1002'].includes(error.code);
  }
  return false;
}

function createClient() {
  const pooledUrl = buildPooledDatabaseUrl();

  const base = new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
    ...(pooledUrl ? { datasources: { db: { url: pooledUrl } } } : {}),
  });

  // Wrap every query with exponential-backoff retry for transient connection errors.
  // Delays: 150ms → 300ms → 600ms (3 attempts). Overridable via env vars.
  return base.$extends({
    query: {
      $allModels: {
        async $allOperations({ args, query }) {
          let attempt = 0;
          while (true) {
            try {
              return await query(args);
            } catch (error) {
              if (isRetryableError(error) && attempt < MAX_RETRIES) {
                attempt++;
                await new Promise(res =>
                  setTimeout(res, RETRY_BASE_MS * Math.pow(2, attempt - 1))
                );
                continue;
              }
              throw error;
            }
          }
        },
      },
    },
  });
}

const globalForPrisma = globalThis as unknown as {
  prisma: ReturnType<typeof createClient> | undefined;
};

export const prisma = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

export default prisma;
