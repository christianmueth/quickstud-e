import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { buildPremiumRequiredMessage, getBillingSnapshot } from "@/lib/billing";
import { chatV1 } from "@/lib/aiGateway";
import { sanitizeWorkspaceContext, summarizeWorkspaceContext, type WorkspaceContext } from "@/lib/workspaceContext";
import { buildWorkspaceConstitutionPrompt } from "@/lib/workspaceConstitution";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PRESENTATION_MODEL_TIMEOUT_MS = 12_000;

type PresentationPlanRequest = {
  sourceType?: string;
  sourceTitle?: string;
  sourceText?: string;
  presentationGoal?: string;
  audience?: string;
  workspaceContext?: WorkspaceContext | null;
};

const presentationPlanSchema = {
  type: "object",
  additionalProperties: false,
  required: ["title", "audience", "objective", "outline", "presenterChecklist"],
  properties: {
    title: { type: "string" },
    audience: { type: "string" },
    objective: { type: "string" },
    outline: {
      type: "array",
      minItems: 4,
      maxItems: 8,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["slideTitle", "purpose", "bullets", "speakerGuidance", "suggestedVisual"],
        properties: {
          slideTitle: { type: "string" },
          purpose: { type: "string" },
          bullets: { type: "array", items: { type: "string" }, minItems: 2, maxItems: 5 },
          speakerGuidance: { type: "string" },
          suggestedVisual: { type: "string" },
        },
      },
    },
    presenterChecklist: { type: "array", items: { type: "string" }, minItems: 3, maxItems: 6 },
  },
} as const;

export async function POST(req: Request) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ ok: false, error: "Unauthorized", code: "UNAUTHORIZED" }, { status: 401 });
    }

    const billing = await getBillingSnapshot(userId);
    if (!billing.isPaid) {
      return NextResponse.json(
        {
          ok: false,
          error: buildPremiumRequiredMessage("Presentation planning"),
          code: "PREMIUM_REQUIRED",
          upgradePath: "/app/billing",
        },
        { status: 402 }
      );
    }

    const body = (await req.json()) as PresentationPlanRequest;
    const sourceText = clean(body.sourceText).slice(0, 10000);
    const workspaceContext = sanitizeWorkspaceContext(body.workspaceContext);
    if (!sourceText) {
      return NextResponse.json({ ok: false, error: "Source material is required." }, { status: 400 });
    }

    let plan: object;

    try {
      const response = await Promise.race([
        chatV1({
          allowUnauthenticated: true,
          disableOpenAICompat: true,
          temperature: 0.35,
          max_output_tokens: 900,
          structured_output: { type: "json_schema", name: "presentation_plan", schema: presentationPlanSchema },
          messages: [
            {
              role: "system",
              content: buildWorkspaceConstitutionPrompt([
                "You are building a guided presentation outline inside a study workspace.",
                "Do not auto-complete the full presentation in a rigid way.",
                "Produce an editable outline that preserves human authorship.",
                "Speaker guidance should be concise and useful for real delivery.",
              ]),
            },
            {
              role: "user",
              content: [
                `Source type: ${clean(body.sourceType) || "notes"}`,
                `Working title: ${clean(body.sourceTitle) || "untitled workspace material"}`,
                `Audience: ${clean(body.audience) || "general study audience"}`,
                `Presentation goal: ${clean(body.presentationGoal) || "teach the most important ideas clearly"}`,
                `Active workspace context: ${summarizeWorkspaceContext(workspaceContext)}`,
                "Source material:",
                sourceText,
              ].join("\n\n"),
            },
          ],
        }),
        createPlannerTimeout(),
      ]);

      plan =
        response.output_json && typeof response.output_json === "object"
          ? response.output_json
          : buildFallbackPlan(body, sourceText, response.output_text);
    } catch (error: any) {
      if (error?.code === "UNAUTHORIZED") {
        throw error;
      }
      plan = buildFallbackPlan(body, sourceText, "");
    }

    const exportMarkdown = buildMarkdown(plan as any);
    return NextResponse.json({ ok: true, plan: { ...(plan as object), exportMarkdown } });
  } catch (error: any) {
    if (error?.code === "UNAUTHORIZED") {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ ok: false, error: error?.message || "Presentation planning failed." }, { status: 500 });
  }
}

function clean(value: unknown) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function createPlannerTimeout() {
  return new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error("Presentation planner timed out before model output was ready.")), PRESENTATION_MODEL_TIMEOUT_MS);
  });
}

