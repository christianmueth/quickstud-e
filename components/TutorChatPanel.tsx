"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import PremiumUpsellModal from "@/components/PremiumUpsellModal";
import { getUpgradePrompt, type PremiumApiResponse, type UpgradePrompt } from "@/lib/clientBilling";
import {
  isTutorChatSessionContextFresh,
  TUTOR_CHAT_SESSION_CONTEXT_EVENT,
  TUTOR_CHAT_SESSION_CONTEXT_STORAGE_KEY,
  sanitizeTutorChatSessionContext,
  type TutorChatSessionContext,
} from "@/lib/tutorChatSessionContext";
import { readTutorChatEnabled, setTutorChatEnabled, TUTOR_CHAT_ENABLED_EVENT } from "@/lib/tutorChatPreferences";

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

const OPEN_STORAGE_KEY = "quickstud:tutor-chat-open";

export default function TutorChatPanel() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [enabled, setEnabled] = useState(true);
  const [open, setOpen] = useState(true);
  const [bootstrapping, setBootstrapping] = useState(true);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [messages, setMessages] = useState<TutorChatMessage[]>([]);
  const [context, setContext] = useState<TutorChatContext | null>(null);
  const [sessionContext, setSessionContext] = useState<TutorChatSessionContext | null>(null);
  const [draft, setDraft] = useState("");
  const [upgradePrompt, setUpgradePrompt] = useState<UpgradePrompt | null>(null);
  const messageViewportRef = useRef<HTMLDivElement | null>(null);

  const isWorkspaceRoute = pathname?.startsWith("/app") ?? false;
  const deckId = useMemo(() => extractDeckId(pathname), [pathname]);
  const isDeckStudyRoute = Boolean(deckId);
  const focusConcept = searchParams.get("concept");
  const focusReason = searchParams.get("reason");
  const routeKey = `${pathname || ""}?${searchParams.toString()}`;
  const hasFreshSessionContext = isTutorChatSessionContextFresh(sessionContext);
  const activeSessionContext =
    isDeckStudyRoute && hasFreshSessionContext && sessionContext?.deckId === deckId && !sessionContext.sessionComplete
      ? sessionContext
      : null;

  useEffect(() => {
    const stored = window.localStorage.getItem(OPEN_STORAGE_KEY);
    if (stored === "0") setOpen(false);
    if (stored === "1") setOpen(true);
  }, []);

  useEffect(() => {
    setEnabled(readTutorChatEnabled());

    function syncEnabledState(event?: Event) {
      const detail = event && "detail" in event ? (event as CustomEvent<{ enabled?: unknown }>).detail : undefined;
      if (typeof detail?.enabled === "boolean") {
        setEnabled(detail.enabled);
        return;
      }

      setEnabled(readTutorChatEnabled());
    }

    window.addEventListener(TUTOR_CHAT_ENABLED_EVENT, syncEnabledState);
    return () => window.removeEventListener(TUTOR_CHAT_ENABLED_EVENT, syncEnabledState);
  }, []);

  useEffect(() => {
    window.localStorage.setItem(OPEN_STORAGE_KEY, open ? "1" : "0");
  }, [open]);

  useEffect(() => {
    function readStoredSessionContext() {
      const raw = window.localStorage.getItem(TUTOR_CHAT_SESSION_CONTEXT_STORAGE_KEY);
      if (!raw) return null;

      try {
        return JSON.parse(raw) as unknown;
      } catch {
        return null;
      }
    }

    function syncSessionContext(nextValue: unknown) {
      const sanitized = sanitizeTutorChatSessionContext(nextValue);
      if (!isTutorChatSessionContextFresh(sanitized)) {
        window.localStorage.removeItem(TUTOR_CHAT_SESSION_CONTEXT_STORAGE_KEY);
        setSessionContext(null);
        return;
      }

      setSessionContext(sanitized);
    }

    syncSessionContext(readStoredSessionContext());

    function onSessionContext(event: Event) {
      syncSessionContext((event as CustomEvent).detail);
    }

    window.addEventListener(TUTOR_CHAT_SESSION_CONTEXT_EVENT, onSessionContext);
    return () => window.removeEventListener(TUTOR_CHAT_SESSION_CONTEXT_EVENT, onSessionContext);
  }, []);

  useEffect(() => {
    if (!isWorkspaceRoute) return;

    let cancelled = false;
    async function loadHistory() {
      if (!cancelled) {
        setContext((current) => (deckId ? current : null));
      }
      setLoading(true);
      try {
        const query = new URLSearchParams();
        if (deckId) query.set("deckId", deckId);
        const res = await fetch(`/api/tutor-chat${query.size ? `?${query.toString()}` : ""}`, { cache: "no-store" });
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
  }, [deckId, isWorkspaceRoute, routeKey]);

  useEffect(() => {
    const viewport = messageViewportRef.current;
    if (!viewport) return;
    viewport.scrollTop = viewport.scrollHeight;
  }, [messages, open]);

  if (!isWorkspaceRoute || !enabled) return null;

  const promptSuggestions = buildPromptSuggestions(context, pathname);
  const summaryLabel = buildSummaryLabel({ pathname, deckId, deckTitle: context?.deckTitle ?? null });

  async function submitMessage(prefill?: string) {
    const content = (prefill ?? draft).trim();
    if (!content || sending) return;

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
          path: pathname,
          deckId,
          focusConcept,
          focusReason,
          liveContext: activeSessionContext,
        }),
      });
      const data = (await safeJson(res)) as (TutorChatResponse & PremiumApiResponse) | null;
      const prompt = getUpgradePrompt(data, "Persistent tutor is a Premium feature.");
      if (prompt) {
        setUpgradePrompt(prompt);
        setOpen(true);
        return;
      }
      if (!res.ok || !data?.ok || !data.message) {
        throw new Error(data?.error || "We couldn't get tutor guidance right now.");
      }
      setMessages((current) => [...current, data.message as TutorChatMessage]);
      setContext(data.context || null);
      setOpen(true);
    } catch (error: unknown) {
      setMessages((current) => current.filter((item) => item.id !== optimisticMessage.id));
      toast.error(getErrorMessage(error, "We couldn't get tutor guidance right now."));
    } finally {
      setSending(false);
    }
  }

  return (
    <>
    <div className="pointer-events-none fixed inset-x-4 bottom-4 z-40 sm:left-auto sm:right-5 sm:w-[24rem]">
      <div className="pointer-events-auto overflow-hidden rounded-3xl border border-sky-200 bg-white/95 shadow-[0_20px_60px_rgba(15,23,42,0.18)] backdrop-blur">
        <div className="flex items-center justify-between gap-3 border-b border-sky-100 bg-gradient-to-r from-sky-50 via-white to-cyan-50 px-4 py-3">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-sky-700">Persistent tutor</p>
            <p className="truncate text-sm text-slate-700">Context-aware guidance for {summaryLabel}</p>
          </div>
          <button
            type="button"
            className="shrink-0 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
            onClick={() => setOpen((current) => !current)}
          >
            {open ? "Minimize" : "Open"}
          </button>
        </div>

        {open ? (
          <div className="space-y-4 p-4">
            <div className="flex flex-wrap gap-2 text-[11px] text-slate-600">
              {context?.weakConcepts?.slice(0, 2).map((concept) => (
                <span key={concept} className="rounded-full border border-sky-200 bg-sky-50 px-2.5 py-1">
                  weak area: {concept}
                </span>
              ))}
              {context?.explanationStyle ? (
                <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1">
                  style: {context.explanationStyle}
                </span>
              ) : null}
              {deckId && typeof context?.cardCount === "number" ? (
                <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1">
                  {context.cardCount} cards in view
                </span>
              ) : null}
              {activeSessionContext?.queuePosition ? (
                <span className="rounded-full border border-violet-200 bg-violet-50 px-2.5 py-1 text-violet-800">
                  prompt {activeSessionContext.queuePosition.current} of {activeSessionContext.queuePosition.total}
                </span>
              ) : null}
            </div>

            <div ref={messageViewportRef} className="max-h-[22rem] space-y-3 overflow-y-auto pr-1">
              {bootstrapping || loading ? (
                <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                  Restoring tutor continuity...
                </div>
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
                <div className="space-y-3 rounded-2xl border border-sky-100 bg-sky-50 px-4 py-4 text-sm leading-6 text-slate-700">
                  <p className="font-medium text-slate-900">Ask for a quick explanation, a next-step recommendation, or help unpacking what feels shaky.</p>
                  <p>The tutor can use your current workspace, recent study history, and saved weak concepts to keep guidance continuous.</p>
                </div>
              )}
            </div>

            {!messages.length && !loading ? (
              <div className="flex flex-wrap gap-2">
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
              </div>
            ) : null}

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
                placeholder="Ask the tutor what to review, what changed, or why this concept still matters."
                className="min-h-[88px] w-full rounded-2xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-900"
              />
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs leading-5 text-slate-500">The tutor can explain and recommend, but it will not take study actions for you.</p>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                    onClick={() => setOpen(false)}
                  >
                    Minimize chat
                  </button>
                  <button
                    type="submit"
                    className="rounded-full bg-slate-950 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
                    disabled={sending || !draft.trim()}
                  >
                    {sending ? "Thinking..." : "Ask tutor"}
                  </button>
                </div>
              </div>
            </form>
          </div>
        ) : (
          <button
            type="button"
            className="w-full bg-white px-4 py-3 text-left text-sm text-slate-700 hover:bg-slate-50"
            onClick={() => setOpen(true)}
          >
            Reopen tutor chat
          </button>
        )}
      </div>
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

function extractDeckId(pathname: string | null) {
  const match = String(pathname || "").match(/^\/app\/deck\/([^/]+)/);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

function buildPromptSuggestions(context: TutorChatContext | null, pathname: string | null) {
  const suggestions = [
    "What should I review next?",
    context?.weakConcepts?.[0]
      ? `Give me a quick refresh on ${context.weakConcepts[0]}.`
      : "What concept looks the shakiest right now?",
    pathname === "/app/progress"
      ? "What does my recent progress suggest?"
      : "How should I use this study set right now?",
  ];

  return Array.from(new Set(suggestions));
}

function buildSummaryLabel({
  pathname,
  deckId,
  deckTitle,
}: {
  pathname: string | null;
  deckId: string | null;
  deckTitle: string | null;
}) {
  if (pathname === "/app/progress") return "progress view";
  if (deckId) return deckTitle || "current study set";
  return "workspace";
}

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

function formatPercent(value: number) {
  return `${Math.round(value * 100)}%`;
}

function formatSignedPercent(value: number) {
  const rounded = Math.round(value * 100);
  return `${rounded > 0 ? "+" : ""}${rounded}%`;
}