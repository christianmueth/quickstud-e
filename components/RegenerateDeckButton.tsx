"use client";
import { useState } from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";

export default function RegenerateDeckButton({ deckId }: { deckId: string }) {
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  async function onClick() {
    if (busy) return;
    const count = Number(prompt("How many new study prompts should this set add? (5-50)", "12"));
    if (!count || isNaN(count)) return;

    setBusy(true);
    const t = toast.loading("Refreshing study focus...");
    try {
      const res = await fetch(`/api/deck/${deckId}/regenerate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ count, temperature: 0.2, append: false }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Failed");
      toast.success(`Added ${json.added} new study prompts`);
      router.refresh();
    } catch (e: any) {
      toast.error(e?.message || "Could not refresh study focus");
    } finally {
      toast.dismiss(t); setBusy(false);
    }
  }

  return (
    <button className="text-sm px-3 py-1.5 rounded border" onClick={onClick} disabled={busy}>
      {busy ? "Refreshing..." : "Refresh guidance"}
    </button>
  );
}