function buildFallbackPlan(
  body: PresentationPlanRequest,
  sourceText: string,
  modelText: string
) {
  const sentences = splitSentences(sourceText || modelText).slice(0, 8);
  const title = clean(body.sourceTitle) || inferTitleFromText(sourceText) || "Guided presentation outline";
  const audience = clean(body.audience) || "General study audience";
  const objective = clean(body.presentationGoal) || "Explain the most important ideas clearly.";

  const keyPoints = sentences.length
    ? sentences
    : [
        "Introduce the main idea in one clear sentence.",
        "Break the process into the most important stages.",
        "Connect the explanation back to the study goal.",
      ];

  const outline = [
    {
      slideTitle: "Why this topic matters",
      purpose: "Orient the audience to the core concept and goal.",
      bullets: uniqueBullets([
        keyPoints[0] || objective,
        `Focus question: ${objective}`,
        `Audience lens: ${audience}`,
      ]),
      speakerGuidance: "Open with the big-picture purpose before moving into details.",
      suggestedVisual: "A simple title slide with one key question or diagram preview.",
    },
    {
      slideTitle: "Core ingredients",
      purpose: "Name the inputs, parts, or conditions the audience needs first.",
      bullets: uniqueBullets([
        keyPoints[1] || keyPoints[0] || "Identify the main inputs or prerequisites.",
        keyPoints[2] || "Define the most important vocabulary in plain language.",
        "Keep the setup short enough that the process remains the focus.",
      ]),
      speakerGuidance: "Clarify the setup quickly so the audience is ready for the main sequence.",
      suggestedVisual: "A labeled list or simple diagram of the starting ingredients.",
    },
    {
      slideTitle: "How the process works",
      purpose: "Walk through the main mechanism step by step.",
      bullets: uniqueBullets([
        keyPoints[3] || keyPoints[1] || "Explain the first major step.",
        keyPoints[4] || keyPoints[2] || "Show what changes during the middle stage.",
        keyPoints[5] || "Point out the result of the sequence.",
      ]),
      speakerGuidance: "Move in sequence and narrate each transition instead of rushing to the endpoint.",
      suggestedVisual: "A flowchart with arrows connecting the major stages.",
    },
    {
      slideTitle: "What to notice",
      purpose: "Highlight the relationships, outputs, or misconceptions that matter most.",
      bullets: uniqueBullets([
        keyPoints[6] || "Compare two ideas the audience may confuse.",
        keyPoints[7] || "Explain the output or takeaway in everyday language.",
        "Call out one common misunderstanding and correct it directly.",
      ]),
      speakerGuidance: "Slow down here and translate the mechanism into a clear takeaway.",
      suggestedVisual: "A comparison table or callout boxes for the most important distinctions.",
    },
    {
      slideTitle: "Recap and close",
      purpose: "End with a short summary and a clear final takeaway.",
      bullets: uniqueBullets([
        `Restate the goal: ${objective}`,
        summarizeSentences(keyPoints.slice(0, 3)),
        "Leave the audience with one sentence they should remember after the presentation.",
      ]),
      speakerGuidance: "Close by linking the summary back to the original question or goal.",
      suggestedVisual: "A simple recap slide with three short takeaways.",
    },
  ];

  return {
    title,
    audience,
    objective,
    outline,
    presenterChecklist: [
      "Trim each slide to the minimum number of bullets you need.",
      "Say the transitions out loud once before presenting.",
      "Check that the main takeaway is understandable without reading every bullet.",
    ],
  };
}

function splitSentences(text: string) {
  return String(text || "")
    .split(/(?<=[.!?])\s+/)
    .map((part) => clean(part))
    .filter(Boolean);
}

function inferTitleFromText(text: string) {
  const firstSentence = splitSentences(text)[0] || "";
  return firstSentence.length > 80 ? `${firstSentence.slice(0, 77)}...` : firstSentence;
}

function uniqueBullets(items: string[]) {
  return Array.from(new Set(items.map(clean).filter(Boolean))).slice(0, 4);
}

function summarizeSentences(items: string[]) {
  const summary = items.map(clean).filter(Boolean).join(" ");
  if (!summary) return "Summarize the process in one clean through-line.";
  return summary.length > 220 ? `${summary.slice(0, 217)}...` : summary;
}

function buildMarkdown(plan: {
  title?: string;
  audience?: string;
  objective?: string;
  outline?: Array<{ slideTitle?: string; purpose?: string; bullets?: string[]; speakerGuidance?: string; suggestedVisual?: string }>;
  presenterChecklist?: string[];
}) {
  const lines = [`# ${plan.title || "Presentation"}`, "", `Audience: ${plan.audience || "General"}`, "", `Objective: ${plan.objective || ""}`, ""];
  for (const [index, slide] of (plan.outline || []).entries()) {
    lines.push(`## Slide ${index + 1}: ${slide.slideTitle || "Untitled"}`);
    lines.push(`Purpose: ${slide.purpose || ""}`);
    lines.push("");
    for (const bullet of slide.bullets || []) lines.push(`- ${bullet}`);
    lines.push("");
    lines.push(`Speaker guidance: ${slide.speakerGuidance || ""}`);
    lines.push(`Suggested visual: ${slide.suggestedVisual || ""}`);
    lines.push("");
  }
  lines.push("## Presenter checklist");
  for (const item of plan.presenterChecklist || []) lines.push(`- ${item}`);
  lines.push("");
  return lines.join("\n");
}