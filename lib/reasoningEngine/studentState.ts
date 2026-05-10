import { Prisma, type StudentState } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  isMisconceptionCategory,
  type MisconceptionCategory,
  type ReasoningResponse,
  type StudentKnowledgeState,
} from "@/lib/reasoningEngine/contracts";

type UpdateStudentStateFromVerificationInput = {
  userId: string;
  mode: "verify_answer" | "compare_explanations";
  prompt: string;
  response: ReasoningResponse;
  answer?: string;
  expectedAnswer?: string;
};

type StudentStateSnapshot = {
  weakConcepts: string[];
  misconceptionPatterns: MisconceptionCategory[];
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
};

export async function updateStudentStateFromVerification(input: UpdateStudentStateFromVerificationInput) {
  const existing = await prisma.studentState.findUnique({ where: { userId: input.userId } });
  const current = decodeStudentState(existing);
  const concepts = extractConcepts(input.prompt);
  const success = input.response.confidence >= 0.65;
  const lowConfidence = input.response.confidence < 0.45;

  const nextWeakConcepts = success
    ? current.weakConcepts.filter((concept) => !concepts.includes(concept))
    : uniqueLimited([...concepts, ...current.weakConcepts], 12);

  const misconceptionTag = inferMisconceptionPattern(input);
  const nextMisconceptions = misconceptionTag
    ? uniqueLimited([misconceptionTag, ...current.misconceptionPatterns], 12)
    : current.misconceptionPatterns;

  const verificationCount = current.confidenceProfile.verificationCount + 1;
  const verificationAverage =
    (current.confidenceProfile.verificationAverage * current.confidenceProfile.verificationCount + input.response.confidence) /
    verificationCount;
  const successfulChecks = current.retentionProfile.successfulChecks + (success ? 1 : 0);
  const failedChecks = current.retentionProfile.failedChecks + (success ? 0 : 1);
  const totalChecks = successfulChecks + failedChecks;
  const successRate = totalChecks ? successfulChecks / totalChecks : 0;

  const snapshot: StudentStateSnapshot = {
    weakConcepts: nextWeakConcepts,
    misconceptionPatterns: nextMisconceptions,
    confidenceProfile: {
      overall: round3((current.confidenceProfile.overall + input.response.confidence) / 2),
      verificationAverage: round3(verificationAverage),
      verificationCount,
      lastConfidence: round3(input.response.confidence),
    },
    retentionProfile: {
      recentVerificationSuccessRate: round3(successRate),
      successfulChecks,
      failedChecks,
    },
    pacingProfile: {
      verificationAttempts: current.pacingProfile.verificationAttempts + 1,
      lowConfidenceStreak: lowConfidence ? current.pacingProfile.lowConfidenceStreak + 1 : 0,
    },
    preferredExplanationStyle: current.preferredExplanationStyle,
    recentFailures: success ? current.recentFailures : uniqueLimited([summarizePrompt(input.prompt), ...current.recentFailures], 8),
    recentSuccesses: success ? uniqueLimited([summarizePrompt(input.prompt), ...current.recentSuccesses], 8) : current.recentSuccesses,
  };

  return prisma.studentState.upsert({
    where: { userId: input.userId },
    create: {
      userId: input.userId,
      weakConcepts: snapshot.weakConcepts as Prisma.InputJsonValue,
      misconceptionPatterns: snapshot.misconceptionPatterns as Prisma.InputJsonValue,
      confidenceProfile: snapshot.confidenceProfile as Prisma.InputJsonValue,
      retentionProfile: snapshot.retentionProfile as Prisma.InputJsonValue,
      pacingProfile: snapshot.pacingProfile as Prisma.InputJsonValue,
      preferredExplanationStyle: snapshot.preferredExplanationStyle,
      recentFailures: snapshot.recentFailures as Prisma.InputJsonValue,
      recentSuccesses: snapshot.recentSuccesses as Prisma.InputJsonValue,
    },
    update: {
      weakConcepts: snapshot.weakConcepts as Prisma.InputJsonValue,
      misconceptionPatterns: snapshot.misconceptionPatterns as Prisma.InputJsonValue,
      confidenceProfile: snapshot.confidenceProfile as Prisma.InputJsonValue,
      retentionProfile: snapshot.retentionProfile as Prisma.InputJsonValue,
      pacingProfile: snapshot.pacingProfile as Prisma.InputJsonValue,
      preferredExplanationStyle: snapshot.preferredExplanationStyle,
      recentFailures: snapshot.recentFailures as Prisma.InputJsonValue,
      recentSuccesses: snapshot.recentSuccesses as Prisma.InputJsonValue,
    },
    select: { id: true },
  });
}

