import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "How Adaptive Guidance Works | QuickStud-E",
  description:
    "Learn how QuickStud-E personalizes tutoring with bounded guidance, interpretable recommendations, and calm study flow.",
};

const guidancePrinciples = [
  {
    title: "Guidance stays bounded",
    body: "QuickStud-E can suggest what to review next and how to explain it, but it does not quietly take control of your learning plan.",
  },
  {
    title: "Recommendations stay interpretable",
    body: "When the tutor brings a concept back, it should be because your recent answers, confidence, or recovery pattern made that choice reasonable.",
  },
  {
    title: "Progress matters more than automation",
    body: "The product is designed to feel like one calm tutor across a session, not like a black-box system making hidden decisions around you.",
  },
];

const signsTheTutorUses = [
  "recent hesitation on a concept",
  "repeated misconception patterns",
  "recovery after tutor help",
  "which explanation style has been helping most",
  "whether your confidence has been dropping across recent steps",
];

const whatItDoesNotDo = [
  "quietly widen its own authority",
  "replace your study judgment with hidden planner control",
  "treat one shaky answer as proof that you need a full curriculum change",
  "hide why a recommendation appeared",
];

export default function AdaptiveGuidancePage() {
  return (
    <main className="mx-auto max-w-5xl space-y-10 px-6 py-10">
      <section className="rounded-[2rem] border border-sky-200 bg-gradient-to-br from-sky-50 via-white to-cyan-50 p-8 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-700">Resources</p>
        <h1 className="mt-3 max-w-3xl text-4xl font-semibold tracking-tight text-slate-950">
          How adaptive guidance works in QuickStud-E
        </h1>
        <p className="mt-4 max-w-3xl text-sm leading-7 text-slate-700">
          The tutor uses your recent answers, recovery pattern, and study history to decide what kind of help is most useful next.
          The goal is not to act like an autonomous planner. The goal is to keep the next study step understandable, timely, and calm.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link
            href="/?next=%2Fapp"
            className="rounded-full bg-slate-950 px-5 py-2.5 text-sm font-medium text-white hover:bg-slate-800"
          >
            Start guided study
          </Link>
          <Link
            href="/"
            className="rounded-full border border-slate-300 px-5 py-2.5 text-sm font-medium text-slate-900 hover:bg-white"
          >
            Return home
          </Link>
        </div>
      </section>

      <section className="grid gap-5 md:grid-cols-3">
        {guidancePrinciples.map((principle) => (
          <article key={principle.title} className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-950">{principle.title}</h2>
            <p className="mt-3 text-sm leading-7 text-slate-700">{principle.body}</p>
          </article>
        ))}
      </section>

      <section className="grid gap-6 lg:grid-cols-[1.05fr_0.95fr]">
        <article className="rounded-3xl border border-emerald-200 bg-gradient-to-br from-emerald-50 via-white to-lime-50 p-6 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">What the tutor pays attention to</p>
          <ul className="mt-4 space-y-3 text-sm leading-7 text-slate-700">
            {signsTheTutorUses.map((item) => (
              <li key={item} className="rounded-2xl border border-emerald-100 bg-white/90 px-4 py-3">
                {item}
              </li>
            ))}
          </ul>
        </article>

        <article className="rounded-3xl border border-amber-200 bg-gradient-to-br from-amber-50 via-white to-orange-50 p-6 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-700">What it does not do</p>
          <ul className="mt-4 space-y-3 text-sm leading-7 text-slate-700">
            {whatItDoesNotDo.map((item) => (
              <li key={item} className="rounded-2xl border border-amber-100 bg-white/90 px-4 py-3">
                {item}
              </li>
            ))}
          </ul>
        </article>
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">In practice</p>
        <div className="mt-4 grid gap-4 md:grid-cols-3">
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <h2 className="text-base font-semibold text-slate-950">Before a session</h2>
            <p className="mt-2 text-sm leading-7 text-slate-700">
              The workspace can surface a suggested focus area and explain why it is showing up now.
            </p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <h2 className="text-base font-semibold text-slate-950">During a session</h2>
            <p className="mt-2 text-sm leading-7 text-slate-700">
              Tutor help reacts to your own answer first, so the coaching can target confusion instead of replacing your attempt.
            </p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <h2 className="text-base font-semibold text-slate-950">After a session</h2>
            <p className="mt-2 text-sm leading-7 text-slate-700">
              Reflection should tell you what improved, what still looks unstable, and what would make the next short session useful.
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}