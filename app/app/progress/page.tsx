export const dynamic = "force-dynamic";

import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import { summarizeReasoningRuns } from "@/lib/reasoningEngine/analytics";
import { humanizeMisconceptionCategory } from "@/lib/reasoningEngine/contracts";
import { formatStudentState } from "@/lib/reasoningEngine/studentState";

type RecentRunRow = {
  id: string;
  mode: string;
  title: string | null;
  origin: string | null;
  confidence: number | null;
  trajectoryScore: number | null;
  searchDepth: number;
  beamWidth: number | null;
  candidatesGenerated: number | null;
  candidatesSelected: number | null;
  prunedCount: number | null;
  verificationApplied: boolean;
  metadata: unknown;
  createdAt: Date;
  deckId: string | null;
  candidates: Array<{
    id: string;
    rank: number;
    question: string;
    answer: string;
    score: number;
    verificationConfidence: number | null;
    selected: boolean;
    pruned: boolean;
    trajectoryDepth: number;
    sourceAttempt: number | null;
    difficulty: string | null;
    createdAt: Date;
  }>;
};

export default async function ProgressPage() {
  let clerkUserId: string | null = null;

  try {
    const authResult = await auth();
    clerkUserId = authResult.userId;
  } catch (error) {
    console.error("[Progress] Auth error:", error);
    return <StateMessage title="Authentication Error" body="Unable to authenticate this session. Check Clerk configuration before using the progress dashboard." tone="error" />;
  }

  if (!clerkUserId) redirect("/sign-in");

  try {
    await prisma.user.upsert({
      where: { clerkUserId },
      update: {},
      create: { clerkUserId },
    });
  } catch (error) {
    console.error("[Progress] Database error creating user:", error);
    return <StateMessage title="Database Connection Error" body="Unable to connect to the database for progress data. Check the Prisma database configuration before continuing." tone="error" />;
  }

  let userRecord: {
    id: string;
    xp: number;
    studyStreak: number;
    xpToday: number;
    xpTodayDate: Date | null;
    dailyGoal: number;
    studentState: Parameters<typeof formatStudentState>[0];
  } | null = null;

  let recentRuns: RecentRunRow[] = [];
  let studentStateUnavailable = false;
  let reasoningRunsUnavailable = false;
  let decks: Array<{
    id: string;
    title: string;
    cards: Array<{ question: string; answer: string }>;
  }> = [];

  try {
    userRecord = await prisma.user.findFirst({
      where: { clerkUserId },
      select: {
        id: true,
        xp: true,
        studyStreak: true,
        xpToday: true,
        xpTodayDate: true,
        dailyGoal: true,
        studentState: true,
      },
    });
  } catch (error: any) {
    const message = String(error?.message || "");
    studentStateUnavailable = /StudentState|relation .* does not exist|table .* does not exist/i.test(message);
    if (!studentStateUnavailable) {
      console.error("[Progress] Failed to load user progress state:", error);
      return <StateMessage title="Progress Unavailable" body="The dashboard could not load user progress data right now." tone="error" />;
    }

    userRecord = await prisma.user.findFirst({
      where: { clerkUserId },
      select: {
        id: true,
        xp: true,
        studyStreak: true,
        xpToday: true,
        xpTodayDate: true,
        dailyGoal: true,
      },
    }) as typeof userRecord;
  }

  if (!userRecord) {
    return <StateMessage title="Progress Not Ready" body="Your study profile has not been initialized yet. Start a session and return here once you have created or reviewed some study material." tone="empty" />;
  }

  try {
    recentRuns = await prisma.reasoningRun.findMany({
      where: {
        userId: userRecord.id,
        mode: { in: ["tutor_guidance", "study_recovery", "verify_answer", "compare_explanations"] },
      },
      orderBy: { createdAt: "desc" },
      take: 36,
      select: {
        id: true,
        mode: true,
        title: true,
        origin: true,
        confidence: true,
        trajectoryScore: true,
        searchDepth: true,
        beamWidth: true,
        candidatesGenerated: true,
        candidatesSelected: true,
        prunedCount: true,
        verificationApplied: true,
        metadata: true,
        createdAt: true,
        deckId: true,
        candidates: {
          orderBy: [{ rank: "asc" }, { createdAt: "asc" }],
          take: 6,
          select: {
            id: true,
            rank: true,
            question: true,
            answer: true,
            score: true,
            verificationConfidence: true,
            selected: true,
            pruned: true,
            trajectoryDepth: true,
            sourceAttempt: true,
            difficulty: true,
            createdAt: true,
          },
        },
      },
    });
  } catch (error: any) {
    const message = String(error?.message || "");
    reasoningRunsUnavailable = /ReasoningRun|relation .* does not exist|table .* does not exist/i.test(message);
    if (!reasoningRunsUnavailable) {
      console.error("[Progress] Failed to load reasoning runs:", error);
      return <StateMessage title="Progress Unavailable" body="The dashboard could not load study analytics right now." tone="error" />;
    }
  }

  try {
    decks = await prisma.deck.findMany({
      where: { userId: userRecord.id },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        title: true,
        cards: {
          select: {
            question: true,
            answer: true,
          },
        },
      },
      take: 24,
    });
  } catch (error) {
    console.error("[Progress] Failed to load decks for recommendations:", error);
  }

  const studentState = studentStateUnavailable ? null : formatStudentState(userRecord.studentState ?? null);
  const analytics = reasoningRunsUnavailable ? null : summarizeReasoningRuns(recentRuns);
  const xpToday = getXpToday(userRecord.xpToday, userRecord.xpTodayDate);
  const confidenceSeries = recentRuns
    .slice(0, 8)
    .reverse()
    .map((run, index) => ({
      label: `S${index + 1}`,
      value: clampUnit(run.confidence ?? 0),
    }));
  const recommendedTopics = buildRecommendedTopics(studentState, analytics, decks);
  const misconceptionCards = buildMisconceptionCards(studentState, analytics);
  const strategyPatterns = analytics?.strategyWinsByMisconception.slice(0, 3) || [];
  const recentWins = studentState?.recentSuccesses.slice(0, 4) || [];
  const recentRecoveryNeeds = studentState?.recentFailures.slice(0, 4) || [];
  const recoveryTimeline = buildRecoveryTimeline(recentRuns);
  const recoverySummary = summarizeRecoveryTimeline(recoveryTimeline);

  return (
    <main className="mx-auto max-w-6xl space-y-8 px-6 py-8">
      <section className="flex flex-col gap-4 rounded-3xl border border-gray-200 bg-gradient-to-r from-sky-50 via-white to-emerald-50 p-8 lg:flex-row lg:items-end lg:justify-between">
        <div className="max-w-3xl space-y-3">
          <p className="text-sm font-medium uppercase tracking-[0.18em] text-sky-700">Student progress</p>
          <h1 className="text-3xl font-semibold tracking-tight text-gray-950 sm:text-4xl">Progress and recovery dashboard</h1>
          <p className="text-base leading-7 text-gray-600">
            This dashboard shows study momentum, recurring misconceptions, recovery patterns, and the next topics to strengthen. It is designed for student visibility, not internal governance operations.
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Link href="/app" className="rounded-full border border-gray-300 bg-white px-5 py-3 text-sm font-medium text-gray-900 hover:bg-gray-50">
            Back to study workspace
          </Link>
          <Link href="/how-adaptive-guidance-works" className="rounded-full bg-gray-950 px-5 py-3 text-sm font-medium text-white hover:bg-gray-800">
            Review adaptive guidance
          </Link>
        </div>
      </section>

      {(studentStateUnavailable || reasoningRunsUnavailable) && (
        <section className="rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-900">
          {studentStateUnavailable && "Student-state history is not available yet in this environment. Apply the latest Prisma migration to unlock saved misconception and recovery state. "}
          {reasoningRunsUnavailable && "Reasoning-run analytics are not available yet in this environment. Apply the latest Prisma migration to unlock recent study trends and guidance patterns."}
        </section>
      )}

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Current study streak" value={`${userRecord.studyStreak} day${userRecord.studyStreak === 1 ? "" : "s"}`} detail="Consistency matters more than raw session length." tone="sky" />
        <MetricCard label="Today's study goal" value={`${xpToday}/${userRecord.dailyGoal} XP`} detail={xpToday >= userRecord.dailyGoal ? "Daily goal reached." : `${Math.max(0, userRecord.dailyGoal - xpToday)} XP to go today.`} tone="emerald" />
        <MetricCard label="Verification success" value={`${Math.round((studentState?.retentionProfile.recentVerificationSuccessRate ?? 0) * 100)}%`} detail={`${studentState?.retentionProfile.successfulChecks ?? 0} successful checks across recent study history.`} tone="amber" />
        <MetricCard label="Recent tutoring runs" value={String(analytics?.totalRuns ?? 0)} detail={`${analytics?.verificationRuns ?? 0} runs included verification support.`} tone="violet" />
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
        <div className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-xl font-semibold text-gray-950">Confidence trend</h2>
              <p className="mt-2 text-sm leading-6 text-gray-600">
                Recent tutoring and verification confidence over the last few sessions. This helps show whether understanding is stabilizing.
              </p>
            </div>
            <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-700">
              Average {Math.round((analytics?.averageConfidence ?? 0) * 100)}%
            </span>
          </div>

          {confidenceSeries.length === 0 ? (
            <EmptyInlineState body="Start studying to populate your confidence trend." />
          ) : (
            <div className="mt-6 flex items-end gap-3">
              {confidenceSeries.map((point) => (
                <div key={point.label} className="flex flex-1 flex-col items-center gap-2">
                  <div className="flex h-40 w-full items-end rounded-2xl bg-gray-50 px-2 pb-2">
                    <div
                      className="w-full rounded-xl bg-gradient-to-t from-sky-600 to-emerald-400"
                      style={{ height: `${Math.max(8, Math.round(point.value * 100))}%` }}
                    />
                  </div>
                  <span className="text-xs text-gray-500">{point.label}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
          <h2 className="text-xl font-semibold text-gray-950">Recommended next topics</h2>
          <p className="mt-2 text-sm leading-6 text-gray-600">
            These recommendations are derived from your recent weak concepts, misconceptions, and study outcomes.
          </p>
          <div className="mt-5 space-y-3">
            {recommendedTopics.length === 0 ? (
              <EmptyInlineState body="Recommendations will appear once you have more tutoring or verification history." />
            ) : (
              recommendedTopics.map((topic) => (
                <div key={topic.title} className="rounded-2xl border border-gray-200 bg-gray-50 p-4">
                  <div className="flex items-center justify-between gap-4">
                    <h3 className="font-medium text-gray-950">{topic.title}</h3>
                    <span className="rounded-full bg-white px-2.5 py-1 text-xs font-medium text-gray-600">{topic.badge}</span>
                  </div>
                  <p className="mt-2 text-sm leading-6 text-gray-600">{topic.reason}</p>
                  {topic.href ? (
                    <div className="mt-4 flex items-center justify-between gap-3">
                      <p className="text-xs text-gray-500">
                        {topic.actionLabel === "Resume this concept" ? "Focuses the study queue on the closest matching deck material." : "Returns you to a relevant study flow with the current recommendation context."}
                      </p>
                      <Link
                        href={topic.href}
                        className="rounded-full bg-gray-950 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
                      >
                        {topic.actionLabel}
                      </Link>
                    </div>
                  ) : null}
                </div>
              ))
            )}
          </div>
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-3">
        <div className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm xl:col-span-2">
          <h2 className="text-xl font-semibold text-gray-950">Misconception patterns</h2>
          <p className="mt-2 text-sm leading-6 text-gray-600">
            These are the learning patterns the system is watching so tutoring can reinforce the right next step.
          </p>
          <div className="mt-5 grid gap-4 md:grid-cols-2">
            {misconceptionCards.length === 0 ? (
              <div className="md:col-span-2">
                <EmptyInlineState body="Misconception patterns will appear after you complete more guided study or answer verification sessions." />
              </div>
            ) : (
              misconceptionCards.map((item) => (
                <article key={item.title} className="rounded-2xl border border-gray-200 bg-gray-50 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="font-medium text-gray-950">{item.title}</h3>
                    <span className="text-xs font-medium text-gray-500">{item.meta}</span>
                  </div>
                  <p className="mt-2 text-sm leading-6 text-gray-600">{item.description}</p>
                </article>
              ))
            )}
          </div>
        </div>

        <div className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
          <h2 className="text-xl font-semibold text-gray-950">Study cadence</h2>
          <p className="mt-2 text-sm leading-6 text-gray-600">
            A lightweight view of consistency and pacing, so you can see whether effort is becoming steadier over time.
          </p>
          <dl className="mt-5 space-y-4 text-sm text-gray-700">
            <div className="flex items-start justify-between gap-4 border-b border-gray-100 pb-3">
              <dt className="font-medium text-gray-900">Lifetime XP</dt>
              <dd>{userRecord.xp}</dd>
            </div>
            <div className="flex items-start justify-between gap-4 border-b border-gray-100 pb-3">
              <dt className="font-medium text-gray-900">Verification attempts</dt>
              <dd>{studentState?.pacingProfile.verificationAttempts ?? 0}</dd>
            </div>
            <div className="flex items-start justify-between gap-4 border-b border-gray-100 pb-3">
              <dt className="font-medium text-gray-900">Low-confidence streak</dt>
              <dd>{studentState?.pacingProfile.lowConfidenceStreak ?? 0}</dd>
            </div>
            <div className="flex items-start justify-between gap-4">
              <dt className="font-medium text-gray-900">Preferred explanation style</dt>
              <dd>{studentState?.preferredExplanationStyle ?? "Still learning"}</dd>
            </div>
          </dl>
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-2">
        <div className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
          <h2 className="text-xl font-semibold text-gray-950">Recovery progress</h2>
          <p className="mt-2 text-sm leading-6 text-gray-600">
            Recent wins and recovery needs make it easier to see where understanding is improving and where more repetition will help.
          </p>
          <div className="mt-5 grid gap-4 md:grid-cols-2">
            <div>
              <h3 className="text-sm font-medium uppercase tracking-[0.16em] text-emerald-700">Recent wins</h3>
              <div className="mt-3 space-y-3">
                {recentWins.length === 0 ? (
                  <EmptyInlineState body="Successful recovery examples will appear here after more guided study sessions." compact />
                ) : (
                  recentWins.map((item) => (
                    <div key={item} className="rounded-2xl bg-emerald-50 p-3 text-sm leading-6 text-emerald-950">
                      {item}
                    </div>
                  ))
                )}
              </div>
            </div>
            <div>
              <h3 className="text-sm font-medium uppercase tracking-[0.16em] text-amber-700">Needs reinforcement</h3>
              <div className="mt-3 space-y-3">
                {recentRecoveryNeeds.length === 0 ? (
                  <EmptyInlineState body="Topics that still need reinforcement will appear here as the system learns more about your study patterns." compact />
                ) : (
                  recentRecoveryNeeds.map((item) => (
                    <div key={item} className="rounded-2xl bg-amber-50 p-3 text-sm leading-6 text-amber-950">
                      {item}
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
          <h2 className="text-xl font-semibold text-gray-950">Recovery timeline</h2>
          <p className="mt-2 text-sm leading-6 text-gray-600">
            This shows whether confidence is rebuilding, which topics are stabilizing, and where you are still revisiting the same kind of difficulty.
          </p>
          {recoverySummary ? (
            <div className="mt-4 rounded-2xl border border-sky-100 bg-sky-50 p-4 text-sm leading-6 text-sky-950">
              {recoverySummary}
            </div>
          ) : null}
          <div className="mt-5 space-y-4">
            {recoveryTimeline.length === 0 ? (
              <EmptyInlineState body="Recovery events will appear here after more coached study reviews are recorded." />
            ) : (
              recoveryTimeline.map((event) => (
                <article key={event.id} className="rounded-2xl border border-gray-200 bg-gray-50 p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h3 className="font-medium text-gray-950">{event.headline}</h3>
                      <p className="mt-1 text-xs uppercase tracking-[0.14em] text-gray-500">{event.when}</p>
                    </div>
                    <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${event.toneClass}`}>
                      {event.badge}
                    </span>
                  </div>
                  <p className="mt-3 text-sm leading-6 text-gray-600">{event.description}</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {event.tags.map((tag) => (
                      <span key={tag} className="rounded-full border border-gray-200 bg-white px-3 py-1 text-xs text-gray-600">
                        {tag}
                      </span>
                    ))}
                  </div>
                </article>
              ))
            )}
          </div>
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-1">
        <div className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
          <h2 className="text-xl font-semibold text-gray-950">Helpful guidance patterns</h2>
          <p className="mt-2 text-sm leading-6 text-gray-600">
            This summarizes which tutoring styles have been most helpful across your recent misconception categories.
          </p>
          <div className="mt-5 space-y-4">
            {strategyPatterns.length === 0 ? (
              <EmptyInlineState body="Guidance patterns will appear once you have more tutoring guidance history." />
            ) : (
              strategyPatterns.map((pattern) => (
                <article key={pattern.category} className="rounded-2xl border border-gray-200 bg-gray-50 p-4">
                  <div className="flex items-center justify-between gap-4">
                    <h3 className="font-medium text-gray-950">{humanizeMisconceptionCategory(pattern.category)}</h3>
                    <span className="text-xs font-medium text-gray-500">{pattern.runCount} run{pattern.runCount === 1 ? "" : "s"}</span>
                  </div>
                  <p className="mt-2 text-sm leading-6 text-gray-600">
                    {pattern.topStrategy
                      ? `Most helpful recent pattern: ${trimText(pattern.topStrategy, 96)}${pattern.topStrategyType ? ` (${pattern.topStrategyType.toLowerCase()})` : ""}.`
                      : "The system is still learning which guidance pattern works best here."}
                  </p>
                </article>
              ))
            )}
          </div>
        </div>
      </section>
    </main>
  );
}

function MetricCard({
  label,
  value,
  detail,
  tone,
}: {
  label: string;
  value: string;
  detail: string;
  tone: "sky" | "emerald" | "amber" | "violet";
}) {
  const toneClasses = {
    sky: "from-sky-50 to-white text-sky-900 border-sky-100",
    emerald: "from-emerald-50 to-white text-emerald-900 border-emerald-100",
    amber: "from-amber-50 to-white text-amber-900 border-amber-100",
    violet: "from-violet-50 to-white text-violet-900 border-violet-100",
  };

  return (
    <article className={`rounded-3xl border bg-gradient-to-br p-5 shadow-sm ${toneClasses[tone]}`}>
      <p className="text-sm font-medium text-gray-600">{label}</p>
      <p className="mt-3 text-3xl font-semibold tracking-tight text-gray-950">{value}</p>
      <p className="mt-2 text-sm leading-6 text-gray-600">{detail}</p>
    </article>
  );
}

function EmptyInlineState({ body, compact = false }: { body: string; compact?: boolean }) {
  return (
    <div className={`rounded-2xl border border-dashed border-gray-300 bg-gray-50 text-sm leading-6 text-gray-500 ${compact ? "p-3" : "p-4 mt-5"}`}>
      {body}
    </div>
  );
}

function StateMessage({
  title,
  body,
  tone,
}: {
  title: string;
  body: string;
  tone: "error" | "empty";
}) {
  const palette = tone === "error"
    ? "border-red-300 bg-red-50 text-red-900"
    : "border-gray-300 bg-gray-50 text-gray-900";
  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <div className={`rounded-3xl border p-6 ${palette}`}>
        <h1 className="text-xl font-semibold">{title}</h1>
        <p className="mt-3 text-sm leading-6">{body}</p>
      </div>
    </main>
  );
}

function getXpToday(xpToday: number, xpTodayDate: Date | null): number {
  if (!xpTodayDate) return 0;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const compare = new Date(xpTodayDate);
  compare.setHours(0, 0, 0, 0);
  return Number(compare) === Number(today) ? xpToday : 0;
}

function clampUnit(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function buildRecommendedTopics(
  studentState: ReturnType<typeof formatStudentState> | null,
  analytics: ReturnType<typeof summarizeReasoningRuns> | null,
  decks: Array<{ id: string; title: string; cards: Array<{ question: string; answer: string }> }>
) {
  const topics = (studentState?.weakConcepts || []).slice(0, 3).map((concept) => ({
    title: titleCase(concept),
    badge: "Weak topic",
    reason: "This concept has appeared in your recent weak-topic memory, so it is a good candidate for targeted review and short verification cycles.",
    recommendationKey: concept,
    actionLabel: "Resume this concept",
  }));

  const misconception = analytics?.byMisconception[0];
  if (misconception) {
    topics.push({
      title: humanizeMisconceptionCategory(misconception.category),
      badge: "Recovery focus",
      reason: "This misconception pattern has appeared most often in recent study history, so extra worked examples and slower step-by-step tutoring are likely to help.",
      recommendationKey: misconception.category,
      actionLabel: "Continue recovery",
    });
  }

  const recentFailure = studentState?.recentFailures[0];
  if (recentFailure) {
    topics.push({
      title: "Recent difficult prompt",
      badge: "Revisit",
      reason: trimText(recentFailure, 132),
      recommendationKey: recentFailure,
      actionLabel: "Revisit this prompt",
    });
  }

  return dedupeByTitle(topics)
    .map((topic) => ({
      ...topic,
      href: buildRecommendationHref(decks, topic.recommendationKey, topic.reason, topic.badge),
    }))
    .slice(0, 4);
}

function buildMisconceptionCards(
  studentState: ReturnType<typeof formatStudentState> | null,
  analytics: ReturnType<typeof summarizeReasoningRuns> | null
) {
  const fromState = (studentState?.misconceptionPatterns || []).slice(0, 4).map((pattern) => ({
    title: humanizeMisconceptionCategory(pattern),
    meta: "Student memory",
    description: "This pattern has been saved in your learning memory, which means the system has seen it recur and will keep adapting explanations around it.",
  }));

  const fromAnalytics = (analytics?.confidenceByMisconception || []).slice(0, 4).map((entry) => ({
    title: humanizeMisconceptionCategory(entry.category),
    meta: `${Math.round(entry.averageConfidence * 100)}% avg confidence`,
    description: `${entry.runCount} recent run${entry.runCount === 1 ? "" : "s"} touched this area, with ${entry.lowConfidenceRuns} low-confidence result${entry.lowConfidenceRuns === 1 ? "" : "s"}.`,
  }));

  return dedupeByTitle([...fromAnalytics, ...fromState]).slice(0, 4);
}

function buildRecoveryTimeline(runs: RecentRunRow[]) {
  return runs
    .filter((run) => run.mode === "study_recovery")
    .slice(0, 6)
    .map((run) => {
      const metadata = toRecord(run.metadata);
      const recovered = metadata.recovered === true;
      const stabilized = metadata.stabilized === true;
      const priorConfidence = toFiniteNumber(metadata.priorConfidence);
      const postReviewConfidence = toFiniteNumber(metadata.postReviewConfidence);
      const confidenceDelta = toFiniteNumber(metadata.confidenceDelta);
      const selectedStrategy = toRecord(metadata.selectedStrategy);
      const misconceptionSignals = toStringArray(metadata.misconceptionSignals).slice(0, 2);
      const weakTopics = toStringArray(metadata.weakTopicMatches).slice(0, 2);
      const prompt = trimText(String(metadata.prompt || run.title || "Study recovery"), 110);

      const badge = stabilized ? "Stabilizing" : recovered ? "Recovering" : "Needs reinforcement";
      const toneClass = stabilized
        ? "bg-emerald-100 text-emerald-900"
        : recovered
          ? "bg-sky-100 text-sky-900"
          : "bg-amber-100 text-amber-900";

      const headline = stabilized
        ? "Confidence improved and this concept looks more stable"
        : recovered
          ? "You recovered after coaching and kept the session moving"
          : "This concept still needs another recovery pass";

      const descriptionParts = [
        `${Math.round(priorConfidence * 100)}% to ${Math.round(postReviewConfidence * 100)}% confidence after review`,
        selectedStrategy.label ? `with ${String(selectedStrategy.label).toLowerCase()}` : null,
        misconceptionSignals[0] ? `around ${humanizeMisconceptionCategory(misconceptionSignals[0])}` : null,
      ].filter(Boolean);

      return {
        id: run.id,
        when: formatRelativeDay(run.createdAt),
        badge,
        toneClass,
        headline,
        description: `${descriptionParts.join(" ")}. ${prompt}`,
        tags: dedupeByTitle(
          [
            ...misconceptionSignals.map((signal) => ({ title: humanizeMisconceptionCategory(signal) })),
            ...weakTopics.map((topic) => ({ title: titleCase(topic) })),
            { title: confidenceDelta >= 0 ? `+${Math.round(confidenceDelta * 100)} pts confidence` : `${Math.round(confidenceDelta * 100)} pts confidence` },
          ]
        ).map((item) => item.title),
      };
    });
}

function summarizeRecoveryTimeline(timeline: Array<{ badge: string }>) {
  if (!timeline.length) return null;

  const stabilizing = timeline.filter((event) => event.badge === "Stabilizing").length;
  const recovering = timeline.filter((event) => event.badge === "Recovering").length;
  const needsReinforcement = timeline.filter((event) => event.badge === "Needs reinforcement").length;

  if (stabilizing >= 2) {
    return "Recent recovery events suggest confidence is stabilizing in more than one area. Keep using focused review while the same concepts are still fresh.";
  }
  if (recovering > needsReinforcement) {
    return "Recent sessions show positive recovery momentum. You are rebuilding confidence, but a few topics still benefit from another short guided pass.";
  }
  return "Recent recovery is still uneven. The best next move is to keep revisiting the highlighted concepts with short, focused study cycles.";
}

function dedupeByTitle<T extends { title: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  const unique: T[] = [];
  for (const item of items) {
    if (seen.has(item.title)) continue;
    seen.add(item.title);
    unique.push(item);
  }
  return unique;
}

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function toFiniteNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

function trimText(value: string, limit: number): string {
  if (value.length <= limit) return value;
  return `${value.slice(0, Math.max(0, limit - 3)).trimEnd()}...`;
}

function titleCase(value: string): string {
  return String(value || "")
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function formatRelativeDay(date: Date): string {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(date);
  target.setHours(0, 0, 0, 0);
  const diffDays = Math.round((Number(today) - Number(target)) / 86_400_000);

  if (diffDays <= 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays} days ago`;
  return target.toLocaleDateString();
}

function buildRecommendationHref(
  decks: Array<{ id: string; title: string; cards: Array<{ question: string; answer: string }> }>,
  recommendationKey: string,
  reason: string,
  badge: string
) {
  const bestDeck = chooseBestDeckForConcept(decks, recommendationKey);
  if (!bestDeck) return null;

  const params = new URLSearchParams({
    concept: trimText(recommendationKey, 80),
    reason: trimText(reason, 160),
    source: badge.toLowerCase().replace(/\s+/g, "_"),
  });
  return `/app/deck/${bestDeck.id}?${params.toString()}`;
}

function chooseBestDeckForConcept(
  decks: Array<{ id: string; title: string; cards: Array<{ question: string; answer: string }> }>,
  recommendationKey: string
) {
  const query = recommendationKey.toLowerCase();
  let best: { id: string; title: string; score: number } | null = null;

  for (const deck of decks) {
    const cardScore = deck.cards.reduce((sum, card) => sum + rankConceptMatch(card.question, query) + rankConceptMatch(card.answer, query), 0);
    const titleScore = rankConceptMatch(deck.title, query);
    const score = cardScore + titleScore;
    if (!best || score > best.score) {
      best = { id: deck.id, title: deck.title, score };
    }
  }

  if (best?.score && best.score > 0) return best;
  return decks[0] ? { id: decks[0].id, title: decks[0].title, score: 0 } : null;
}

function rankConceptMatch(value: string, query: string): number {
  const haystack = String(value || "").toLowerCase();
  if (!haystack || !query) return 0;
  let score = 0;
  if (haystack.includes(query)) score += 4;
  for (const token of query.split(/\s+/).filter(Boolean)) {
    if (token.length < 3) continue;
    if (haystack.includes(token)) score += 1;
  }
  return score;
}