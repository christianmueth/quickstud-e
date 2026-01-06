#!/usr/bin/env node
/**
 * Probes RunPod vLLM OpenAI-compatible endpoints.
 *
 * Usage (PowerShell):
 *   node scripts/runpod-openai-probe.mjs
 *
 * Requires env:
 *   RUNPOD_ENDPOINT=https://api.runpod.ai/v2/<id>/run
 *   RUNPOD_API_KEY=rpa_...
 *   RUNPOD_MODEL=...
 */

import process from "process";
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
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      args[key] = true;
    } else {
      args[key] = next;
      i++;
    }
  }
  return args;
}

function printHelp() {
  console.log(`RunPod OpenAI-compat probe\n\nUsage (PowerShell):\n  node scripts/runpod-openai-probe.mjs --endpoint <RUNPOD_ENDPOINT> --key <RUNPOD_API_KEY> [--model <RUNPOD_MODEL>]\n\nEnv alternatives:\n  RUNPOD_ENDPOINT, RUNPOD_API_KEY, RUNPOD_MODEL\n\nExample:\n  node scripts/runpod-openai-probe.mjs --endpoint https://api.runpod.ai/v2/<id>/run --key rpa_xxx --model deepseek-r1\n`);
}

function die(msg) {
  console.error(msg);
  process.exit(1);
}

function safeSlice(s, n = 400) {
  return String(s || "").slice(0, n);
}

function buildCandidates(runEndpoint) {
  const url = new URL(runEndpoint);
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length < 2 || parts[0] !== "v2") {
    return [];
  }
  const endpointId = parts[1];
  const base = `${url.protocol}//${url.host}`;
  return [
    {
      label: "patternA",
      base: `${base}/v2/${endpointId}/openai/v1`,
    },
    {
      label: "patternB",
      base: `${base}/v2/vllm-${endpointId}/openai/v1`,
    },
  ];
}

async function fetchText(url, headers, body) {
  const resp = await fetch(url, {
    method: body ? "POST" : "GET",
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await resp.text().catch(() => "");
  return { status: resp.status, ok: resp.ok, text };
}

async function main() {
  // Load local env files to make running this probe easy.
  const repoRoot = process.cwd();
  loadDotenvLike(path.join(repoRoot, ".env.local"));
  loadDotenvLike(path.join(repoRoot, ".env"));

  const args = parseArgs(process.argv.slice(2));
  if (args.help || args.h) {
    printHelp();
    return;
  }

  const runEndpoint = args.endpoint || process.env.RUNPOD_ENDPOINT;
  const apiKey = args.key || process.env.RUNPOD_API_KEY;
  const model = args.model || process.env.RUNPOD_MODEL || "deepseek-r1";

  if (!runEndpoint || !apiKey) {
    printHelp();
  }
  if (!runEndpoint) die("Missing RUNPOD_ENDPOINT (or --endpoint)");
  if (!apiKey) die("Missing RUNPOD_API_KEY (or --key)");

  const auth = apiKey.toLowerCase().startsWith("bearer ") ? apiKey : `Bearer ${apiKey}`;
  const headers = {
    Authorization: auth,
    "Content-Type": "application/json",
  };

  const candidates = buildCandidates(runEndpoint);
  if (!candidates.length) die(`Could not derive candidates from RUNPOD_ENDPOINT: ${runEndpoint}`);

  console.log("RunPod OpenAI-compat probe");
  console.log("RUNPOD_ENDPOINT:", runEndpoint);
  console.log("Candidates:", candidates.map((c) => c.base).join(" | "));
  console.log("RUNPOD_MODEL:", model);

  for (const c of candidates) {
    console.log("\n==", c.label, c.base, "==");

    const modelsUrl = `${c.base}/models`;
    const modelsRes = await fetchText(modelsUrl, headers);
    console.log("GET /models ->", modelsRes.status);
    console.log(safeSlice(modelsRes.text, 600));

    let discoveredModelId = null;
    try {
      if (modelsRes.ok) {
        const j = JSON.parse(modelsRes.text);
        discoveredModelId = typeof j?.data?.[0]?.id === "string" ? j.data[0].id : null;
      }
    } catch {
      // ignore
    }

    const effectiveModel =
      model && model !== "deepseek-r1" ? model : discoveredModelId || model;
    if (discoveredModelId) console.log("Discovered model id:", discoveredModelId);
    console.log("Chat model used:", effectiveModel);

    const chatUrl = `${c.base}/chat/completions`;

    // 1) Plain chat (no response_format)
    const plainBody = {
      model: effectiveModel,
      messages: [{ role: "user", content: "Reply with exactly: OK" }],
      temperature: 0,
      max_tokens: 8,
    };
    const plainRes = await fetchText(chatUrl, headers, plainBody);
    console.log("POST /chat/completions (plain) ->", plainRes.status);
    console.log(safeSlice(plainRes.text, 800));

    // 2) json_object (commonly supported)
    const jsonObjBody = {
      model: effectiveModel,
      messages: [{ role: "user", content: "Return a JSON object: {\"ok\":\"OK\"}. JSON only." }],
      temperature: 0,
      max_tokens: 32,
      response_format: { type: "json_object" },
    };
    const jsonObjRes = await fetchText(chatUrl, headers, jsonObjBody);
    console.log("POST /chat/completions (json_object) ->", jsonObjRes.status);
    console.log(safeSlice(jsonObjRes.text, 800));

    // 3) json_schema (newer; may 500 on some deployments)
    const jsonSchemaBody = {
      model: effectiveModel,
      messages: [{ role: "user", content: "Return JSON only that matches the schema." }],
      temperature: 0,
      max_tokens: 32,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "ok",
          schema: {
            type: "object",
            additionalProperties: false,
            required: ["ok"],
            properties: { ok: { type: "string" } },
          },
        },
      },
    };
    const jsonSchemaRes = await fetchText(chatUrl, headers, jsonSchemaBody);
    console.log("POST /chat/completions (json_schema) ->", jsonSchemaRes.status);
    console.log(safeSlice(jsonSchemaRes.text, 800));
  }
}

main().catch((e) => {
  console.error("Probe failed:", e?.stack || e);
  process.exit(1);
});
