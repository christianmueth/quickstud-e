"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import BillingActionButton from "@/components/BillingActionButton";
import PremiumUpsellModal from "@/components/PremiumUpsellModal";
import { getUpgradePrompt, type PremiumApiResponse, type UpgradePrompt } from "@/lib/clientBilling";
import { readWorkspaceContext, updateWorkspaceContext } from "@/lib/workspaceContext";

type TutorChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
};

type TutorChatContext = {
  deckTitle: string | null;
  cardCount: number | null;
  weakConcepts: string[];
  recentSuccesses: string[];
  recentFailures: string[];
  explanationStyle: string | null;
  lowConfidenceStreak: number;
  recentGuidance: string[];
};

type TutorChatResponse = {
  ok: boolean;
  messages?: TutorChatMessage[];
  message?: TutorChatMessage;
  context?: TutorChatContext;
  error?: string;
};

type TutorWorkspacePanelProps = {
  isPaid: boolean;
  planLabel: string;
  initialMode: TutorMode;
  performanceSummary: {
    headline: string;
    summary: string;
    cues: string[];
    memoryMoments: string[];
    prompts: string[];
    deckCount: number;
    recentRunCount: number;
  };
};

type TutorMode = "study-plan" | "explanation" | "quiz-me";
type ConversationFilter = "all" | "assistant" | "user";

const TUTOR_MODES: Array<{
  key: TutorMode;
  label: string;
  title: string;
  description: string;
  placeholder: string;
  focusReason: string;
}> = [
  {
    key: "study-plan",
    label: "Study plan",
    title: "Turn performance into a concrete next-step plan.",
    description: "Best when you want sequencing, priorities, and a short session structure based on your recent weak areas.",
    placeholder: "Ask for a study plan built from your recent weak areas, recovery patterns, and current workload.",
    focusReason: "Tutor mode: study plan. Prioritize sequencing, review order, and concrete next steps from recent performance.",
  },
  {
    key: "explanation",
    label: "Explanation",
    title: "Drill into the concept that still feels shaky.",
    description: "Best when you need a clearer explanation, worked intuition, or a slower reframe of a weak concept.",
    placeholder: "Ask for a clearer explanation of the idea that is still slipping, including why it matters and what to notice next.",
    focusReason: "Tutor mode: explanation. Prioritize conceptual clarity, intuition, and explanation style matched to recent performance.",
  },
  {
    key: "quiz-me",
    label: "Quiz me",
    title: "Have the tutor probe your understanding directly.",
    description: "Best when you want short checks, targeted questions, and quick correction loops anchored to your weak areas.",
    placeholder: "Ask the tutor to quiz you on the concept that currently needs the most reinforcement.",
    focusReason: "Tutor mode: quiz me. Prioritize short targeted questions, retrieval practice, and immediate correction cues from recent performance.",
  },
];

