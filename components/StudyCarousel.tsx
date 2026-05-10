"use client";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { humanizeMisconceptionCategory } from "@/lib/reasoningEngine/contracts";

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
  const router = useRouter();

  async function loadQueue() {
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
      setIdx(0); setShowBack(false); setCelebrated(false); setAnswerDraft(""); setCoachResult(null); setPolicySummary(null);
      setXpToday(Number(meJson?.xpToday ?? 0));
      setGoal(Number(meJson?.dailyGoal ?? 50));

      if (!qRes.ok) toast.error("Failed to load study queue");
      if (!meRes.ok) toast.error("Failed to load user stats");
    } catch (e: any) {
      toast.error(e?.message || "Network error"); setQueue([]);
    } finally { setLoading(false); }
  }

  useEffect(() => { loadQueue(); /* eslint-disable-next-line */ }, [deckId, focusConcept]);

  const current = queue[idx] || null;
  const progress = useMemo(() => (queue.length ? Math.round(((idx + (current ? 0 : 1)) / queue.length) * 100) : 0), [idx, queue.length, current]);
  function onFlip() { if (current) setShowBack((s) => !s); }

  useEffect(() => {
    setAnswerDraft("");
    setCoachResult(null);
    setPolicySummary(null);
    setCoachLoading(false);
  }, [current?.id]);

  async function mark(rating: "again" | "good" | "easy") {
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

      const next = [...queue]; next.splice(idx, 1); if (rating === "again") next.push(current);
      setQueue(next); setShowBack(false); if (idx >= next.length) setIdx(Math.max(0, next.length - 1));
      setAnswerDraft(""); setCoachResult(null); setPolicySummary(null);

      toast.success(rating === "easy" ? "Perfect! +5 XP" : rating === "good" ? "Nice! +3 XP" : "Keep going! +1 XP");
      if (coachingContext) {
        toast.message(recovered ? "Recovery recorded for this coached attempt" : "Recovery miss recorded for this coached attempt");
      }

      const newXP = xpToday + gain; setXpToday(newXP);
      if (!celebrated && goal && newXP >= goal) {
        setCelebrated(true);
        try {
          const confetti = (await import("canvas-confetti")).default;
          confetti({ particleCount: 120, spread: 70, origin: { y: 0.6 } });
        } catch { /* confetti optional */ }
        toast.success("Daily goal reached! 🎉");
      }

      if (next.length === 0) { toast.success("Session complete 🎉"); router.refresh(); }
    } catch (e: any) { toast.error(e?.message || "Could not submit review"); }
  }

  async function coachCurrentCard() {
    if (!current) return;
    const studentAnswer = answerDraft.trim();
    if (!studentAnswer) {
      toast.error("Write a short answer before requesting a hint");
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
        throw new Error((data as any)?.error || "Failed to generate adaptive coaching");
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
    } catch (e: any) {
      toast.error(e?.message || "Could not load adaptive coaching");
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
  }, [current, queue.length, xpToday, goal, celebrated]);

  if (loading) return <div className="rounded border p-6 text-sm text-gray-500">Loading study set…</div>;
  if (!queue.length)
    return (
      <div className="rounded border p-6 text-sm text-gray-500 flex items-center justify-between">
        <span>No due cards right now.</span>
        <button className="text-sm px-3 py-1.5 rounded border" onClick={loadQueue}>Refresh</button>
      </div>
    );

  const pctDaily = Math.max(0, Math.min(100, Math.round((xpToday / (goal || 50)) * 100)));
  const card = current!;

  return (
    <div className="space-y-4">
      {(focusConcept || focusReason) ? (
        <div className="rounded-2xl border border-sky-200 bg-sky-50 p-4 text-sm text-sky-950">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="font-semibold">Resuming this concept: {focusConcept || "Targeted review"}</p>
              {focusReason ? <p className="mt-1 text-sky-900">Why this is recommended: {focusReason}</p> : null}
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
        <div className="text-xs text-gray-600 mb-1">Daily goal: {xpToday}/{goal} XP</div>
        <div className="h-2 w-full bg-gray-200 rounded">
          <div className="h-2 bg-black rounded" style={{ width: `${pctDaily}%` }} />
        </div>
      </div>

      <div className="h-2 w-full bg-gray-200 rounded">
        <div className="h-2 bg-gray-800/60 rounded" style={{ width: `${progress}%` }} />
      </div>

      <div className="rounded-2xl border p-6 min-h-[220px] flex flex-col justify-between">
        <div className="text-xs text-gray-500">
          Card {idx + 1} / {queue.length} • Press <kbd>Space</kbd> to flip, <kbd>1</kbd>/<kbd>2</kbd>/<kbd>3</kbd> to grade
        </div>
        <div className="text-lg whitespace-pre-wrap my-6">{showBack ? card.answer : card.question}</div>
        <div className="flex items-center gap-2">
          <button className="px-3 py-1.5 rounded border" onClick={() => setIdx((i) => Math.max(0, i - 1))} disabled={idx === 0}>◀ Prev</button>
          <button className="flex-1 px-3 py-1.5 rounded bg-black text-white" onClick={onFlip}>{showBack ? "Hide answer" : "Show answer"}</button>
          <button className="px-3 py-1.5 rounded border" onClick={() => setIdx((i) => Math.min(queue.length - 1, i + 1))} disabled={idx >= queue.length - 1}>Next ▶</button>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">Try your answer first</h3>
            <p className="text-xs text-slate-500">Inline adaptive tutoring uses your answer, misconception category, and prior strategy wins.</p>
          </div>
          <button
            className="px-3 py-1.5 rounded bg-slate-900 text-white disabled:opacity-60"
            onClick={coachCurrentCard}
            disabled={coachLoading}
          >
            {coachLoading ? "Coaching…" : "Check and coach"}
          </button>
        </div>
        <textarea
          value={answerDraft}
          onChange={(event) => setAnswerDraft(event.target.value)}
          placeholder="Write your answer or explanation here before flipping the card."
          className="min-h-[96px] w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-900"
        />

        {coachResult ? (
          <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <h4 className="text-sm font-semibold text-emerald-950">Adaptive tutoring decision</h4>
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
              <h4 className="text-sm font-semibold text-amber-950">Misconception and confidence</h4>
              <div className="flex flex-wrap gap-2">
                {(coachResult.misconceptionSignals || []).length ? (
                  coachResult.misconceptionSignals?.map((signal) => (
                    <span key={signal} className="rounded-full border border-amber-200 bg-white/80 px-3 py-1 text-xs text-amber-900">
                      {humanizeMisconceptionCategory(signal)}
                    </span>
                  ))
                ) : (
                  <span className="text-xs text-amber-900">No strong misconception signal detected.</span>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <MiniCoachStat label="Verification confidence" value={formatScore(coachResult.verification?.confidence)} />
                <MiniCoachStat label="Strategy confidence" value={formatScore(coachResult.selectedStrategy?.confidence)} />
              </div>
              {policySummary ? (
                <div className="rounded-xl border border-amber-200 bg-white/80 p-3 text-xs text-amber-900 space-y-1">
                  <div>Historical top strategy: {policySummary.topStrategy || "none yet"}</div>
                  <div>Avg confidence for this category: {formatScore(policySummary.averageConfidence)}</div>
                  <div>Low-confidence runs in slice: {policySummary.lowConfidenceRuns}</div>
                  <div>Recovery tracking activates when you grade after coaching.</div>
                </div>
              ) : null}
              {coachResult.weakTopicMatches?.length ? (
                <div className="flex flex-wrap gap-2">
                  {coachResult.weakTopicMatches.map((topic) => (
                    <span key={topic} className="rounded-full border border-amber-200 bg-white/80 px-3 py-1 text-xs text-amber-900">
                      weak topic: {topic}
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
          <button className="px-3 py-1.5 rounded bg-red-600 text-white" onClick={() => mark("again")}>1 · Again</button>
          <button className="px-3 py-1.5 rounded bg-yellow-500 text-white" onClick={() => mark("good")}>2 · Good</button>
          <button className="px-3 py-1.5 rounded bg-green-600 text-white" onClick={() => mark("easy")}>3 · Easy</button>
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

function formatScore(value: number | undefined | null) {
  const num = typeof value === "number" && Number.isFinite(value) ? value : 0;
  return num.toFixed(3);
}
