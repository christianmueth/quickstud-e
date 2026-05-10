// app/page.tsx
import Image from "next/image";
import Link from "next/link";
import { SignedIn } from "@clerk/nextjs";

export default function Home() {
  return (
    <main className="flex min-h-[calc(100vh-64px)] items-center justify-center p-6">
      <div className="mx-auto max-w-4xl text-center space-y-6">
        {/* Logo / feature image */}
        <div className="relative mx-auto h-40 w-40 sm:h-48 sm:w-48">
          <Image
            src="/quickstud_e.png"   // put quickstud_e.png in /public
            alt="QuickStud-E"
            fill
            className="object-contain"
            priority
          />
        </div>

        {/* Headline + subcopy always visible */}
        <h1 className="text-3xl sm:text-5xl font-semibold">
          Replay-governed adaptive tutoring for real study work
        </h1>
        <p className="mx-auto max-w-2xl text-gray-600">
          QuickStud-E combines flashcards, tutoring hints, student-state memory, misconception tracking, and replay-visible adaptive decision support under strict rollout governance.
        </p>

        <div className="flex flex-wrap items-center justify-center gap-2 text-sm text-gray-700">
          <span className="rounded-full border border-gray-200 bg-gray-50 px-3 py-1">Flashcards and study decks</span>
          <span className="rounded-full border border-gray-200 bg-gray-50 px-3 py-1">AI tutoring and verification</span>
          <span className="rounded-full border border-gray-200 bg-gray-50 px-3 py-1">Student-state memory</span>
          <span className="rounded-full border border-gray-200 bg-gray-50 px-3 py-1">Misconception and recovery tracking</span>
          <span className="rounded-full border border-gray-200 bg-gray-50 px-3 py-1">Adaptive shadow scoring</span>
        </div>

        <p className="mx-auto max-w-2xl text-sm text-gray-500">
          The live product ships with adaptive scoring in shadow mode and heuristic tutoring still authoritative, so governed world-model-inspired decision support is available without unchecked planner authority.
        </p>

        <div className="flex flex-wrap items-center justify-center gap-3">
          <Link
            href="/how-adaptive-guidance-works"
            className="rounded-full border border-gray-300 px-6 py-3 text-sm font-medium text-gray-800 hover:bg-gray-50"
          >
            How adaptive guidance works
          </Link>

        {/* Center CTA only when signed IN */}
        <SignedIn>
          <div className="flex items-center justify-center">
            <Link
              href="/app"
              className="rounded-full bg-black px-6 py-3 text-white hover:opacity-90"
            >
              Open study workspace
            </Link>
          </div>
        </SignedIn>
        </div>
      </div>
    </main>
  );
}
