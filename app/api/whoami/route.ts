// app/api/whoami/route.ts (or src/app/api/whoami/route.ts)
import { auth } from "@clerk/nextjs/server";

export const dynamic = "force-dynamic"; // avoid caching while testing

export async function GET() {
  const { userId, sessionId } = await auth();  // ← must await
  // Use nulls instead of undefined so they show up in JSON even when signed out
  return Response.json({
    userId: userId ?? null,
    sessionId: sessionId ?? null,
  });
}
