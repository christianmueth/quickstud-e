import type { TutorChatSessionContext } from "@/lib/tutorChatSessionContext";

export const WORKSPACE_CONTEXT_STORAGE_KEY = "quickstud:workspace-context";
export const WORKSPACE_CONTEXT_EVENT = "quickstud:workspace-context";

const MAX_WEAK_CONCEPTS = 8;
const MAX_MISCONCEPTIONS = 8;
const MAX_RECENT_GUIDANCE = 4;
const MAX_RECENT_TUTOR_INTERACTIONS = 6;
const MAX_UPLOADED_ASSETS = 6;

export type WorkspaceUploadedAsset = {
  id: string;
  kind: string;
  name: string;
  source: "whiteboard" | "presentation";
  updatedAt: string;
};

export type WorkspaceContext = {
  version: 1;
  updatedAt: string;
  activeStudySet: {
    deckId: string;
    focusConcept: string | null;
    focusReason: string | null;
    queuePosition: TutorChatSessionContext["queuePosition"];
    currentCard: TutorChatSessionContext["currentCard"];
    sessionComplete: boolean;
  } | null;
  weakConcepts: string[];
  misconceptionPatterns: string[];
  tutorMemory: {
    explanationStyle: string | null;
    recentGuidance: string[];
  } | null;
  currentGuidedSession: {
    answerDraft: string | null;
    latestHint: string | null;
    latestRationale: string | null;
    confidence: number | null;
    strategyType: string | null;
    worldModelExplanation: string | null;
    projectedConfidenceDelta: number | null;
    projectedRecoveryProbability: number | null;
    projectedStabilityGain: number | null;
  } | null;
  whiteboardReference: {
    boardId: string | null;
    boardName: string | null;
    workspaceGoal: string | null;
    noteCount: number;
    shapeCount: number;
    strokeCount: number;
    selectedCount: number;
    annotationCount: number;
    sourceAttachmentName: string | null;
    sourceOverlayKind: "image" | "pdf" | null;
    updatedAt: string;
  } | null;
  presentationReference: {
    title: string | null;
    audience: string | null;
    objective: string | null;
    sourceType: string | null;
    sourceTitle: string | null;
    outlineCount: number;
    updatedAt: string;
  } | null;
  uploadedAssets: WorkspaceUploadedAsset[];
  recentTutorInteractions: Array<{
    role: "user" | "assistant";
    content: string;
    createdAt: string;
  }>;
};

export function createEmptyWorkspaceContext(): WorkspaceContext {
  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    activeStudySet: null,
    weakConcepts: [],
    misconceptionPatterns: [],
    tutorMemory: null,
    currentGuidedSession: null,
    whiteboardReference: null,
    presentationReference: null,
    uploadedAssets: [],
    recentTutorInteractions: [],
  };
}

