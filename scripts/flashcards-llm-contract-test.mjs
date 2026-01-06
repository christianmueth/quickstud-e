#!/usr/bin/env node
/*
Pure-local LLM contract test (no Next.js server).

Goal:
  Verify the configured RunPod LLM can reliably output flashcards in:
    1) Q/A block format (Q: ... A: ... ---)
    2) JSON schema format

Usage (PowerShell):
  node scripts/flashcards-llm-contract-test.mjs --mode qa --cards 10 --text "..."
  node scripts/flashcards-llm-contract-test.mjs --mode json --cards 10 --text "..."

Env (loaded from .env.local/.env automatically):
  RUNPOD_ENDPOINT=https://api.runpod.ai/v2/<id>/run
  RUNPOD_API_KEY=...
  RUNPOD_MODEL=deepseek-r1 (optional)

Notes:
  - Uses OpenAI-compat endpoint derived from RUNPOD_ENDPOINT.
  - Exits non-zero if it cannot parse the requested number of cards.
*/

import process from "node:process";
import fs from "node:fs";
import path from "node:path";

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
  const out = {
    mode: "qa", // qa | json | json-array
    cards: 10,
    text: null,
    endpoint: null,
    key: null,
    model: null,
    timeoutMs: 90_000,
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = argv[i + 1];
    if (a === "--mode" && next) out.mode = next;
    else if (a === "--cards" && next) out.cards = Number(next) || out.cards;
    else if (a === "--text" && next) out.text = next;
    else if (a === "--endpoint" && next) out.endpoint = next;
    else if (a === "--key" && next) out.key = next;
    else if (a === "--model" && next) out.model = next;
    else if (a === "--timeout" && next) out.timeoutMs = Number(next) || out.timeoutMs;
    else if (a === "--help" || a === "-h") out.help = true;
  }
  return out;
}

function help() {
  console.log(
    [
      "flashcards-llm-contract-test.mjs",
      "",
      "Options:",
      "  --mode qa|json          Output format to test (default: qa)",
      "  --cards <n>             Card count (default: 10)",
      "  --text <string>         Source text material",
      "  --timeout <ms>          Request timeout in ms (default: 90000)",
      "  --endpoint <url>        Override RUNPOD_ENDPOINT",
      "  --key <token>           Override RUNPOD_API_KEY",
      "  --model <id>            Override RUNPOD_MODEL",
      "",
      "Env:",
      "  RUNPOD_ENDPOINT, RUNPOD_API_KEY, RUNPOD_MODEL (loaded from .env.local/.env)",
      "",
      "Examples:",
      "  node scripts/flashcards-llm-contract-test.mjs --mode qa --cards 10 --text \"Water expands when it freezes...\"",
      "  node scripts/flashcards-llm-contract-test.mjs --mode json --cards 10 --text \"Water expands when it freezes...\"",
    ].join("\n")
  );
}

function buildChatBaseFromRunEndpoint(runEndpoint) {
  const url = new URL(runEndpoint);
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length < 2 || parts[0] !== "v2") throw new Error("RUNPOD_ENDPOINT must look like https://api.runpod.ai/v2/<id>/run");
  const endpointId = parts[1];
  return `${url.protocol}//${url.host}/v2/${endpointId}/openai/v1`;
}

function normalizeLine(line) {
  let s = String(line || "").trim();
  s = s.replace(/^[-*>\u2022]+\s+/, "");
  s = s.replace(/^\*\*(Q|Question|A|Answer)\*\*\s*([:\-])/i, "$1$2");
  s = s.replace(/^__(Q|Question|A|Answer)__\s*([:\-])/i, "$1$2");
  return s.trim();
}

function parseCardsFromQA(text, n) {
  const normalized = String(text || "").replace(/\r\n/g, "\n");
  const out = [];
  const lines = normalized
    .split("\n")
    .map(normalizeLine)
    .filter((l) => l.length > 0 && l !== "</final>");

  const isSep = (l) => l === "---" || l === "***";
  const isQ = (l) => /^(?:\d+\s*[).\-]\s*)?(?:Q|Question)\s*[:\-]/i.test(l);
  const isA = (l) => /^(?:\d+\s*[).\-]\s*)?(?:A|Answer)\s*[:\-]/i.test(l);
  const stripLabel = (l) => l.replace(/^(?:\d+\s*[).\-]\s*)?(?:Q|Question|A|Answer)\s*[:\-]\s*/i, "");

  let currentQ = "";
  let currentA = "";
  let mode = "none";

  const flush = () => {
    const q = String(currentQ || "").trim();
    const a = String(currentA || "").trim();
    if (q && a) out.push({ q, a });
    currentQ = "";
    currentA = "";
    mode = "none";
  };

  for (const line of lines) {
    if (out.length >= n) break;
    if (isSep(line)) {
      flush();
      continue;
    }

    if (isQ(line) && /\b(?:A|Answer)\s*[:\-]/i.test(line)) {
      const parts = line.split(/\b(?:A|Answer)\s*[:\-]\s*/i);
      const qPart = stripLabel(parts[0] || "");
      const aPart = parts.slice(1).join(" ");
      currentQ = qPart;
      currentA = aPart;
      flush();
      continue;
    }

    if (isQ(line)) {
      if (currentQ || currentA) flush();
      mode = "q";
      currentQ += (currentQ ? " " : "") + stripLabel(line);
      continue;
    }

    if (isA(line)) {
      mode = "a";
      currentA += (currentA ? " " : "") + stripLabel(line);
      continue;
    }

    if (mode === "q") currentQ += (currentQ ? " " : "") + line;
    else if (mode === "a") currentA += (currentA ? " " : "") + line;
  }

  if (out.length < n) flush();
  return out.length ? out : null;
}

