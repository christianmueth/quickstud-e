import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "How Adaptive Guidance Works | QuickStud-E",
  description:
    "Learn how QuickStud-E personalizes tutoring with student-state memory, replay review, governed adaptive scoring, and staged rollout safeguards.",
};

const sections = [
  {
    title: "Adaptive guidance",
    body:
      "QuickStud-E personalizes tutoring by comparing multiple guidance options and selecting the one that best fits the learner's current state. The goal is not to maximize novelty or automation. The goal is to provide the next helpful step with stable, inspectable reasoning.",
  },
  {
    title: "Learning memory",
    body:
      "The system keeps track of student progress, weak topics, and recurring misconceptions so tutoring can build on prior work instead of restarting from scratch. This memory supports continuity across study sessions and makes remediation more targeted.",
  },
  {
    title: "Replay and review",
    body:
      "Tutoring decisions are analyzed over time through replay-oriented review. That gives the team a way to inspect why a strategy was selected, compare alternatives, and study whether guidance choices are helping students recover from confusion more reliably.",
  },
  {
    title: "Governed adaptation",
    body:
      "Adaptive improvements are introduced under governance rather than silently pushed into live authority. New scoring logic is monitored, compared against the current heuristic baseline, and evaluated for stability before it can influence tutoring behavior.",
  },
  {
    title: "Shadow-first rollout",
    body:
      "New adaptive logic is first tested in shadow mode. That means QuickStud-E can score and analyze possible interventions without immediately changing what learners see. This lets the team collect evidence before expanding authority.",
  },
  {
    title: "Bounded authority and rollback",
    body:
      "When adaptive logic eventually gains more influence, that happens gradually, within explicit bounds, and with a rollback path. Human review, replay visibility, and operational checks remain part of the system so product behavior stays understandable and reversible.",
  },
];

export default function HowAdaptiveGuidanceWorksPage() {
  return (
    <main className="min-h-[calc(100vh-64px)] bg-gradient-to-b from-stone-50 via-white to-sky-50 px-6 py-16">
      <div className="mx-auto max-w-5xl space-y-12">
        <section className="space-y-6 text-center">
          <p className="text-sm font-medium uppercase tracking-[0.18em] text-sky-700">
            Trust and control
          </p>
          <h1 className="text-4xl font-semibold tracking-tight text-gray-950 sm:text-5xl">
            How adaptive guidance works
          </h1>
          <p className="mx-auto max-w-3xl text-lg leading-8 text-gray-600">
            QuickStud-E adapts tutoring by combining student-state memory, candidate guidance evaluation, and replay-based review. The system is designed to personalize help while keeping authority staged, observable, and reversible.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3 text-sm text-gray-700">
            <span className="rounded-full border border-sky-200 bg-white px-3 py-1">Personalized tutoring</span>
            <span className="rounded-full border border-sky-200 bg-white px-3 py-1">Misconception tracking</span>
            <span className="rounded-full border border-sky-200 bg-white px-3 py-1">Replay-based review</span>
            <span className="rounded-full border border-sky-200 bg-white px-3 py-1">Shadow-first rollout</span>
            <span className="rounded-full border border-sky-200 bg-white px-3 py-1">Bounded adaptive authority</span>
          </div>
        </section>

        <section className="grid gap-5 md:grid-cols-2">
          {sections.map((section) => (
            <article
              key={section.title}
              className="rounded-3xl border border-gray-200 bg-white/90 p-7 shadow-sm"
            >
              <h2 className="text-xl font-semibold text-gray-950">{section.title}</h2>
              <p className="mt-3 text-base leading-7 text-gray-600">{section.body}</p>
            </article>
          ))}
        </section>

        <section className="rounded-3xl border border-gray-200 bg-white p-8 shadow-sm">
          <div className="grid gap-6 md:grid-cols-2">
            <div>
              <h2 className="text-2xl font-semibold text-gray-950">What this means in practice</h2>
              <p className="mt-3 text-base leading-7 text-gray-600">
                Learners get a complete tutoring product today: study tools, tutoring hints, persistent progress context, misconception-aware guidance, and governed adaptive scoring. What they do not get is unchecked autonomous planner behavior.
              </p>
            </div>
            <div className="rounded-2xl bg-stone-50 p-5">
              <dl className="space-y-4 text-sm text-gray-700">
                <div className="flex items-start justify-between gap-4 border-b border-stone-200 pb-3">
                  <dt className="font-medium text-gray-900">Adaptive tutoring</dt>
                  <dd>Live</dd>
                </div>
                <div className="flex items-start justify-between gap-4 border-b border-stone-200 pb-3">
                  <dt className="font-medium text-gray-900">Student-state memory</dt>
                  <dd>Live</dd>
                </div>
                <div className="flex items-start justify-between gap-4 border-b border-stone-200 pb-3">
                  <dt className="font-medium text-gray-900">Replay-based review</dt>
                  <dd>Operational</dd>
                </div>
                <div className="flex items-start justify-between gap-4 border-b border-stone-200 pb-3">
                  <dt className="font-medium text-gray-900">Adaptive shadow scoring</dt>
                  <dd>Live in shadow mode</dd>
                </div>
                <div className="flex items-start justify-between gap-4">
                  <dt className="font-medium text-gray-900">Autonomous planner authority</dt>
                  <dd>Not live</dd>
                </div>
              </dl>
            </div>
          </div>
        </section>

        <section className="flex flex-col items-center justify-between gap-4 rounded-3xl bg-gray-950 px-8 py-10 text-center text-white md:flex-row md:text-left">
          <div className="max-w-2xl">
            <h2 className="text-2xl font-semibold">Built for trust, not hidden adaptation</h2>
            <p className="mt-3 text-base leading-7 text-gray-300">
              QuickStud-E improves tutoring through measured rollout, replay visibility, and bounded control. That makes personalization more reliable without asking learners to accept a black-box authority model.
            </p>
          </div>
          <Link
            href="/app"
            className="rounded-full bg-white px-6 py-3 text-sm font-medium text-gray-950 hover:bg-gray-100"
          >
            Open study workspace
          </Link>
        </section>
      </div>
    </main>
  );
}