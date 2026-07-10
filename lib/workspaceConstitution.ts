export const WORKSPACE_CONSTITUTION_RULES = [
  "Preserve the constitutional rule: richer workspace context does not imply greater authority.",
  "Keep the human operationally central at all times.",
  "You may improve memory, explanation quality, visual guidance, organizational continuity, and multimodal tutoring support.",
  "You must not take hidden actions, run autonomous workflows, silently override recommendations, or imply planner control.",
  "Do not claim to execute tasks, modify the workspace on the learner's behalf, or self-direct multi-step operations without explicit user action.",
  "If a suggestion could be interpreted as taking control, restate it as a human-visible recommendation or editable draft instead.",
] as const;

export type WorkspaceConstitutionSurfaceStatus = "guarded" | "not_applicable" | "needs_review";

export type WorkspaceConstitutionSurface = {
  id: string;
  label: string;
  route: string;
  category: "ai_guidance" | "shared_tutor" | "state" | "export";
  status: WorkspaceConstitutionSurfaceStatus;
  detail: string;
};

export const WORKSPACE_CONSTITUTION_SURFACES: WorkspaceConstitutionSurface[] = [
  {
    id: "tutor-chat",
    label: "Tutor chat",
    route: "/api/tutor-chat",
    category: "shared_tutor",
    status: "guarded",
    detail: "Uses the shared workspace constitution prompt before generating guidance.",
  },
  {
    id: "whiteboard-assist",
    label: "Whiteboard assist",
    route: "/api/workspace/whiteboard-assist",
    category: "ai_guidance",
    status: "guarded",
    detail: "Uses the shared workspace constitution prompt before returning board guidance.",
  },
  {
    id: "presentation-plan",
    label: "Presentation plan",
    route: "/api/workspace/presentation-plan",
    category: "ai_guidance",
    status: "guarded",
    detail: "Uses the shared workspace constitution prompt before returning outline guidance.",
  },
  {
    id: "workspace-context",
    label: "Workspace context sync",
    route: "/api/workspace/context",
    category: "state",
    status: "not_applicable",
    detail: "Persists bounded state only; no model prompt is involved.",
  },
  {
    id: "whiteboard-state",
    label: "Whiteboard state",
    route: "/api/workspace/whiteboard-state",
    category: "state",
    status: "not_applicable",
    detail: "Persists named boards only; no model prompt is involved.",
  },
  {
    id: "presentation-export",
    label: "Presentation export",
    route: "/api/workspace/presentation-export",
    category: "export",
    status: "not_applicable",
    detail: "Exports user-authored plans only; no model prompt is involved.",
  },
];

export function buildWorkspaceConstitutionPrompt(extraLines: string[] = []) {
  return [...WORKSPACE_CONSTITUTION_RULES, ...extraLines].join("\n");
}

export function getWorkspaceConstitutionChecklist() {
  return WORKSPACE_CONSTITUTION_SURFACES.map((surface) => ({ ...surface }));
}

export function getWorkspaceConstitutionChecklistSummary() {
  const guarded = WORKSPACE_CONSTITUTION_SURFACES.filter((surface) => surface.status === "guarded").length;
  const notApplicable = WORKSPACE_CONSTITUTION_SURFACES.filter((surface) => surface.status === "not_applicable").length;
  const needsReview = WORKSPACE_CONSTITUTION_SURFACES.filter((surface) => surface.status === "needs_review").length;

  return {
    guarded,
    notApplicable,
    needsReview,
    headline: needsReview > 0
      ? `${needsReview} workspace surface${needsReview === 1 ? " needs" : "s need"} constitutional review.`
      : "All known workspace guidance surfaces are either constitution-guarded or explicitly non-agentic.",
  };
}

export function buildHumanCenteredRecommendation(reason: string) {
  const normalized = reason.trim();
  if (!normalized) return "";
  if (/visible recommendation|not an automatic/i.test(normalized)) return normalized;
  return `${normalized} This remains a visible recommendation you can accept, edit, or ignore.`;
}