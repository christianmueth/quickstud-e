/*
E2E helper: YouTube URL -> transcript -> flashcards (local)

Why this exists:
- The VS Code tool terminal runs one command at a time in the same session.
- This script starts `next dev`, waits for readiness, runs the existing flashcards smoketest,
  and then stops the dev server.

Usage (PowerShell):
  $env:FLASHCARDS_TEST_KEY = "localtest"
  node scripts/flashcards-youtube-e2e.mjs --url "https://www.youtube.com/watch?v=..." --cards 10
*/

import process from "node:process";
import { spawn } from "node:child_process";

function parseArgs(argv) {
  const out = { url: null, cards: 10, base: "http://localhost:3000", port: 3000 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--url" && argv[i + 1]) out.url = argv[++i];
    else if (a === "--cards" && argv[i + 1]) out.cards = Number(argv[++i]) || 10;
    else if (a === "--base" && argv[i + 1]) out.base = argv[++i];
    else if (a === "--port" && argv[i + 1]) out.port = Number(argv[++i]) || 3000;
    else if (a === "--help" || a === "-h") return { help: true };
  }
  return out;
}

async function sleep(ms) {
  await new Promise((r) => setTimeout(r, ms));
}

async function waitForReady(url, timeoutMs = 60_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const r = await fetch(url, { method: "GET" });
      if (r.ok) return true;
    } catch {
      // ignore
    }
    await sleep(1000);
  }
  return false;
}

function killProcessTree(child) {
  if (!child || !child.pid) return;

  // Best-effort cross-platform shutdown.
  try {
    child.kill("SIGINT");
  } catch {
    // ignore
  }

  const pid = child.pid;
  setTimeout(() => {
    try {
      if (process.platform === "win32") {
        spawn("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore" });
      } else {
        process.kill(pid, "SIGKILL");
      }
    } catch {
      // ignore
    }
  }, 2500).unref();
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.url) {
    console.log([
      "flashcards-youtube-e2e.mjs",
      "",
      "Options:",
      "  --url   <youtubeUrl>   (required)",
      "  --cards <n>            (default: 10)",
      "  --port  <n>            (default: 3000)",
      "  --base  <baseUrl>      (default: http://localhost:3000)",
      "",
      "Example (PowerShell):",
      '  $env:FLASHCARDS_TEST_KEY = "localtest"',
      '  node scripts/flashcards-youtube-e2e.mjs --url "https://www.youtube.com/watch?v=_bcfxty39Cw" --cards 10',
    ].join("\n"));
    process.exit(args.help ? 0 : 1);
  }

  const testKey = process.env.FLASHCARDS_TEST_KEY;
  if (!testKey) {
    console.error("Missing FLASHCARDS_TEST_KEY in environment. Example: $env:FLASHCARDS_TEST_KEY=\"localtest\"");
    process.exit(1);
  }

  const base = String(args.base || `http://localhost:${args.port}`).replace(/\/$/, "");
  const readyUrl = `${base}/`;
  const useShell = process.platform === "win32";

  console.log("[e2e] starting dev server...");
  const dev = spawn("npm", ["run", "dev", "--", "-p", String(args.port)], {
    env: { ...process.env, FLASHCARDS_TEST_KEY: testKey },
    stdio: "pipe",
    shell: useShell,
  });

  dev.stdout.on("data", (d) => process.stdout.write(String(d)));
  dev.stderr.on("data", (d) => process.stderr.write(String(d)));

  const ok = await waitForReady(readyUrl, 90_000);
  if (!ok) {
    console.error("[e2e] dev server did not become ready in time");
    killProcessTree(dev);
    process.exit(2);
  }

  console.log("[e2e] server ready; running flashcards smoketest...");

  const smoketest = spawn(
    "npm",
    [
      "run",
      "flashcards:smoketest",
      "--",
      "--base",
      base,
      "--url",
      String(args.url),
      "--cards",
      String(args.cards || 10),
    ],
    {
      env: { ...process.env, FLASHCARDS_TEST_KEY: testKey },
      stdio: "inherit",
      shell: useShell,
    }
  );

  const code = await new Promise((resolve) => {
    smoketest.on("exit", (c) => resolve(typeof c === "number" ? c : 1));
  });

  console.log(`[e2e] smoketest exit code: ${code}`);
  killProcessTree(dev);
  process.exit(code);
}

main().catch((e) => {
  console.error("[e2e] fatal:", e?.stack || e);
  process.exit(1);
});
