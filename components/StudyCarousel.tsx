"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { humanizeMisconceptionCategory } from "@/lib/reasoningEngine/contracts";
import {
  TUTOR_CHAT_SESSION_CONTEXT_EVENT,
  TUTOR_CHAT_SESSION_CONTEXT_STORAGE_KEY,
  type TutorChatSessionContext,
} from "@/lib/tutorChatSessionContext";

type StudyCard = { id: string; question: string; answer: string };

type TutoringGuideResponse = {
  ok: boolean;
  verification?: {
    final_answer: string;
    reasoning: string;
    confidence: number;
    trajectory_score: number;
    search_depth: number;
  };
  tutoring?: {
    final_answer: string;
    reasoning: string;
    confidence: number;
    trajectory_score: number;
    search_depth: number;
  };
  weakTopicMatches?: string[];
  misconceptionSignals?: string[];
  selectedStrategy?: {
    id: string;
    label: string;
    hint: string;
    rationale: string;
    score: number;
    confidence: number;
    selected: boolean;
    strategyType: "conceptual" | "diagnostic" | "scaffolded";
  };
  candidateStrategies?: Array<{
    id: string;
    label: string;
    hint: string;
    rationale: string;
    score: number;
    confidence: number;
    selected: boolean;
    strategyType: "conceptual" | "diagnostic" | "scaffolded";
  }>;
  studentState?: {
    weakConcepts: string[];
    misconceptionPatterns: string[];
    confidenceProfile: {
      overall: number;
      verificationAverage: number;
      verificationCount: number;
      lastConfidence: number;
    };
    retentionProfile: {
      recentVerificationSuccessRate: number;
      successfulChecks: number;
      failedChecks: number;
    };
    pacingProfile: {
      verificationAttempts: number;
      lowConfidenceStreak: number;
    };
    preferredExplanationStyle: string | null;
    recentFailures: string[];
    recentSuccesses: string[];
    updatedAt: string | null;
    createdAt: string | null;
  } | null;
};

type StrategyPolicySummary = {
  topStrategy: string | null;
  topStrategyType: string | null;
  winCount: number;
  runCount: number;
  averageConfidence: number;
  lowConfidenceRuns: number;
};

type SessionEvent = {
  rating: "again" | "good" | "easy";
  coached: boolean;
  recovered: boolean;
  misconception: string | null;
  weakTopic: string | null;
  strategyLabel: string | null;
  priorConfidence: number | null;
};

async function safeJson(res: Response) {
  try { const text = await res.text(); return text ? JSON.parse(text) : null; } catch { return null; }
}

function buildCoachingContext(card: StudyCard, answerDraft: string, coachResult: TutoringGuideResponse | null) {
  if (!coachResult) return null;
  return {
    prompt: card.question,
    studentAnswer: answerDraft.trim(),
    expectedAnswer: card.answer,
    misconceptionSignals: coachResult.misconceptionSignals || [],
    weakTopicMatches: coachResult.weakTopicMatches || [],
    verification: coachResult.verification,
    selectedStrategy: coachResult.selectedStrategy,
    studentState: coachResult.studentState || null,
  };
}

