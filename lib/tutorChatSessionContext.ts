export const TUTOR_CHAT_SESSION_CONTEXT_STORAGE_KEY = "quickstud:tutor-chat-session-context";
export const TUTOR_CHAT_SESSION_CONTEXT_EVENT = "quickstud:tutor-chat-session-context";

export type TutorChatSessionContext = {
  deckId: string;
  focusConcept: string | null;
  focusReason: string | null;
  queuePosition: {
    current: number;
    total: number;
  } | null;
  currentCard: {
    id: string;
    question: string;
    answerPreview: string;
    revealed: boolean;
  } | null;
  answerDraft: string | null;
  latestCoaching: {
    hint: string | null;
    rationale: string | null;
    misconceptionSignals: string[];
    weakTopicMatches: string[];
    confidence: number | null;
    strategyType: string | null;
  } | null;
  sessionComplete: boolean;
};

export function sanitizeTutorChatSessionContext(value: unknown): TutorChatSessionContext | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const queuePosition = asRecord(record.queuePosition);
  const currentCard = asRecord(record.currentCard);
  const latestCoaching = asRecord(record.latestCoaching);

  const deckId = toStringValue(record.deckId);
  if (!deckId) return null;

  return {
    deckId,
    focusConcept: toStringValue(record.focusConcept),
    focusReason: toStringValue(record.focusReason),
    queuePosition:
      queuePosition && typeof queuePosition.current === "number" && typeof queuePosition.total === "number"
        ? {
            current: Math.max(1, Math.floor(queuePosition.current)),
            total: Math.max(1, Math.floor(queuePosition.total)),
          }
        : null,
    currentCard:
      currentCard && toStringValue(currentCard.id) && toStringValue(currentCard.question)
        ? {
            id: toStringValue(currentCard.id) as string,
            question: toStringValue(currentCard.question) as string,
            answerPreview: toStringValue(currentCard.answerPreview) || "",
            revealed: Boolean(currentCard.revealed),
          }
        : null,
    answerDraft: toStringValue(record.answerDraft),
    latestCoaching: latestCoaching
      ? {
          hint: toStringValue(latestCoaching.hint),
          rationale: toStringValue(latestCoaching.rationale),
          misconceptionSignals: toStringArray(latestCoaching.misconceptionSignals),
          weakTopicMatches: toStringArray(latestCoaching.weakTopicMatches),
          confidence: typeof latestCoaching.confidence === "number" ? latestCoaching.confidence : null,
          strategyType: toStringValue(latestCoaching.strategyType),
        }
      : null,
    sessionComplete: Boolean(record.sessionComplete),
  };
}

function asRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function toStringValue(value: unknown) {
  const text = typeof value === "string" ? value.trim() : "";
  return text || null;
}

function toStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
}