import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

// Each PrismaClient opens its own pool of database connections, so the whole
// app should share one. In development, Next.js re-runs modules on every code
// change (hot reload); stashing the client on `globalThis` stops each reload
// from opening a fresh pool until Postgres runs out of connections.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function createClient() {
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
  return new PrismaClient({ adapter });
}

export const prisma = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
