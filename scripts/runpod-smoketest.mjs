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
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

async function main() {
  const repoRoot = process.cwd();
  loadDotenvLike(path.join(repoRoot, ".env.local"));
  loadDotenvLike(path.join(repoRoot, ".env"));

  const endpoint = process.env.RUNPOD_ENDPOINT;
  const apiKey = process.env.RUNPOD_API_KEY;
  const model = process.env.RUNPOD_MODEL || "deepseek-r1";

  if (!endpoint) {
    console.error("RUNPOD_ENDPOINT missing");
    process.exit(1);
  }
  if (!apiKey) {
    console.error("RUNPOD_API_KEY missing");
    process.exit(1);
  }

  const auth = apiKey.trim().toLowerCase().startsWith("bearer ")
    ? apiKey.trim()
    : `Bearer ${apiKey.trim()}`;

  const payload = {
    input: {
      model,
      messages: [{ role: "user", content: "Say hi" }],
      max_tokens: 30,
      temperature: 0,
    },
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: auth,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    const text = await res.text().catch(() => "");
    const preview = (text || "").slice(0, 600);

    console.log(JSON.stringify({
      endpoint: endpoint.replace(/^https?:\/\//, "").slice(0, 120),
      status: res.status,
      ok: res.ok,
      bodyPreview: preview,
    }, null, 2));

    process.exit(res.ok ? 0 : 2);
  } catch (e) {
    const msg = e?.name === "AbortError" ? "Request timed out" : String(e?.message || e);
    console.error(JSON.stringify({ endpoint: endpoint.replace(/^https?:\/\//, "").slice(0, 120), error: msg }, null, 2));
    process.exit(3);
  } finally {
    clearTimeout(timeout);
  }
}

main();
