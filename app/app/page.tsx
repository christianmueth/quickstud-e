export const dynamic = "force-dynamic";
import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import { summarizeReasoningRuns } from "@/lib/reasoningEngine/analytics";
import { humanizeMisconceptionCategory } from "@/lib/reasoningEngine/contracts";
import { formatStudentState } from "@/lib/reasoningEngine/studentState";
import CreateForm from "@/components/CreateForm";
import DeckCarousel from "@/components/DeckCarousel";
import DeleteAllDecksButton from "@/components/DeleteAllDecksButton";

export default async function AppPage() {
  let userId: string | null = null;
  
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
    await prisma.user.upsert({ 
      where: { clerkUserId: userId }, 
      update: {}, 
      create: { clerkUserId: userId } 
    });
  } catch (error) {
    console.error("[App] Database error creating user:", error);
    return (
      <div className="max-w-2xl mx-auto p-6">
        <div className="border border-red-300 bg-red-50 p-4 rounded">
          <h2 className="font-semibold text-red-900">We couldn't load your learning spaces.</h2>
          <p className="text-sm text-red-700 mt-2">
            Your study workspace can't load until the data connection is available again.
          </p>
        </div>
      </div>
    );
  }

  let decks: Array<{ id: string; title: string; createdAt: Date; _count: { cards: number } } > = [];
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
      where: { user: { clerkUserId: userId } },
      orderBy: { createdAt: "desc" },
      select: { id: true, title: true, createdAt: true, _count: { select: { cards: true } } },
    });
  } catch (error) {
    console.error("[App] Error fetching decks:", error);
  }

  const analytics = recentRuns.length ? summarizeReasoningRuns(recentRuns) : null;
  const workspaceTutorBrief = buildWorkspaceTutorBrief(studentState, analytics, decks.length);
  const memoryMoments = buildTutorMemoryMoments(studentState, analytics);

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-8">
      <section className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
        <div className="rounded-3xl border border-sky-200 bg-gradient-to-br from-sky-50 via-white to-cyan-50 p-6 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-700">Tutor framing</p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">{workspaceTutorBrief.headline}</h1>
          <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-700">{workspaceTutorBrief.summary}</p>
          <div className="mt-5 grid gap-3 md:grid-cols-3">
            {workspaceTutorBrief.cues.map((cue) => (
              <div key={cue} className="rounded-2xl border border-sky-100 bg-white/90 p-4 text-sm leading-6 text-slate-700">
                {cue}
              </div>
            ))}
          </div>
          <div className="mt-5 flex flex-wrap gap-3">
            <Link href="/app/progress" className="rounded-full bg-slate-950 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800">
              Review my progress
            </Link>
            <Link href="/how-adaptive-guidance-works" className="rounded-full border border-slate-300 px-4 py-2 text-sm font-medium text-slate-900 hover:bg-white">
              Why this guidance appears
            </Link>
          </div>
        </div>

        <div className="rounded-3xl border border-emerald-200 bg-gradient-to-br from-emerald-50 via-white to-lime-50 p-6 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">Tutor memory moments</p>
          <h2 className="mt-3 text-2xl font-semibold tracking-tight text-slate-950">What the tutor remembers right now</h2>
          <div className="mt-5 space-y-3">
            {memoryMoments.map((moment) => (
              <div key={moment} className="rounded-2xl border border-emerald-100 bg-white/90 p-4 text-sm leading-6 text-slate-700">
                {moment}
              </div>
            ))}
          </div>
        </div>
      </section>

      <DeckCarousel userId={userId} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <section className="space-y-4">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Study</p>
          <h2 className="text-xl font-semibold">Build study material</h2>
          <p className="text-sm text-gray-600">Paste text, upload PDF or slides, add a link, and turn it into a guided study set.</p>
          <div className="rounded border p-4">
            <CreateForm />
          </div>
        </section>

        <section className="space-y-4">
          <div className="flex justify-between items-center">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Study</p>
              <h2 className="text-xl font-semibold">Study library</h2>
            </div>
            {decks.length > 0 && (
              <div>
                <DeleteAllDecksButton />
              </div>
            )}
          </div>
          {decks.length === 0 ? (
            <div className="rounded border p-6 text-sm text-gray-500">No study sets yet. Build one on the left to start a guided session.</div>
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
                    Open session
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
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
