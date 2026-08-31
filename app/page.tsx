// app/page.tsx
import Link from "next/link";
import { SignInButton, SignUpButton, SignedIn, SignedOut } from "@clerk/nextjs";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const resolvedSearchParams = await searchParams;
  const nextTarget = normalizeNextTarget(resolvedSearchParams.next);

  return (
    <main className="min-h-[calc(100vh-64px)] bg-[linear-gradient(180deg,_#fffdf8_0%,_#ffffff_50%,_#f8fbff_100%)] px-6 py-12 sm:py-20">
      <div className="mx-auto grid max-w-4xl gap-12">
        <section className="max-w-2xl space-y-6">
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-amber-800">QuickStud-E</p>
          <div className="space-y-3">
            <h1 className="text-4xl font-semibold tracking-tight text-slate-950 sm:text-5xl">Study clearly.</h1>
            <p className="text-base leading-7 text-slate-700 sm:text-lg">Create study material, review it, and get help when you need it.</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <SignedOut>
              <SignUpButton mode="modal" forceRedirectUrl={nextTarget} signInForceRedirectUrl={nextTarget}>
                <button className="rounded-full bg-slate-950 px-5 py-2.5 text-sm font-medium text-white hover:bg-slate-800">Start free</button>
              </SignUpButton>
              <SignInButton mode="modal" forceRedirectUrl={nextTarget} signUpForceRedirectUrl={nextTarget}>
                <button className="rounded-full border border-slate-300 px-5 py-2.5 text-sm font-medium text-slate-800 hover:bg-white">Sign in</button>
              </SignInButton>
            </SignedOut>
            <SignedIn>
              <Link href="/app" className="rounded-full bg-slate-950 px-5 py-2.5 text-sm font-medium text-white hover:bg-slate-800">Open workspace</Link>
            </SignedIn>
            <Link href="/how-adaptive-guidance-works" className="text-sm font-medium text-slate-700 underline underline-offset-4">How it works</Link>
          </div>
        </section>

        <section className="border-y border-slate-200 py-5">
          <div className="grid gap-5 sm:grid-cols-[1fr_auto] sm:items-center">
            <div>
              <h2 className="font-semibold text-slate-950">Free</h2>
              <p className="mt-1 text-sm text-slate-600">Five study generations each month.</p>
            </div>
            <p className="text-lg font-semibold text-slate-950">$0</p>
          </div>
          <div className="mt-5 grid gap-5 border-t border-slate-200 pt-5 sm:grid-cols-[1fr_auto] sm:items-center">
            <div>
              <h2 className="font-semibold text-slate-950">Premium</h2>
              <p className="mt-1 text-sm text-slate-600">Unlimited generations and tutor tools.</p>
            </div>
            <p className="text-lg font-semibold text-slate-950">$2.99/month</p>
          </div>
        </section>
      </div>
    </main>
  );
}

function normalizeNextTarget(value: string | undefined) {
  const trimmed = String(value || "").trim();
  if (!trimmed.startsWith("/")) return "/app";
  if (trimmed.startsWith("//")) return "/app";
  return trimmed;
}
