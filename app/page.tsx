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
          Turn slides & PDFs into flashcards
        </h1>
        <p className="text-gray-600">
          Paste text or upload a PDF/PPTX. Get study-ready cards in seconds.
        </p>

        {/* Center CTA only when signed IN */}
        <SignedIn>
          <div className="flex items-center justify-center">
            <Link
              href="/app"
              className="rounded-full bg-black px-6 py-3 text-white hover:opacity-90"
            >
              Create flashcards
            </Link>
          </div>
        </SignedIn>
      </div>
    </main>
  );
}