export function sanitizeWorkspaceContext(value: unknown): WorkspaceContext | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const activeStudySet = asRecord(record.activeStudySet);
  const currentGuidedSession = asRecord(record.currentGuidedSession);
  const tutorMemory = asRecord(record.tutorMemory);
  const whiteboardReference = asRecord(record.whiteboardReference);
  const presentationReference = asRecord(record.presentationReference);

  return {
    version: 1,
    updatedAt: toIsoString(record.updatedAt),
    activeStudySet:
      activeStudySet && toStringValue(activeStudySet.deckId)
        ? {
            deckId: toStringValue(activeStudySet.deckId) as string,
            focusConcept: toStringValue(activeStudySet.focusConcept),
            focusReason: toStringValue(activeStudySet.focusReason),
            queuePosition: sanitizeQueuePosition(activeStudySet.queuePosition),
            currentCard: sanitizeCurrentCard(activeStudySet.currentCard),
            sessionComplete: Boolean(activeStudySet.sessionComplete),
          }
        : null,
    weakConcepts: uniqueStrings(record.weakConcepts, MAX_WEAK_CONCEPTS),
    misconceptionPatterns: uniqueStrings(record.misconceptionPatterns, MAX_MISCONCEPTIONS),
    tutorMemory: tutorMemory
      ? {
          explanationStyle: toStringValue(tutorMemory.explanationStyle),
          recentGuidance: uniqueStrings(tutorMemory.recentGuidance, MAX_RECENT_GUIDANCE),
        }
      : null,
    currentGuidedSession: currentGuidedSession
      ? {
          answerDraft: toStringValue(currentGuidedSession.answerDraft, 400),
          latestHint: toStringValue(currentGuidedSession.latestHint, 280),
          latestRationale: toStringValue(currentGuidedSession.latestRationale, 500),
          confidence: toNumberOrNull(currentGuidedSession.confidence),
          strategyType: toStringValue(currentGuidedSession.strategyType),
          worldModelExplanation: toStringValue(currentGuidedSession.worldModelExplanation, 500),
          projectedConfidenceDelta: toNumberOrNull(currentGuidedSession.projectedConfidenceDelta),
          projectedRecoveryProbability: toNumberOrNull(currentGuidedSession.projectedRecoveryProbability),
          projectedStabilityGain: toNumberOrNull(currentGuidedSession.projectedStabilityGain),
        }
      : null,
    whiteboardReference: whiteboardReference
      ? {
          boardId: toStringValue(whiteboardReference.boardId),
          boardName: toStringValue(whiteboardReference.boardName),
          workspaceGoal: toStringValue(whiteboardReference.workspaceGoal, 240),
          noteCount: toCount(whiteboardReference.noteCount),
          shapeCount: toCount(whiteboardReference.shapeCount),
          strokeCount: toCount(whiteboardReference.strokeCount),
          selectedCount: toCount(whiteboardReference.selectedCount),
          annotationCount: toCount(whiteboardReference.annotationCount),
          sourceAttachmentName: toStringValue(whiteboardReference.sourceAttachmentName),
          sourceOverlayKind: whiteboardReference.sourceOverlayKind === "image" || whiteboardReference.sourceOverlayKind === "pdf" ? whiteboardReference.sourceOverlayKind : null,
          updatedAt: toIsoString(whiteboardReference.updatedAt),
        }
      : null,
    presentationReference: presentationReference
      ? {
          title: toStringValue(presentationReference.title, 180),
          audience: toStringValue(presentationReference.audience, 180),
          objective: toStringValue(presentationReference.objective, 240),
          sourceType: toStringValue(presentationReference.sourceType),
          sourceTitle: toStringValue(presentationReference.sourceTitle, 180),
          outlineCount: toCount(presentationReference.outlineCount),
          updatedAt: toIsoString(presentationReference.updatedAt),
        }
      : null,
    uploadedAssets: sanitizeUploadedAssets(record.uploadedAssets),
    recentTutorInteractions: sanitizeTutorInteractions(record.recentTutorInteractions),
  };
}

export function readWorkspaceContext(): WorkspaceContext {
  if (typeof window === "undefined") {
    return createEmptyWorkspaceContext();
  }

  const raw = window.localStorage.getItem(WORKSPACE_CONTEXT_STORAGE_KEY);
  if (!raw) return createEmptyWorkspaceContext();

  try {
    return sanitizeWorkspaceContext(JSON.parse(raw)) ?? createEmptyWorkspaceContext();
  } catch {
    return createEmptyWorkspaceContext();
  }
}

export function writeWorkspaceContext(nextValue: WorkspaceContext) {
  if (typeof window === "undefined") return;
  const sanitized = sanitizeWorkspaceContext(nextValue) ?? createEmptyWorkspaceContext();
  const finalValue = { ...sanitized, updatedAt: new Date().toISOString() } satisfies WorkspaceContext;
  window.localStorage.setItem(WORKSPACE_CONTEXT_STORAGE_KEY, JSON.stringify(finalValue));
  window.dispatchEvent(new CustomEvent(WORKSPACE_CONTEXT_EVENT, { detail: finalValue }));
}

export function updateWorkspaceContext(updater: (current: WorkspaceContext) => WorkspaceContext) {
  const current = readWorkspaceContext();
  writeWorkspaceContext(updater(current));
}

