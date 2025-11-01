import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

// Public routes should include auth pages to avoid redirect loops
// You can extend this list with other public paths as needed
const isPublicRoute = createRouteMatcher([
  "/",
  "/sign-in(.*)",
  "/sign-up(.*)",
]);

export default clerkMiddleware(async (auth, request) => {
  if (!isPublicRoute(request)) {
    await auth.protect();
  }
});

export const config = {
  matcher: ["/((?!.+\\.[\\w]+$|_next).*)", "/", "/(api)(.*)"]
};
