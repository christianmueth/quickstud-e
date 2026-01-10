import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

// Public routes should include auth pages to avoid redirect loops
// You can extend this list with other public paths as needed
const isPublicRoute = createRouteMatcher([
  "/",
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/api/transcribe(.*)",
  "/api/youtube/transcript(.*)",
  "/api/youtube-transcript(.*)",
]);

export default clerkMiddleware(async (auth, request) => {
  const traceId = request.headers.get("x-quickstud-trace") || globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;

  // Propagate trace id to downstream handlers and back to the client.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-quickstud-trace", traceId);
  const response = NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });
  response.headers.set("x-quickstud-trace", traceId);

  // Optional test bypass for CLI smoke-tests without a Clerk session.
  // Requires setting FLASHCARDS_TEST_KEY in the environment and passing header:
  //   x-flashcards-test-key: <FLASHCARDS_TEST_KEY>
  const testKey = process.env.FLASHCARDS_TEST_KEY;
  const path = request.nextUrl.pathname;
  if (
    testKey &&
    (path.startsWith("/api/flashcards") ||
      path.startsWith("/api/blob-upload-url") ||
      path.startsWith("/api/youtube-transcript") ||
      path.startsWith("/api/youtube/runpod-transcribe")) &&
    request.headers.get("x-flashcards-test-key") === testKey
  ) {
    return response;
  }

  if (!isPublicRoute(request)) {
    await auth.protect();
  }

  return response;
});

export const config = {
  matcher: ["/((?!.+\\.[\\w]+$|_next).*)", "/", "/(api)(.*)"]
};