export default function StudyCarousel({
  deckId,
  focusConcept,
  focusReason,
  recommendationSource,
}: {
  deckId: string;
  focusConcept?: string | null;
  focusReason?: string | null;
  recommendationSource?: string | null;
}) {
  const [queue, setQueue] = useState<StudyCard[]>([]);
  const [idx, setIdx] = useState(0);
  const [showBack, setShowBack] = useState(false);
  const [loading, setLoading] = useState(true);
  const [answerDraft, setAnswerDraft] = useState("");
  const [coachLoading, setCoachLoading] = useState(false);
  const [coachResult, setCoachResult] = useState<TutoringGuideResponse | null>(null);
  const [policySummary, setPolicySummary] = useState<StrategyPolicySummary | null>(null);
  const [xpToday, setXpToday] = useState(0);
  const [goal, setGoal] = useState(50);
  const [celebrated, setCelebrated] = useState(false);
  const [sessionEvents, setSessionEvents] = useState<SessionEvent[]>([]);
  const [sessionComplete, setSessionComplete] = useState(false);
  const router = useRouter();
  const tutorPresence = useMemo(
    () => buildTutorPresence({
      card: current,
      focusConcept,
      focusReason,
      recommendationSource,
      coachResult,
    }),
    [current, focusConcept, focusReason, recommendationSource, coachResult]
  );

  const loadQueue = useCallback(async () => {
    setLoading(true);
    try {
      const studyUrl = new URL(`/api/deck/${deckId}/study`, window.location.origin);
      if (focusConcept) studyUrl.searchParams.set("concept", focusConcept);
      const [qRes, meRes] = await Promise.all([
        fetch(studyUrl.toString(), { cache: "no-store" }),
        fetch(`/api/me`, { cache: "no-store" }),
      ]);
      const qJson = qRes.ok ? await safeJson(qRes) : null;
      const meJson = meRes.ok ? await safeJson(meRes) : null;

      setQueue(Array.isArray(qJson?.cards) ? qJson.cards : []);
      setIdx(0); setShowBack(false); setCelebrated(false); setAnswerDraft(""); setCoachResult(null); setPolicySummary(null); setSessionEvents([]); setSessionComplete(false);
      setXpToday(Number(meJson?.xpToday ?? 0));
      setGoal(Number(meJson?.dailyGoal ?? 50));

      if (!qRes.ok) toast.error("We couldn't prepare your guided session right now.");
      if (!meRes.ok) toast.error("We couldn't load today's study progress right now.");
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, "We couldn't load this guided session right now.")); setQueue([]);
    } finally { setLoading(false); }
  }, [deckId, focusConcept]);

  useEffect(() => { void loadQueue(); }, [loadQueue]);

  const current = queue[idx] || null;
  const progress = useMemo(() => (queue.length ? Math.round(((idx + (current ? 0 : 1)) / queue.length) * 100) : 0), [idx, queue.length, current]);
  const onFlip = useCallback(() => { if (current) setShowBack((s) => !s); }, [current]);

  useEffect(() => {
    setAnswerDraft("");
    setCoachResult(null);
    setPolicySummary(null);
    setCoachLoading(false);
  }, [current?.id]);

  useEffect(() => {
    const nextContext: TutorChatSessionContext = {
      deckId,
      focusConcept: focusConcept || null,
      focusReason: focusReason || null,
      queuePosition: current
        ? {
            current: idx + 1,
            total: queue.length,
          }
        : null,
      currentCard: current
        ? {
            id: current.id,
            question: current.question,
            answerPreview: current.answer.slice(0, 220),
            revealed: showBack,
          }
        : null,
      answerDraft: answerDraft.trim() || null,
      latestCoaching: coachResult
        ? {
            hint: coachResult.selectedStrategy?.hint || coachResult.tutoring?.final_answer || null,
            rationale: coachResult.selectedStrategy?.rationale || null,
            misconceptionSignals: coachResult.misconceptionSignals || [],
            weakTopicMatches: coachResult.weakTopicMatches || [],
            confidence: typeof coachResult.verification?.confidence === "number" ? coachResult.verification.confidence : null,
            strategyType: coachResult.selectedStrategy?.strategyType || null,
          }
        : null,
      sessionComplete,
    };

    window.localStorage.setItem(TUTOR_CHAT_SESSION_CONTEXT_STORAGE_KEY, JSON.stringify(nextContext));
    window.dispatchEvent(new CustomEvent(TUTOR_CHAT_SESSION_CONTEXT_EVENT, { detail: nextContext }));
  }, [
    answerDraft,
    coachResult,
    current,
    deckId,
    focusConcept,
    focusReason,
    idx,
    queue.length,
    sessionComplete,
    showBack,
  ]);

  const mark = useCallback(async (rating: "again" | "good" | "easy") => {
    if (!current) return;
    const gain = rating === "easy" ? 5 : rating === "good" ? 3 : 1;
    const coachingContext = buildCoachingContext(current, answerDraft, coachResult);
    const recovered = !!coachingContext && rating !== "again";
    try {
      await fetch(`/api/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cardId: current.id, rating, coachingContext }),
      });

      setSessionEvents((events) => [
        ...events,
        {
          rating,
          coached: !!coachingContext,
          recovered,
          misconception: coachingContext?.misconceptionSignals?.[0] || null,
          weakTopic: coachingContext?.weakTopicMatches?.[0] || null,
          strategyLabel: coachingContext?.selectedStrategy?.label || null,
          priorConfidence: typeof coachingContext?.verification?.confidence === "number"
            ? coachingContext.verification.confidence
            : null,
        },
      ]);

      const next = [...queue]; next.splice(idx, 1); if (rating === "again") next.push(current);
      setQueue(next); setShowBack(false); if (idx >= next.length) setIdx(Math.max(0, next.length - 1));
      setAnswerDraft(""); setCoachResult(null); setPolicySummary(null);

      toast.success(rating === "easy" ? "Strong finish. +5 XP" : rating === "good" ? "Nice progress. +3 XP" : "Good catch. +1 XP");
      if (coachingContext) {
        toast.message(recovered ? "The tutor recorded that this coaching step helped." : "The tutor recorded that this concept still needs another pass.");
      }

      const newXP = xpToday + gain; setXpToday(newXP);
      if (!celebrated && goal && newXP >= goal) {
        setCelebrated(true);
        try {
          const confetti = (await import("canvas-confetti")).default;
          confetti({ particleCount: 120, spread: 70, origin: { y: 0.6 } });
        } catch { /* confetti optional */ }
        toast.success("Daily study goal reached! 🎉");
      }

      if (next.length === 0) { setSessionComplete(true); toast.success("Guided session complete 🎉"); }
    } catch (error: unknown) { toast.error(getErrorMessage(error, "We couldn't save that study step.")); }
  }, [answerDraft, celebrated, coachResult, current, goal, idx, queue, xpToday]);

  async function coachCurrentCard() {
    if (!current) return;
    const studentAnswer = answerDraft.trim();
    if (!studentAnswer) {
      toast.error("Write a short answer first so the tutor has something to respond to.");
      return;
    }

    setCoachLoading(true);
    try {
      const res = await fetch("/api/tutoring/guide", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: current.question,
          studentAnswer,
          expectedAnswer: current.answer,
          title: "Inline study coaching",
          origin: "study_carousel",
        }),
      });
      const data = (await safeJson(res)) as TutoringGuideResponse | null;
      if (!res.ok || !data?.ok) {
        throw new Error(readApiError(data, "We couldn't prepare tutor guidance for this step."));
      }
      setCoachResult(data);

      const primaryMisconception = data.misconceptionSignals?.[0];
      if (primaryMisconception) {
        const policyRes = await fetch(
          `/api/reasoning-runs?mode=tutor_guidance&misconception=${encodeURIComponent(primaryMisconception)}&limit=20`,
          { cache: "no-store" }
        );
        const policyData = await safeJson(policyRes);
        if (policyRes.ok && policyData?.ok) {
          const strategyEntry = policyData.analytics?.strategyWinsByMisconception?.find(
            (entry: { category: string }) => entry.category === primaryMisconception
          );
          const confidenceEntry = policyData.analytics?.confidenceByMisconception?.find(
            (entry: { category: string }) => entry.category === primaryMisconception
          );
          setPolicySummary(
            strategyEntry || confidenceEntry
              ? {
                  topStrategy: strategyEntry?.topStrategy || null,
                  topStrategyType: strategyEntry?.topStrategyType || null,
                  winCount: strategyEntry?.winCount || 0,
                  runCount: Math.max(strategyEntry?.runCount || 0, confidenceEntry?.runCount || 0),
                  averageConfidence: confidenceEntry?.averageConfidence || 0,
                  lowConfidenceRuns: confidenceEntry?.lowConfidenceRuns || 0,
                }
              : null
          );
        }
      } else {
        setPolicySummary(null);
      }

      if (!showBack) setShowBack(true);
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, "We couldn't load tutor guidance right now."));
    } finally {
      setCoachLoading(false);
    }
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!current) return;
      if (e.key === " " || e.code === "Space") { e.preventDefault(); onFlip(); }
      if (e.key === "1") mark("again");
      if (e.key === "2") mark("good");
      if (e.key === "3") mark("easy");
      if (e.key === "ArrowRight") setIdx((i) => Math.min(i + 1, Math.max(queue.length - 1, 0)));
      if (e.key === "ArrowLeft") setIdx((i) => Math.max(i - 1, 0));
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [current, mark, onFlip, queue.length]);

  if (loading) return <div className="rounded border p-6 text-sm text-gray-500">Preparing your guided session...</div>;
  if (!queue.length && !sessionComplete)
    return (
      <div className="rounded border p-6 text-sm text-gray-500 flex items-center justify-between">
        <span>Your tutor does not have a guided review pass waiting right now.</span>
        <button className="text-sm px-3 py-1.5 rounded border" onClick={loadQueue}>Refresh</button>
      </div>
    );

  if (!queue.length && sessionComplete) {
    const reflection = buildSessionReflection(sessionEvents, deckId, focusConcept);
    return (
      <div className="space-y-4">
        <div className="rounded-3xl border border-emerald-200 bg-gradient-to-br from-emerald-50 via-white to-sky-50 p-6 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">Session reflection</p>
          <h2 className="mt-3 text-2xl font-semibold tracking-tight text-slate-950">{reflection.headline}</h2>
          <p className="mt-3 text-sm leading-7 text-slate-700">{reflection.summary}</p>
          <div className="mt-5 grid gap-3 md:grid-cols-3">
            <div className="rounded-2xl border border-emerald-100 bg-white/90 p-4 text-sm leading-6 text-slate-700">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-emerald-700">What changed</p>
              <p className="mt-2">{reflection.whatChanged}</p>
            </div>
            <div className="rounded-2xl border border-amber-100 bg-white/90 p-4 text-sm leading-6 text-slate-700">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-amber-700">Still unstable</p>
              <p className="mt-2">{reflection.stillUnstable}</p>
            </div>
            <div className="rounded-2xl border border-sky-100 bg-white/90 p-4 text-sm leading-6 text-slate-700">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-sky-700">Next session</p>
              <p className="mt-2">{reflection.nextSession}</p>
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <h3 className="text-sm font-semibold uppercase tracking-[0.16em] text-slate-700">Tutor next step</h3>
          <p className="mt-3 text-sm leading-6 text-slate-700">{reflection.nextStep}</p>
          <div className="mt-4 flex flex-wrap gap-3">
            {reflection.resumeHref ? (
              <button
                className="rounded-full bg-emerald-600 px-4 py-2 text-sm font-medium text-white"
                onClick={() => router.push(reflection.resumeHref as string)}
              >
                Resume this weak point
              </button>
            ) : null}
            <button className="rounded-full bg-slate-950 px-4 py-2 text-sm font-medium text-white" onClick={loadQueue}>
              Start another pass
            </button>
            <button className="rounded-full border border-slate-300 px-4 py-2 text-sm font-medium text-slate-900" onClick={() => router.refresh()}>
              Refresh workspace
            </button>
          </div>
        </div>
      </div>
    );
  }

  const pctDaily = Math.max(0, Math.min(100, Math.round((xpToday / (goal || 50)) * 100)));
  const card = current!;

  return (
    <div className="space-y-4">
      {(focusConcept || focusReason) ? (
        <div className="rounded-2xl border border-sky-200 bg-sky-50 p-4 text-sm text-sky-950">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="font-semibold">Today&apos;s focus: {focusConcept || "Targeted review"}</p>
              {focusReason ? <p className="mt-1 text-sky-900">Why the tutor picked this: {focusReason}</p> : null}
            </div>
            {recommendationSource ? (
              <span className="rounded-full border border-sky-200 bg-white/80 px-3 py-1 text-xs uppercase tracking-[0.14em] text-sky-800">
                {recommendationSource.replace(/_/g, " ")}
              </span>
            ) : null}
          </div>
        </div>
      ) : null}

      <div>
        <div className="text-xs text-gray-600 mb-1">Daily study goal: {xpToday}/{goal} XP</div>
        <div className="h-2 w-full bg-gray-200 rounded">
          <div className="h-2 bg-black rounded" style={{ width: `${pctDaily}%` }} />
        </div>
      </div>

      <div className="rounded-2xl border border-sky-200 bg-gradient-to-r from-sky-50 via-white to-cyan-50 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="max-w-3xl">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-sky-700">Tutor guide</p>
            <h3 className="mt-2 text-lg font-semibold text-slate-950">{tutorPresence.title}</h3>
            <p className="mt-2 text-sm leading-6 text-slate-700">{tutorPresence.message}</p>
          </div>
          {tutorPresence.badge ? (
            <span className="rounded-full border border-sky-200 bg-white/90 px-3 py-1 text-xs uppercase tracking-[0.14em] text-sky-800">
              {tutorPresence.badge}
            </span>
          ) : null}
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          {tutorPresence.cues.map((cue) => (
            <div key={cue} className="rounded-xl border border-sky-100 bg-white/85 p-3 text-sm leading-6 text-slate-700">
              {cue}
            </div>
          ))}
        </div>
      </div>

      <div className="h-2 w-full bg-gray-200 rounded">
        <div className="h-2 bg-gray-800/60 rounded" style={{ width: `${progress}%` }} />
      </div>

      <div className="rounded-2xl border p-6 min-h-[220px] flex flex-col justify-between">
        <div className="text-xs text-gray-500">
          Prompt {idx + 1} / {queue.length} • Press <kbd>Space</kbd> to reveal, <kbd>1</kbd>/<kbd>2</kbd>/<kbd>3</kbd> to reflect how it went
        </div>
        <div className="text-lg whitespace-pre-wrap my-6">{showBack ? card.answer : card.question}</div>
        <div className="flex items-center gap-2">
          <button className="px-3 py-1.5 rounded border" onClick={() => setIdx((i) => Math.max(0, i - 1))} disabled={idx === 0}>◀ Earlier</button>
          <button className="flex-1 px-3 py-1.5 rounded bg-black text-white" onClick={onFlip}>{showBack ? "Hide tutor answer" : "Reveal tutor answer"}</button>
          <button className="px-3 py-1.5 rounded border" onClick={() => setIdx((i) => Math.min(queue.length - 1, i + 1))} disabled={idx >= queue.length - 1}>Next ▶</button>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">Try your own explanation first</h3>
            <p className="text-xs text-slate-500">The tutor uses your answer, likely misconception, and recent recovery patterns to decide what help to give next.</p>
          </div>
          <button
            className="px-3 py-1.5 rounded bg-slate-900 text-white disabled:opacity-60"
            onClick={coachCurrentCard}
            disabled={coachLoading}
          >
            {coachLoading ? "Thinking…" : "Get tutor help"}
          </button>
        </div>
        <textarea
          value={answerDraft}
          onChange={(event) => setAnswerDraft(event.target.value)}
          placeholder="Write your answer or explanation here before revealing the tutor answer."
          className="min-h-[96px] w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-900"
        />

        {coachResult ? (
          <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <h4 className="text-sm font-semibold text-emerald-950">Tutor guidance for this step</h4>
                {coachResult.selectedStrategy ? (
                  <span className="rounded-full border border-emerald-200 bg-white/80 px-3 py-1 text-xs text-emerald-900">
                    {coachResult.selectedStrategy.strategyType}
                  </span>
                ) : null}
              </div>
              <p className="text-sm text-emerald-950">{coachResult.selectedStrategy?.hint || coachResult.tutoring?.final_answer || "No hint generated."}</p>
              {coachResult.selectedStrategy?.rationale ? (
                <p className="text-xs text-emerald-900">{coachResult.selectedStrategy.rationale}</p>
              ) : null}
              <ul className="space-y-2 text-xs text-emerald-900">
                {buildInlineWhyWon(coachResult, policySummary).map((reason) => (
                  <li key={reason} className="rounded-xl bg-white/80 px-3 py-2 border border-emerald-100">
                    {reason}
                  </li>
                ))}
              </ul>
            </div>

            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 space-y-3">
              <h4 className="text-sm font-semibold text-amber-950">What the tutor is seeing</h4>
              <div className="flex flex-wrap gap-2">
                {(coachResult.misconceptionSignals || []).length ? (
                  coachResult.misconceptionSignals?.map((signal) => (
                    <span key={signal} className="rounded-full border border-amber-200 bg-white/80 px-3 py-1 text-xs text-amber-900">
                      {humanizeMisconceptionCategory(signal)}
                    </span>
                  ))
                ) : (
                  <span className="text-xs text-amber-900">No strong misconception pattern stood out in this answer.</span>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <MiniCoachStat label="Current understanding" value={formatScore(coachResult.verification?.confidence)} />
                <MiniCoachStat label="Tutor confidence" value={formatScore(coachResult.selectedStrategy?.confidence)} />
              </div>
              {policySummary ? (
                <div className="rounded-xl border border-amber-200 bg-white/80 p-3 text-xs text-amber-900 space-y-1">
                  <div>Most helpful recent tutoring move here: {policySummary.topStrategy || "none yet"}</div>
                  <div>Typical confidence in this pattern: {formatScore(policySummary.averageConfidence)}</div>
                  <div>Recent low-confidence examples: {policySummary.lowConfidenceRuns}</div>
                  <div>Your next rating helps the tutor learn whether this intervention actually helped.</div>
                </div>
              ) : null}
              {coachResult.weakTopicMatches?.length ? (
                <div className="flex flex-wrap gap-2">
                  {coachResult.weakTopicMatches.map((topic) => (
                    <span key={topic} className="rounded-full border border-amber-200 bg-white/80 px-3 py-1 text-xs text-amber-900">
                      focus area: {topic}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>

      {showBack && (
        <div className="flex items-center gap-3">
          <button className="px-3 py-1.5 rounded bg-red-600 text-white" onClick={() => mark("again")}>1 · Still shaky</button>
          <button className="px-3 py-1.5 rounded bg-yellow-500 text-white" onClick={() => mark("good")}>2 · Getting there</button>
          <button className="px-3 py-1.5 rounded bg-green-600 text-white" onClick={() => mark("easy")}>3 · Feels solid</button>
        </div>
      )}
    </div>
  );
}

function MiniCoachStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white/80 p-3">
      <p className="text-[11px] uppercase tracking-[0.16em] text-slate-500">{label}</p>
      <p className="mt-1 text-base font-semibold text-slate-900">{value}</p>
    </div>
  );
}

function buildInlineWhyWon(result: TutoringGuideResponse, policy: StrategyPolicySummary | null) {
  const reasons = [] as string[];
  if (result.selectedStrategy?.label) {
    reasons.push(`Selected ${result.selectedStrategy.label.toLowerCase()} after reranking the available tutoring trajectories.`);
  }
  if (typeof result.verification?.confidence === "number") {
    reasons.push(`Your current verification confidence is ${formatScore(result.verification.confidence)}, so the hint is calibrated to that uncertainty level.`);
  }
  if (result.misconceptionSignals?.length) {
    reasons.push(`The system classified this answer under ${humanizeMisconceptionCategory(result.misconceptionSignals[0])}, which influenced the intervention choice.`);
  }
  if (policy?.topStrategy) {
    reasons.push(`In recent runs for this category, ${policy.topStrategy.toLowerCase()} has been the most common winning intervention.`);
  }
  return reasons.slice(0, 4);
}

function buildTutorPresence({
  card,
  focusConcept,
  focusReason,
  recommendationSource,
  coachResult,
}: {
  card: StudyCard | null;
  focusConcept?: string | null;
  focusReason?: string | null;
  recommendationSource?: string | null;
  coachResult: TutoringGuideResponse | null;
}) {
  const misconception = coachResult?.misconceptionSignals?.[0];
  const preferredStyle = coachResult?.studentState?.preferredExplanationStyle;
  const lowConfidenceStreak = coachResult?.studentState?.pacingProfile.lowConfidenceStreak ?? 0;
  const selectedStrategy = coachResult?.selectedStrategy;

  if (coachResult) {
    return {
      title: selectedStrategy
        ? `Let's work this through with ${selectedStrategy.label.toLowerCase()}.`
        : "I have a tutoring move ready for this card.",
      message: misconception
        ? `Your answer suggests ${humanizeMisconceptionCategory(misconception).toLowerCase()}, so I am steering this session toward a more targeted intervention instead of generic repetition.`
        : "I am using your answer and recent study state to pick the next hint rather than showing a generic explanation.",
      badge: selectedStrategy?.strategyType || recommendationSource || null,
      cues: [
        selectedStrategy?.hint || coachResult.tutoring?.final_answer || "Ask for coaching after you write your own answer to get a targeted hint.",
        preferredStyle
          ? `Current explanation style match: ${preferredStyle.toLowerCase()}.`
          : "The tutor is still learning which explanation style works best for you.",
        lowConfidenceStreak > 0
          ? `You are in a ${lowConfidenceStreak}-step low-confidence stretch, so the tutor is keeping the pace slower.`
          : "Confidence has not dipped for multiple steps in a row, so normal pacing is still appropriate.",
      ],
    };
  }

  return {
    title: focusConcept ? `Today's session centers on ${focusConcept}.` : `Start by explaining ${trimQuestion(card?.question || "this card", 56)} in your own words.`,
    message: focusReason
      ? `Why this is next: ${focusReason}`
      : "Write your answer before you flip the card. Once you do, the tutor can adapt the next hint to your confidence, misconception pattern, and recent recovery history.",
    badge: recommendationSource ? recommendationSource.replace(/_/g, " ") : null,
    cues: [
      focusConcept
        ? `The queue is already biased toward ${focusConcept} so you spend less time hunting for the right review target.`
        : "Answer first. The tutor becomes more useful when it can react to your attempt instead of replacing it.",
      "If the concept feels shaky, ask for coaching before grading so the recovery signal is captured.",
      "After a strong recovery, grade the card normally so the tutor can learn whether this intervention actually helped.",
    ],
  };
}

function buildSessionReflection(events: SessionEvent[], deckId: string, focusConcept?: string | null) {
  const coachedCount = events.filter((event) => event.coached).length;
  const recoveredCount = events.filter((event) => event.recovered).length;
  const easyCount = events.filter((event) => event.rating === "easy").length;
  const againCount = events.filter((event) => event.rating === "again").length;
  const goodCount = events.filter((event) => event.rating === "good").length;
  const topMisconception = mostCommonLabel(events.map((event) => event.misconception).filter(Boolean) as string[]);
  const topWeakTopic = mostCommonLabel(events.map((event) => event.weakTopic).filter(Boolean) as string[]);
  const topStrategy = mostCommonLabel(events.map((event) => event.strategyLabel).filter(Boolean) as string[]);
  const focusLabel = titleFromSignal(topWeakTopic || focusConcept || "");

  const headline = easyCount >= Math.max(1, Math.ceil(events.length / 2))
    ? "You ended this session with solid recovery momentum."
    : recoveredCount > againCount
      ? "You made progress, but one area still wants another pass."
      : "This session exposed a concept that still needs slower reinforcement.";

  const summary = recoveredCount > 0
    ? `The session did more than move cards forward. You hit resistance, adjusted with guidance, and recovered enough momentum to make this topic feel more teachable than it did at the start.`
    : easyCount > againCount
      ? `You kept this session steady and moved through the material with more control than hesitation, which usually means the concept is starting to settle instead of feeling newly fragile.`
      : `This pass surfaced a real friction point, which is still useful. It shows the tutor where to slow down and which explanation path needs to be clearer next time.`;

  const whatChanged = recoveredCount > 0
    ? `${coachedCount === recoveredCount ? "Guidance" : "A few targeted hints"} helped convert hesitation into progress${focusLabel ? ` around ${focusLabel}` : ""}, so this concept is less stuck than it looked at the start of the session.`
    : easyCount > goodCount
      ? `${focusLabel ? `${focusLabel} felt` : "The material felt"} more stable once you got rolling, and the stronger finishes suggest recall is becoming easier to sustain across consecutive prompts.`
      : `You clarified what kind of support you need${topStrategy ? `, and ${topStrategy.toLowerCase()} gave the clearest traction when the concept started to wobble` : " by seeing exactly where the explanation started to break down"}.`;

  const stillUnstable = topMisconception
    ? `${humanizeMisconceptionCategory(topMisconception)} still shows up when the question gets less automatic${focusLabel ? `, especially inside ${focusLabel}` : ""}, so that is the place to keep slower, more deliberate reinforcement.`
    : againCount > 0
      ? `${focusLabel || "The shakier cards"} still needs another pass before the tutor should treat it as stable. Right now the pattern looks more like partial recall than durable understanding.`
      : `Nothing fully collapsed this session, but the tutor should still treat ${focusLabel || "this topic"} as recently improved rather than permanently stable.`;

  const nextSession = focusLabel
    ? `Come back to ${focusLabel} first, then use coaching early if the explanation starts to slow down again instead of waiting until the end of the pass.`
    : `Start the next pass with the first card that felt slow today, and ask for a short hint as soon as your explanation stops feeling clean.`;

  const nextStep = againCount > 0
    ? `Start one more short pass${focusLabel ? ` centered on ${focusLabel}` : ""} and ask for coaching earlier on the first unstable card.`
    : `Take the momentum forward with a short follow-up review${focusLabel ? ` on ${focusLabel}` : ""} before switching topics.`;

  const resumeHref = topWeakTopic || focusConcept
    ? buildDeckResumeHref({
        deckId,
        concept: topWeakTopic || focusConcept || "",
        reason: againCount > 0
          ? `This concept still felt unstable at the end of your last guided session, so the tutor is bringing you back to it first.`
          : `This concept improved, but the tutor wants one more focused pass before treating it as stable.`,
        source: "session_reflection",
      })
    : null;

  return { headline, summary, whatChanged, stillUnstable, nextSession, nextStep, resumeHref };
}

function mostCommonLabel(labels: string[]) {
  const counts = new Map<string, number>();
  for (const label of labels) {
    counts.set(label, (counts.get(label) || 0) + 1);
  }
  let best: string | null = null;
  let bestCount = 0;
  for (const [label, count] of counts.entries()) {
    if (count > bestCount) {
      best = label;
      bestCount = count;
    }
  }
  return best;
}

function titleFromSignal(value: string) {
  return value
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function buildDeckResumeHref({
  deckId,
  concept,
  reason,
  source,
}: {
  deckId: string;
  concept: string;
  reason: string;
  source: string;
}) {
  const params = new URLSearchParams({
    concept: trimQuestion(concept, 80),
    reason: trimQuestion(reason, 160),
    source,
  });
  return `/app/deck/${deckId}?${params.toString()}`;
}

function trimQuestion(value: string, limit: number) {
  if (value.length <= limit) return value;
  return `${value.slice(0, Math.max(0, limit - 3)).trimEnd()}...`;
}

function formatScore(value: number | undefined | null) {
  const num = typeof value === "number" && Number.isFinite(value) ? value : 0;
  return num.toFixed(3);
}

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

function readApiError(value: unknown, fallback: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fallback;
  const error = (value as { error?: unknown }).error;
  return typeof error === "string" && error.trim().length > 0 ? error : fallback;
}