export function upsertWorkspaceAsset(assets: WorkspaceUploadedAsset[], nextAsset: WorkspaceUploadedAsset) {
  const normalized = sanitizeUploadedAssets(assets);
  const withoutExisting = normalized.filter((asset) => asset.id !== nextAsset.id);
  return sanitizeUploadedAssets([nextAsset, ...withoutExisting]);
}

export function summarizeWorkspaceContext(context: WorkspaceContext | null) {
  if (!context) return "no active workspace context";

  const parts = [
    context.activeStudySet
      ? `study set ${context.activeStudySet.deckId}${context.activeStudySet.focusConcept ? ` focused on ${context.activeStudySet.focusConcept}` : ""}`
      : null,
    context.weakConcepts.length ? `weak concepts: ${context.weakConcepts.slice(0, 3).join(", ")}` : null,
    context.whiteboardReference?.boardName
      ? `whiteboard: ${context.whiteboardReference.boardName}${context.whiteboardReference.workspaceGoal ? ` about ${context.whiteboardReference.workspaceGoal}` : ""}`
      : null,
    context.presentationReference?.title
      ? `presentation: ${context.presentationReference.title} (${context.presentationReference.outlineCount} slides)`
      : null,
    context.uploadedAssets.length ? `assets: ${context.uploadedAssets.slice(0, 3).map((asset) => asset.name).join(", ")}` : null,
    context.recentTutorInteractions.length
      ? `recent tutor turns: ${context.recentTutorInteractions.slice(-2).map((item) => `${item.role}: ${item.content}`).join(" | ")}`
      : null,
  ];

  return parts.filter(Boolean).join("; ") || "no active workspace context";
}

function sanitizeUploadedAssets(value: unknown): WorkspaceUploadedAsset[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      const record = asRecord(item);
      if (!record) return null;
      const id = toStringValue(record.id);
      const kind = toStringValue(record.kind);
      const name = toStringValue(record.name, 160);
      const source = record.source === "whiteboard" || record.source === "presentation" ? record.source : null;
      if (!id || !kind || !name || !source) return null;
      return {
        id,
        kind,
        name,
        source,
        updatedAt: toIsoString(record.updatedAt),
      } satisfies WorkspaceUploadedAsset;
    })
    .filter((item): item is WorkspaceUploadedAsset => Boolean(item))
    .slice(0, MAX_UPLOADED_ASSETS);
}

function sanitizeTutorInteractions(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      const record = asRecord(item);
      if (!record) return null;
      const role = record.role === "user" || record.role === "assistant" ? record.role : null;
      const content = toStringValue(record.content, 400);
      if (!role || !content) return null;
      return {
        role,
        content,
        createdAt: toIsoString(record.createdAt),
      };
    })
    .filter((item): item is WorkspaceContext["recentTutorInteractions"][number] => Boolean(item))
    .slice(-MAX_RECENT_TUTOR_INTERACTIONS);
}

function sanitizeQueuePosition(value: unknown) {
  const record = asRecord(value);
  if (!record) return null;
  if (typeof record.current !== "number" || typeof record.total !== "number") return null;
  return {
    current: Math.max(1, Math.floor(record.current)),
    total: Math.max(1, Math.floor(record.total)),
  };
}

function sanitizeCurrentCard(value: unknown) {
  const record = asRecord(value);
  if (!record) return null;
  const id = toStringValue(record.id);
  const question = toStringValue(record.question, 280);
  if (!id || !question) return null;
  return {
    id,
    question,
    answerPreview: toStringValue(record.answerPreview, 220) || "",
    revealed: Boolean(record.revealed),
  };
}

function asRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function uniqueStrings(value: unknown, limit: number) {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim()))).slice(0, limit);
}

function toStringValue(value: unknown, maxLength = 120) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return null;
  return text.slice(0, maxLength);
}

function toIsoString(value: unknown) {
  const candidate = typeof value === "string" ? value : "";
  const date = new Date(candidate);
  if (Number.isNaN(date.getTime())) return new Date().toISOString();
  return date.toISOString();
}

function toNumberOrNull(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function toCount(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}