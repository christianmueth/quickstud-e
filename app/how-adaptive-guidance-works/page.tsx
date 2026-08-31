import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "How Adaptive Guidance Works | QuickStud-E",
  description:
    "Learn how QuickStud-E personalizes tutoring with bounded guidance, interpretable recommendations, and calm study flow.",
};

export default function AdaptiveGuidancePage() {
  return (
    <main className="mx-auto max-w-4xl px-6 py-16 sm:py-24">
      <section className="max-w-2xl">
        <p className="text-sm font-semibold uppercase tracking-[0.18em] text-sky-700">QuickStud-E</p>
        <h1 className="mt-3 text-4xl font-semibold tracking-tight text-slate-950 sm:text-5xl">How it works</h1>
        <p className="mt-4 text-base leading-7 text-slate-700 sm:text-lg">
          Your recent study activity shapes the next helpful prompt, without taking over your plan.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link
            href="/app?tab=flashcards"
            className="rounded-full bg-slate-950 px-5 py-2.5 text-sm font-medium text-white hover:bg-slate-800"
          >
            Start guided study
          </Link>
        </div>
      </section>

      <section className="mt-14 grid border-y border-slate-200 py-5 sm:grid-cols-3">
        <article className="py-4 sm:px-5 sm:first:pl-0 sm:not-last:border-r sm:border-slate-200">
          <h2 className="font-semibold text-slate-950">Notice</h2>
          <p className="mt-1 text-sm text-slate-600">Answers and confidence.</p>
        </article>
        <article className="border-t border-slate-200 py-4 sm:border-t-0 sm:px-5 sm:not-last:border-r sm:border-slate-200">
          <h2 className="font-semibold text-slate-950">Guide</h2>
          <p className="mt-1 text-sm text-slate-600">A useful next step.</p>
        </article>
        <article className="border-t border-slate-200 py-4 sm:border-t-0 sm:pl-5">
          <h2 className="font-semibold text-slate-950">You decide</h2>
          <p className="mt-1 text-sm text-slate-600">Your plan stays yours.</p>
        </article>
      </section>
    </main>
  );
}