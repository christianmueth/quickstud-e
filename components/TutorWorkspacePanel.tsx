"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import BillingActionButton from "@/components/BillingActionButton";
import PremiumUpsellModal from "@/components/PremiumUpsellModal";
import { getUpgradePrompt, type PremiumApiResponse, type UpgradePrompt } from "@/lib/clientBilling";

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
    description: "A short plan from recent weak areas.",
    placeholder: "Ask for a study plan built from your recent weak areas, recovery patterns, and current workload.",
    focusReason: "Tutor mode: study plan. Prioritize sequencing, review order, and concrete next steps from recent performance.",
  },
  {
    key: "explanation",
    label: "Explanation",
    title: "Drill into the concept that still feels shaky.",
    description: "A clearer explanation of the weak concept.",
    placeholder: "Ask for a clearer explanation of the idea that is still slipping, including why it matters and what to notice next.",
    focusReason: "Tutor mode: explanation. Prioritize conceptual clarity, intuition, and explanation style matched to recent performance.",
  },
  {
    key: "quiz-me",
    label: "Quiz me",
    title: "Have the tutor probe your understanding directly.",
    description: "Short checks on the concepts that need work.",
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
      <section className="mx-auto max-w-3xl space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold text-slate-950">Tutor</h2>
            <p className="mt-1 text-sm text-slate-600">{performanceSummary.headline}</p>
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

        {!isPaid ? (
          <div className="border-t border-slate-200 pt-5">
            <p className="text-sm text-slate-700">Tutor chat is available with Premium.</p>
            <div className="mt-3">
                <BillingActionButton
                  action="checkout"
                  plan="premium"
                  className="rounded-full bg-slate-950 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
                  pendingLabel="Opening checkout..."
                >
                  Upgrade to Premium
                </BillingActionButton>
            </div>
          </div>
        ) : (
          <>
              <div ref={messageViewportRef} className="max-h-[28rem] space-y-3 overflow-y-auto border-y border-slate-200 py-5">
                {bootstrapping || loading ? (
                  <p className="text-sm text-slate-600">Loading conversation...</p>
                ) : messages.length ? (
                  messages.map((message) => (
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
                  <p className="text-sm text-slate-600">Choose a prompt or ask a question to begin.</p>
                )}
              </div>

              <div className="flex flex-wrap gap-2">
                {promptSuggestions.slice(0, 2).map((suggestion) => (
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
              </div>

              <form
                className="space-y-3"
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