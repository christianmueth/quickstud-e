// app/page.tsx
import Image from "next/image";
import Link from "next/link";
import { SignInButton, SignUpButton, SignedIn, SignedOut } from "@clerk/nextjs";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const resolvedSearchParams = await searchParams;
  const nextTarget = normalizeNextTarget(resolvedSearchParams.next);
  const plans = [
    {
      name: "Free",
      price: "$0",
      cadence: "/month",
      summary: "Core study flow with monthly limits.",
      accent: "border-slate-200 bg-white",
      badge: "Free",
    },
    {
      name: "Premium",
      price: "$2.99",
      cadence: "/month",
      summary: "Unlimited study generation and tutor tools.",
      accent: "border-amber-300 bg-gradient-to-b from-amber-50 to-white",
      badge: "Premium",
    },
  ] as const;

  return (
    <main className="min-h-[calc(100vh-64px)] bg-[radial-gradient(circle_at_top,_rgba(251,191,36,0.18),_transparent_28%),linear-gradient(180deg,_#fffdf8_0%,_#ffffff_42%,_#f8fbff_100%)] px-6 py-10 sm:py-16">
      <div className="mx-auto flex max-w-6xl flex-col gap-14">
        <section className="grid items-center gap-10 lg:grid-cols-[1.05fr_0.95fr]">
          <div className="space-y-6">
            <div className="inline-flex rounded-full border border-amber-200 bg-amber-50 px-4 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-amber-800">
              Guided study, then paid expansion
            </div>
            <div className="space-y-4">
              <h1 className="max-w-3xl text-4xl font-semibold tracking-tight text-slate-950 sm:text-6xl">
                Study with a calm adaptive tutor.
              </h1>
              <p className="max-w-2xl text-base leading-8 text-slate-700 sm:text-lg">
                Guided review, tutor help, and simple progress tracking.
              </p>
            </div>

            <div className="flex flex-wrap gap-2 text-sm text-slate-700">
              <span className="rounded-full border border-slate-200 bg-white/80 px-3 py-1">Guided study sessions</span>
              <span className="rounded-full border border-slate-200 bg-white/80 px-3 py-1">Tutor hints that react to your answer</span>
              <span className="rounded-full border border-slate-200 bg-white/80 px-3 py-1">Progress memory across sessions</span>
              <span className="rounded-full border border-slate-200 bg-white/80 px-3 py-1">Recovery-aware recommendations</span>
              <span className="rounded-full border border-slate-200 bg-white/80 px-3 py-1">Clear next-step explanations</span>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <Link
                href="/how-adaptive-guidance-works"
                className="rounded-full border border-slate-300 px-6 py-3 text-sm font-medium text-slate-800 hover:bg-white"
              >
                Explore resources
              </Link>

              <SignedOut>
                <SignUpButton
                  mode="modal"
                  forceRedirectUrl={nextTarget}
                  signInForceRedirectUrl={nextTarget}
                >
                  <button className="rounded-full bg-slate-950 px-6 py-3 text-sm font-medium text-white hover:bg-slate-800">
                    Start free
                  </button>
                </SignUpButton>
                <SignInButton
                  mode="modal"
                  forceRedirectUrl={nextTarget}
                  signUpForceRedirectUrl={nextTarget}
                >
                  <button className="rounded-full border border-slate-300 px-6 py-3 text-sm font-medium text-slate-800 hover:bg-white">
                    Sign in
                  </button>
                </SignInButton>
              </SignedOut>

              <SignedIn>
                <Link
                  href="/app"
                  className="rounded-full bg-slate-950 px-6 py-3 text-sm font-medium text-white hover:bg-slate-800"
                >
                  Open study workspace
                </Link>
              </SignedIn>
            </div>
          </div>

          <div className="relative overflow-hidden rounded-[2rem] border border-slate-200 bg-white/90 p-6 shadow-[0_28px_90px_rgba(15,23,42,0.08)] backdrop-blur">
            <div className="absolute -right-12 -top-12 h-40 w-40 rounded-full bg-amber-200/30 blur-3xl" />
            <div className="absolute -bottom-16 -left-10 h-48 w-48 rounded-full bg-sky-200/30 blur-3xl" />
            <div className="relative space-y-6">
              <div className="relative mx-auto h-40 w-40 sm:h-48 sm:w-48">
                <Image
                  src="/quickstud_e.png"
                  alt="QuickStud-E"
                  fill
                  sizes="(max-width: 640px) 160px, 192px"
                  className="object-contain"
                  priority
                />
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Free plan</p>
                  <p className="mt-2 text-2xl font-semibold text-slate-950">5 generations</p>
                  <p className="mt-1 text-sm leading-6 text-slate-600">Try the full study flow.</p>
                </div>
                <div className="rounded-2xl border border-amber-200 bg-amber-50/90 p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-amber-800">Premium</p>
                  <p className="mt-2 text-2xl font-semibold text-slate-950">$2.99</p>
                  <p className="mt-1 text-sm leading-6 text-slate-700">Unlimited access.</p>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="rounded-[1.75rem] border border-slate-200 bg-white/90 p-6 shadow-sm">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Plans</p>
              <h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">Free or Premium.</h2>
            </div>
            <p className="text-sm text-slate-600">Premium is $2.99/month. Cancel anytime.</p>
          </div>

          <div className="mt-5 grid gap-4 md:grid-cols-2">
            {plans.map((plan) => (
              <article key={plan.name} className={`rounded-2xl border p-4 ${plan.accent}`}>
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">{plan.badge}</p>
                    <h3 className="mt-1 text-lg font-semibold text-slate-950">{plan.name}</h3>
                  </div>
                  <div className="text-right">
                    <p className="text-2xl font-semibold text-slate-950">{plan.price}</p>
                    <p className="text-xs text-slate-500">{plan.cadence}</p>
                  </div>
                </div>
                <p className="mt-3 text-sm text-slate-700">{plan.summary}</p>
                <div className="mt-4 flex flex-wrap gap-3">
                  <SignedOut>
                    <SignUpButton
                      mode="modal"
                      forceRedirectUrl={nextTarget}
                      signInForceRedirectUrl={nextTarget}
                    >
                      <button className="rounded-full bg-slate-950 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800">
                        {plan.name === "Free" ? "Start free" : "Get Premium"}
                      </button>
                    </SignUpButton>
                  </SignedOut>
                  <SignedIn>
                    <Link
                      href={plan.name === "Free" ? "/app" : "/app/billing"}
                      className="rounded-full bg-slate-950 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
                    >
                      {plan.name === "Free" ? "Open app" : "Manage Premium"}
                    </Link>
                  </SignedIn>
                </div>
              </article>
            ))}
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
