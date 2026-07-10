/*
Usage:
  1) Start dev server: npm run dev
  2) In another terminal:
       node scripts/workspace-whiteboard-assist-smoketest.mjs

This exercises the whiteboard assist contract directly.
*/

import process from "node:process";
import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { Agent, fetch as undiciFetch } from "undici";

const dispatcher = new Agent({
  headersTimeout: 600_000,
  bodyTimeout: 600_000,
});

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
    intent: "relationships",
    workspaceGoal: "Show how light reactions support the Calvin cycle.",
    boardSummary: "Two clusters labeled Light reactions and Calvin cycle with empty arrows between them.",
    annotations: ["Need clearer energy flow", "Add ATP and NADPH roles"],
    hasSourceAttachment: true,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--base" && argv[index + 1]) out.baseUrl = argv[++index];
    else if (arg === "--intent" && argv[index + 1]) out.intent = argv[++index];
    else if (arg === "--goal" && argv[index + 1]) out.workspaceGoal = argv[++index];
    else if (arg === "--summary" && argv[index + 1]) out.boardSummary = argv[++index];
    else if (arg === "--help" || arg === "-h") return { help: true };
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  console.log([
    "workspace-whiteboard-assist-smoketest.mjs",
    "",
    "Options:",
    "  --base <url>       Base URL (default: http://localhost:3000)",
    "  --intent <mode>    Assist intent (default: relationships)",
    "  --goal <text>      Workspace goal",
    "  --summary <text>   Board summary",
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

const endpoint = `${args.baseUrl.replace(/\/$/, "")}/api/workspace/whiteboard-assist`;
const start = performance.now();
const response = await undiciFetch(endpoint, {
  method: "POST",
  dispatcher,
  headers: {
    "Content-Type": "application/json",
    "x-flashcards-test-key": testKey,
  },
  body: JSON.stringify({
    intent: args.intent,
    workspaceGoal: args.workspaceGoal,
    boardSummary: args.boardSummary,
    annotations: args.annotations,
    hasSourceAttachment: args.hasSourceAttachment,
  }),
});
const elapsed = performance.now() - start;
const text = await response.text();
let json = null;
try {
  json = JSON.parse(text);
} catch {
  // Ignore parse errors below.
}

if (!response.ok || !json?.ok || !json?.suggestion) {
  console.error(`HTTP ${response.status}`);
  console.error(`Timing: ${elapsed.toFixed(0)}ms`);
  console.error(json ?? text);
  process.exit(2);
}

const suggestion = json.suggestion;
if (!Array.isArray(suggestion.nodes) || !Array.isArray(suggestion.connections) || !Array.isArray(suggestion.actions)) {
  console.error("Whiteboard assist returned an invalid structured payload.");
  process.exit(3);
}

console.log(`HTTP ${response.status}`);
console.log(`Timing: ${elapsed.toFixed(0)}ms`);
console.log(`Title: ${suggestion.title}`);
console.log(`Nodes: ${suggestion.nodes.length}`);
console.log(`Connections: ${suggestion.connections.length}`);
console.log(`First action: ${suggestion.actions[0] || "n/a"}`);