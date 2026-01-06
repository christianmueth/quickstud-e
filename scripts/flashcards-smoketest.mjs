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

function parseArgs(argv) {
  const out = { baseUrl: "http://localhost:3000", title: "smoketest", cardCount: 20, text: null, url: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--base" && argv[i + 1]) out.baseUrl = argv[++i];
    else if (a === "--title" && argv[i + 1]) out.title = argv[++i];
    else if (a === "--cards" && argv[i + 1]) out.cardCount = Number(argv[++i]) || 20;
    else if (a === "--text" && argv[i + 1]) out.text = argv[++i];
    else if (a === "--url" && argv[i + 1]) out.url = argv[++i];
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
      "",
      "Example:",
      "  set FLASHCARDS_TEST_KEY=localtest",
      "  node scripts/flashcards-smoketest.mjs --text \"Water expands when it freezes...\"",
    ].join("\n")
  );
  process.exit(0);
}

const testKey = process.env.FLASHCARDS_TEST_KEY;
if (!testKey) {
  console.error("Missing FLASHCARDS_TEST_KEY in environment. Set it to any value and re-run.");
  process.exit(1);
}

if (!args.text && !args.url) {
  console.error("Provide either --text or --url");
  process.exit(1);
}

const endpoint = `${args.baseUrl.replace(/\/$/, "")}/api/flashcards`;

const form = new FormData();
form.set("title", String(args.title || "smoketest"));
form.set("cardCount", String(args.cardCount || 20));
if (args.text) form.set("source", String(args.text));
if (args.url) form.set("url", String(args.url));

const resp = await fetch(endpoint, {
  method: "POST",
  headers: {
    "x-flashcards-test-key": testKey,
  },
  body: form,
});

const text = await resp.text();
let json = null;
try {
  json = JSON.parse(text);
} catch {
  // keep raw
}

if (!resp.ok) {
  console.error(`HTTP ${resp.status}`);
  console.error(json ?? text);
  process.exit(2);
}

console.log(`HTTP ${resp.status}`);
if (!json) {
  console.log(text);
  process.exit(0);
}

if (json.ok && Array.isArray(json.cards)) {
  console.log(`Returned ${json.cards.length} cards (origin=${json.origin})`);
  console.log("First 3 cards:");
  for (const c of json.cards.slice(0, 3)) {
    console.log("- Q:", c.question);
    console.log("  A:", c.answer);
  }
  process.exit(0);
}

console.log(json);