export function formatStudentState(state: StudentState | null) {
  const decoded = decodeStudentState(state);
  return {
    weakConcepts: decoded.weakConcepts,
    misconceptionPatterns: decoded.misconceptionPatterns,
    confidenceProfile: decoded.confidenceProfile,
    retentionProfile: decoded.retentionProfile,
    pacingProfile: decoded.pacingProfile,
    preferredExplanationStyle: decoded.preferredExplanationStyle,
    recentFailures: decoded.recentFailures,
    recentSuccesses: decoded.recentSuccesses,
    updatedAt: state?.updatedAt?.toISOString() ?? null,
    createdAt: state?.createdAt?.toISOString() ?? null,
  };
}

export async function getStudentKnowledgeState(userId: string): Promise<StudentKnowledgeState | undefined> {
  const state = await prisma.studentState.findUnique({ where: { userId } });
  if (!state) return undefined;
  const decoded = decodeStudentState(state);
  return {
    weakTopics: decoded.weakConcepts,
    priorMistakes: decoded.misconceptionPatterns,
    confidenceByTopic: decoded.weakConcepts.reduce<Record<string, number>>((acc, topic) => {
      acc[topic] = decoded.confidenceProfile.overall;
      return acc;
    }, {}),
    retentionByTopic: decoded.weakConcepts.reduce<Record<string, number>>((acc, topic) => {
      acc[topic] = decoded.retentionProfile.recentVerificationSuccessRate;
      return acc;
    }, {}),
    reasoningPatterns: decoded.misconceptionPatterns,
  };
}

export function classifyMisconceptionSignalsFromVerification(
  input: UpdateStudentStateFromVerificationInput
): MisconceptionCategory[] {
  const category = inferMisconceptionPattern(input);
  return category ? [category] : [];
}

function decodeStudentState(state: StudentState | null): StudentStateSnapshot {
  return {
    weakConcepts: toStringArray(state?.weakConcepts),
    misconceptionPatterns: toMisconceptionArray(state?.misconceptionPatterns),
    confidenceProfile: toConfidenceProfile(state?.confidenceProfile),
    retentionProfile: toRetentionProfile(state?.retentionProfile),
    pacingProfile: toPacingProfile(state?.pacingProfile),
    preferredExplanationStyle: state?.preferredExplanationStyle ?? null,
    recentFailures: toStringArray(state?.recentFailures),
    recentSuccesses: toStringArray(state?.recentSuccesses),
  };
}

function inferMisconceptionPattern(input: UpdateStudentStateFromVerificationInput): MisconceptionCategory | null {
  if (input.mode === "compare_explanations") {
    return input.response.confidence < 0.5 ? "CONCEPTUAL_CONFUSION" : null;
  }

  const answer = normalizeText(input.answer || "");
  const expected = normalizeText(input.expectedAnswer || "");
  if (!expected) return input.response.confidence < 0.45 ? "MEMORIZATION_FAILURE" : null;

  if (hasUnitMismatch(answer, expected)) return "UNIT_ERROR";
  if (hasSignMismatch(answer, expected)) return "SIGN_ERROR";
  if (looksLikeArithmeticError(answer, expected)) return "ARITHMETIC_ERROR";
  if (looksOvergeneralized(answer, expected)) return "OVERGENERALIZATION";
  if (looksLikeSkippedStep(answer, expected, input.response.confidence)) return "SKIPPED_STEP";

  const overlap = tokenOverlap(answer, expected);
  if (overlap < 0.2 && input.response.confidence < 0.55) return "FALSE_ASSUMPTION";
  if (overlap < 0.5 && input.response.confidence < 0.65) return "CONCEPTUAL_CONFUSION";
  return null;
}

function extractConcepts(prompt: string): string[] {
  const tokens = String(prompt || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 5 && !STOPWORDS.has(token));
  return uniqueLimited(tokens, 5);
}

function summarizePrompt(prompt: string): string {
  const text = String(prompt || "").replace(/\s+/g, " ").trim();
  return text.length > 120 ? `${text.slice(0, 120)}...` : text;
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

function toMisconceptionArray(value: unknown): MisconceptionCategory[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isMisconceptionCategory);
}

