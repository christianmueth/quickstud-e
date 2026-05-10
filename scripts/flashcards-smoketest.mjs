/*
Usage:
  1) Start dev server: npm run dev
  2) In another terminal:
       set FLASHCARDS_TEST_KEY=localtest
       node scripts/flashcards-smoketest.mjs --text "..."

Notes:
  - This calls /api/flashcards in test mode (bypasses Clerk) and returns the parsed cards.
  - It exercises the same parsing, shrinking, and RunPod call path as production.
*/

import process from "node:process";
import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { Agent, setGlobalDispatcher, fetch as undiciFetch, FormData } from "undici";

// RunPod calls (queueing + generation) can exceed Node/Undici's default header timeout.
// Increase timeouts for this *test script* so we can observe end-to-end behavior.
setGlobalDispatcher(
  new Agent({
    headersTimeout: Number(process.env.FLASHCARDS_SMOKETEST_HEADERS_TIMEOUT_MS || 420_000),
    bodyTimeout: Number(process.env.FLASHCARDS_SMOKETEST_BODY_TIMEOUT_MS || 420_000),
  })
);

function loadDotenvLike(filePath) {
  if (!fs.existsSync(filePath)) return;
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const m = trimmed.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!m) continue;
    const key = m[1];
    let value = m[2] ?? "";
    value = value.trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

function parseArgs(argv) {
  const out = { baseUrl: "http://localhost:3000", title: "smoketest", cardCount: 20, text: null, url: null, file: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--base" && argv[i + 1]) out.baseUrl = argv[++i];
    else if (a === "--title" && argv[i + 1]) out.title = argv[++i];
    else if (a === "--cards" && argv[i + 1]) out.cardCount = Number(argv[++i]) || 20;
    else if (a === "--text" && argv[i + 1]) out.text = argv[++i];
    else if (a === "--url" && argv[i + 1]) out.url = argv[++i];
    else if (a === "--file" && argv[i + 1]) out.file = argv[++i];
    else if (a === "--help" || a === "-h") return { help: true };
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  console.log(
    [
      "flashcards-smoketest.mjs",
      "",
      "Options:",
      "  --base  http://localhost:3000   Base URL (default: http://localhost:3000)",
      "  --title <string>               Deck title (default: smoketest)",
      "  --cards <n>                    Card count (default: 20)",
      "  --text  <string>               Source text",
      "  --url   <string>               URL to ingest (website or YouTube)",
      "  --file  <path>                 Upload a local PDF/PPTX file",
      "",
      "Example:",
      "  set FLASHCARDS_TEST_KEY=localtest",
      "  node scripts/flashcards-smoketest.mjs --text \"Water expands when it freezes...\"",
    ].join("\n")
  );
  process.exit(0);
}

// Load local env files for RUNPOD_*/etc.
const repoRoot = process.cwd();
loadDotenvLike(path.join(repoRoot, ".env.local"));
loadDotenvLike(path.join(repoRoot, ".env"));

const testKey = process.env.FLASHCARDS_TEST_KEY;
if (!testKey) {
  console.error("Missing FLASHCARDS_TEST_KEY in environment. Set it to any value and re-run.");
  process.exit(1);
}

if (!args.text && !args.url && !args.file) {
  console.error("Provide either --text, --url, or --file");
  process.exit(1);
}

const endpoint = `${args.baseUrl.replace(/\/$/, "")}/api/flashcards`;

let resp;
const t0 = performance.now();
if (args.file) {
  const filePath = path.resolve(process.cwd(), String(args.file));
  if (!fs.existsSync(filePath)) {
    console.error(`File not found: ${filePath}`);
    process.exit(1);
  }
  const fileName = path.basename(filePath);
  const lower = fileName.toLowerCase();
  const contentType =
    lower.endsWith(".pptx")
      ? "application/vnd.openxmlformats-officedocument.presentationml.presentation"
      : lower.endsWith(".pdf")
        ? "application/pdf"
        : "application/octet-stream";

  const buf = fs.readFileSync(filePath);
  const fd = new FormData();
  fd.set("title", String(args.title || "smoketest"));
  fd.set("cardCount", String(args.cardCount || 20));
  fd.append("file", new Blob([buf], { type: contentType }), fileName);

  resp = await undiciFetch(endpoint, {
    method: "POST",
    headers: {
      "x-flashcards-test-key": testKey,
      // Do NOT set Content-Type; fetch will set multipart boundary.
    },
    body: fd,
  });
} else {
  const form = new URLSearchParams();
  form.set("title", String(args.title || "smoketest"));
  form.set("cardCount", String(args.cardCount || 20));
  if (args.text) form.set("source", String(args.text));
  if (args.url) form.set("url", String(args.url));

  resp = await undiciFetch(endpoint, {
    method: "POST",
    headers: {
      "x-flashcards-test-key": testKey,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: form,
  });
}
const t1 = performance.now();

const text = await resp.text();
let json = null;
try {
  json = JSON.parse(text);
} catch {
  // keep raw
}

if (!resp.ok) {
  console.error(`HTTP ${resp.status}`);
  console.error(`Timing: ${(t1 - t0).toFixed(0)}ms`);
  console.error(json ?? text);
  process.exit(2);
}

console.log(`HTTP ${resp.status}`);
console.log(`Timing: ${(t1 - t0).toFixed(0)}ms`);
if (!json) {
  console.log(text);
  process.exit(0);
}

if (json.ok && Array.isArray(json.cards)) {
  console.log(`Returned ${json.cards.length} cards (origin=${json.origin})`);
  if (json.debug) {
    console.log("Debug:");
    if (typeof json.debug.sourceLength === "number") console.log("- sourceLength:", json.debug.sourceLength);
    if (typeof json.debug.llmSourceLength === "number") console.log("- llmSourceLength:", json.debug.llmSourceLength);
    if (typeof json.debug.sourcePreview === "string") console.log("- sourcePreview:", json.debug.sourcePreview);
    if (typeof json.debug.llmSourcePreview === "string") console.log("- llmSourcePreview:", json.debug.llmSourcePreview);
  }
  console.log("First 3 cards:");
  for (const c of json.cards.slice(0, 3)) {
    console.log("- Q:", c.question);
    console.log("  A:", c.answer);
  }
  process.exit(0);
}

console.log(json);
