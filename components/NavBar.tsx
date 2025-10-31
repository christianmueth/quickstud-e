// components/NavBar.tsx
"use client";

import Link from "next/link";
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
          <SignedIn>
            <Link href="/app" className="text-sm px-3 py-1.5 rounded border hover:bg-gray-50">
              My Decks
            </Link>
          </SignedIn>

          <SignedOut>
            <SignInButton mode="modal">
              <button className="text-sm px-3 py-1.5 rounded bg-black text-white">Sign in</button>
            </SignInButton>
            <SignUpButton mode="modal">
              <button className="text-sm px-3 py-1.5 rounded border">Create account</button>
            </SignUpButton>
          </SignedOut>

          <SignedIn>
            <UserStatsPill />
            <UserButton afterSignOutUrl="/" />
          </SignedIn>
        </div>
      </nav>
    </header>
  );
}
