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
      summary: "Start with bounded AI study generation and the core guided-review flow.",
      features: [
        "5 AI generations each month",
        "Guided review sets and study notes",
        "PDF and document study inputs",
        "Progress tracking across sessions",
      ],
      accent: "border-slate-200 bg-white",
      badge: "Start here",
    },
    {
      name: "Premium",
      price: "$9.99",
      cadence: "/month",
      summary: "Unlock the full adaptive study workflow for individual learners.",
      features: [
        "Unlimited AI generations",
        "Persistent tutor chat",
        "Whiteboard assist and presentation planning",
        "Stripe billing portal and self-serve cancellation",
      ],
      accent: "border-amber-300 bg-gradient-to-b from-amber-50 to-white",
      badge: "Most popular",
    },
  ] as const;
  const billingFaq = [
    {
      question: "Can I cancel anytime?",
      answer:
        "Yes. Paid plans are managed through Stripe's hosted billing portal, so you can cancel without contacting support. Your paid access stays active through the end of the current billing period.",
    },
    {
      question: "What happens if I downgrade or cancel?",
      answer:
        "Your existing account and study history remain in place. After the paid period ends, the account falls back to the free plan limits, including the monthly AI generation cap.",
    },
    {
      question: "Do you lock me into a long-term contract?",
      answer:
        "No. The current plans are monthly subscriptions. There is no annual commitment required to start using Premium.",
    },
    {
      question: "Why does the free plan have a limit?",
      answer:
        "The free plan is designed to let you evaluate the study workflow without opening unlimited AI usage. Paid plans cover the heavier generation volume and premium workspace tools.",
    },
    {
      question: "Are refunds automatic?",
      answer:
        "The current product flow emphasizes self-serve cancellation rather than promising automatic refunds. If you need an exception, billing review still has to be handled manually.",
    },
    {
      question: "What does Premium unlock immediately?",
      answer:
        "Premium removes the monthly AI generation cap and unlocks persistent tutor chat, whiteboard assist, and presentation planning as soon as Stripe confirms the subscription.",
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
                A calm adaptive tutor with a clear path from free study to full premium workflow.
              </h1>
              <p className="max-w-2xl text-base leading-8 text-slate-700 sm:text-lg">
                QuickStud-E helps you study with guided review, tutoring hints, progress memory, and recovery-aware recommendations that stay understandable from one session to the next.
              </p>
            </div>

            <div className="flex flex-wrap gap-2 text-sm text-slate-700">
              <span className="rounded-full border border-slate-200 bg-white/80 px-3 py-1">Guided study sessions</span>
              <span className="rounded-full border border-slate-200 bg-white/80 px-3 py-1">Tutor hints that react to your answer</span>
              <span className="rounded-full border border-slate-200 bg-white/80 px-3 py-1">Progress memory across sessions</span>
              <span className="rounded-full border border-slate-200 bg-white/80 px-3 py-1">Recovery-aware recommendations</span>
              <span className="rounded-full border border-slate-200 bg-white/80 px-3 py-1">Clear next-step explanations</span>
            </div>

            <p className="max-w-2xl text-sm leading-7 text-slate-500">
              The tutoring experience is adaptive, but its authority stays bounded. Recommendations are meant to feel useful and explainable, not opaque or over-controlling.
            </p>

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
                  <p className="mt-1 text-sm leading-6 text-slate-600">Enough to test guided review, document inputs, and study notes before committing.</p>
                </div>
                <div className="rounded-2xl border border-amber-200 bg-amber-50/90 p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-amber-800">Premium</p>
                  <p className="mt-2 text-2xl font-semibold text-slate-950">Unlimited</p>
                  <p className="mt-1 text-sm leading-6 text-slate-700">Best for learners who want tutor chat, whiteboard assist, and presentation planning in one flow.</p>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="space-y-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Pricing</p>
              <h2 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">Choose how much of the adaptive workflow you want unlocked.</h2>
            </div>
            <p className="max-w-xl text-sm leading-7 text-slate-600">
              Start free, then upgrade when you need persistent tutor continuity, workspace AI tools, and unlimited generation volume.
            </p>
          </div>

          <div className="grid gap-5 lg:grid-cols-2">
            {plans.map((plan) => (
              <article key={plan.name} className={`rounded-[1.75rem] border p-6 shadow-sm ${plan.accent}`}>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">{plan.badge}</p>
                    <h3 className="mt-3 text-2xl font-semibold text-slate-950">{plan.name}</h3>
                  </div>
                  <div className="text-right">
                    <p className="text-3xl font-semibold tracking-tight text-slate-950">{plan.price}</p>
                    <p className="text-sm text-slate-500">{plan.cadence}</p>
                  </div>
                </div>

                <p className="mt-4 text-sm leading-7 text-slate-700">{plan.summary}</p>

                <div className="mt-5 space-y-3">
                  {plan.features.map((feature) => (
                    <div key={feature} className="rounded-2xl border border-white/70 bg-white/70 px-4 py-3 text-sm text-slate-700">
                      {feature}
                    </div>
                  ))}
                </div>

                <div className="mt-6 flex flex-wrap gap-3">
                  <SignedOut>
                    <SignUpButton
                      mode="modal"
                      forceRedirectUrl={nextTarget}
                      signInForceRedirectUrl={nextTarget}
                    >
                      <button className="rounded-full bg-slate-950 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800">
                        {plan.name === "Free" ? "Create free account" : `Start ${plan.name}`}
                      </button>
                    </SignUpButton>
                  </SignedOut>
                  <SignedIn>
                    <Link
                      href={plan.name === "Free" ? "/app" : "/app/billing"}
                      className="rounded-full bg-slate-950 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
                    >
                      {plan.name === "Free" ? "Open study workspace" : `Choose ${plan.name}`}
                    </Link>
                  </SignedIn>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="grid gap-6 lg:grid-cols-[0.92fr_1.08fr]">
          <div className="rounded-[1.75rem] border border-slate-200 bg-white/85 p-6 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Billing policy</p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">The important billing terms are meant to be understandable before you create an account.</h2>
            <div className="mt-5 space-y-4 text-sm leading-7 text-slate-700">
              <p>Subscriptions are monthly, self-serve, and managed through Stripe.</p>
              <p>Cancellations stop future renewals, but they do not erase your account or your saved study material.</p>
              <p>When paid access ends, the account returns to the free plan instead of being locked out entirely.</p>
            </div>

            <div className="mt-6 rounded-3xl border border-amber-200 bg-amber-50 p-5">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-amber-800">Before signup</p>
              <ul className="mt-3 space-y-2 text-sm leading-7 text-slate-700">
                <li>Free accounts start with 5 AI generations each month.</li>
                <li>Premium is a recurring monthly subscription.</li>
                <li>Billing management and cancellation happen in the hosted Stripe portal.</li>
              </ul>
            </div>
          </div>

          <div className="space-y-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">FAQ</p>
              <h2 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">Common pricing objections, answered directly.</h2>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              {billingFaq.map((item) => (
                <article key={item.question} className="rounded-[1.5rem] border border-slate-200 bg-white/90 p-5 shadow-sm">
                  <h3 className="text-lg font-semibold text-slate-950">{item.question}</h3>
                  <p className="mt-3 text-sm leading-7 text-slate-700">{item.answer}</p>
                </article>
              ))}
            </div>
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
