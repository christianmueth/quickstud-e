export const reasoningResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["final_answer", "reasoning", "confidence", "trajectory_score", "search_depth"],
  properties: {
    final_answer: { type: "string", minLength: 1 },
    reasoning: { type: "string", minLength: 1 },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    trajectory_score: { type: "number" },
    search_depth: { type: "integer", minimum: 0 },
  },
} as const;

export type ReasoningResponse = {
  final_answer: string;
  reasoning: string;
  confidence: number;
  trajectory_score: number;
  search_depth: number;
};

export const MISCONCEPTION_CATEGORIES = [
  "ARITHMETIC_ERROR",
  "CONCEPTUAL_CONFUSION",
  "SIGN_ERROR",
  "UNIT_ERROR",
  "SKIPPED_STEP",
  "FALSE_ASSUMPTION",
  "OVERGENERALIZATION",
  "MEMORIZATION_FAILURE",
] as const;

export type MisconceptionCategory = (typeof MISCONCEPTION_CATEGORIES)[number];

export type ReasoningTrajectory = {
  id: string;
  steps: string[];
  score: number;
  confidence: number;
  complete: boolean;
};

export type ReasoningEngineStage =
  | "generate"
  | "score"
  | "prune"
  | "expand"
  | "select"
  | "verify";

export type StudentKnowledgeState = {
  weakTopics: string[];
  priorMistakes: MisconceptionCategory[];
  confidenceByTopic: Record<string, number>;
  retentionByTopic: Record<string, number>;
  reasoningPatterns: MisconceptionCategory[];
};

export function isMisconceptionCategory(value: unknown): value is MisconceptionCategory {
  return typeof value === "string" && (MISCONCEPTION_CATEGORIES as readonly string[]).includes(value);
}

export function humanizeMisconceptionCategory(value: MisconceptionCategory | string): string {
  switch (value) {
    case "ARITHMETIC_ERROR":
      return "Arithmetic Error";
    case "CONCEPTUAL_CONFUSION":
      return "Conceptual Confusion";
    case "SIGN_ERROR":
      return "Sign Error";
    case "UNIT_ERROR":
      return "Unit Error";
    case "SKIPPED_STEP":
      return "Skipped Step";
    case "FALSE_ASSUMPTION":
      return "False Assumption";
    case "OVERGENERALIZATION":
      return "Overgeneralization";
    case "MEMORIZATION_FAILURE":
      return "Memorization Failure";
    default:
      return String(value || "")
        .replace(/_/g, " ")
        .replace(/\b\w/g, (char) => char.toUpperCase());
  }
}

export function createReasoningResponse(input: ReasoningResponse): ReasoningResponse {
  return {
    final_answer: String(input.final_answer || "").trim(),
    reasoning: String(input.reasoning || "").trim(),
    confidence: clampUnit(input.confidence),
    trajectory_score: Number.isFinite(input.trajectory_score) ? input.trajectory_score : 0,
    search_depth: Math.max(0, Math.floor(input.search_depth || 0)),
  };
}

function clampUnit(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}