function toConfidenceProfile(value: unknown): StudentStateSnapshot["confidenceProfile"] {
  const obj = asRecord(value);
  return {
    overall: toNumber(obj.overall),
    verificationAverage: toNumber(obj.verificationAverage),
    verificationCount: Math.floor(toNumber(obj.verificationCount)),
    lastConfidence: toNumber(obj.lastConfidence),
  };
}

function toRetentionProfile(value: unknown): StudentStateSnapshot["retentionProfile"] {
  const obj = asRecord(value);
  return {
    recentVerificationSuccessRate: toNumber(obj.recentVerificationSuccessRate),
    successfulChecks: Math.floor(toNumber(obj.successfulChecks)),
    failedChecks: Math.floor(toNumber(obj.failedChecks)),
  };
}

function toPacingProfile(value: unknown): StudentStateSnapshot["pacingProfile"] {
  const obj = asRecord(value);
  return {
    verificationAttempts: Math.floor(toNumber(obj.verificationAttempts)),
    lowConfidenceStreak: Math.floor(toNumber(obj.lowConfidenceStreak)),
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function toNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function normalizeText(text: string): string {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s./%-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(text: string): string[] {
  return normalizeText(text)
    .split(/\s+/)
    .filter((token) => token.length >= 2);
}

function tokenOverlap(left: string, right: string): number {
  const leftTokens = new Set(tokenize(left));
  const rightTokens = new Set(tokenize(right));
  if (!leftTokens.size || !rightTokens.size) return 0;
  let overlap = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) overlap++;
  }
  return overlap / Math.max(1, Math.min(leftTokens.size, rightTokens.size));
}

function looksLikeSkippedStep(answer: string, expected: string, confidence: number): boolean {
  const answerTokens = tokenize(answer);
  const expectedTokens = tokenize(expected);
  return confidence < 0.55 && answerTokens.length > 0 && answerTokens.length <= Math.max(3, Math.floor(expectedTokens.length * 0.4));
}

function looksOvergeneralized(answer: string, expected: string): boolean {
  const generalized = /\b(always|never|all|every|none|must)\b/.test(answer);
  const expectedGeneralized = /\b(always|never|all|every|none|must)\b/.test(expected);
  return generalized && !expectedGeneralized;
}

function looksLikeArithmeticError(answer: string, expected: string): boolean {
  const answerNumbers = extractNumbers(answer);
  const expectedNumbers = extractNumbers(expected);
  if (!answerNumbers.length || !expectedNumbers.length) return false;
  const sharedContext = tokenOverlap(answer.replace(NUMBER_REGEX, " "), expected.replace(NUMBER_REGEX, " "));
  return sharedContext >= 0.5 && !answerNumbers.some((value, index) => value === expectedNumbers[index]);
}

function hasSignMismatch(answer: string, expected: string): boolean {
  const answerHasNegative = /(^|\s)-\d/.test(answer) || /negative/.test(answer);
  const expectedHasNegative = /(^|\s)-\d/.test(expected) || /negative/.test(expected);
  return answerHasNegative !== expectedHasNegative;
}

function hasUnitMismatch(answer: string, expected: string): boolean {
  const answerUnits = extractUnits(answer);
  const expectedUnits = extractUnits(expected);
  if (!answerUnits.length || !expectedUnits.length) return false;
  return !answerUnits.some((unit) => expectedUnits.includes(unit));
}

function extractNumbers(text: string): string[] {
  return Array.from(text.matchAll(NUMBER_REGEX), (match) => match[0]);
}

function extractUnits(text: string): string[] {
  return tokenize(text).filter((token) => UNIT_TOKENS.has(token));
}

function uniqueLimited<T extends string>(values: T[], max: number): T[] {
  const out: T[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const cleaned = String(value || "").trim();
    if (!cleaned) continue;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(cleaned as T);
    if (out.length >= max) break;
  }
  return out;
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

const STOPWORDS = new Set([
  "about", "after", "before", "their", "there", "which", "would", "could", "should", "because", "while", "where", "these", "those", "using", "explain", "answer", "question", "compare", "following", "student", "reasoning",
]);

const NUMBER_REGEX = /-?\d+(?:\.\d+)?/g;

const UNIT_TOKENS = new Set([
  "m",
  "cm",
  "mm",
  "km",
  "g",
  "kg",
  "mg",
  "s",
  "sec",
  "min",
  "h",
  "hr",
  "n",
  "j",
  "w",
  "v",
  "a",
  "%",
  "percent",
  "celsius",
  "fahrenheit",
  "mol",
  "mole",
  "meters",
  "grams",
  "seconds",
]);