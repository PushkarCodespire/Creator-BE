"use strict";
// ===========================================
// PRISMA CLIENT INSTANCE (Prisma v7)
// ===========================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.prisma = void 0;
const client_1 = require("@prisma/client");
const adapter_pg_1 = require("@prisma/adapter-pg");
const pg_1 = require("pg");
// Create Postgres connection pool
const pool = new pg_1.Pool({
    connectionString: process.env.DATABASE_URL,
});
// Create Prisma adapter
const adapter = new adapter_pg_1.PrismaPg(pool);
// Global caching (important for dev / hot reload)
const globalForPrisma = globalThis;
exports.prisma = globalForPrisma.prisma ??
    new client_1.PrismaClient({
        adapter,
        log: process.env.NODE_ENV === "development"
            ? ["query", "error", "warn"]
            : ["error"],
    });
if (process.env.NODE_ENV !== "production") {
    globalForPrisma.prisma = exports.prisma;
}
exports.default = exports.prisma;
