"use client";

import { useEffect, useMemo, useState } from "react";
import { humanizeMisconceptionCategory } from "@/lib/reasoningEngine/contracts";

type ReasoningCandidate = {
  id: string;
  rank: number;
  question: string;
  answer: string;
  score: number;
  verificationConfidence: number;
  selected: boolean;
  pruned: boolean;
  trajectoryDepth: number;
  sourceAttempt: number | null;
  difficulty: string | null;
  createdAt: string;
};

type ReasoningRun = {
  id: string;
  mode: string;
  title: string | null;
  origin: string | null;
  confidence: number;
  trajectoryScore: number;
  searchDepth: number;
  beamWidth: number | null;
  candidatesGenerated: number | null;
  candidatesSelected: number | null;
  prunedCount: number | null;
  verificationApplied: boolean;
  metadata: {
    weakTopicMatches: string[];
    misconceptionSignals: string[];
    verification: {
      final_answer: string;
      reasoning: string;
      confidence: number;
      trajectory_score: number;
      search_depth: number;
    };
    adaptivePolicy: {
      mode: string;
      policyVersion: string;
      selectedPolicyLabel: string;
      scorerKind: string;
      blendWeight: number;
      abstainThreshold: number;
      heuristicSelectedStrategyId: string;
      adaptiveSelectedStrategyId: string;
      effectiveSelectedStrategyId: string;
      disagreement: boolean;
      abstained: boolean;
      overrideApplied: boolean;
      candidateScores: Array<{
        strategyId: string;
        heuristicScore: number;
        artifactValueScore: number;
        blendedScore: number;
        heuristicSelected: boolean;
        adaptiveSelected: boolean;
      }>;
    } | null;
  };
  createdAt: string;
  deckId: string | null;
  replay?: {
    summary: {
      totalCandidates: number;
      selectedCount: number;
      prunedCount: number;
      averageScore: number;
      averageVerificationConfidence: number;
      highestScore: number;
    };
    candidates: ReasoningCandidate[];
  };
};

type ReasoningAnalytics = {
  totalRuns: number;
  averageConfidence: number;
  averageTrajectoryScore: number;
  averageSearchDepth: number;
  averagePrunedCount: number;
  lowConfidenceRuns: number;
  verificationRuns: number;
  byMode: Array<{ mode: string; count: number }>;
  byMisconception: Array<{ category: string; count: number }>;
  dominantMisconception: string | null;
  strategyWinsByMisconception: Array<{
    category: string;
    runCount: number;
    topStrategy: string | null;
    topStrategyType: string | null;
    winCount: number;
    strategies: Array<{ strategy: string; strategyType: string | null; count: number }>;
  }>;
  confidenceByMisconception: Array<{
    category: string;
    runCount: number;
    averageConfidence: number;
    lowConfidenceRuns: number;
  }>;
  adaptivePolicy: {
    loggedRuns: number;
    shadowRuns: number;
    activeRuns: number;
    disagreementRate: number;
    abstentionRate: number;
    overrideRate: number;
    topStrategyShifts: Array<{
      fromStrategyId: string;
      toStrategyId: string;
      count: number;
    }>;
  };
};

type ShadowReadinessStatus = "pass" | "watch" | "hold" | "manual";

type ShadowReadinessGate = {
  label: string;
  status: ShadowReadinessStatus;
  detail: string;
};

type ShadowReadiness = {
  summaryStatus: Exclude<ShadowReadinessStatus, "manual">;
  headline: string;
  recommendation: string;
  gates: ShadowReadinessGate[];
  stats: {
    telemetryCoverage: number;
    disagreementCount: number;
    abstentionShareOfDisagreements: number;
    averageCandidateMargin: number;
    topShiftShare: number;
    topMisconceptionShare: number;
    topSelectedStrategyShare: number;
  };
};

type StudentState = {
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
};

type GovernanceReport = {
  reportDate: string;
  generatedAt: string;
  reportStatus: string;
  deploymentPosture: string;
  recommendedPosture: string;
  blockedReasons: string[];
  policy: {
    policyVersion: string | null;
    selectedPolicyLabel: string | null;
    scorerKind: string | null;
    blendWeight: number | null;
    abstainThreshold: number | null;
  };
  shadow: {
    totalExamples: number;
    disagreementRate: number;
    abstentionRate: number;
    overrideRate: number;
    dataWarnings: string[];
  };
  recovery: {
    totalExamples: number;
    recoveredCount: number;
    stabilizedCount: number;
    averageConfidenceDelta: number;
    classBalance: {
      recoveryRate: number;
      stabilizationRate: number;
    } | null;
    dataWarnings: string[];
  };
  artifactPaths: {
    governanceReport: string;
    replayDigest: string;
    rolloutDecision: string;
    reportStatus: string;
  };
};

const MODE_OPTIONS = [
  { label: "All runs", value: "" },
  { label: "Flashcards", value: "flashcards" },
  { label: "Verify answer", value: "verify_answer" },
  { label: "Compare explanations", value: "compare_explanations" },
  { label: "Tutor guidance", value: "tutor_guidance" },
];

