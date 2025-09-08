// components/NavBar.tsx
"use client";

import Link from "next/link";
import { SignedIn, SignedOut, UserButton } from "@clerk/nextjs";

export default function NavBar() {
  return (
    <nav className="flex items-center justify-between p-4 border-b">
      <Link href="/" className="font-semibold">QuickStud-E</Link>
      <div>
        <SignedIn>
          <UserButton afterSignOutUrl="/" />
        </SignedIn>
        <SignedOut>
          <Link href="/sign-in" className="mr-4 underline">Sign in</Link>
          <Link href="/sign-up" className="underline">Create account</Link>
        </SignedOut>
      </div>
    </nav>
  );
}
