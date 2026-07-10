/*
Usage:
  1) Start dev server: npm run dev
  2) In another terminal:
       node scripts/workspace-presentation-smoketest.mjs

This exercises the guided presentation planner contract directly.
*/

import process from "node:process";
import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fetch as undiciFetch } from "undici";

function loadDotenvLike(filePath) {
  if (!fs.existsSync(filePath)) return;
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!match) continue;
    const key = match[1];
    let value = match[2] ?? "";
    value = value.trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

function parseArgs(argv) {
  const out = {
    baseUrl: "http://localhost:3000",
    sourceType: "notes",
    sourceTitle: "Photosynthesis review",
    audience: "Biology classmates",
    goal: "Explain the core process clearly in a short class presentation.",
    sourceText: "Photosynthesis converts light energy into chemical energy stored in glucose. The light-dependent reactions make ATP and NADPH, and the Calvin cycle uses them to fix carbon dioxide into sugars.",
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--base" && argv[index + 1]) out.baseUrl = argv[++index];
    else if (arg === "--source-type" && argv[index + 1]) out.sourceType = argv[++index];
    else if (arg === "--title" && argv[index + 1]) out.sourceTitle = argv[++index];
    else if (arg === "--audience" && argv[index + 1]) out.audience = argv[++index];
    else if (arg === "--goal" && argv[index + 1]) out.goal = argv[++index];
    else if (arg === "--text" && argv[index + 1]) out.sourceText = argv[++index];
    else if (arg === "--help" || arg === "-h") return { help: true };
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  console.log([
    "workspace-presentation-smoketest.mjs",
    "",
    "Options:",
    "  --base <url>          Base URL (default: http://localhost:3000)",
    "  --source-type <type>  Source type label (default: notes)",
    "  --title <text>        Working title",
    "  --audience <text>     Audience label",
    "  --goal <text>         Presentation goal",
    "  --text <text>         Source material",
  ].join("\n"));
  process.exit(0);
}

loadDotenvLike(path.join(process.cwd(), ".env.local"));
loadDotenvLike(path.join(process.cwd(), ".env"));

const testKey = process.env.FLASHCARDS_TEST_KEY;
if (!testKey) {
  console.error("Missing FLASHCARDS_TEST_KEY in environment. Set it to any value and re-run.");
  process.exit(1);
}

const body = {
  sourceType: args.sourceType,
  sourceTitle: args.sourceTitle,
  audience: args.audience,
  presentationGoal: args.goal,
  sourceText: args.sourceText,
  workspaceContext: {
    version: 1,
    updatedAt: new Date().toISOString(),
    activeStudySet: {
      deckId: "smoketest-deck",
      focusConcept: "photosynthesis",
      focusReason: "recent weak concept",
      queuePosition: null,
      currentCard: null,
      sessionComplete: false,
    },
    weakConcepts: ["photosynthesis", "calvin cycle"],
    misconceptionPatterns: ["CONCEPTUAL_CONFUSION"],
    tutorMemory: {
      explanationStyle: "step-by-step",
      recentGuidance: ["Use a short contrast between light reactions and the Calvin cycle."],
    },
    currentGuidedSession: null,
    whiteboardReference: {
      boardId: "board-smoke",
      boardName: "Photosynthesis map",
      workspaceGoal: "Compare the light reactions with the Calvin cycle.",
      noteCount: 4,
      shapeCount: 2,
      strokeCount: 0,
      selectedCount: 0,
      annotationCount: 1,
      sourceAttachmentName: "chapter-notes.pdf",
      sourceOverlayKind: "pdf",
      updatedAt: new Date().toISOString(),
    },
    presentationReference: null,
    uploadedAssets: [],
    recentTutorInteractions: [
      { role: "assistant", content: "Keep the explanation centered on energy conversion.", createdAt: new Date().toISOString() },
    ],
  },
};

const endpoint = `${args.baseUrl.replace(/\/$/, "")}/api/workspace/presentation-plan`;
const start = performance.now();
const response = await undiciFetch(endpoint, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "x-flashcards-test-key": testKey,
  },
  body: JSON.stringify(body),
});
const elapsed = performance.now() - start;
const text = await response.text();
let json = null;
try {
  json = JSON.parse(text);
} catch {
  // Ignore parse errors below.
}

if (!response.ok || !json?.ok || !json?.plan) {
  console.error(`HTTP ${response.status}`);
  console.error(`Timing: ${elapsed.toFixed(0)}ms`);
  console.error(json ?? text);
  process.exit(2);
}

const plan = json.plan;
if (!Array.isArray(plan.outline) || plan.outline.length < 4) {
  console.error("Presentation planner returned an invalid outline payload.");
  process.exit(3);
}

console.log(`HTTP ${response.status}`);
console.log(`Timing: ${elapsed.toFixed(0)}ms`);
console.log(`Title: ${plan.title}`);
console.log(`Slides: ${plan.outline.length}`);
console.log(`First slide: ${plan.outline[0]?.slideTitle || "n/a"}`);
console.log(`Speaker guidance: ${plan.outline[0]?.speakerGuidance || "n/a"}`);
