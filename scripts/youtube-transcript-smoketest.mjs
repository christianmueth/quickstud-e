/*
Usage:
  # Local (recommended: put SUPADATA_API_KEY in .env.local)
  node scripts/youtube-transcript-smoketest.mjs --url "https://www.youtube.com/watch?v=..."

  # Against deployed site
  node scripts/youtube-transcript-smoketest.mjs --base "https://your-app.vercel.app" --url "https://www.youtube.com/watch?v=..."

Notes:
  - This calls the app's /api/youtube-transcript route (Supadata-backed).
  - It does NOT print any secrets.
*/

import process from "node:process";
import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { Agent, setGlobalDispatcher } from "undici";

setGlobalDispatcher(
  new Agent({
    headersTimeout: Number(process.env.YT_SMOKETEST_HEADERS_TIMEOUT_MS || 60_000),
    bodyTimeout: Number(process.env.YT_SMOKETEST_BODY_TIMEOUT_MS || 60_000),
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
  const out = { baseUrl: "http://localhost:3000", baseExplicit: false, url: null, language: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--base" && argv[i + 1]) {
      out.baseUrl = argv[++i];
      out.baseExplicit = true;
    }
    else if (a === "--url" && argv[i + 1]) out.url = argv[++i];
    else if (a === "--language" && argv[i + 1]) out.language = argv[++i];
    else if (a === "--help" || a === "-h") return { help: true };
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  console.log(
    [
      "youtube-transcript-smoketest.mjs",
      "",
      "Options:",
      "  --base http://localhost:3000   Base URL (default: http://localhost:3000)",
      "  --url  <youtubeUrl>            YouTube URL to fetch transcript for (required)",
      "  --language <code>              Optional language hint (e.g. en)",
      "",
      "Tip:",
      "  If port 3000 is busy, run: npm run dev:3001 and pass --base http://localhost:3001",
      "",
      "Example:",
      "  node scripts/youtube-transcript-smoketest.mjs --url \"https://www.youtube.com/watch?v=_bcfxty39Cw\"",
    ].join("\n")
  );
  process.exit(0);
}

if (!args.url) {
  console.error("Missing --url");
  process.exit(1);
}

// Load local env files for SUPADATA_API_KEY when running locally.
const repoRoot = process.cwd();
loadDotenvLike(path.join(repoRoot, ".env.local"));
loadDotenvLike(path.join(repoRoot, ".env"));

async function postTranscript(baseUrl) {
  const endpoint = `${String(baseUrl).replace(/\/$/, "")}/api/youtube-transcript`;
  const t0 = performance.now();
  const testKey = process.env.FLASHCARDS_TEST_KEY;
  const resp = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(testKey ? { "x-flashcards-test-key": testKey } : {}),
    },
    body: JSON.stringify({ youtubeUrl: args.url, language: args.language || undefined }),
  });
  const tHeaders = performance.now();
  const text = await resp.text();
  const tBody = performance.now();
  return { resp, endpoint, text, t0, tHeaders, tBody };
}

let resp;
let endpoint;
let text;
let t0;
let tHeaders;
let tBody;
try {
  ({ resp, endpoint, text, t0, tHeaders, tBody } = await postTranscript(args.baseUrl));
} catch (e) {
  const msg = String(e?.cause?.message || e?.message || e);
  const default3000 = args.baseUrl === "http://localhost:3000" || args.baseUrl === "http://127.0.0.1:3000";
  if (!args.baseExplicit && default3000) {
    // Common on Windows: port 3000 already in use.
    const fallback = "http://localhost:3001";
    try {
      console.warn(`[connect] Failed to reach ${args.baseUrl}. Retrying ${fallback}...`);
      ({ resp, endpoint, text, t0, tHeaders, tBody } = await postTranscript(fallback));
    } catch (e2) {
      const msg2 = String(e2?.cause?.message || e2?.message || e2);
      console.error(`[connect] Could not reach ${args.baseUrl} (${msg}) or ${fallback} (${msg2}).`);
      console.error("Make sure the dev server is running, then pass --base to match the port.");
      process.exit(3);
    }
  } else {
    console.error(`[connect] Could not reach ${args.baseUrl}: ${msg}`);
    console.error("Make sure the dev server is running, then pass --base to match the port.");
    process.exit(3);
  }
}

let json = null;
try {
  json = JSON.parse(text);
} catch {
  // keep raw
}

if (!resp.ok) {
  console.error(`HTTP ${resp.status}`);
  console.error(`Endpoint: ${endpoint}`);
  console.error(
    `Timing: headers ${(tHeaders - t0).toFixed(0)}ms, body ${(tBody - tHeaders).toFixed(0)}ms, total ${(tBody - t0).toFixed(0)}ms`
  );
  console.error(json ?? text);
  process.exit(2);
}

const transcript = json?.transcript;
const len = typeof transcript === "string" ? transcript.length : 0;
console.log(`HTTP ${resp.status}`);
console.log(`Endpoint: ${endpoint}`);
console.log(
  `Timing: headers ${(tHeaders - t0).toFixed(0)}ms, body ${(tBody - tHeaders).toFixed(0)}ms, total ${(tBody - t0).toFixed(0)}ms`
);
console.log(`Transcript chars: ${len}`);
if (len) {
  const preview = transcript.slice(0, 500).replace(/\s+/g, " ").trim();
  console.log("Preview:");
  console.log(preview);
} else {
  console.log(json);
}