export default function ReasoningReplayConsole() {
  const [mode, setMode] = useState("");
  const [misconception, setMisconception] = useState("");
  const [runs, setRuns] = useState<ReasoningRun[]>([]);
  const [analytics, setAnalytics] = useState<ReasoningAnalytics | null>(null);
  const [studentState, setStudentState] = useState<StudentState | null>(null);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [governanceReport, setGovernanceReport] = useState<GovernanceReport | null>(null);
  const [loadingRuns, setLoadingRuns] = useState(true);
  const [loadingState, setLoadingState] = useState(true);
  const [loadingGovernance, setLoadingGovernance] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadRuns() {
      setLoadingRuns(true);
      setError(null);
      try {
        const params = new URLSearchParams({
          includeCandidates: "1",
          limit: "12",
          candidateLimit: "12",
        });
        if (mode) params.set("mode", mode);
        if (misconception) params.set("misconception", misconception);

        const res = await fetch(`/api/reasoning-runs?${params.toString()}`, { cache: "no-store" });
        const data = await res.json();
        if (!res.ok || !data?.ok) {
          throw new Error(data?.error || "Failed to load reasoning runs");
        }
        if (cancelled) return;
        setRuns(data.runs || []);
        setAnalytics(data.analytics || null);
        setSelectedRunId((current) => {
          if (current && (data.runs || []).some((run: ReasoningRun) => run.id === current)) return current;
          return data.runs?.[0]?.id || null;
        });
      } catch (err: any) {
        if (!cancelled) {
          setError(err?.message || "Failed to load reasoning runs");
          setRuns([]);
          setAnalytics(null);
          setSelectedRunId(null);
        }
      } finally {
        if (!cancelled) setLoadingRuns(false);
      }
    }

    loadRuns();
    return () => {
      cancelled = true;
    };
  }, [mode, misconception]);

  useEffect(() => {
    let cancelled = false;

    async function loadStudentState() {
      setLoadingState(true);
      try {
        const res = await fetch("/api/student-state", { cache: "no-store" });
        const data = await res.json();
        if (!cancelled) {
          setStudentState(res.ok && data?.ok ? data.studentState : null);
        }
      } finally {
        if (!cancelled) setLoadingState(false);
      }
    }

    loadStudentState();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadGovernanceReport() {
      setLoadingGovernance(true);
      try {
        const res = await fetch("/api/governance/latest", { cache: "no-store" });
        const data = await res.json();
        if (!cancelled) {
          setGovernanceReport(res.ok && data?.ok ? data.report : null);
        }
      } finally {
        if (!cancelled) setLoadingGovernance(false);
      }
    }

    loadGovernanceReport();
    return () => {
      cancelled = true;
    };
  }, []);

  const selectedRun = useMemo(
    () => runs.find((run) => run.id === selectedRunId) || runs[0] || null,
    [runs, selectedRunId]
  );

  const shadowReadiness = useMemo(
    () => evaluateShadowReadiness(analytics, runs),
    [analytics, runs]
  );

  return (
    <div className="mx-auto max-w-7xl p-6 space-y-6">
      <section className="rounded-3xl border border-slate-200 bg-[radial-gradient(circle_at_top_left,_rgba(14,165,233,0.10),_transparent_42%),linear-gradient(135deg,_#f8fbff_0%,_#eef5ff_45%,_#f8fafc_100%)] p-6 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-sky-700">Reasoning Replay</p>
            <h1 className="text-3xl font-semibold text-slate-900">Inspectable reasoning, not black-box tutoring</h1>
            <p className="max-w-3xl text-sm text-slate-600">
              Review selected and rejected trajectories, track confidence and pruning behavior, and inspect how student state is shaping tutoring strategy selection.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {MODE_OPTIONS.map((option) => {
              const active = mode === option.value;
              return (
                <button
                  key={option.label}
                  onClick={() => setMode(option.value)}
                  className={active
                    ? "rounded-full bg-slate-900 px-4 py-2 text-sm text-white"
                    : "rounded-full border border-slate-300 bg-white px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
        </div>
        <div className="mt-4 space-y-2">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Misconception filter</p>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setMisconception("")}
              className={misconception === ""
                ? "rounded-full bg-amber-500 px-4 py-2 text-sm text-white"
                : "rounded-full border border-amber-200 bg-white px-4 py-2 text-sm text-amber-900 hover:bg-amber-50"}
            >
              All categories
            </button>
            {(analytics?.byMisconception || []).map((entry) => {
              const active = misconception === entry.category;
              return (
                <button
                  key={entry.category}
                  onClick={() => setMisconception(entry.category)}
                  className={active
                    ? "rounded-full bg-amber-500 px-4 py-2 text-sm text-white"
                    : "rounded-full border border-amber-200 bg-white px-4 py-2 text-sm text-amber-900 hover:bg-amber-50"}
                >
                  {humanizeMisconception(entry.category)} ({entry.count})
                </button>
              );
            })}
          </div>
        </div>
      </section>

      {error ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>
      ) : null}

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <MetricCard label="Total runs" value={loadingRuns ? "..." : String(analytics?.totalRuns || 0)} tone="slate" />
        <MetricCard label="Avg confidence" value={loadingRuns ? "..." : formatScore(analytics?.averageConfidence)} tone="sky" />
        <MetricCard label="Avg trajectory score" value={loadingRuns ? "..." : formatScore(analytics?.averageTrajectoryScore)} tone="emerald" />
        <MetricCard label="Avg search depth" value={loadingRuns ? "..." : formatScore(analytics?.averageSearchDepth)} tone="amber" />
        <MetricCard label="Dominant misconception" value={loadingRuns ? "..." : formatDominantMisconception(analytics?.dominantMisconception)} tone="rose" />
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Weekly governance snapshot</h2>
            <p className="text-sm text-slate-500">Latest generated governance bundle for replay review, rollout posture, and operational continuity.</p>
          </div>
          {governanceReport ? (
            <ShadowStatusPill status={governanceReport.reportStatus === "ok" ? "pass" : "hold"}>
              {governanceReport.reportStatus === "ok" ? "report active" : governanceReport.reportStatus}
            </ShadowStatusPill>
          ) : null}
        </div>

        {loadingGovernance ? (
          <PlaceholderBlock />
        ) : !governanceReport ? (
          <EmptyState text="No governance bundle found yet. Run the weekly governance report generator to create the first operational snapshot." />
        ) : (
          <>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
              <MiniStat label="Report date" value={governanceReport.reportDate} />
              <MiniStat label="Deployment posture" value={governanceReport.deploymentPosture} />
              <MiniStat label="Recommended posture" value={humanizeUnderscoreLabel(governanceReport.recommendedPosture)} />
              <MiniStat label="Shadow examples" value={String(governanceReport.shadow.totalExamples)} />
              <MiniStat label="Recovery examples" value={String(governanceReport.recovery.totalExamples)} />
            </div>

            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <MiniStat label="Disagreement rate" value={formatScore(governanceReport.shadow.disagreementRate)} />
              <MiniStat label="Abstention rate" value={formatScore(governanceReport.shadow.abstentionRate)} />
              <MiniStat label="Recovery rate" value={formatScore(governanceReport.recovery.classBalance?.recoveryRate)} />
              <MiniStat label="Avg confidence delta" value={formatScore(governanceReport.recovery.averageConfidenceDelta)} />
            </div>

            <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 space-y-3">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Operational warnings</p>
                {governanceWarnings(governanceReport).length ? (
                  <ul className="space-y-2 text-sm text-slate-700">
                    {governanceWarnings(governanceReport).map((warning) => (
                      <li key={warning} className="rounded-xl bg-white px-3 py-2 border border-slate-200">
                        {warning}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-slate-600">No warnings are attached to the latest governance bundle.</p>
                )}
              </div>

              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 space-y-3">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Artifact paths</p>
                <div className="space-y-2 text-sm text-slate-700">
                  <div className="rounded-xl bg-white px-3 py-2 border border-slate-200">{governanceReport.artifactPaths.governanceReport}</div>
                  <div className="rounded-xl bg-white px-3 py-2 border border-slate-200">{governanceReport.artifactPaths.replayDigest}</div>
                  <div className="rounded-xl bg-white px-3 py-2 border border-slate-200">{governanceReport.artifactPaths.rolloutDecision}</div>
                  <div className="rounded-xl bg-white px-3 py-2 border border-slate-200">Generated {new Date(governanceReport.generatedAt).toLocaleString()}</div>
                </div>
              </div>
            </div>
          </>
        )}
      </section>

      {analytics?.adaptivePolicy?.loggedRuns ? (
        <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">Adaptive policy telemetry</h2>
              <p className="text-sm text-slate-500">Shadow and active disagreement behavior for the live tutoring reranker boundary.</p>
            </div>
            <span className="text-xs text-slate-500">{analytics.adaptivePolicy.loggedRuns} logged tutor-guidance runs</span>
          </div>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <MiniStat label="Disagreement rate" value={formatScore(analytics.adaptivePolicy.disagreementRate)} />
            <MiniStat label="Abstention rate" value={formatScore(analytics.adaptivePolicy.abstentionRate)} />
            <MiniStat label="Override rate" value={formatScore(analytics.adaptivePolicy.overrideRate)} />
            <MiniStat label="Shadow / active" value={`${analytics.adaptivePolicy.shadowRuns}/${analytics.adaptivePolicy.activeRuns}`} />
          </div>
          {analytics.adaptivePolicy.topStrategyShifts.length ? (
            <div className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Most common heuristic to adaptive shifts</p>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {analytics.adaptivePolicy.topStrategyShifts.map((shift) => (
                  <div key={`${shift.fromStrategyId}-${shift.toStrategyId}`} className="rounded-2xl border border-violet-200 bg-violet-50 p-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-violet-800">Shift</p>
                    <p className="mt-2 text-sm font-medium text-violet-950">{shift.fromStrategyId} to {shift.toStrategyId}</p>
                    <p className="mt-3 text-2xl font-semibold text-violet-900">{shift.count}</p>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </section>
      ) : null}

      {shadowReadiness ? (
        <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">Shadow-readiness checklist</h2>
              <p className="text-sm text-slate-500">Rollout gates for deciding whether the adaptive layer has earned any authority beyond shadow scoring.</p>
            </div>
            <ShadowStatusPill status={shadowReadiness.summaryStatus}>
              {shadowReadiness.headline}
            </ShadowStatusPill>
          </div>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <MiniStat label="Telemetry coverage" value={formatPercent(shadowReadiness.stats.telemetryCoverage)} />
            <MiniStat label="Abstain / disagreement" value={formatPercent(shadowReadiness.stats.abstentionShareOfDisagreements)} />
            <MiniStat label="Avg top-2 margin" value={formatScore(shadowReadiness.stats.averageCandidateMargin)} />
            <MiniStat label="Top strategy share" value={formatPercent(shadowReadiness.stats.topSelectedStrategyShare)} />
          </div>
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
            {shadowReadiness.recommendation}
          </div>
          <div className="grid gap-3 xl:grid-cols-2">
            {shadowReadiness.gates.map((gate) => (
              <div key={gate.label} className="rounded-2xl border border-slate-200 bg-white p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-slate-900">{gate.label}</p>
                    <p className="mt-2 text-sm text-slate-600">{gate.detail}</p>
                  </div>
                  <ShadowStatusPill status={gate.status}>{shadowGateLabel(gate.status)}</ShadowStatusPill>
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {analytics?.byMisconception?.length ? (
        <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">Misconception aggregation</h2>
              <p className="text-sm text-slate-500">Category frequency across the currently loaded replay slice.</p>
            </div>
            <span className="text-xs text-slate-500">{analytics.byMisconception.length} categories detected</span>
          </div>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {analytics.byMisconception.slice(0, 8).map((entry) => (
              <div key={entry.category} className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-800">Misconception</p>
                <p className="mt-2 text-base font-semibold text-amber-950">{humanizeMisconception(entry.category)}</p>
                <p className="mt-3 text-2xl font-semibold text-amber-900">{entry.count}</p>
                <p className="mt-1 text-xs text-amber-800">runs in current slice</p>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {analytics?.strategyWinsByMisconception?.length ? (
        <section className="grid gap-6 xl:grid-cols-2">
          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">Strategy wins by misconception</h2>
                <p className="text-sm text-slate-500">Selected tutoring strategies that most often win reranking for each misconception category.</p>
              </div>
            </div>
            <div className="space-y-3">
              {analytics.strategyWinsByMisconception.slice(0, 6).map((entry) => (
                <div key={entry.category} className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-800">{humanizeMisconception(entry.category)}</p>
                      <h3 className="mt-2 font-semibold text-emerald-950">{entry.topStrategy || "No tutoring win yet"}</h3>
                    </div>
                    <div className="text-right text-xs text-emerald-800">
                      <div>{entry.winCount} wins</div>
                      <div>{entry.runCount} runs</div>
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {entry.topStrategyType ? <Badge>{entry.topStrategyType}</Badge> : null}
                    {entry.strategies.slice(0, 3).map((strategy) => (
                      <Badge key={`${entry.category}-${strategy.strategy}-${strategy.strategyType || "unknown"}`}>
                        {strategy.strategyType || "strategy"}: {strategy.count}
                      </Badge>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">Confidence by misconception</h2>
              <p className="text-sm text-slate-500">Average confidence and low-confidence pressure for each misconception category in the current slice.</p>
            </div>
            <div className="space-y-3">
              {analytics.confidenceByMisconception.slice(0, 6).map((entry) => (
                <div key={entry.category} className="rounded-2xl border border-sky-200 bg-sky-50 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-800">{humanizeMisconception(entry.category)}</p>
                      <p className="mt-2 text-lg font-semibold text-sky-950">avg confidence {formatScore(entry.averageConfidence)}</p>
                    </div>
                    <div className="text-right text-xs text-sky-800">
                      <div>{entry.lowConfidenceRuns} low-confidence</div>
                      <div>{entry.runCount} runs</div>
                    </div>
                  </div>
                  <div className="mt-3 h-2 overflow-hidden rounded-full bg-sky-100">
                    <div
                      className="h-full rounded-full bg-sky-500 transition-all"
                      style={{ width: `${Math.max(4, Math.min(100, entry.averageConfidence * 100))}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      ) : null}

      {selectedRun ? (
        <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Why this path won</p>
              <h2 className="mt-1 text-lg font-semibold text-slate-900">{selectedRun.title || readableRunTitle(selectedRun)}</h2>
            </div>
            <div className="flex flex-wrap gap-2 text-xs text-slate-600">
              <Badge>mode {labelForMode(selectedRun.mode)}</Badge>
              <Badge>confidence {formatScore(selectedRun.confidence)}</Badge>
              <Badge>trajectory {formatScore(selectedRun.trajectoryScore)}</Badge>
              {selectedRun.metadata.adaptivePolicy ? <Badge>{selectedRun.metadata.adaptivePolicy.mode} adaptive telemetry</Badge> : null}
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
              <h3 className="text-sm font-semibold text-emerald-900">Selection commentary</h3>
              <ul className="mt-3 space-y-2 text-sm text-emerald-900">
                {buildWhyWonReasons(selectedRun).map((reason) => (
                  <li key={reason} className="rounded-xl bg-white/70 px-3 py-2">
                    {reason}
                  </li>
                ))}
              </ul>
            </div>
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
              <h3 className="text-sm font-semibold text-amber-900">Misconception signals</h3>
              {selectedRun.metadata.misconceptionSignals.length === 0 ? (
                <p className="mt-3 text-sm text-amber-900">No persistent misconception signal was attached to this run.</p>
              ) : (
                <div className="mt-3 flex flex-wrap gap-2">
                  {selectedRun.metadata.misconceptionSignals.map((signal) => (
                    <span key={signal} className="rounded-full bg-white/80 px-3 py-1 text-sm text-amber-900 border border-amber-200">
                      {humanizeMisconception(signal)}
                    </span>
                  ))}
                </div>
              )}
              {selectedRun.metadata.weakTopicMatches.length > 0 ? (
                <div className="mt-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-800">Matched weak topics</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {selectedRun.metadata.weakTopicMatches.map((topic) => (
                      <span key={topic} className="rounded-full border border-amber-200 bg-white/80 px-3 py-1 text-sm text-amber-900">
                        {topic}
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          </div>

          {selectedRun.metadata.adaptivePolicy ? (
            <div className="rounded-2xl border border-violet-200 bg-violet-50 p-4 space-y-4">
              <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-violet-950">Adaptive policy trace</h3>
                  <p className="text-xs text-violet-900">
                    {selectedRun.metadata.adaptivePolicy.selectedPolicyLabel || selectedRun.metadata.adaptivePolicy.policyVersion} via {selectedRun.metadata.adaptivePolicy.scorerKind}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2 text-xs text-violet-900">
                  <Badge>blend {formatScore(selectedRun.metadata.adaptivePolicy.blendWeight)}</Badge>
                  <Badge>abstain {formatScore(selectedRun.metadata.adaptivePolicy.abstainThreshold)}</Badge>
                  <Badge>{selectedRun.metadata.adaptivePolicy.overrideApplied ? "override applied" : selectedRun.metadata.adaptivePolicy.disagreement ? "shadow disagreement" : "no disagreement"}</Badge>
                </div>
              </div>
              <div className="grid gap-3 md:grid-cols-3">
                <MiniStat label="Heuristic choice" value={selectedRun.metadata.adaptivePolicy.heuristicSelectedStrategyId || "none"} />
                <MiniStat label="Adaptive choice" value={selectedRun.metadata.adaptivePolicy.adaptiveSelectedStrategyId || "none"} />
                <MiniStat label="Effective choice" value={selectedRun.metadata.adaptivePolicy.effectiveSelectedStrategyId || "none"} />
              </div>
              <div className="space-y-3">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-violet-900">Candidate score trace</p>
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {selectedRun.metadata.adaptivePolicy.candidateScores.map((candidate) => (
                    <div key={candidate.strategyId} className="rounded-2xl border border-violet-200 bg-white/80 p-4">
                      <div className="flex flex-wrap gap-2">
                        <Badge strong={candidate.heuristicSelected || candidate.adaptiveSelected}>{candidate.strategyId}</Badge>
                        {candidate.heuristicSelected ? <Badge>heuristic</Badge> : null}
                        {candidate.adaptiveSelected ? <Badge>adaptive</Badge> : null}
                      </div>
                      <div className="mt-3 space-y-1 text-sm text-violet-950">
                        <div>heuristic {formatScore(candidate.heuristicScore)}</div>
                        <div>artifact {formatScore(candidate.artifactValueScore)}</div>
                        <div>blended {formatScore(candidate.blendedScore)}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : null}
        </section>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[1.1fr_1.3fr_0.9fr]">
        <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-slate-900">Run history</h2>
            <span className="text-xs text-slate-500">{runs.length} loaded</span>
          </div>
          <div className="space-y-3 max-h-[70vh] overflow-auto pr-1">
            {loadingRuns ? (
              <PlaceholderBlock />
            ) : runs.length === 0 ? (
              <EmptyState text="No reasoning runs yet. Generate flashcards, verify an answer, or use tutoring guidance to populate replay." />
            ) : (
              runs.map((run) => {
                const active = selectedRun?.id === run.id;
                return (
                  <button
                    key={run.id}
                    onClick={() => setSelectedRunId(run.id)}
                    className={active
                      ? "w-full rounded-2xl border border-sky-400 bg-sky-50 p-4 text-left shadow-sm"
                      : "w-full rounded-2xl border border-slate-200 bg-slate-50/60 p-4 text-left hover:bg-slate-50"}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">{labelForMode(run.mode)}</p>
                        <h3 className="mt-1 font-medium text-slate-900">{run.title || readableRunTitle(run)}</h3>
                      </div>
                      <span className={run.confidence >= 0.65 ? "rounded-full bg-emerald-100 px-2 py-1 text-xs text-emerald-700" : run.confidence < 0.45 ? "rounded-full bg-rose-100 px-2 py-1 text-xs text-rose-700" : "rounded-full bg-amber-100 px-2 py-1 text-xs text-amber-700"}>
                        {formatScore(run.confidence)}
                      </span>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-600">
                      <Badge>{new Date(run.createdAt).toLocaleString()}</Badge>
                      <Badge>score {formatScore(run.trajectoryScore)}</Badge>
                      <Badge>depth {run.searchDepth}</Badge>
                      <Badge>{run.candidatesSelected ?? 0}/{run.candidatesGenerated ?? 0} kept</Badge>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">Trajectory replay</h2>
              <p className="text-sm text-slate-500">Selected, rejected, and misconception-adjacent paths for the active run.</p>
            </div>
            {selectedRun?.replay ? (
              <div className="text-right text-xs text-slate-500">
                <div>{selectedRun.replay.summary.totalCandidates} candidates</div>
                <div>{selectedRun.replay.summary.prunedCount} pruned</div>
              </div>
            ) : null}
          </div>

          {!selectedRun ? (
            <EmptyState text="Select a reasoning run to inspect its replay." />
          ) : !selectedRun.replay?.candidates?.length ? (
            <EmptyState text="This run does not have persisted candidates available yet." />
          ) : (
            <div className="space-y-4">
              <div className="grid gap-3 md:grid-cols-3">
                <MiniStat label="Avg candidate score" value={formatScore(selectedRun.replay.summary.averageScore)} />
                <MiniStat label="Avg verification confidence" value={formatScore(selectedRun.replay.summary.averageVerificationConfidence)} />
                <MiniStat label="Highest score" value={formatScore(selectedRun.replay.summary.highestScore)} />
              </div>
              <div className="space-y-3 max-h-[60vh] overflow-auto pr-1">
                {selectedRun.replay.candidates.map((candidate) => {
                  const tone = candidate.selected
                    ? "border-emerald-300 bg-emerald-50"
                    : candidate.pruned
                      ? "border-rose-200 bg-rose-50"
                      : "border-slate-200 bg-slate-50";
                  const label = candidate.selected ? "Selected" : candidate.pruned ? "Rejected" : "Candidate";
                  return (
                    <article key={candidate.id} className={`rounded-2xl border p-4 ${tone}`}>
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <div className="flex flex-wrap gap-2">
                            <Badge strong>{label}</Badge>
                            <Badge>rank {candidate.rank}</Badge>
                            <Badge>score {formatScore(candidate.score)}</Badge>
                            <Badge>verify {formatScore(candidate.verificationConfidence)}</Badge>
                            <Badge>depth {candidate.trajectoryDepth}</Badge>
                            {candidate.difficulty ? <Badge>{candidate.difficulty}</Badge> : null}
                            {candidateLabel(selectedRun, candidate) ? <Badge>{candidateLabel(selectedRun, candidate)}</Badge> : null}
                          </div>
                          <h3 className="mt-3 font-medium text-slate-900">{candidate.question}</h3>
                        </div>
                      </div>
                      <p className="mt-3 text-sm leading-6 text-slate-700">{candidate.answer}</p>
                      <div className="mt-3 space-y-2">
                        <p className="text-xs text-slate-500">{candidate.selected ? "This trajectory won the reranking pass and shaped the final output." : "This trajectory was explored but not selected. Use it to inspect rejected alternatives and misconception patterns."}</p>
                        <ul className="space-y-2">
                          {buildCandidateReasons(selectedRun, candidate).map((reason) => (
                            <li key={reason} className="rounded-xl bg-white/70 px-3 py-2 text-xs text-slate-700 border border-white/80">
                              {reason}
                            </li>
                          ))}
                        </ul>
                      </div>
                    </article>
                  );
                })}
              </div>
            </div>
          )}
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Student state</h2>
            <p className="text-sm text-slate-500">Persistent adaptation signals shaping tutoring and verification.</p>
          </div>

          {loadingState ? (
            <PlaceholderBlock />
          ) : !studentState ? (
            <EmptyState text="Student state becomes available after persisted verification or tutoring runs." />
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <MiniStat label="Overall confidence" value={formatScore(studentState.confidenceProfile.overall)} />
                <MiniStat label="Verification avg" value={formatScore(studentState.confidenceProfile.verificationAverage)} />
                <MiniStat label="Verification count" value={String(studentState.confidenceProfile.verificationCount)} />
                <MiniStat label="Low-confidence streak" value={String(studentState.pacingProfile.lowConfidenceStreak)} />
              </div>

              <TagSection title="Weak concepts" items={studentState.weakConcepts} empty="No weak concepts detected yet." />
              <TagSection title="Misconception patterns" items={studentState.misconceptionPatterns} empty="No recurring misconception patterns yet." />
              <TagSection title="Recent failures" items={studentState.recentFailures} empty="No recent failures logged." multiline />
              <TagSection title="Recent successes" items={studentState.recentSuccesses} empty="No recent successes logged." multiline />

              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-slate-900">Success rate</span>
                  <span>{formatScore(studentState.retentionProfile.recentVerificationSuccessRate)}</span>
                </div>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-200">
                  <div
                    className="h-full rounded-full bg-emerald-500 transition-all"
                    style={{ width: `${Math.max(4, Math.min(100, studentState.retentionProfile.recentVerificationSuccessRate * 100))}%` }}
                  />
                </div>
                <p className="mt-3 text-xs text-slate-500">
                  Updated {studentState.updatedAt ? new Date(studentState.updatedAt).toLocaleString() : "not yet"}
                </p>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function MetricCard({ label, value, tone }: { label: string; value: string; tone: "slate" | "sky" | "emerald" | "amber" | "rose" }) {
  const toneClass = {
    slate: "border-slate-200 bg-white text-slate-900",
    sky: "border-sky-200 bg-sky-50 text-sky-900",
    emerald: "border-emerald-200 bg-emerald-50 text-emerald-900",
    amber: "border-amber-200 bg-amber-50 text-amber-900",
    rose: "border-rose-200 bg-rose-50 text-rose-900",
  }[tone];

  return (
    <div className={`rounded-2xl border p-4 shadow-sm ${toneClass}`}>
      <p className="text-xs uppercase tracking-[0.2em] opacity-70">{label}</p>
      <p className="mt-3 text-2xl font-semibold">{value}</p>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
      <p className="text-xs uppercase tracking-[0.18em] text-slate-500">{label}</p>
      <p className="mt-2 text-lg font-semibold text-slate-900">{value}</p>
    </div>
  );
}

function ShadowStatusPill({ status, children }: { status: ShadowReadinessStatus; children: React.ReactNode }) {
  const toneClass = {
    pass: "border-emerald-200 bg-emerald-50 text-emerald-800",
    watch: "border-amber-200 bg-amber-50 text-amber-800",
    hold: "border-rose-200 bg-rose-50 text-rose-800",
    manual: "border-sky-200 bg-sky-50 text-sky-800",
  }[status];

  return (
    <span className={`rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] ${toneClass}`}>
      {children}
    </span>
  );
}

function Badge({ children, strong = false }: { children: React.ReactNode; strong?: boolean }) {
  return (
    <span className={strong ? "rounded-full bg-slate-900 px-2.5 py-1 text-xs text-white" : "rounded-full bg-white/90 px-2.5 py-1 text-xs text-slate-600 border border-slate-200"}>
      {children}
    </span>
  );
}

function TagSection({ title, items, empty, multiline = false }: { title: string; items: string[]; empty: string; multiline?: boolean }) {
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
      {items.length === 0 ? (
        <p className="text-sm text-slate-500">{empty}</p>
      ) : multiline ? (
        <div className="space-y-2">
          {items.map((item) => (
            <div key={item} className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
              {item}
            </div>
          ))}
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {items.map((item) => (
            <span key={item} className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-sm text-slate-700">
              {item}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-6 text-sm text-slate-500">{text}</div>;
}

function PlaceholderBlock() {
  return (
    <div className="animate-pulse space-y-3">
      <div className="h-16 rounded-2xl bg-slate-100" />
      <div className="h-16 rounded-2xl bg-slate-100" />
      <div className="h-16 rounded-2xl bg-slate-100" />
    </div>
  );
}

function formatScore(value: number | undefined | null) {
  const num = typeof value === "number" && Number.isFinite(value) ? value : 0;
  return num.toFixed(3);
}

function formatPercent(value: number | undefined | null) {
  const num = typeof value === "number" && Number.isFinite(value) ? value : 0;
  return `${Math.round(num * 100)}%`;
}

function formatDominantMisconception(value: string | null | undefined) {
  return value ? humanizeMisconception(value) : "None";
}

function labelForMode(mode: string) {
  switch (mode) {
    case "flashcards":
      return "Flashcards";
    case "verify_answer":
      return "Verify answer";
    case "compare_explanations":
      return "Compare explanations";
    case "tutor_guidance":
      return "Tutor guidance";
    default:
      return mode.replace(/_/g, " ");
  }
}

function readableRunTitle(run: ReasoningRun) {
  if (run.mode === "tutor_guidance") return "Adaptive tutoring strategy selection";
  if (run.mode === "verify_answer") return "Answer verification pass";
  if (run.mode === "compare_explanations") return "Explanation comparison pass";
  return "Reasoning run";
}

function buildWhyWonReasons(run: ReasoningRun) {
  const reasons = [
    `This path achieved the strongest combined trajectory score (${formatScore(run.trajectoryScore)}) among the explored options.`,
  ];
  if (run.metadata.verification.confidence > 0) {
    reasons.push(`Verification confidence for this run was ${formatScore(run.metadata.verification.confidence)}, which helped stabilize selection.`);
  }
  if (run.metadata.weakTopicMatches.length > 0) {
    reasons.push(`The selected path directly addressed weak-topic signals: ${run.metadata.weakTopicMatches.join(", ")}.`);
  }
  if (run.metadata.misconceptionSignals.length > 0) {
    reasons.push(`The strategy was chosen to counter the misconception pattern ${humanizeMisconception(run.metadata.misconceptionSignals[0])}.`);
  }
  if (run.metadata.adaptivePolicy?.overrideApplied) {
    reasons.push(`A low-authority adaptive override was applied after the heuristic and artifact scorer disagreed on the best tutoring action.`);
  } else if (run.metadata.adaptivePolicy?.disagreement) {
    reasons.push(`The adaptive scorer disagreed with the heuristic controller, but the abstention gate kept the heuristic selection in place.`);
  }
  if ((run.candidatesGenerated ?? 0) > 1) {
    reasons.push(`It won after reranking ${run.candidatesGenerated} candidate trajectories and pruning ${run.prunedCount ?? 0}.`);
  }
  return reasons.slice(0, 4);
}

function buildCandidateReasons(run: ReasoningRun, candidate: ReasoningCandidate) {
  const reasons: string[] = [];
  const selected = run.replay?.candidates.find((item) => item.selected) || null;

  if (candidate.selected) {
    reasons.push("Won the reranking pass after balancing trajectory score, verification confidence, and student-state fit.");
  } else {
    if (selected && candidate.score < selected.score) {
      reasons.push(`Lower rerank score than the selected path (${formatScore(candidate.score)} vs ${formatScore(selected.score)}).`);
    }
    if (selected && candidate.verificationConfidence < selected.verificationConfidence) {
      reasons.push(
        `Lower verification confidence than the chosen path (${formatScore(candidate.verificationConfidence)} vs ${formatScore(selected.verificationConfidence)}).`
      );
    }
  }

  const label = candidateLabel(run, candidate);
  if (label) {
    reasons.push(`Labeled as ${label.toLowerCase()} based on the persistent tutoring and misconception signals attached to this run.`);
  }

  if (candidate.trajectoryDepth > 1) {
    reasons.push(`This candidate appeared later in the search rollout at depth ${candidate.trajectoryDepth}.`);
  }

  if (reasons.length === 0) {
    reasons.push(candidate.selected ? "Selected as the highest-value available trajectory." : "Kept as an alternative trajectory for replay and comparison.");
  }

  return reasons.slice(0, 3);
}

function candidateLabel(run: ReasoningRun, candidate: ReasoningCandidate) {
  const text = `${candidate.question} ${candidate.answer}`.toLowerCase();
  for (const signal of run.metadata.misconceptionSignals) {
    if (text.includes(signal.replace(/_/g, " ")) || text.includes(signal.toLowerCase())) {
      return humanizeMisconception(signal);
    }
  }
  if (!candidate.selected && run.metadata.misconceptionSignals.length > 0) {
    return humanizeMisconception(run.metadata.misconceptionSignals[0]);
  }
  if (candidate.selected && run.metadata.weakTopicMatches.length > 0) {
    return "Weak-topic aligned";
  }
  return null;
}

function humanizeMisconception(value: string) {
  return humanizeMisconceptionCategory(value);
}

function evaluateShadowReadiness(
  analytics: ReasoningAnalytics | null,
  runs: ReasoningRun[]
): ShadowReadiness | null {
  if (!analytics?.adaptivePolicy?.loggedRuns) return null;

  const tutorGuidanceRuns = runs.filter((run) => run.mode === "tutor_guidance");
  const adaptiveRuns = tutorGuidanceRuns.filter((run) => run.metadata.adaptivePolicy);
  const disagreementRuns = adaptiveRuns.filter((run) => run.metadata.adaptivePolicy?.disagreement);
  const telemetryCoverage = tutorGuidanceRuns.length
    ? adaptiveRuns.length / tutorGuidanceRuns.length
    : 0;
  const disagreementCount = disagreementRuns.length;
  const abstentionShareOfDisagreements = disagreementCount
    ? (analytics.adaptivePolicy.abstentionRate * analytics.adaptivePolicy.loggedRuns) / disagreementCount
    : 0;
  const averageCandidateMargin = average(
    adaptiveRuns.map((run) => topCandidateMargin(run.metadata.adaptivePolicy?.candidateScores || []))
  );
  const topShiftShare = disagreementCount
    ? (analytics.adaptivePolicy.topStrategyShifts[0]?.count || 0) / disagreementCount
    : 0;
  const totalMisconceptionCount = analytics.byMisconception.reduce((sum, entry) => sum + entry.count, 0);
  const topMisconceptionShare = totalMisconceptionCount
    ? (analytics.byMisconception[0]?.count || 0) / totalMisconceptionCount
    : 0;
  const selectedStrategyCounts = new Map<string, number>();
  for (const run of adaptiveRuns) {
    const strategyId = run.metadata.adaptivePolicy?.effectiveSelectedStrategyId;
    if (!strategyId) continue;
    selectedStrategyCounts.set(strategyId, (selectedStrategyCounts.get(strategyId) || 0) + 1);
  }
  const topSelectedStrategyShare = adaptiveRuns.length
    ? Math.max(0, ...selectedStrategyCounts.values()) / adaptiveRuns.length
    : 0;

  const gates: ShadowReadinessGate[] = [
    buildGate(
      "Telemetry completeness",
      telemetryCoverage >= 0.95 && analytics.adaptivePolicy.loggedRuns >= 5
        ? "pass"
        : telemetryCoverage >= 0.8
          ? "watch"
          : "hold",
      telemetryCoverage >= 0.95
        ? `Adaptive telemetry is attached to ${adaptiveRuns.length}/${tutorGuidanceRuns.length || 0} tutor-guidance runs in the current slice.`
        : `Coverage is ${formatPercent(telemetryCoverage)} in the current slice; verify persistence and route logging before granting authority.`
    ),
    buildGate(
      "Disagreement sparse and stable",
      analytics.adaptivePolicy.loggedRuns < 15
        ? "watch"
        : analytics.adaptivePolicy.disagreementRate <= 0.08
          ? "pass"
          : analytics.adaptivePolicy.disagreementRate <= 0.15
            ? "watch"
            : "hold",
      analytics.adaptivePolicy.loggedRuns < 15
        ? `Only ${analytics.adaptivePolicy.loggedRuns} logged adaptive runs are visible; keep collecting shadow traffic before interpreting disagreement rate ${formatPercent(analytics.adaptivePolicy.disagreementRate)}.`
        : `Current disagreement rate is ${formatPercent(analytics.adaptivePolicy.disagreementRate)} across ${analytics.adaptivePolicy.loggedRuns} logged adaptive runs.`
    ),
    buildGate(
      "Abstention common",
      disagreementCount === 0
        ? "watch"
        : abstentionShareOfDisagreements >= 0.6
          ? "pass"
          : abstentionShareOfDisagreements >= 0.35
            ? "watch"
            : "hold",
      disagreementCount === 0
        ? "No adaptive disagreements are visible yet, so abstention behavior is still untested on real traffic."
        : `${formatPercent(abstentionShareOfDisagreements)} of disagreements abstained in the current slice, which is the main calibration check before any live authority.`
    ),
    buildGate(
      "Override clusters interpretable",
      disagreementCount < 5
        ? "watch"
        : topShiftShare <= 0.5
          ? "pass"
          : topShiftShare <= 0.75
            ? "watch"
            : "hold",
      disagreementCount < 5
        ? `Only ${disagreementCount} disagreement traces are available; inspect more shadow disagreements before trusting cluster shape.`
        : `The most common heuristic-to-adaptive shift accounts for ${formatPercent(topShiftShare)} of disagreements.`
    ),
    buildGate(
      "Candidate-score spread non-collapsed",
      averageCandidateMargin >= 0.03
        ? "pass"
        : averageCandidateMargin >= 0.015
          ? "watch"
          : "hold",
      `Average top-two blended-score margin is ${formatScore(averageCandidateMargin)} across logged adaptive runs, which indicates how separable real candidate rankings are.`
    ),
    buildGate(
      "Misconception concentration",
      topMisconceptionShare <= 0.45
        ? "pass"
        : topMisconceptionShare <= 0.6
          ? "watch"
          : "hold",
      `The largest misconception bucket currently represents ${formatPercent(topMisconceptionShare)} of the visible replay slice.`
    ),
    buildGate(
      "Strategy concentration",
      topSelectedStrategyShare <= 0.5
        ? "pass"
        : topSelectedStrategyShare <= 0.7
          ? "watch"
          : "hold",
      `The most common effective tutoring strategy currently accounts for ${formatPercent(topSelectedStrategyShare)} of adaptive-logged tutor-guidance runs.`
    ),
    buildGate(
      "Replay inspection",
      "manual",
      disagreementCount === 0
        ? "Manual gate: there are no disagreement traces to inspect yet, so replay cannot establish interpretability of live disagreements."
        : "Manual gate: inspect the top disagreement traces and verify that the losing candidate, abstention decision, and candidate-score trace are all intelligible."
    ),
    buildGate(
      "Synthetic-to-real drift review",
      "manual",
      "Manual gate: compare live disagreement, abstention, and candidate-margin behavior against the offline-selected operating point before enabling bounded overrides."
    ),
  ];

  const summaryStatus = gates.some((gate) => gate.status === "hold")
    ? "hold"
    : gates.some((gate) => gate.status === "watch")
      ? "watch"
      : "pass";

  return {
    summaryStatus,
    headline: summaryStatus === "hold"
      ? "Hold Shadow Mode"
      : summaryStatus === "watch"
        ? "Continue Shadow Collection"
        : "Eligible For Bounded Trial",
    recommendation: summaryStatus === "hold"
      ? "Keep adaptive authority disabled. The current shadow slice still shows at least one rollout gate that is too weak or too concentrated for a safe override trial."
      : summaryStatus === "watch"
        ? "Stay in shadow mode and gather more tutor-guidance traffic. The current slice is directionally useful, but not yet strong enough to justify even sparse adaptive authority."
        : "Automatic gates look healthy in the current slice, but manual replay review and synthetic-to-real drift inspection should still be signed off before enabling bounded overrides.",
    gates,
    stats: {
      telemetryCoverage: round3(telemetryCoverage),
      disagreementCount,
      abstentionShareOfDisagreements: round3(abstentionShareOfDisagreements),
      averageCandidateMargin: round3(averageCandidateMargin),
      topShiftShare: round3(topShiftShare),
      topMisconceptionShare: round3(topMisconceptionShare),
      topSelectedStrategyShare: round3(topSelectedStrategyShare),
    },
  };
}

function buildGate(label: string, status: ShadowReadinessStatus, detail: string): ShadowReadinessGate {
  return { label, status, detail };
}

function shadowGateLabel(status: ShadowReadinessStatus) {
  switch (status) {
    case "pass":
      return "Pass";
    case "watch":
      return "Watch";
    case "hold":
      return "Hold";
    case "manual":
      return "Manual";
  }
}

function topCandidateMargin(candidateScores: Array<{ blendedScore: number }>) {
  if (candidateScores.length < 2) return 0;
  const sorted = [...candidateScores].sort((left, right) => right.blendedScore - left.blendedScore);
  return sorted[0].blendedScore - sorted[1].blendedScore;
}

function average(values: number[]) {
  const nums = values.filter((value) => Number.isFinite(value));
  if (!nums.length) return 0;
  return nums.reduce((sum, value) => sum + value, 0) / nums.length;
}

function humanizeUnderscoreLabel(value: string | null | undefined) {
  if (!value) return "none";
  return value
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function governanceWarnings(report: GovernanceReport) {
  return [...report.blockedReasons, ...report.shadow.dataWarnings, ...report.recovery.dataWarnings].slice(0, 6);
}