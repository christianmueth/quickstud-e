"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

export default function AddCardForm({ deckId }: { deckId: string }) {
  const [q, setQ] = useState("");
  const [a, setA] = useState("");
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  async function add() {
    if (!q.trim() || !a.trim() || busy) return;
    setBusy(true);
    const t = toast.loading("Adding card…");
    try {
      const res = await fetch(`/api/deck/${deckId}/card`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q, answer: a }),
      });
      if (!res.ok) throw new Error("Add failed");
      toast.success("Card added");
      setQ(""); setA("");
      router.refresh();
    } catch (e: any) {
      toast.error(e?.message || "Add failed");
    } finally {
      toast.dismiss(t);
      setBusy(false);
    }
  }

  return (
    <div className="rounded border p-4 space-y-3">
      <h3 className="font-medium">Add a card</h3>
      <input
        value={q} onChange={(e) => setQ(e.target.value)}
        placeholder="Question"
        className="w-full border rounded p-2"
        maxLength={500}
      />
      <textarea
        value={a} onChange={(e) => setA(e.target.value)}
        placeholder="Answer"
        className="w-full border rounded p-2 h-28"
        maxLength={2000}
      />
      <button className="px-3 py-1.5 rounded bg-black text-white disabled:opacity-60" onClick={add} disabled={busy}>
        {busy ? "Adding…" : "Add card"}
      </button>
    </div>
  );
}