function extractFirstJsonObjectOrArray(s) {
  const text = String(s || "");
  const start = Math.min(...[text.indexOf("{"), text.indexOf("[")].filter((i) => i >= 0));
  if (!Number.isFinite(start)) return null;

  const opener = text[start];
  const closer = opener === "{" ? "}" : "]";

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }

    if (ch === opener) depth++;
    if (ch === closer) {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }

  return null;
}

async function fetchJson(url, headers) {
  const resp = await fetch(url, { method: "GET", headers });
  const text = await resp.text().catch(() => "");
  return { resp, text };
}

async function postJson(url, headers, body, timeoutMs) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await resp.text().catch(() => "");
    return { resp, text };
  } finally {
    clearTimeout(t);
  }
}

async function main() {
  const repoRoot = process.cwd();
  loadDotenvLike(path.join(repoRoot, ".env.local"));
  loadDotenvLike(path.join(repoRoot, ".env"));

  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    help();
    process.exit(0);
  }

  const runEndpoint = args.endpoint || process.env.RUNPOD_ENDPOINT;
  const apiKey = args.key || process.env.RUNPOD_API_KEY;
  const model = args.model || process.env.RUNPOD_MODEL || "deepseek-r1";
  const n = Math.min(Math.max(Number(args.cards) || 10, 3), 50);

  if (!runEndpoint) throw new Error("Missing RUNPOD_ENDPOINT");
  if (!apiKey) throw new Error("Missing RUNPOD_API_KEY");
  if (!args.text) throw new Error("Missing --text");

  const auth = apiKey.trim().toLowerCase().startsWith("bearer ") ? apiKey.trim() : `Bearer ${apiKey.trim()}`;
  const base = buildChatBaseFromRunEndpoint(runEndpoint);
  const modelsUrl = `${base}/models`;
  const chatUrl = `${base}/chat/completions`;

  const headers = { Authorization: auth, "Content-Type": "application/json" };

  console.log("[contract] base:", base);
  console.log("[contract] models:", modelsUrl);
  console.log("[contract] mode:", args.mode);

  const modelsRes = await fetchJson(modelsUrl, headers);
  console.log("[contract] GET /models ->", modelsRes.resp.status);
  let discoveredModelId = null;
  try {
    if (modelsRes.resp.ok) {
      const j = JSON.parse(modelsRes.text);
      discoveredModelId = typeof j?.data?.[0]?.id === "string" ? j.data[0].id : null;
    }
  } catch {
    // ignore
  }

  const effectiveModel = discoveredModelId || model;
  if (discoveredModelId) console.log("[contract] discovered model:", discoveredModelId);
  console.log("[contract] chat model used:", effectiveModel);

  if (String(args.mode).toLowerCase() === "qa") {
    const prompt = `Generate EXACTLY ${n} flashcards from the material.\n\nABSOLUTE OUTPUT FORMAT (NO JSON):\n- Output ONLY flashcards in this repeated block format.\n- No preface, no explanation, no markdown, no code fences, no numbering.\n- The FIRST characters of your response MUST be 'Q:' (no leading whitespace).\n\nFormat (repeat EXACTLY ${n} times):\nQ: <question>\nA: <answer>\n---\n\nAfter the final '---', output the single token:\n</final>\n\nMaterial:\n${args.text}`;

    const body = {
      model: effectiveModel,
      messages: [
        { role: "system", content: "You are a flashcard generator. Output ONLY Q/A blocks in the required format. No reasoning. No extra text." },
        { role: "user", content: prompt },
      ],
      temperature: 0,
      max_tokens: 1400,
      stop: ["</final>"],
    };

    const res = await postJson(chatUrl, headers, body, args.timeoutMs);
    console.log("[contract] POST /chat/completions ->", res.resp.status);
    if (!res.resp.ok) {
      console.log(res.text.slice(0, 800));
      process.exit(2);
    }

    let content = null;
    try {
      const j = JSON.parse(res.text);
      content = j?.choices?.[0]?.message?.content ?? null;
    } catch {
      content = null;
    }

    if (!content) {
      console.log("[contract] no content");
      console.log(res.text.slice(0, 800));
      process.exit(3);
    }

    const cards = parseCardsFromQA(content, n);
    console.log("[contract] raw preview:", String(content).slice(0, 240));
    console.log("[contract] parsed:", cards ? `${cards.length}/${n}` : "0");

    if (!cards || cards.length < n) {
      console.log("[contract] FAIL: could not parse required Q/A cards");
      process.exit(10);
    }

    console.log("[contract] PASS");
    console.log("[contract] first card:");
    console.log(cards[0]);
    process.exit(0);
  }

  if (String(args.mode).toLowerCase() === "json") {
    const schema = {
      type: "object",
      additionalProperties: false,
      required: ["cards"],
      properties: {
        cards: {
          type: "array",
          minItems: n,
          maxItems: n,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["q", "a"],
            properties: {
              q: { type: "string", minLength: 6, maxLength: 200 },
              a: { type: "string", minLength: 6, maxLength: 400 },
            },
          },
        },
      },
    };

    const body = {
      model: effectiveModel,
      messages: [
        { role: "system", content: "Output ONLY valid JSON that matches the provided schema. No reasoning. No extra text." },
        { role: "user", content: `Create exactly ${n} flashcards from the material.` },
        { role: "user", content: `Material:\n${args.text}` },
      ],
      temperature: 0,
      max_tokens: 1600,
      response_format: {
        type: "json_schema",
        json_schema: { name: "flashcards", schema },
      },
    };

    const res = await postJson(chatUrl, headers, body, args.timeoutMs);
    console.log("[contract] POST /chat/completions ->", res.resp.status);
    if (!res.resp.ok) {
      console.log(res.text.slice(0, 800));
      process.exit(2);
    }

    let content = null;
    try {
      const j = JSON.parse(res.text);
      content = j?.choices?.[0]?.message?.content ?? null;
    } catch {
      content = null;
    }

    if (!content) {
      console.log("[contract] no content");
      console.log(res.text.slice(0, 800));
      process.exit(3);
    }

    const extracted = extractFirstJsonObjectOrArray(content) || content;
    let parsed = null;
    try {
      parsed = JSON.parse(extracted);
    } catch {
      parsed = null;
    }

    const cards = parsed?.cards;
    console.log("[contract] raw preview:", String(content).slice(0, 240));
    console.log("[contract] parsed cards:", Array.isArray(cards) ? `${cards.length}/${n}` : "0");

    if (!Array.isArray(cards) || cards.length < n) {
      console.log("[contract] FAIL: could not parse required JSON cards");
      process.exit(11);
    }

    console.log("[contract] PASS");
    console.log("[contract] first card:");
    console.log(cards[0]);
    process.exit(0);
  }

  if (String(args.mode).toLowerCase() === "json-array") {
    const schema = {
      type: "array",
      minItems: n,
      maxItems: n,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["q", "a"],
        properties: {
          q: { type: "string", minLength: 6, maxLength: 200 },
          a: { type: "string", minLength: 6, maxLength: 400 },
        },
      },
    };

    const body = {
      model: effectiveModel,
      messages: [
        { role: "system", content: "Output ONLY valid JSON that matches the provided schema. No reasoning. No extra text." },
        { role: "user", content: `Create exactly ${n} flashcards from the material.` },
        { role: "user", content: `Material:\n${args.text}` },
      ],
      temperature: 0,
      max_tokens: 1600,
      response_format: {
        type: "json_schema",
        json_schema: { name: "flashcards", schema },
      },
    };

    const res = await postJson(chatUrl, headers, body, args.timeoutMs);
    console.log("[contract] POST /chat/completions ->", res.resp.status);
    if (!res.resp.ok) {
      console.log(res.text.slice(0, 800));
      process.exit(2);
    }

    let content = null;
    try {
      const j = JSON.parse(res.text);
      content = j?.choices?.[0]?.message?.content ?? null;
    } catch {
      content = null;
    }

    if (!content) {
      console.log("[contract] no content");
      console.log(res.text.slice(0, 800));
      process.exit(3);
    }

    const extracted = extractFirstJsonObjectOrArray(content) || content;
    let parsed = null;
    try {
      parsed = JSON.parse(extracted);
    } catch {
      parsed = null;
    }

    console.log("[contract] raw preview:", String(content).slice(0, 240));
    console.log("[contract] parsed cards:", Array.isArray(parsed) ? `${parsed.length}/${n}` : "0");

    if (!Array.isArray(parsed) || parsed.length < n) {
      console.log("[contract] FAIL: could not parse required JSON-array cards");
      process.exit(12);
    }

    console.log("[contract] PASS");
    console.log("[contract] first card:");
    console.log(parsed[0]);
    process.exit(0);
  }

  throw new Error(`Unknown --mode: ${args.mode}`);
}

main().catch((e) => {
  console.error("[contract] ERROR:", e?.stack || e);
  process.exit(1);
});
