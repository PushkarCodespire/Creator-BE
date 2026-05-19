import "dotenv/config";
import { defineConfig } from "prisma/config";

// Keep Prisma schema location only.
// Datasource URL is configured via environment (e.g. DATABASE_URL)
// or in the runtime adapter, not in this config file. This avoids
// PrismaConfigEnvError during CI when DATABASE_URL is not set.
const databaseUrl = process.env.DATABASE_URL;

export default defineConfig({
  schema: "prisma/schema.prisma",
  ...(databaseUrl
    ? {
      datasource: {
        url: databaseUrl,
      },
    }
    : {}),
});
