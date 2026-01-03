import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

// Public routes should include auth pages to avoid redirect loops
// You can extend this list with other public paths as needed
const isPublicRoute = createRouteMatcher([
  "/",
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/api/transcribe(.*)",
  "/api/youtube/transcript(.*)",
]);

export default clerkMiddleware(async (auth, request) => {
  // Optional test bypass for CLI smoke-tests without a Clerk session.
  // Requires setting FLASHCARDS_TEST_KEY in the environment and passing header:
  //   x-flashcards-test-key: <FLASHCARDS_TEST_KEY>
  const testKey = process.env.FLASHCARDS_TEST_KEY;
  const path = request.nextUrl.pathname;
  if (
    testKey &&
    (path.startsWith("/api/flashcards") ||
      path.startsWith("/api/blob-upload-url") ||
      path.startsWith("/api/youtube/runpod-transcribe")) &&
    request.headers.get("x-flashcards-test-key") === testKey
  ) {
    return;
  }

  if (!isPublicRoute(request)) {
    await auth.protect();
  }
});

export const config = {
  matcher: ["/((?!.+\\.[\\w]+$|_next).*)", "/", "/(api)(.*)"]
};