export default function TutorWorkspacePanel({ isPaid, planLabel, initialMode, performanceSummary }: TutorWorkspacePanelProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [bootstrapping, setBootstrapping] = useState(true);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [mode, setMode] = useState<TutorMode>(initialMode);
  const [conversationFilter, setConversationFilter] = useState<ConversationFilter>("all");
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState<TutorChatMessage[]>([]);
  const [context, setContext] = useState<TutorChatContext | null>(null);
  const [upgradePrompt, setUpgradePrompt] = useState<UpgradePrompt | null>(null);
  const messageViewportRef = useRef<HTMLDivElement | null>(null);

  const activeMode = useMemo(() => TUTOR_MODES.find((item) => item.key === mode) || TUTOR_MODES[0], [mode]);
  const promptSuggestions = useMemo(() => {
    const modePrompts: Record<TutorMode, string[]> = {
      "study-plan": [
        "Build me a 20-minute study plan from my recent performance.",
        "What should I review first, second, and third right now?",
      ],
      explanation: [
        context?.weakConcepts?.[0]
          ? `Explain ${context.weakConcepts[0]} in a slower, clearer way.`
          : "Explain the concept that currently looks weakest for me.",
        "Why does this concept keep causing hesitation for me?",
      ],
      "quiz-me": [
        context?.weakConcepts?.[0]
          ? `Quiz me on ${context.weakConcepts[0]} with short checks.`
          : "Quiz me on the idea I most need to reinforce.",
        "Ask me three targeted questions based on my recent weak area.",
      ],
    };

    return Array.from(new Set([...modePrompts[mode], ...performanceSummary.prompts].filter(Boolean)));
  }, [context?.weakConcepts, mode, performanceSummary.prompts]);
  const visibleMessages = useMemo(() => {
    if (conversationFilter === "all") return messages;
    return messages.filter((message) => message.role === conversationFilter);
  }, [conversationFilter, messages]);

  useEffect(() => {
    setMode(initialMode);
  }, [initialMode]);

  useEffect(() => {
    if (!pathname) return;

    const params = new URLSearchParams(searchParams?.toString() || "");
    const currentMode = normalizeTutorMode(params.get("mode"));
    const currentTab = params.get("tab");
    if (currentMode === mode && currentTab === "tutor") return;

    params.set("tab", "tutor");
    params.set("mode", mode);
    const nextUrl = `${pathname}?${params.toString()}`;
    window.history.replaceState(null, "", nextUrl);
  }, [mode, pathname, searchParams]);

  useEffect(() => {
    if (!isPaid) {
      setBootstrapping(false);
      return;
    }

    let cancelled = false;
    async function loadHistory() {
      setLoading(true);
      try {
        const params = new URLSearchParams({ mode });
        const res = await fetch(`/api/tutor-chat?${params.toString()}`, { cache: "no-store" });
        const data = (await safeJson(res)) as TutorChatResponse | null;
        if (!res.ok || !data?.ok) {
          throw new Error(data?.error || "We couldn't load tutor continuity right now.");
        }

        if (!cancelled) {
          setMessages(Array.isArray(data.messages) ? data.messages : []);
          setContext(data.context || null);
        }
      } catch (error: unknown) {
        if (!cancelled) toast.error(getErrorMessage(error, "We couldn't load tutor continuity right now."));
      } finally {
        if (!cancelled) {
          setLoading(false);
          setBootstrapping(false);
        }
      }
    }

    loadHistory();
    return () => {
      cancelled = true;
    };
  }, [isPaid, mode]);

  useEffect(() => {
    const viewport = messageViewportRef.current;
    if (!viewport) return;
    viewport.scrollTop = viewport.scrollHeight;
  }, [messages]);

  useEffect(() => {
    if (!messages.length && !context) return;
    updateWorkspaceContext((current) => ({
      ...current,
      weakConcepts: context?.weakConcepts?.length ? context.weakConcepts.slice(0, 8) : current.weakConcepts,
      tutorMemory: {
        explanationStyle: context?.explanationStyle || current.tutorMemory?.explanationStyle || null,
        recentGuidance: context?.recentGuidance?.length ? context.recentGuidance.slice(0, 4) : current.tutorMemory?.recentGuidance || [],
      },
      recentTutorInteractions: messages.slice(-6).map((message) => ({
        role: message.role,
        content: message.content,
        createdAt: message.createdAt,
      })),
    }));
  }, [context, messages]);

  async function submitMessage(prefill?: string) {
    const content = (prefill ?? draft).trim();
    if (!content || sending || !isPaid) return;

    const optimisticMessage: TutorChatMessage = {
      id: `local-${Date.now()}`,
      role: "user",
      content,
      createdAt: new Date().toISOString(),
    };

    setMessages((current) => [...current, optimisticMessage]);
    setDraft("");
    setSending(true);

    try {
      const res = await fetch("/api/tutor-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: content,
          tutorMode: mode,
          path: `/app?tab=tutor&mode=${mode}`,
          focusConcept: context?.weakConcepts?.[0] || null,
          focusReason: activeMode.focusReason,
          workspaceContext: readWorkspaceContext(),
        }),
      });
      const data = (await safeJson(res)) as (TutorChatResponse & PremiumApiResponse) | null;
      const prompt = getUpgradePrompt(data, "AI tutor is a Premium feature.");
      if (prompt) {
        setMessages((current) => current.filter((item) => item.id !== optimisticMessage.id));
        setUpgradePrompt(prompt);
        return;
      }
      if (!res.ok || !data?.ok || !data.message) {
        throw new Error(data?.error || "We couldn't get tutor guidance right now.");
      }
      setMessages((current) => [...current, data.message as TutorChatMessage]);
      setContext(data.context || null);
    } catch (error: unknown) {
      setMessages((current) => current.filter((item) => item.id !== optimisticMessage.id));
      toast.error(getErrorMessage(error, "We couldn't get tutor guidance right now."));
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      <div className="grid gap-6 xl:grid-cols-[0.88fr_1.12fr]">
        <section className="space-y-4">
          <div className="rounded-3xl border border-sky-200 bg-gradient-to-br from-sky-50 via-white to-cyan-50 p-6 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-700">AI tutor read</p>
            <h2 className="mt-3 text-2xl font-semibold tracking-tight text-slate-950">{performanceSummary.headline}</h2>
            <p className="mt-3 text-sm leading-7 text-slate-700">{performanceSummary.summary}</p>
            <div className="mt-5 grid gap-3 md:grid-cols-3 xl:grid-cols-1">
              {performanceSummary.cues.map((cue) => (
                <div key={cue} className="rounded-2xl border border-sky-100 bg-white/90 p-4 text-sm leading-6 text-slate-700">
                  {cue}
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-3xl border border-emerald-200 bg-gradient-to-br from-emerald-50 via-white to-lime-50 p-6 shadow-sm">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">Performance context</p>
                <h3 className="mt-3 text-xl font-semibold tracking-tight text-slate-950">Tutor memory and recent performance</h3>
              </div>
              <div className="rounded-full border border-emerald-200 bg-white px-3 py-1 text-xs font-medium text-emerald-800">
                {performanceSummary.recentRunCount} recent tutor signals
              </div>
            </div>
            <div className="mt-5 space-y-3">
              {performanceSummary.memoryMoments.map((moment) => (
                <div key={moment} className="rounded-2xl border border-emerald-100 bg-white/90 p-4 text-sm leading-6 text-slate-700">
                  {moment}
                </div>
              ))}
            </div>
            <div className="mt-5 grid gap-3 md:grid-cols-2">
              <div className="rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-700">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Study sets ready</p>
                <p className="mt-2 text-2xl font-semibold text-slate-950">{performanceSummary.deckCount}</p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-700">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Current access</p>
                <p className="mt-2 text-2xl font-semibold text-slate-950">{planLabel}</p>
              </div>
            </div>
          </div>
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">AI tutor chat</p>
              <h2 className="mt-3 text-2xl font-semibold tracking-tight text-slate-950">Ask for coaching based on your performance patterns.</h2>
              <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-700">
                This tutor uses your recent performance, weak concepts, recovery patterns, and saved study history to answer with more continuity than a one-off chat.
              </p>
            </div>
            {isPaid ? (
              <div className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-800">
                Premium unlocked
              </div>
            ) : (
              <div className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-medium text-amber-800">
                Upgrade required
              </div>
            )}
          </div>

          <div className="mt-6 rounded-3xl border border-slate-200 bg-slate-50 p-4">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Tutor mode</p>
                <h3 className="mt-2 text-lg font-semibold text-slate-950">{activeMode.title}</h3>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-700">{activeMode.description}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {TUTOR_MODES.map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => setMode(item.key)}
                    className={mode === item.key
                      ? "rounded-full bg-slate-950 px-4 py-2 text-sm font-medium text-white"
                      : "rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-900 hover:bg-slate-50"
                    }
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {!isPaid ? (
            <div className="mt-6 rounded-3xl border border-amber-200 bg-gradient-to-br from-amber-50 via-white to-orange-50 p-6">
              <p className="text-sm leading-7 text-slate-700">
                The AI tutor tab is performance-aware and uses your recent learning signals, but sending messages is currently a Premium feature.
              </p>
              <div className="mt-5 flex flex-wrap gap-3">
                <BillingActionButton
                  action="checkout"
                  plan="premium"
                  className="rounded-full bg-slate-950 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
                  pendingLabel="Opening checkout..."
                >
                  Upgrade to Premium
                </BillingActionButton>
                <a href="/app/billing" className="rounded-full border border-slate-300 px-4 py-2 text-sm font-medium text-slate-900 hover:bg-white">
                  View billing
                </a>
              </div>
              <div className="mt-6 grid gap-3 md:grid-cols-2">
                {promptSuggestions.map((prompt) => (
                  <div key={prompt} className="rounded-2xl border border-white/80 bg-white/90 p-4 text-sm leading-6 text-slate-700">
                    {prompt}
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <>
              <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setConversationFilter("all")}
                    className={conversationFilter === "all"
                      ? "rounded-full bg-slate-950 px-3 py-1.5 text-xs font-medium text-white"
                      : "rounded-full border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                    }
                  >
                    All messages
                  </button>
                  <button
                    type="button"
                    onClick={() => setConversationFilter("assistant")}
                    className={conversationFilter === "assistant"
                      ? "rounded-full bg-slate-950 px-3 py-1.5 text-xs font-medium text-white"
                      : "rounded-full border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                    }
                  >
                    Tutor only
                  </button>
                  <button
                    type="button"
                    onClick={() => setConversationFilter("user")}
                    className={conversationFilter === "user"
                      ? "rounded-full bg-slate-950 px-3 py-1.5 text-xs font-medium text-white"
                      : "rounded-full border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                    }
                  >
                    My prompts only
                  </button>
                </div>
                <div className="rounded-full border border-sky-200 bg-sky-50 px-3 py-1.5 text-xs font-medium text-sky-800">
                  Mode: {activeMode.label}
                </div>
              </div>

              <div ref={messageViewportRef} className="mt-6 max-h-[28rem] space-y-3 overflow-y-auto pr-1">
                {bootstrapping || loading ? (
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                    Restoring tutor continuity...
                  </div>
                ) : visibleMessages.length ? (
                  visibleMessages.map((message) => (
                    <div
                      key={message.id}
                      className={message.role === "assistant"
                        ? "mr-6 rounded-2xl border border-sky-100 bg-sky-50 px-4 py-3 text-sm leading-6 text-slate-700"
                        : "ml-8 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm leading-6 text-slate-900"
                      }
                    >
                      <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                        {message.role === "assistant" ? "Tutor" : "You"}
                      </p>
                      <p className="whitespace-pre-wrap">{message.content}</p>
                    </div>
                  ))
                ) : (
                  <div className="space-y-3 rounded-2xl border border-sky-100 bg-sky-50 px-4 py-4 text-sm leading-6 text-slate-700">
                    <p className="font-medium text-slate-900">
                      {messages.length
                        ? "No messages match the current filter yet. Switch filters or ask the tutor in the active mode."
                        : "Start with one of the suggested prompts below, or ask directly about your weak areas and next study step."}
                    </p>
                    <p>The tutor will answer using your saved performance context instead of treating this like a blank chat window.</p>
                  </div>
                )}
              </div>

              <div className="mt-5 flex flex-wrap gap-2">
                {promptSuggestions.map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs text-slate-700 hover:bg-white"
                    onClick={() => submitMessage(suggestion)}
                    disabled={sending}
                  >
                    {suggestion}
                  </button>
                ))}
                {context?.explanationStyle ? (
                  <div className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs text-emerald-800">
                    Best-fit explanation style: {context.explanationStyle}
                  </div>
                ) : null}
              </div>

              <form
                className="mt-5 space-y-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  void submitMessage();
                }}
              >
                <textarea
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  placeholder={activeMode.placeholder}
                  className="min-h-[120px] w-full rounded-2xl border border-slate-300 bg-white px-3 py-3 text-sm text-slate-900 outline-none focus:border-slate-900"
                />
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs leading-5 text-slate-500">The tutor explains and recommends from your performance history, but it does not take study actions for you.</p>
                  <button
                    type="submit"
                    className="rounded-full bg-slate-950 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
                    disabled={sending || !draft.trim()}
                  >
                    {sending ? "Thinking..." : "Ask AI tutor"}
                  </button>
                </div>
              </form>
            </>
          )}
        </section>
      </div>

      <PremiumUpsellModal
        open={Boolean(upgradePrompt)}
        title={upgradePrompt?.title || "Premium feature"}
        message={upgradePrompt?.message || "Upgrade to Premium to continue."}
        upgradePath={upgradePrompt?.upgradePath}
        onClose={() => setUpgradePrompt(null)}
      />
    </>
  );
}

async function safeJson(res: Response) {
  try {
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

function normalizeTutorMode(value: string | null | undefined): TutorMode {
  return value === "explanation" || value === "quiz-me" ? value : "study-plan";
}

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}