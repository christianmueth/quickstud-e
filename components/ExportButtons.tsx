"use client";
import { useState } from "react";

export default function ExportButtons({ deckId }: { deckId: string }) {
  const [busy, setBusy] = useState<string | null>(null);

  async function download(fmt: "csv" | "tsv" | "anki-tsv") {
    if (busy) return;
    setBusy(fmt);
    try {
      const res = await fetch(`/api/deck/${deckId}/export?fmt=${fmt}`, { cache: "no-store" });
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fmt === "csv" ? "deck.csv" : "deck.tsv";
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex gap-2">
      <button className="text-sm px-3 py-1.5 rounded border" onClick={() => download("csv")} disabled={!!busy}>
        {busy === "csv" ? "…" : "Export CSV"}
      </button>
      <button className="text-sm px-3 py-1.5 rounded border" onClick={() => download("tsv")} disabled={!!busy}>
        {busy === "tsv" ? "…" : "Export TSV"}
      </button>
      <button className="text-sm px-3 py-1.5 rounded border" title="Anki can import TSV" onClick={() => download("anki-tsv")} disabled={!!busy}>
        {busy === "anki-tsv" ? "…" : "Export Anki (TSV)"}
      </button>
    </div>
  );
}
