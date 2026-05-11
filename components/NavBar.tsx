// components/NavBar.tsx
"use client";

import { Suspense } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { SignedIn, SignedOut, SignInButton, SignUpButton, UserButton } from "@clerk/nextjs";
import UserStatsPill from "@/components/UserStatsPill"; // remove this line + usage if you don't have the pill yet

export default function NavBar() {
  return (
    <header className="sticky top-0 z-50 bg-white/90 backdrop-blur border-b">
      <nav className="mx-auto max-w-6xl px-4 py-3 flex items-center justify-between">
        <Link href="/" className="font-semibold text-lg">
          QuickStud-E
        </Link>

        <div className="flex items-center gap-3">
          <Link href="/how-adaptive-guidance-works" className="text-sm px-3 py-1.5 rounded border hover:bg-gray-50">
            Resources
          </Link>

          <SignedIn>
            <Link href="/app" className="text-sm px-3 py-1.5 rounded border hover:bg-gray-50">
              Study
            </Link>
            <Link href="/app/progress" className="text-sm px-3 py-1.5 rounded border hover:bg-gray-50">
              Progress
            </Link>
          </SignedIn>

          <Suspense fallback={<SignedOutAuthButtons nextTarget="/app" />}>
            <SignedOutAuthButtonsFromLocation />
          </Suspense>

          <SignedIn>
            <UserStatsPill />
            <UserButton afterSignOutUrl="/" />
          </SignedIn>
        </div>
      </nav>
    </header>
  );
}

function SignedOutAuthButtonsFromLocation() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const nextTarget = buildAuthRedirectTarget(pathname, searchParams);
  return <SignedOutAuthButtons nextTarget={nextTarget} />;
}

function SignedOutAuthButtons({ nextTarget }: { nextTarget: string }) {
  return (
    <SignedOut>
      <SignInButton mode="modal" forceRedirectUrl={nextTarget} signUpForceRedirectUrl={nextTarget}>
        <button className="text-sm px-3 py-1.5 rounded bg-black text-white">Sign in</button>
      </SignInButton>
      <SignUpButton mode="modal" forceRedirectUrl={nextTarget} signInForceRedirectUrl={nextTarget}>
        <button className="text-sm px-3 py-1.5 rounded border">Create account</button>
      </SignUpButton>
    </SignedOut>
  );
}

function buildAuthRedirectTarget(
  pathname: string,
  searchParams: ReturnType<typeof useSearchParams>
) {
  if (pathname === "/") {
    const requestedTarget = searchParams.get("next");
    return normalizeNextTarget(requestedTarget);
  }

  const query = searchParams.toString();
  return normalizeNextTarget(query ? `${pathname}?${query}` : pathname);
}

function normalizeNextTarget(value: string | null | undefined) {
  const trimmed = String(value || "").trim();
  if (!trimmed.startsWith("/")) return "/app";
  if (trimmed.startsWith("//")) return "/app";
  return trimmed;
}
