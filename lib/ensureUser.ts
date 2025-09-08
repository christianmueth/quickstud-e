// lib/ensureUser.ts
import { prisma } from "./db";

export async function ensureUser(clerkUserId: string) {
  return prisma.user.upsert({
    where: { clerkUserId },
    update: {},
    create: { clerkUserId },
  });
}
