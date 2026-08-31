export const dynamic = "force-dynamic";
import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import BillingActionButton from "@/components/BillingActionButton";
import { summarizeReasoningRuns } from "@/lib/reasoningEngine/analytics";
import { humanizeMisconceptionCategory } from "@/lib/reasoningEngine/contracts";
import { formatStudentState } from "@/lib/reasoningEngine/studentState";
import { formatPlanLabel, getBillingSnapshot } from "@/lib/billing";
import CreateForm from "@/components/CreateForm";
import DeckCarousel from "@/components/DeckCarousel";
import DeleteAllDecksButton from "@/components/DeleteAllDecksButton";
import TutorWorkspacePanel from "@/components/TutorWorkspacePanel";

type TutorMode = "study-plan" | "explanation" | "quiz-me";

export default async function AppPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; mode?: string }>;
}) {
  let userId: string | null = null;
  let billingSnapshot: Awaited<ReturnType<typeof getBillingSnapshot>> | null = null;
  const resolvedSearchParams = await searchParams;
  const activeTab = resolvedSearchParams.tab === "tutor" ? "tutor" : resolvedSearchParams.tab === "notes" ? "notes" : "flashcards";
  const activeTutorMode = normalizeTutorMode(resolvedSearchParams.mode);
  
  try {
    const authResult = await auth();
    userId = authResult.userId;
  } catch (error) {
    console.error("[App] Auth error:", error);
    return (
      <div className="max-w-2xl mx-auto p-6">
        <div className="border border-red-300 bg-red-50 p-4 rounded">
          <h2 className="font-semibold text-red-900">We couldn't restore your study session.</h2>
          <p className="text-sm text-red-700 mt-2">
            Return to the home page and sign in again to continue your guided study. If this keeps happening, the auth setup likely needs attention.
          </p>
        </div>
      </div>
    );
  }
  
  if (!userId) redirect(`/?next=${encodeURIComponent("/app")}`);

  try {
    billingSnapshot = await getBillingSnapshot(userId);
  } catch (error) {
    console.error("[App] Billing snapshot fallback:", error);
  }

  let decks: Array<{ id: string; title: string; createdAt: Date; _count: { cards: number } } > = [];
  let studyNotes: Array<{ id: string; title: string; source: string | null; createdAt: Date }> = [];
  let studentState: ReturnType<typeof formatStudentState> | null = null;
  let recentRuns: Array<{
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
  }> = [];

  const userRecord = await prisma.user.findFirst({
    where: { clerkUserId: userId },
    select: { id: true, studentState: true },
  }).catch(() => null);

  if (userRecord?.studentState) {
    studentState = formatStudentState(userRecord.studentState);
  }

  if (userRecord?.id) {
    recentRuns = await prisma.reasoningRun.findMany({
      where: {
        userId: userRecord.id,
        mode: { in: ["tutor_guidance", "study_recovery", "verify_answer", "compare_explanations"] },
      },
      orderBy: { createdAt: "desc" },
      take: 18,
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
          take: 4,
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
    }).catch(() => []);
  }

  try {
    decks = await prisma.deck.findMany({
      where: {
        user: { clerkUserId: userId },
        cards: { none: { question: "__STUDY_NOTE__" } },
      },
      orderBy: { createdAt: "desc" },
      select: { id: true, title: true, createdAt: true, _count: { select: { cards: true } } },
    });
  } catch (error) {
    console.error("[App] Error fetching decks:", error);
  }

  try {
    studyNotes = await prisma.deck.findMany({
      where: {
        user: { clerkUserId: userId },
        cards: { some: { question: "__STUDY_NOTE__" } },
      },
      orderBy: { createdAt: "desc" },
      select: { id: true, title: true, source: true, createdAt: true },
    });
  } catch (error) {
    console.error("[App] Error fetching study notes:", error);
  }

  const analytics = recentRuns.length ? summarizeReasoningRuns(recentRuns) : null;
  const workspaceTutorBrief = buildWorkspaceTutorBrief(studentState, analytics, decks.length);
  const memoryMoments = buildTutorMemoryMoments(studentState, analytics);
  const currentPlanLabel = billingSnapshot ? formatPlanLabel(billingSnapshot.plan) : "Free";
  const primaryWeakConcept = studentState?.weakConcepts[0] ? titleCase(studentState.weakConcepts[0]) : null;
  const tutorPrompts = [
    primaryWeakConcept ? `Why does ${primaryWeakConcept} keep showing up as a weak area for me?` : "What concept looks weakest right now?",
    "Build me a short study plan from my recent performance.",
    memoryMoments[0] ? `Use this recent pattern and tutor me through it: ${memoryMoments[0]}` : "What does my recent tutor history suggest I should do next?",
    recentRuns.length ? "What does my recent recovery performance say about my next step?" : "How should I start using the tutor before opening flashcards?",
  ];

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      <section className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-950">Study</h1>
        <div className="flex flex-wrap gap-3">
          <Link href="/app/progress" className="text-sm font-medium text-slate-700 underline underline-offset-4">Progress</Link>
        </div>
      </section>

      <DeckCarousel userId={userId} />

      <section className="rounded-3xl border border-slate-200 bg-white p-3 shadow-sm">
        <div className="flex flex-wrap gap-2">
          <Link
            href="/app?tab=flashcards"
            className={activeTab === "flashcards"
              ? "rounded-full bg-slate-950 px-4 py-2 text-sm font-medium text-white"
              : "rounded-full border border-slate-300 px-4 py-2 text-sm font-medium text-slate-900 hover:bg-slate-50"
            }
          >
            Study sets
          </Link>
          <Link
            href={`/app?tab=tutor&mode=${activeTutorMode}`}
            className={activeTab === "tutor"
              ? "rounded-full bg-slate-950 px-4 py-2 text-sm font-medium text-white"
              : "rounded-full border border-slate-300 px-4 py-2 text-sm font-medium text-slate-900 hover:bg-slate-50"
            }
          >
            Tutor
          </Link>
          <Link
            href="/app?tab=notes"
            className={activeTab === "notes"
              ? "rounded-full bg-slate-950 px-4 py-2 text-sm font-medium text-white"
              : "rounded-full border border-slate-300 px-4 py-2 text-sm font-medium text-slate-900 hover:bg-slate-50"
            }
          >
            Notes
          </Link>
        </div>
      </section>

      {activeTab === "tutor" ? (
        <TutorWorkspacePanel
          isPaid={Boolean(billingSnapshot?.isPaid)}
          planLabel={currentPlanLabel}
          initialMode={activeTutorMode}
          performanceSummary={{
            headline: workspaceTutorBrief.headline,
            summary: workspaceTutorBrief.summary,
            cues: workspaceTutorBrief.cues,
            memoryMoments,
            prompts: tutorPrompts,
            deckCount: decks.length,
            recentRunCount: recentRuns.length,
          }}
        />
      ) : activeTab === "notes" ? (
        <section className="max-w-2xl space-y-4">
          <div>
            <h2 className="text-xl font-semibold">Study notes</h2>
          </div>
          {studyNotes.length === 0 ? (
            <div className="rounded border p-6 text-sm text-gray-500">No study notes yet.</div>
          ) : (
            <ul className="divide-y rounded border">
              {studyNotes.map((note) => (
                <li key={note.id} className="flex items-center justify-between gap-3 p-4">
                  <div className="min-w-0">
                    <Link href={`/app/study-notes/view?id=${note.id}`} className="block truncate font-medium hover:underline">
                      {note.title}
                    </Link>
                    <p className="text-xs text-gray-500">
                      {new Date(note.createdAt).toLocaleString()}{note.source ? ` • ${note.source}` : ""}
                    </p>
                  </div>
                  <Link href={`/app/study-notes/view?id=${note.id}`} className="whitespace-nowrap rounded border px-3 py-1.5 text-sm hover:bg-gray-50">
                    Open
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          <section className="space-y-4">
            <h2 className="text-xl font-semibold">Create</h2>
            {billingSnapshot ? (
              <div className="rounded-2xl border border-sky-200 bg-sky-50 p-4 text-sm text-slate-700">
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <div>
                    <p className="font-medium text-slate-950">{currentPlanLabel}</p>
                    <p className="mt-1">
                      This month: {billingSnapshot.monthlyGenerationCount}
                      {billingSnapshot.monthlyGenerationLimit ? ` of ${billingSnapshot.monthlyGenerationLimit}` : " (unlimited)"}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {billingSnapshot.isPaid ? (
                      <BillingActionButton
                        action="portal"
                        className="rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-900 disabled:opacity-60"
                        pendingLabel="Opening portal..."
                      >
                        Manage
                      </BillingActionButton>
                    ) : (
                      <BillingActionButton
                        action="checkout"
                        plan="premium"
                        className="rounded-full bg-slate-950 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
                        pendingLabel="Opening checkout..."
                      >
                        Upgrade
                      </BillingActionButton>
                    )}
                  </div>
                </div>
              </div>
            ) : null}
            <div className="rounded border p-4">
              <CreateForm
                billingSummary={billingSnapshot ? {
                  plan: billingSnapshot.plan,
                  isPaid: billingSnapshot.isPaid,
                  monthlyGenerationCount: billingSnapshot.monthlyGenerationCount,
                  monthlyGenerationLimit: billingSnapshot.monthlyGenerationLimit,
                  monthlyGenerationsRemaining: billingSnapshot.monthlyGenerationsRemaining,
                  canGenerate: billingSnapshot.isPaid || (billingSnapshot.monthlyGenerationsRemaining ?? 0) > 0,
                } : undefined}
              />
            </div>
          </section>

          <section className="space-y-4">
            <div className="flex justify-between items-center">
              <div>
                <h2 className="text-xl font-semibold">Library</h2>
              </div>
              {decks.length > 0 && (
                <div>
                  <DeleteAllDecksButton />
                </div>
              )}
            </div>
            {decks.length === 0 ? (
              <div className="rounded border p-6 text-sm text-gray-500">No study sets yet.</div>
            ) : (
              <ul className="divide-y rounded border">
                {decks.map((d) => (
                  <li key={d.id} className="p-4 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <Link href={`/app/deck/${d.id}`} className="font-medium hover:underline truncate block">
                        {d.title}
                      </Link>
                      <p className="text-xs text-gray-500">
                        {new Date(d.createdAt).toLocaleString()} • {d._count.cards} prompt{d._count.cards === 1 ? "" : "s"}
                      </p>
                    </div>
                    <Link href={`/app/deck/${d.id}`} className="text-sm px-3 py-1.5 rounded border hover:bg-gray-50 whitespace-nowrap">
                      Open
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

function normalizeTutorMode(value: string | undefined): TutorMode {
  return value === "explanation" || value === "quiz-me" ? value : "study-plan";
}

function buildWorkspaceTutorBrief(
  studentState: ReturnType<typeof formatStudentState> | null,
  analytics: ReturnType<typeof summarizeReasoningRuns> | null,
  deckCount: number
) {
  const weakConcept = studentState?.weakConcepts[0] || null;
  const misconception = analytics?.dominantMisconception || studentState?.misconceptionPatterns[0] || null;
  const lowConfidenceStreak = studentState?.pacingProfile.lowConfidenceStreak ?? 0;
  const recentFailure = studentState?.recentFailures[0] || null;
  const recentSuccess = studentState?.recentSuccesses[0] || null;

  const headline = weakConcept
    ? `Start with ${titleCase(weakConcept)} before browsing everything else.`
    : deckCount > 0
      ? "Your workspace is ready for a guided study pass."
      : "Create your first study set and the tutor will start building memory.";

  const summary = weakConcept
    ? `The tutor is prioritizing ${titleCase(weakConcept)} because it still appears in your recent learning memory${misconception ? ` and is often paired with ${humanizeMisconceptionCategory(misconception).toLowerCase()}` : ""}. A short focused session will help more than jumping across multiple study sets.`
    : deckCount > 0
      ? "You have enough material to start a structured session. As you complete more coached reviews, the workspace will get more specific about what to reinforce next and why."
      : "Once you add material and complete a few coached checks, the tutor will start showing weak concepts, recovery patterns, and guided next steps here.";

  const cues = [
    recentFailure
      ? `Recent hesitation: ${trimText(recentFailure, 88)}`
      : "No recent failure is dominating the workspace yet.",
    recentSuccess
      ? `Recent recovery win: ${trimText(recentSuccess, 88)}`
      : "The tutor is still waiting for enough recovery evidence to highlight a recent win.",
    lowConfidenceStreak > 0
      ? `You are on a ${lowConfidenceStreak}-session low-confidence streak, so slower example-first review is a good default.`
      : "Confidence has not shown a prolonged drop recently, so normal pacing is still appropriate.",
  ];

  return { headline, summary, cues };
}

function buildTutorMemoryMoments(
  studentState: ReturnType<typeof formatStudentState> | null,
  analytics: ReturnType<typeof summarizeReasoningRuns> | null
) {
  const moments = [] as string[];

  if (studentState?.recentFailures[0]) {
    moments.push(`Last time, this topic still caused hesitation: ${trimText(studentState.recentFailures[0], 92)}`);
  }
  if (studentState?.recentSuccesses[0]) {
    moments.push(`You recovered this more smoothly in a recent session: ${trimText(studentState.recentSuccesses[0], 92)}`);
  }
  if (studentState?.preferredExplanationStyle) {
    moments.push(`The tutor currently sees ${studentState.preferredExplanationStyle.toLowerCase()} explanations as your best fit.`);
  }
  if (analytics?.dominantMisconception) {
    moments.push(`Most repeated recent friction point: ${humanizeMisconceptionCategory(analytics.dominantMisconception)}.`);
  }

  if (moments.length === 0) {
    moments.push("As you study more, the tutor will start recalling hesitation patterns, stronger explanation styles, and faster recovery paths here.");
  }

  return moments.slice(0, 4);
}

function trimText(value: string, limit: number) {
  if (value.length <= limit) return value;
  return `${value.slice(0, Math.max(0, limit - 3)).trimEnd()}...`;
}

function titleCase(value: string) {
  return String(value || "")
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}
