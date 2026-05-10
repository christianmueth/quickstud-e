/*
Usage:
  # Directly call Supadata (no Next.js server needed)
  node scripts/youtube-transcript-direct-smoketest.mjs --url "https://www.youtube.com/watch?v=..."

Notes:
  - Requires SUPADATA_API_KEY in .env.local or environment.
  - Prints timing + transcript length preview.
  - Does NOT print any secrets.
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
  const out = { url: null, language: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--url" && argv[i + 1]) out.url = argv[++i];
    else if (a === "--language" && argv[i + 1]) out.language = argv[++i];
    else if (a === "--help" || a === "-h") return { help: true };
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  console.log(
    [
      "youtube-transcript-direct-smoketest.mjs",
      "",
      "Options:",
      "  --url  <youtubeUrl>            YouTube URL to fetch transcript for (required)",
      "  --language <code>              Optional language hint (e.g. en)",
      "",
      "Example:",
      '  node scripts/youtube-transcript-direct-smoketest.mjs --url "https://www.youtube.com/watch?v=_bcfxty39Cw"',
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

const apiKey = process.env.SUPADATA_API_KEY;
if (!apiKey) {
  console.error("SUPADATA_API_KEY is not set. Put it in .env.local or environment.");
  process.exit(2);
}

const u = new URL("https://api.supadata.ai/v1/transcript");
u.searchParams.set("url", String(args.url));
u.searchParams.set("text", "true");
u.searchParams.set("mode", "auto");
if (args.language) u.searchParams.set("lang", String(args.language));

const t0 = performance.now();
let resp;
try {
  resp = await fetch(u.toString(), {
    method: "GET",
    headers: {
      "x-api-key": apiKey,
      Accept: "application/json",
    },
  });
} catch (e) {
  const msg = String(e?.cause?.message || e?.message || e);
  console.error(`[connect] Failed to reach Supadata: ${msg}`);
  process.exit(3);
}
const tHeaders = performance.now();

const text = await resp.text();
const tBody = performance.now();

let json = null;
try {
  json = JSON.parse(text);
} catch {
  // keep raw
}

if (!resp.ok) {
  console.error(`HTTP ${resp.status}`);
  console.error(`Endpoint: ${u.toString()}`);
  console.error(json ?? text);
  console.error(`Timing: headers ${(tHeaders - t0).toFixed(0)}ms, body ${(tBody - tHeaders).toFixed(0)}ms, total ${(tBody - t0).toFixed(0)}ms`);
  process.exit(4);
}

const transcript = json?.content;
const len = typeof transcript === "string" ? transcript.length : 0;
console.log(`HTTP ${resp.status}`);
console.log(`Endpoint: ${u.toString()}`);
console.log(`Timing: headers ${(tHeaders - t0).toFixed(0)}ms, body ${(tBody - tHeaders).toFixed(0)}ms, total ${(tBody - t0).toFixed(0)}ms`);
console.log(`Transcript chars: ${len}`);
if (len) {
  const preview = transcript.slice(0, 500).replace(/\s+/g, " ").trim();
  console.log("Preview:");
  console.log(preview);
} else {
  console.log(json);
}
