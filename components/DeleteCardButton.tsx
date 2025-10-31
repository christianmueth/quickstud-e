"use client";
import { useState } from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";

export default function DeleteCardButton({ cardId }: { cardId: string }) {
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  async function onDelete() {
    if (busy) return;
    if (!confirm("Delete this card?")) return;

    setBusy(true);
    try {
      const res = await fetch(`/api/card/${cardId}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Delete failed");
      toast.success("Card deleted");
      router.refresh(); // ✅ re-renders the server page without a function prop
    } catch (e: any) {
      toast.error(e?.message || "Delete failed");
      setBusy(false);
    }
  }

  return (
    <button className="text-sm px-2 py-1 rounded bg-gray-200 hover:bg-gray-300" onClick={onDelete} disabled={busy}>
      {busy ? "…" : "Delete"}
    </button>
  );
}
