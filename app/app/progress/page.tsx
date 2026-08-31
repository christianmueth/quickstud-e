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
    return <StateMessage title="We couldn't restore your study session." body="Sign in again to continue reviewing your progress and guided study history." tone="error" />;
  }

  if (!clerkUserId) redirect(`/?next=${encodeURIComponent("/app/progress")}`);

  try {
    await prisma.user.upsert({
      where: { clerkUserId },
      update: {},
      create: { clerkUserId },
    });
  } catch (error) {
    console.error("[Progress] Database error creating user:", error);
    return <StateMessage title="We couldn't load your progress right now." body="Your tutor history and recovery signals will appear again once the study data connection is back." tone="error" />;
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
  } catch (error: unknown) {
    const message = String(error?.message || "");
    studentStateUnavailable = /StudentState|relation .* does not exist|table .* does not exist/i.test(message);
    if (!studentStateUnavailable) {
      console.error("[Progress] Failed to load user progress state:", error);
      return <StateMessage title="Your progress view is temporarily unavailable." body="The tutor couldn't load your recent progress signals right now. Try again in a moment." tone="error" />;
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
    return <StateMessage title="Your progress view will appear soon." body="Start a guided session and this space will begin tracking your learning patterns, recovery moments, and next study focus." tone="empty" />;
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
  } catch (error: unknown) {
    const message = String(error?.message || "");
    reasoningRunsUnavailable = /ReasoningRun|relation .* does not exist|table .* does not exist/i.test(message);
    if (!reasoningRunsUnavailable) {
      console.error("[Progress] Failed to load reasoning runs:", error);
      return <StateMessage title="Your tutor read is temporarily unavailable." body="The progress view could not load your study analytics right now." tone="error" />;
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
  const recommendedTopics = buildRecommendedTopics(studentState, analytics, decks).slice(0, 3);
  const nextTopic = recommendedTopics.find((topic) => topic.href) || null;

  return (
    <main className="mx-auto max-w-6xl space-y-6 px-6 py-8">
      <section className="flex flex-wrap items-center justify-between gap-4 border-b border-gray-200 pb-6">
        <h1 className="text-3xl font-semibold tracking-tight text-gray-950">Progress</h1>
        <div className="flex flex-wrap gap-3">
          <Link href="/app" className="text-sm font-medium text-gray-700 underline underline-offset-4">
            Study
          </Link>
          <Link href="/how-adaptive-guidance-works" className="text-sm font-medium text-gray-700 underline underline-offset-4">
            How it works
          </Link>
        </div>
      </section>

      {(studentStateUnavailable || reasoningRunsUnavailable) && (
        <section className="rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-900">
          {studentStateUnavailable && "Student-state history is not available yet in this environment. Apply the latest Prisma migration to unlock saved misconception and recovery state. "}
          {reasoningRunsUnavailable && "Reasoning-run analytics are not available yet in this environment. Apply the latest Prisma migration to unlock recent study trends and guidance patterns."}
        </section>
      )}

      <section className="grid gap-3 sm:grid-cols-3">
        <MetricCard label="Streak" value={`${userRecord.studyStreak} day${userRecord.studyStreak === 1 ? "" : "s"}`} />
        <MetricCard label="Today" value={`${xpToday}/${userRecord.dailyGoal} XP`} />
        <MetricCard label="Confidence" value={`${Math.round((analytics?.averageConfidence ?? 0) * 100)}%`} />
      </section>

      <section className="border-y border-gray-200 py-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <h2 className="text-xl font-semibold text-gray-950">Next</h2>
          {nextTopic?.href ? (
            <Link href={nextTopic.href} className="rounded-full bg-gray-950 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800">
              {nextTopic.actionLabel}
            </Link>
          ) : (
            <Link href="/app" className="rounded-full bg-gray-950 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800">Start studying</Link>
          )}
        </div>
        {recommendedTopics.length === 0 ? (
          <p className="mt-3 text-sm text-gray-600">Study to see a recommendation.</p>
        ) : (
          <div className="mt-4 divide-y divide-gray-200 border-t border-gray-200">
            {recommendedTopics.map((topic) => (
              <div key={topic.title} className="flex items-center justify-between gap-4 py-3">
                <div>
                  <h3 className="font-medium text-gray-950">{topic.title}</h3>
                  <p className="mt-1 text-sm text-gray-600">{topic.badge}</p>
                </div>
                {topic.href ? <Link href={topic.href} className="text-sm font-medium text-gray-700 underline underline-offset-4">Open</Link> : null}
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}

function MetricCard({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <article className="border border-gray-200 bg-white p-5">
      <p className="text-sm font-medium text-gray-600">{label}</p>
      <p className="mt-2 text-2xl font-semibold tracking-tight text-gray-950">{value}</p>
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
    reason: "Review this topic.",
    recommendationKey: concept,
    actionLabel: "Resume this concept",
  }));

  const misconception = analytics?.byMisconception[0];
  if (misconception) {
    topics.push({
      title: humanizeMisconceptionCategory(misconception.category),
      badge: "Recovery focus",
      reason: "Continue this review.",
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

function buildProgressNarrative(
  studentState: ReturnType<typeof formatStudentState> | null,
  analytics: ReturnType<typeof summarizeReasoningRuns> | null,
  recoverySummary: string | null,
  recommendedTopics: Array<{ title: string; reason: string }>
) {
  const weakConcept = studentState?.weakConcepts[0];
  const recentFailure = studentState?.recentFailures[0];
  const recentSuccess = studentState?.recentSuccesses[0];
  const misconception = analytics?.byMisconception[0]?.category || studentState?.misconceptionPatterns[0] || null;
  const lowConfidenceStreak = studentState?.pacingProfile.lowConfidenceStreak ?? 0;
  const nextTopic = recommendedTopics[0];
  const topicLabel = weakConcept ? titleCase(weakConcept) : nextTopic?.title || "your next guided review topic";

  return {
    headline: weakConcept ? `${topicLabel} is still the concept to reinforce first.` : "The tutor can now point to one clear next reinforcement target.",
    summary: recoverySummary
      ? `${recoverySummary} The progress page should keep that thread intact by showing how the recent sessions connect, not just what they measured.`
      : nextTopic?.reason || "Your recent study history is starting to form a clearer learning narrative, so the next step should reinforce one concept rather than scatter attention across the whole library.",
    whatChanged: recentSuccess
      ? `A recent win suggests part of the material is becoming easier to retrieve, which means the tutor can now build on momentum instead of only reacting to struggle. ${trimText(recentSuccess, 120)}`
      : `The strongest change is structural: there is now enough history to stop giving generic next steps and start anchoring guidance around ${topicLabel}.`,
    stillUnstable: recentFailure
      ? `${trimText(recentFailure, 132)} still needs reinforcement, so the tutor should treat it as active learning work rather than a finished topic.`
      : misconception
        ? `${humanizeMisconceptionCategory(misconception)} remains the clearest instability pattern in the recent history, so worked examples and slower explanations are still the right posture here.`
        : lowConfidenceStreak > 0
          ? `There is still a low-confidence stretch in the recent study pattern, so pacing should stay calm and targeted until that stops repeating.`
          : `${topicLabel} looks improved, but the tutor should still treat it as recently recovering rather than fully stable.`,
    nextStep: weakConcept
      ? `Start the next guided pass with ${topicLabel}, and if the explanation begins to slow down again, use coaching early instead of waiting until the end of the session.`
      : nextTopic
        ? `Use the next guided session to resume ${nextTopic.title.toLowerCase()} directly so the current recovery thread stays intact between visits.`
        : `Run one short guided session and stay with the first concept that feels shaky until the explanation becomes cleaner, not merely familiar.`,
    resumeHref: nextTopic?.href || null,
    resumeLabel: nextTopic?.actionLabel || "Resume the next weak point",
    resumeReason: recentFailure
      ? `${trimText(recentFailure, 132)} is still unresolved, so the clearest next move is to revisit that exact weak point instead of widening the session.`
      : misconception
        ? `${topicLabel} still destabilizes around ${humanizeMisconceptionCategory(misconception).toLowerCase()}, so the clearest next move is a targeted revisit before treating the topic as secure.`
        : lowConfidenceStreak > 0
          ? `${topicLabel} is still inside a low-confidence stretch, so the next pass should reopen the same thread while the friction point is still identifiable.`
          : `${topicLabel} looks close to stable, but one more focused revisit will clarify whether the improvement is durable or only recent.`,
  };
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

function replaceHrefReason(href: string, reason: string) {
  const [path, queryString = ""] = href.split("?");
  const params = new URLSearchParams(queryString);
  params.set("reason", trimText(reason, 160));
  return `${path}?${params.toString()}`;
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

